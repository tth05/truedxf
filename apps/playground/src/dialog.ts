/** Modal dialogs (keyboard shortcuts, the small-screen notice). */
import { h, ICONS, icon } from "./dom.ts";

export interface DialogOptions {
  title: string;
  body: (Node | string)[];
  /** Footer buttons; default a single "Close". */
  actions?: { label: string; primary?: boolean; onclick?: () => void }[];
  class?: string;
}

/** Opens a dialog over the page; Escape, the × and a click outside close it. Returns `close`. */
export function openDialog(o: DialogOptions): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const close = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
    previous?.focus?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  };
  const actions = o.actions ?? [{ label: "Close", primary: true }];
  const buttons = actions.map((a) =>
    h(
      "button",
      {
        class: `btn${a.primary ? " primary" : ""}`,
        type: "button",
        onclick: () => {
          close();
          a.onclick?.();
        },
      },
      a.label,
    ),
  );
  const card = h(
    "div",
    {
      class: `dialog${o.class ? ` ${o.class}` : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": o.title,
    },
    h(
      "div",
      { class: "dialog-head" },
      h("b", {}, o.title),
      h(
        "button",
        { class: "btn icon ghost", title: "Close", type: "button", onclick: close },
        icon(ICONS.close),
      ),
    ),
    h("div", { class: "dialog-body" }, ...o.body),
    h("div", { class: "dialog-actions" }, ...buttons),
  );
  const overlay = h("div", { class: "modal" }, card);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  window.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  buttons.find((_, i) => actions[i]!.primary)?.focus();
  return close;
}
