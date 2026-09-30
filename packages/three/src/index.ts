/**
 * three.js renderer for the truedxf display list (docs/PLAN.md §4.2b).
 *
 * Rules: batches are drawn in display-list order (renderOrder, no depth test); colours are passed
 * through unchanged (no colour management / sRGB conversion) so plot colours stay exact; batch
 * geometry is positioned relative to the camera centre in float64 on the CPU (float32 precision);
 * clip regions use the stencil buffer (even-odd via INVERT).
 */
import type { Batch, DisplayList } from "@truedxf/render";
import * as THREE from "three";

// raw sRGB byte values in, the same values out
THREE.ColorManagement.enabled = false;

const TRIANGLES = 0;
const LINES = 1;

export interface RendererOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /** Default false: aliased output, as needed for exact comparisons. */
  antialias?: boolean;
  /** Needed for readPixels after rendering (tests). */
  preserveDrawingBuffer?: boolean;
  /** Device pixel ratio (default 1). */
  pixelRatio?: number;
}

export interface View {
  /** World coordinates of the visible window. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

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
  /** Group for user content drawn on top of the drawing (world coordinates via `worldGroup`). */
  readonly overlay = new THREE.Group();
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
  }

  setDisplayList(list: DisplayList): void {
    this.clear();
    this.list = list;
    const [r, g, b] = list.background;
    this.renderer.setClearColor(new THREE.Color(r / 255, g / 255, b / 255), 1);
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
  }

  private createBatch(batch: Batch, clipped: boolean): THREE.Object3D {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(batch.positions, 2));
    geom.setAttribute("color", new THREE.BufferAttribute(batch.colors, 4, true));
    const common = {
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      stencilWrite: clipped,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilRef: 0,
      stencilZPass: THREE.KeepStencilOp,
    } as const;
    let obj: THREE.Object3D;
    if (batch.kind === TRIANGLES)
      obj = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...common, side: THREE.DoubleSide }));
    else if (batch.kind === LINES) obj = new THREE.LineSegments(geom, new THREE.LineBasicMaterial(common));
    else
      obj = new THREE.Points(geom, new THREE.PointsMaterial({ ...common, size: 1, sizeAttenuation: false }));
    obj.frustumCulled = false;
    return obj;
  }

  private addStencilReset(order: number): void {
    // full-screen quad in clip space that writes 0 into the stencil buffer
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    const mat = new THREE.ShaderMaterial({
      // three.js declares `attribute vec3 position` itself; our 2-component buffer gives z = 0
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(0.0); }",
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
    mesh.renderOrder = order;
    this.scene.add(mesh);
    this.objects.push({ object: mesh, originX: Number.NaN, originY: Number.NaN });
  }

  private addClipMask(clip: number, order: number): number {
    const region = this.list!.clips[clip]!;
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
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 2));
      const mat = new THREE.MeshBasicMaterial({
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
      mesh.renderOrder = order++;
      this.scene.add(mesh);
      this.objects.push({ object: mesh, originX: ox, originY: oy });
    }
    return order;
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
    this.renderer.render(this.scene, cam);
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
    for (const o of this.objects) {
      this.scene.remove(o.object);
      const m = o.object as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else mat?.dispose();
    }
    this.objects = [];
    this.list = undefined;
  }

  dispose(): void {
    this.clear();
    this.renderer.dispose();
  }
}
