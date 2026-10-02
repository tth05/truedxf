/**
 * three.js renderer for the truedxf display list (docs/PLAN.md §4.2b).
 *
 * Rules: batches are drawn in display-list order (renderOrder, no depth test); colours are passed
 * through unchanged (no colour management / sRGB conversion) so plot colours stay exact; batch
 * geometry is positioned relative to the camera centre in float64 on the CPU (float32 precision);
 * clip regions use the stencil buffer (even-odd via INVERT). Batches with alpha < 255 blend
 * exactly like AutoCAD's plot, out = (src·a + dst·(256 − a)) >> 8 (note 06 §4.2): the frame so
 * far is copied to a texture before such a batch and the shader computes the integer formula.
 */
import type { Batch, ClipRegion, DisplayList, RasterImage } from "@truedxf/render";
import * as THREE from "three";
import { MAX_DEPTH_ORDERS, type MergedPart, mergedGroups, orderCount } from "./merge.ts";

// raw sRGB byte values in, the same values out
THREE.ColorManagement.enabled = false;

/**
 * Bounding sphere for all our geometry: three.js computes spheres for transparent sorting (after
 * uploading, when a released array is gone, and as NaN for our 2-component positions);
 * everything is at z = 0 and never frustum-culled, so any sphere will do.
 */
const UNBOUNDED = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);

const TRIANGLES = 0;
const LINES = 1;
const IMAGE = 3;

export interface RendererOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /** Default false: aliased output, as needed for exact comparisons. */
  antialias?: boolean;
  /** Needed for readPixels after rendering (tests). */
  preserveDrawingBuffer?: boolean;
  /** Device pixel ratio (default 1). */
  pixelRatio?: number;
  /**
   * Blend transparent batches with AutoCAD's integer plot formula (default true; needs a frame
   * copy per transparent batch). false: ordinary alpha blending, for interactive viewers.
   */
  exactBlend?: boolean;
  /** Merge opaque batches using depth for painter order (default false). Ignored with exactBlend. */
  mergeBatches?: boolean;
  /**
   * Drop the renderer's references to vertex arrays after they are uploaded to the GPU (PLAN
   * §4.2b memory budget). The caller's DisplayList still references them; release it too to free
   * the memory. Default false (tests re-read nothing, but keep the classic behaviour).
   */
  releaseArrays?: boolean;
}

export interface View {
  /** World coordinates of the visible window. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Stencil test of clipped objects: drawn where a clip mask (DisplayListRenderer.clipMaskObjects)
 * left a non-zero stencil value.
 */
export const CLIPPED_STENCIL = {
  stencilWrite: true,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilRef: 0,
  stencilZPass: THREE.KeepStencilOp,
} as const;

interface BatchObject {
  object: THREE.Object3D;
  originX: number;
  originY: number;
}

export class DisplayListRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private objects: BatchObject[] = [];
  private list: DisplayList | undefined;
  /** Textures of DisplayList.images (shared by the batches of one list). */
  private textures = new Map<RasterImage, THREE.DataTexture>();
  /** Copy of the frame below a transparent batch (sized in render()). */
  private under: THREE.FramebufferTexture | undefined;
  private readonly underSize = { value: new THREE.Vector2(1, 1) };
  /** Group for user content drawn on top of the drawing (children in world coordinates). */
  readonly overlay = new THREE.Group();
  /** Group for user content drawn below the drawing (children in world coordinates). */
  readonly underlay = new THREE.Group();
  private readonly exactBlend: boolean;
  private readonly releaseArrays: boolean;
  private readonly mergeBatches: boolean;
  private merged = false;
  private readonly underlayScene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private centerX = 0;
  private centerY = 0;

  constructor(options: RendererOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas as HTMLCanvasElement | undefined,
      antialias: options.antialias ?? false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      stencil: true,
      alpha: false,
      premultipliedAlpha: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(options.pixelRatio ?? 1);
    this.renderer.sortObjects = true;
    this.renderer.autoClearStencil = true;
    this.overlay.renderOrder = Number.MAX_SAFE_INTEGER;
    this.scene.add(this.overlay);
    // group render order sorts before the batches' renderOrder (three.js groupOrder)
    this.underlay.renderOrder = -1;
    this.scene.add(this.underlay);
    this.exactBlend = options.exactBlend ?? true;
    this.releaseArrays = options.releaseArrays ?? false;
    this.mergeBatches = (options.mergeBatches ?? false) && !this.exactBlend;
  }

