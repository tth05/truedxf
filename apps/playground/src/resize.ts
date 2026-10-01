/**
 * Resizable layout: sidebar widths (drag the inner edge) and the heights of the panels inside a
 * sidebar (drag the line between two panels). Sizes are remembered in localStorage.
 */

const KEY = "truedxf.layout";

type Sizes = Record<string, number>;

function loadSizes(): Sizes {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Sizes) : {};
  } catch {
    return {};
  }
}

const sizes: Sizes = loadSizes();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // storage unavailable
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Calls `move(dx, dy)` while the pointer is dragged from `handle`, then `end()`. */
function drag(
  handle: HTMLElement,
  start: () => void,
  move: (dx: number, dy: number) => void,
  end: () => void,
): void {
  handle.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // not an active pointer (synthetic events): moves still arrive while over the handle
    }
    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    start();
    const onMove = (e: PointerEvent) => move(e.clientX - x0, e.clientY - y0);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      end();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

/**
 * Makes the two sidebars of `main` resizable. The widths are CSS variables on `main`
 * (`--left-w`, `--right-w`) used by its grid columns; double-click a handle to reset.
 */
export function resizableSidebars(main: HTMLElement, left: HTMLElement, right: HTMLElement): void {
  // the handles live in `main` (positioned on the sidebar edges): the sidebars' contents are
  // replaced on mode switches
  const apply = () => {
    for (const side of ["left", "right"] as const) {
      const w = sizes[`sidebar.${side}`];
      if (w) main.style.setProperty(`--${side}-w`, `${w}px`);
      else main.style.removeProperty(`--${side}-w`);
    }
  };
  apply();
  for (const [panel, side] of [
    [left, "left"],
    [right, "right"],
  ] as const) {
    const handle = document.createElement("div");
    handle.className = `col-resize ${side}`;
    handle.title = "Drag to resize — double-click to reset";
    main.append(handle);
    let w0 = 0;
    drag(
      handle,
      () => {
        w0 = panel.getBoundingClientRect().width;
      },
      (dx) => {
        const w = clamp(w0 + (side === "left" ? dx : -dx), 160, Math.max(200, window.innerWidth * 0.6));
        sizes[`sidebar.${side}`] = Math.round(w);
        apply();
      },
      save,
    );
    handle.addEventListener("dblclick", () => {
      delete sizes[`sidebar.${side}`];
      apply();
      save();
    });
  }
}

/**
 * Makes the `.section` children of `container` vertically resizable: a handle between two
 * sections resizes the one that does not grow (the growing section takes the rest). `key`
 * names the container in the saved sizes; sections are identified by their position.
 * The container's children may change later (mode switches): handles are re-created.
 */
export function resizableSections(container: HTMLElement, key: string): void {
  const sections = () =>
    [...container.children].filter((c): c is HTMLElement => c.classList.contains("section"));
  const setup = () => {
    for (const old of container.querySelectorAll(":scope > .row-resize")) old.remove();
    const list = sections();
    list.forEach((s, i) => {
      s.dataset.maxHeight ??= s.style.maxHeight;
      const saved = sizes[`${key}.${i}`];
      if (saved && !s.classList.contains("grow")) {
        s.style.flex = `0 0 ${saved}px`;
        s.style.maxHeight = "none";
      }
    });
    for (let i = 0; i + 1 < list.length; i++) {
      const above = list[i]!;
      const below = list[i + 1]!;
      // resize the fixed one of the pair; with two fixed sections, the upper one
      const target = above.classList.contains("grow") ? below : above;
      const index = list.indexOf(target);
      const sign = target === above ? 1 : -1;
      const handle = document.createElement("div");
      handle.className = "row-resize";
      handle.title = "Drag to resize — double-click to reset";
      below.before(handle);
      let h0 = 0;
      let total = 0;
      drag(
        handle,
        () => {
          h0 = target.getBoundingClientRect().height;
          total = container.getBoundingClientRect().height;
        },
        (_dx, dy) => {
          const hgt = clamp(h0 + sign * dy, 40, Math.max(60, total - 80));
          target.style.flex = `0 0 ${hgt}px`;
          target.style.maxHeight = "none";
          sizes[`${key}.${index}`] = Math.round(hgt);
        },
        save,
      );
      handle.addEventListener("dblclick", () => {
        delete sizes[`${key}.${index}`];
        target.style.flex = "";
        target.style.maxHeight = target.dataset.maxHeight ?? "";
        save();
      });
    }
  };
  setup();
  // re-run when sections are swapped in or out (ignore our own handles)
  new MutationObserver((records) => {
    const relevant = records.some((r) =>
      [...r.addedNodes, ...r.removedNodes].some(
        (n) => !(n instanceof HTMLElement && n.classList.contains("row-resize")),
      ),
    );
    if (relevant) setup();
  }).observe(container, { childList: true });
}
