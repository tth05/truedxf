/** Tiny DOM helpers (no framework). */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replaces the children of an element. */
export function mount(el: HTMLElement, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

export function icon(svg: string): HTMLElement {
  const s = document.createElement("span");
  s.style.display = "inline-flex";
  s.innerHTML = svg;
  return s;
}

const P = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  open: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  fit: P('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  select: P('<path d="M5 3l14 8-6 2-2 6z"/>'),
  measure: P('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  moon: P('<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>'),
  sun: P(
    '<circle cx="12" cy="12" r="3.5"/><path d="M18 12h2.5M16.2 16.2l1.8 1.8M12 18v2.5M7.8 16.2L6 18M6 12H3.5M7.8 7.8L6 6M12 6V3.5M16.2 7.8L18 6"/>',
  ),
  weight: P(
    '<path d="M4 6h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2.2"/><path d="M4 18h16" stroke-width="3.6"/>',
  ),
  eye: P('<path d="M2.5 12Q12 1.5 21.5 12Q12 22.5 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P(
    '<path d="M2.5 12Q12 1.5 21.5 12Q12 22.5 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>',
  ),
  file: P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  layout: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'),
  model: P('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  grid: P(
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  ),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  folder: P(
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  ),
  caret: P('<path d="M6 9l6 6 6-6"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  house: P('<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>'),
  minus: P('<path d="M5 12h14"/>'),
  download: P('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>'),
  image: P(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  ),
  copy: P(
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  ),
  print: P(
    '<path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  ),
  keyboard: P(
    '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  ),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  font: P('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  help: P(
    '<circle cx="12" cy="12" r="9"/><path d="M9 9.5Q9 6.5 12 6.5T15 9.5Q15 11 12 12.5V14.5M12 17.5v.01"/>',
  ),
  // Octicons star and mark-github (MIT); filled, unlike the stroked icons above
  star: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
};
