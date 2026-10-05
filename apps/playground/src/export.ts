/**
 * Export of the current view: PNG download, clipboard copy and printing. All of it uses
 * `DxfViewer.snapshot()` (the canvas at its device resolution), nothing leaves the browser.
 */
import type { DxfViewer } from "@truedxf/viewer";

/** File name for an export: the drawing's name without .dxf, plus the layout. */
export function exportName(viewer: DxfViewer, ext: string): string {
  const base = (viewer.document?.name ?? "drawing").replace(/\.dxf$/i, "");
  const layout = viewer.layout && viewer.layout !== "Model" ? ` - ${viewer.layout}` : "";
  return `${base}${layout}.${ext}`.replace(/[\\/:*?"<>|]/g, "_");
}

export async function savePng(viewer: DxfViewer): Promise<void> {
  const blob = await viewer.snapshot("image/png");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportName(viewer, "png");
  document.body.append(a);
  a.click();
  a.remove();
  // the download has started from the URL; revoke it once the click has been handled
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canCopyImage = () =>
  typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";

export async function copyPng(viewer: DxfViewer): Promise<void> {
  // a promise as the item's data keeps Safari's user-activation window (it expires on await)
  await navigator.clipboard.write([new ClipboardItem({ "image/png": viewer.snapshot("image/png") })]);
}

/**
 * Prints the current view as an image on its own page (print.css rules in style.css). A dark
 * model space is printed on a white background: the viewer re-renders with light colours first
 * (ACI 7 turns black) and switches back afterwards.
 */
export async function printView(viewer: DxfViewer, host: HTMLElement): Promise<void> {
  const dark = viewer.isDark;
  if (dark) await renderedWith(viewer, () => viewer.setBackground("light"));
  let blob: Blob;
  try {
    blob = await viewer.snapshot("image/png");
  } finally {
    if (dark) viewer.setBackground("dark");
  }
  const url = URL.createObjectURL(blob);
  const img = document.createElement("img");
  img.alt = viewer.document?.name ?? "drawing";
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error("could not prepare the print image"));
    img.src = url;
  });
  host.replaceChildren(img);
  const done = () => {
    host.replaceChildren();
    URL.revokeObjectURL(url);
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

/** Runs `change` and resolves after the next render (or after 5 s without one). */
function renderedWith(viewer: DxfViewer, change: () => void): Promise<void> {
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      resolve();
    }, 5000);
    off = viewer.on("render", () => {
      clearTimeout(timer);
      off();
      resolve();
    });
    change();
  });
}
