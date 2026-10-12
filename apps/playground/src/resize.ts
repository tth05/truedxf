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
        handle.title = "Drag to resize, double-click to reset";
        main.append(handle);
        let w0 = 0;
        drag(
            handle,
            () => {
                w0 = panel.getBoundingClientRect().width;
            },
            (dx) => {
                const w = clamp(
                    w0 + (side === "left" ? dx : -dx),
                    160,
                    Math.max(200, window.innerWidth * 0.6),
                );
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

/** Smallest height a panel can be dragged or squeezed to (CSS .section min-height). */
const MIN_SECTION = 56;

/**
 * Makes the `.section` children of `container` vertically resizable. Dragging the handle
 * between two sections pushes: moving it up shrinks the sections above it, the nearest first,
 * each down to MIN_SECTION, and the section right below grows by the same amount (moving it
 * down works the other way round). A section at its minimum keeps its size and is pushed along.
 * The growing section (`.grow`) takes whatever height is left. `key` names the container in
 * the saved sizes; sections are identified by their position. The container's children may
 * change later (mode switches): handles are re-created.
 */
export function resizableSections(container: HTMLElement, key: string): void {
    const sections = () =>
        [...container.children].filter((c): c is HTMLElement => c.classList.contains("section"));
    const grows = (el: HTMLElement) => el.classList.contains("grow");
    // fixed sections may shrink below their size when the window gets small (never below the
    // CSS min-height), so they cannot cover each other
    const fix = (s: HTMLElement, px: number) => {
        s.style.flex = `0 1 ${px}px`;
        s.style.maxHeight = "none";
    };
    const setup = () => {
        for (const old of container.querySelectorAll(":scope > .row-resize")) old.remove();
        const list = sections();
        list.forEach((s, i) => {
            s.dataset.maxHeight ??= s.style.maxHeight;
            const saved = sizes[`${key}.${i}`];
            if (saved && !grows(s)) fix(s, saved);
        });
        for (let i = 0; i + 1 < list.length; i++) {
            const handle = document.createElement("div");
            handle.className = "row-resize";
            handle.title = "Drag to resize, double-click to reset";
            list[i + 1]!.before(handle);
            let h0: number[] = [];
            drag(
                handle,
                () => {
                    h0 = list.map((s) => s.getBoundingClientRect().height);
                },
                (_dx, dy) => {
                    const h = [...h0];
                    // the sections on the side the handle moves towards give way, nearest first
                    const up = dy < 0;
                    const want = Math.abs(dy);
                    let taken = 0;
                    for (let j = up ? i : i + 1; up ? j >= 0 : j < list.length; j += up ? -1 : 1) {
                        const t = Math.min(Math.max(0, h[j]! - MIN_SECTION), want - taken);
                        h[j]! -= t;
                        taken += t;
                        if (taken >= want) break;
                    }
                    h[up ? i + 1 : i]! += taken;
                    list.forEach((s, j) => {
                        if (grows(s)) return;
                        fix(s, h[j]!);
                        sizes[`${key}.${j}`] = Math.round(h[j]!);
                    });
                },
                save,
            );
            // reset the two sections next to the handle
            handle.addEventListener("dblclick", () => {
                for (const el of [list[i]!, list[i + 1]!]) {
                    if (grows(el)) continue;
                    delete sizes[`${key}.${list.indexOf(el)}`];
                    el.style.flex = "";
                    el.style.maxHeight = el.dataset.maxHeight ?? "";
                }
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
