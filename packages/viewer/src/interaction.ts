/** Which user input the viewer handles (no DOM; DxfViewer applies it). */

export interface Interaction {
    /** Drag to pan (any mouse button; one or two fingers). */
    pan: boolean;
    /**
     * Wheel and pinch zoom. "ctrl": the wheel zooms only with Ctrl or ⌘ held (trackpad pinches
     * send ctrlKey), otherwise the page scrolls; pinching on touch screens always zooms.
     */
    zoom: boolean | "ctrl";
    /** Highlight the entity under the pointer and emit `hover` events. */
    hover: boolean;
    /** Click to select an entity (highlight, `select` event); `select()` works regardless. */
    select: boolean;
    /** Double-click on empty space (anywhere when `select` is off) fits the drawing. */
    dblclickFit: boolean;
    /** Keyboard: the canvas takes focus on click and Esc clears the selection / measurement. */
    keyboard: boolean;
}

export type InteractionOption = boolean | Partial<Interaction>;

const ALL: Interaction = {
    pan: true,
    zoom: true,
    hover: true,
    select: true,
    dblclickFit: true,
    keyboard: true,
};
const NONE: Interaction = {
    pan: false,
    zoom: false,
    hover: false,
    select: false,
    dblclickFit: false,
    keyboard: false,
};

/**
 * Applies a change to the current switches: `true` turns everything on, `false` off, an object
 * changes the switches it names (undefined values are ignored).
 */
export function resolveInteraction(current: Interaction, change: InteractionOption | undefined): Interaction {
    if (change === undefined) return { ...current };
    if (change === true) return { ...ALL };
    if (change === false) return { ...NONE };
    const out = { ...current };
    for (const k of Object.keys(ALL) as (keyof Interaction)[]) {
        const v = change[k];
        if (v !== undefined) (out as Record<keyof Interaction, unknown>)[k] = v;
    }
    return out;
}

/** The initial switches for the `interaction` option (missing switches are on). */
export function initialInteraction(option: InteractionOption | undefined): Interaction {
    return resolveInteraction(ALL, option);
}
