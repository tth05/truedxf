/**
 * Text search in the top bar: finds texts of the current layout (DxfViewer.search: block
 * content, attributes, dimension texts), lists them, and zooms to a match with a marker around
 * it. Enter / Shift+Enter step through the matches (the list closes so it does not cover the
 * match; ↓ shows it again); matches in other layouts switch the layout.
 */
import type { DxfViewer, SearchResult, TextMatch } from "@truedxf/viewer";
import { h, ICONS, icon, mount } from "./dom.ts";
import { fmtNum } from "./format.ts";

/**
 * Area shown around a match: at least this many text heights high and its width three times,
 * so a short word is shown with its surroundings rather than filling the view.
 */
const CONTEXT_HEIGHTS = 24;
const CONTEXT_WIDTHS = 3;

export class SearchBox {
    readonly root: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly panel: HTMLElement;
    private readonly count: HTMLElement;
    private readonly viewer: DxfViewer;
    private result: SearchResult | undefined;
    private index = -1;
    private seq = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** After a layout switch from "also in": jump to the first match once the new list is there. */
    private jumpAfterRender = false;
    private stale = false;

    constructor(viewer: DxfViewer) {
        this.viewer = viewer;
        this.input = h("input", {
            type: "search",
            class: "search-input",
            placeholder: "Search text",
            "aria-label": "Search text in the drawing",
            disabled: true,
            spellcheck: "false",
            autocomplete: "off",
        });
        this.count = h("span", { class: "search-count" });
        this.panel = h("div", { class: "search-panel", role: "listbox" });
        this.root = h(
            "div",
            { class: "search-box", title: "Search text in the drawing (Ctrl+F)" },
            h("span", { class: "search-icon" }, icon(ICONS.search)),
            this.input,
            this.count,
            this.panel,
        );
        this.input.addEventListener("input", () => {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => void this.run(false), 180);
        });
        this.input.addEventListener("focus", () => {
            if (this.result && this.input.value.trim()) this.open(true);
        });
        this.input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                clearTimeout(this.timer);
                if (!this.result || this.stale) void this.run(true);
                else this.step(ev.shiftKey ? -1 : 1);
            } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                ev.preventDefault();
                // the first arrow press shows the list again (it closes after a jump)
                if (this.result && !this.panel.classList.contains("on")) this.open(true);
                else this.step(ev.key === "ArrowDown" ? 1 : -1);
            } else if (ev.key === "Escape") {
                ev.stopPropagation();
                if (this.panel.classList.contains("on")) this.open(false);
                else {
                    this.input.value = "";
                    this.clear();
                    this.input.blur();
                }
            }
        });
        document.addEventListener("pointerdown", (ev) => {
            if (!this.root.contains(ev.target as Node)) this.open(false);
        });
        viewer.on("load", () => {
            this.input.disabled = false;
            this.input.value = "";
            this.clear();
        });
        viewer.on("layout", () => {
            this.stale = true;
        });
        // search the new layout's texts once its complete list is there
        viewer.on("render", () => {
            if (!this.stale) return;
            this.stale = false;
            if (this.input.value.trim()) void this.run(this.jumpAfterRender);
            this.jumpAfterRender = false;
        });
    }

    focus(): void {
        if (this.input.disabled) return;
        this.input.focus();
        this.input.select();
    }

    private clear(): void {
        this.result = undefined;
        this.index = -1;
        this.count.textContent = "";
        this.open(false);
        this.viewer.setMarker(undefined);
    }

    private open(on: boolean): void {
        this.panel.classList.toggle("on", on);
    }

    private async run(jump: boolean): Promise<void> {
        const q = this.input.value.trim();
        const seq = ++this.seq;
        if (!q) {
            this.clear();
            return;
        }
        let r: SearchResult;
        try {
            r = await this.viewer.search(q, 500);
        } catch {
            return;
        }
        if (seq !== this.seq) return;
        this.result = r;
        this.index = -1;
        this.render(q);
        this.open(true);
        if (jump && r.matches.length) this.go(0);
    }

    private step(delta: number): void {
        const n = this.result?.matches.length ?? 0;
        if (!n) return;
        this.go((this.index + delta + n) % n);
    }

    private go(i: number): void {
        const m = this.result?.matches[i];
        if (!m) return;
        this.index = i;
        const b = m.bounds;
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const half = Math.max(w * CONTEXT_WIDTHS, h * CONTEXT_HEIGHTS) / 2;
        this.viewer.fitTo({ minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half }, 0);
        this.viewer.setMarker(m.bounds);
        this.updateCount();
        // the match is in the middle of the view: the list must not cover it
        this.open(false);
        for (const [k, el] of [...this.panel.querySelectorAll<HTMLElement>(".search-hit")].entries()) {
            el.classList.toggle("active", k === i);
            if (k === i) el.scrollIntoView({ block: "nearest" });
        }
    }

    private updateCount(): void {
        const r = this.result;
        if (!r) {
            this.count.textContent = "";
            return;
        }
        this.count.textContent = r.total
            ? this.index >= 0
                ? `${this.index + 1} / ${fmtNum(r.total)}`
                : fmtNum(r.total)
            : "0";
    }

    private render(q: string): void {
        const r = this.result!;
        this.updateCount();
        const rows: HTMLElement[] = [];
        if (r.matches.length === 0)
            rows.push(
                h("div", { class: "search-empty" }, `No text with “${q}” in ${r.layout ?? "this layout"}.`),
            );
        else
            rows.push(
                h(
                    "div",
                    { class: "search-head" },
                    `${fmtNum(r.total)} ${r.total === 1 ? "match" : "matches"} in ${r.layout ?? "this layout"}`,
                    r.total > r.matches.length ? ` (first ${fmtNum(r.matches.length)})` : "",
                    h("span", { class: "spacer" }),
                    h("kbd", {}, "Enter"),
                    " next",
                ),
            );
        r.matches.forEach((m, i) => {
            rows.push(
                h(
                    "div",
                    {
                        class: "search-hit",
                        role: "option",
                        onclick: () => this.go(i),
                    },
                    snippet(m, q),
                ),
            );
        });
        if (r.others.length)
            rows.push(
                h(
                    "div",
                    { class: "search-others" },
                    "Also in ",
                    r.others.flatMap((o, i) => [
                        i ? ", " : "",
                        h(
                            "button",
                            {
                                class: "link inline",
                                onclick: () => {
                                    this.jumpAfterRender = true;
                                    void this.viewer.setLayout(o.layout);
                                },
                            },
                            `${o.layout} (${fmtNum(o.count)})`,
                        ),
                    ]),
                ),
            );
        mount(this.panel, rows);
    }
}

/** The match's text on one line, the query highlighted, long texts cut around it. */
function snippet(m: TextMatch, q: string): HTMLElement {
    const text = m.text.replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    const needle = q.toLowerCase().replace(/\s+/g, " ");
    const at = lower.indexOf(needle);
    const el = h("span", { class: "search-text" });
    if (at < 0) {
        el.textContent = text.length > 80 ? `${text.slice(0, 79)}…` : text;
        return el;
    }
    const start = Math.max(0, at - 30);
    const end = Math.min(text.length, at + needle.length + 40);
    el.append(
        start > 0 ? "…" : "",
        text.slice(start, at),
        h("mark", {}, text.slice(at, at + needle.length)),
        text.slice(at + needle.length, end),
        end < text.length ? "…" : "",
    );
    return el;
}