  setDisplayList(list: DisplayList): void {
    this.clear();
    this.list = list;
    const [r, g, b] = list.background;
    this.renderer.setClearColor(new THREE.Color(r / 255, g / 255, b / 255), 1);
    const count = this.mergeBatches ? orderCount(list) : 0;
    this.merged = this.mergeBatches && count <= MAX_DEPTH_ORDERS;
    if (this.merged) {
      this.underlayScene.add(this.underlay);
      this.overlayScene.add(this.overlay);
      this.setMergedList(list, count);
      if (this.releaseArrays) this.list = undefined;
      return;
    }
    if (this.underlay.parent !== this.scene) this.scene.add(this.underlay, this.overlay);
    let order = 0;
    let activeClip = -1;
    for (const batch of list.batches) {
      if (batch.clip !== activeClip) {
        // reset stencil, then write the new clip region
        this.addStencilReset(order++);
        if (batch.clip >= 0) order = this.addClipMask(batch.clip, order);
        activeClip = batch.clip;
      }
      const obj = this.createBatch(batch, activeClip >= 0);
      obj.renderOrder = order++;
      this.scene.add(obj);
      this.objects.push({ object: obj, originX: batch.originX, originY: batch.originY });
    }
    // the list is only needed while building (images, clips)
    if (this.releaseArrays) this.list = undefined;
  }

  private setMergedList(list: DisplayList, count: number): void {
    const materials = new Map<string, THREE.Material>();
    let order = 0;
    let activeClip = -1;
    for (const group of mergedGroups(list, count)) {
      if (group.clip !== activeClip) {
        this.addStencilReset(order++);
        if (group.clip >= 0) order = this.addClipMask(group.clip, order);
        activeClip = group.clip;
      }
      for (const part of group.parts) {
        const clipped = group.clip >= 0;
        const geom = new THREE.BufferGeometry();
        geom.boundingSphere = UNBOUNDED.clone();
        geom.setAttribute("position", this.attribute(part.positions, 3));
        geom.setAttribute("color", this.attribute(part.colors, 4, true));
        const key = `${part.kind}/${clipped}/${!!part.batch}`;
        let mat = part.kind === IMAGE ? undefined : materials.get(key);
        if (!mat) {
          const common = {
            vertexColors: true,
            // Clip masks and their opaque content must share the transparent queue.
            // Unclipped opaque content can run first: global depth rejects anything behind it.
            transparent: clipped || !!part.batch,
            blending: part.batch ? THREE.NormalBlending : THREE.NoBlending,
            depthTest: true,
            depthWrite: true,
            depthFunc: THREE.LessEqualDepth,
            ...CLIPPED_STENCIL,
            stencilWrite: clipped,
          };
          mat =
            part.kind === TRIANGLES || part.kind === IMAGE
              ? new THREE.MeshBasicMaterial({ ...common, side: THREE.DoubleSide })
              : part.kind === LINES
                ? new THREE.LineBasicMaterial(common)
                : new THREE.PointsMaterial({ ...common, size: 1, sizeAttenuation: false });
          if (part.kind !== IMAGE) materials.set(key, mat);
        }
        this.setImage(part, geom, mat);
        const obj =
          part.kind === TRIANGLES || part.kind === IMAGE
            ? new THREE.Mesh(geom, mat)
            : part.kind === LINES
              ? new THREE.LineSegments(geom, mat)
              : new THREE.Points(geom, mat);
        // Avoid three.js's extra back/front passes for double-sided transparent meshes.
        mat.forceSinglePass = true;
        obj.frustumCulled = false;
        obj.renderOrder = order++;
        this.scene.add(obj);
        this.objects.push({ object: obj, originX: group.originX, originY: group.originY });
      }
    }
  }

  private setImage(part: MergedPart, geom: THREE.BufferGeometry, mat: THREE.Material): void {
    const batch = part.batch;
    if (batch?.kind === IMAGE && batch.uvs && batch.image !== undefined) {
      geom.setAttribute("uv", this.attribute(batch.uvs, 2));
      (mat as THREE.MeshBasicMaterial).map = this.texture(this.list!.images[batch.image]!);
    }
  }

