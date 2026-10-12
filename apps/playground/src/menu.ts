/** Drop-down menus of the top bar (Open, Export). */
import { h, icon } from "./dom.ts";

export interface MenuItem {
    icon: string;
    label: string;
    title?: string;
    /** Shortcut shown on the right, e.g. "Ctrl+O". */
    keys?: string;
    run(): void;
}

/**
 * A menu below `anchor` (which gets `position: relative` through the `.split` class): toggled by
 * `toggle()`, closed by a click elsewhere, Escape or choosing an item. `hint` is a note below the
 * items.
 */
export function dropdown(
    anchor: HTMLElement,
    items: () => (MenuItem | "separator")[],
    hint?: string,
): { toggle(): void; close(): void } {
    const menu = h("div", { class: "menu", role: "menu" });
    const close = () => menu.classList.remove("on");
    const render = () => {
        menu.replaceChildren(
            ...items().map((it) =>
                it === "separator"
                    ? h("div", { class: "menu-sep" })
                    : h(
                          "button",
                          {
                              role: "menuitem",
                              type: "button",
                              ...(it.title ? { title: it.title } : {}),
                              onclick: () => {
                                  close();
                                  it.run();
                              },
                          },
                          icon(it.icon),
                          h("span", { class: "menu-label" }, it.label),
                          it.keys ? h("kbd", {}, it.keys) : null,
                      ),
            ),
            ...(hint ? [h("div", { class: "menu-hint" }, hint)] : []),
        );
    };
    anchor.append(menu);
    document.addEventListener("click", (ev) => {
        if (!anchor.contains(ev.target as Node)) close();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") close();
    });
    return {
        toggle: () => {
            if (menu.classList.contains("on")) close();
            else {
                render();
                menu.classList.add("on");
            }
        },
        close,
    };
}