  private createBatch(batch: Batch, clipped: boolean): THREE.Object3D {
    const geom = new THREE.BufferGeometry();
    geom.boundingSphere = UNBOUNDED.clone();
    geom.setAttribute("position", this.attribute(batch.positions, 2));
    geom.setAttribute("color", this.attribute(batch.colors, 4, true));
    const common = {
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      ...CLIPPED_STENCIL,
      stencilWrite: clipped,
    } as const;
    let obj: THREE.Object3D;
    if (this.exactBlend && batch.kind !== IMAGE && hasAlpha(batch.colors)) {
      obj = this.createBlendBatch(batch, geom, common);
    } else if (batch.kind === IMAGE && batch.uvs && batch.image !== undefined) {
      geom.setAttribute("uv", this.attribute(batch.uvs, 2));
      const map = this.texture(this.list!.images[batch.image]!);
      obj = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...common, map, side: THREE.DoubleSide }));
    } else if (batch.kind === TRIANGLES)
      obj = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...common, side: THREE.DoubleSide }));
    else if (batch.kind === LINES) obj = new THREE.LineSegments(geom, new THREE.LineBasicMaterial(common));
    else
      obj = new THREE.Points(geom, new THREE.PointsMaterial({ ...common, size: 1, sizeAttenuation: false }));
    obj.frustumCulled = false;
    return obj;
  }

  private attribute(array: Float32Array | Uint8Array, itemSize: number, normalized = false) {
    const a = new THREE.BufferAttribute(array, itemSize, normalized);
    if (this.releaseArrays) a.onUpload(releaseArray);
    return a;
  }

  /** A batch blended with AutoCAD's integer formula against a copy of the frame below it. */
  private createBlendBatch(
    batch: Batch,
    geom: THREE.BufferGeometry,
    common: Partial<THREE.MaterialParameters>,
  ): THREE.Object3D {
    const mat = new THREE.ShaderMaterial({
      ...common,
      // stays in the transparent render list so renderOrder interleaves it with the others
      transparent: true,
      blending: THREE.NoBlending,
      uniforms: { under: { value: null }, size: this.underSize },
      vertexShader: `varying vec4 vC;
void main() {
  vC = color;
  gl_PointSize = 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
}`,
      fragmentShader: `uniform sampler2D under;
uniform vec2 size;
varying vec4 vC;
void main() {
  vec3 d = floor(texture2D(under, gl_FragCoord.xy / size).rgb * 255.0 + 0.5);
  vec3 s = floor(vC.rgb * 255.0 + 0.5);
  float a = floor(vC.a * 255.0 + 0.5);
  gl_FragColor = vec4(floor((s * a + d * (256.0 - a)) / 256.0) / 255.0, 1.0);
}`,
    });
    const obj =
      batch.kind === TRIANGLES
        ? new THREE.Mesh(geom, mat)
        : batch.kind === LINES
          ? new THREE.LineSegments(geom, mat)
          : new THREE.Points(geom, mat);
    obj.onBeforeRender = () => {
      if (!this.under) return;
      this.renderer.copyFramebufferToTexture(this.under);
      mat.uniforms.under!.value = this.under;
    };
    return obj;
  }

  /** Nearest-sampled RGBA texture, rows top first (uv (0,0) = top-left, so no flip). */
  private texture(img: RasterImage): THREE.DataTexture {
    let t = this.textures.get(img);
    if (!t) {
      t = new THREE.DataTexture(img.pixels, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      this.textures.set(img, t);
    }
    return t;
  }

  /**
   * The stencil passes that restrict later objects using {@link CLIPPED_STENCIL} to `region`
   * (a reset, then the region's mask), positioned in world coordinates for `overlay`: give them
   * increasing renderOrders before the clipped objects (e.g. highlights of viewport content).
   */
  clipMaskObjects(region: ClipRegion): THREE.Object3D[] {
    const out: THREE.Object3D[] = [this.stencilReset()];
    for (const { mesh, ox, oy } of this.clipMasks(region)) {
      mesh.position.set(ox, oy, 0);
      out.push(mesh);
    }
    return out;
  }

  private addStencilReset(order: number): void {
    const mesh = this.stencilReset();
    mesh.renderOrder = order;
    this.scene.add(mesh);
    this.objects.push({ object: mesh, originX: Number.NaN, originY: Number.NaN });
  }

  private stencilReset(): THREE.Mesh {
    // full-screen quad in clip space that writes 0 into the stencil buffer
    const geom = new THREE.BufferGeometry();
    geom.boundingSphere = UNBOUNDED.clone();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    const mat = new THREE.ShaderMaterial({
      // three.js declares `attribute vec3 position` itself; our 2-component buffer gives z = 0
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(0.0); }",
      // transparent like the batches: three.js renders all opaque objects before all transparent
      // ones, so stencil passes must be in the same list to keep their renderOrder position
      transparent: true,
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilRef: 0,
      stencilZPass: THREE.ZeroStencilOp,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  private addClipMask(clip: number, order: number): number {
    for (const { mesh, ox, oy } of this.clipMasks(this.list!.clips[clip]!)) {
      mesh.renderOrder = order++;
      this.scene.add(mesh);
      this.objects.push({ object: mesh, originX: ox, originY: oy });
    }
    return order;
  }

  /** Stencil meshes of a clip region, vertices relative to (ox, oy). */
  private clipMasks(region: ClipRegion): { mesh: THREE.Mesh; ox: number; oy: number }[] {
    const out: { mesh: THREE.Mesh; ox: number; oy: number }[] = [];
    for (const ring of region.rings) {
      const n = ring.length >> 1;
      if (n < 3) continue;
      // triangle fan from the first vertex; INVERT gives even-odd coverage for any polygon
      const ox = ring[0]!;
      const oy = ring[1]!;
      const pos = new Float32Array((n - 2) * 6);
      for (let i = 1; i + 1 < n; i++) {
        const k = (i - 1) * 6;
        pos[k + 2] = ring[i * 2]! - ox;
        pos[k + 3] = ring[i * 2 + 1]! - oy;
        pos[k + 4] = ring[i * 2 + 2]! - ox;
        pos[k + 5] = ring[i * 2 + 3]! - oy;
      }
      const geom = new THREE.BufferGeometry();
      geom.boundingSphere = UNBOUNDED.clone();
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 2));
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, // same render list as the batches (see addStencilReset)
        colorWrite: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.InvertStencilOp,
        stencilFail: THREE.InvertStencilOp,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      out.push({ mesh, ox, oy });
    }
    return out;
  }

  /** Sets the canvas size in CSS pixels (drawing buffer = size × pixel ratio). */
  setSize(width: number, height: number, updateStyle = false): void {
    this.renderer.setSize(width, height, updateStyle);
  }

  /** Renders the world window onto the whole canvas. */
  render(view: View): void {
    this.centerX = (view.minX + view.maxX) / 2;
    this.centerY = (view.minY + view.maxY) / 2;
    const hw = (view.maxX - view.minX) / 2;
    const hh = (view.maxY - view.minY) / 2;
    const cam = this.camera;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.position.set(0, 0, 0);
    cam.updateProjectionMatrix();
    for (const o of this.objects) {
      if (Number.isNaN(o.originX)) continue;
      // float64 subtraction on the CPU keeps precision for large world coordinates
      o.object.position.set(o.originX - this.centerX, o.originY - this.centerY, 0);
    }
    this.overlay.position.set(-this.centerX, -this.centerY, 0);
    this.underlay.position.set(-this.centerX, -this.centerY, 0);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (!this.under || this.under.image.width !== w || this.under.image.height !== h) {
      this.under?.dispose();
      this.under = new THREE.FramebufferTexture(w, h);
      this.underSize.value.set(w, h);
    }
    if (this.merged) {
      // Explicit stages preserve host underlays/overlays regardless of their material queue.
      // Stencil passes (including clipped highlights) never write depth.
      const autoClear = this.renderer.autoClear;
      const autoReset = this.renderer.info.autoReset;
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
      try {
        this.renderer.render(this.underlayScene, cam);
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.scene, cam);
        this.renderer.render(this.overlayScene, cam);
      } finally {
        this.renderer.autoClear = autoClear;
        this.renderer.info.autoReset = autoReset;
      }
    } else this.renderer.render(this.scene, cam);
  }

  /** RGBA pixels of the drawing buffer, top row first. Requires preserveDrawingBuffer or a call right after render(). */
  readPixels(): { width: number; height: number; data: Uint8Array } {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    // flip vertically (GL origin is bottom-left)
    const row = width * 4;
    const tmp = new Uint8Array(row);
    for (let y = 0; y < height >> 1; y++) {
      const a = y * row;
      const b = (height - 1 - y) * row;
      tmp.set(data.subarray(a, a + row));
      data.copyWithin(a, b, b + row);
      data.set(tmp, b);
    }
    return { width, height, data };
  }

  clear(): void {
    const disposed = new Set<THREE.Material>();
    for (const o of this.objects) {
      this.scene.remove(o.object);
      const m = o.object as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        if (!disposed.has(x)) x.dispose();
        disposed.add(x);
      }
    }
    this.objects = [];
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.list = undefined;
  }

  dispose(): void {
    this.clear();
    this.under?.dispose();
    this.renderer.dispose();
  }
}

function releaseArray(this: THREE.BufferAttribute): void {
  // three.js keeps `count` and the GPU buffer; the CPU copy is no longer needed
  (this as { array: unknown }).array = null;
}

function hasAlpha(colors: Uint8Array): boolean {
  for (let i = 3; i < colors.length; i += 4) if (colors[i]! < 255) return true;
  return false;
}
