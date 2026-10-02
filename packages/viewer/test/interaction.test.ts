import { describe, expect, it } from "vitest";
import { initialInteraction, resolveInteraction } from "../src/interaction.ts";

describe("interaction switches", () => {
  it("defaults to everything on; false turns everything off", () => {
    expect(initialInteraction(undefined)).toEqual({
      pan: true,
      zoom: true,
      hover: true,
      select: true,
      dblclickFit: true,
      keyboard: true,
    });
    expect(Object.values(initialInteraction(false)).every((v) => v === false)).toBe(true);
  });

  it("changes only the named switches", () => {
    const i = initialInteraction({ zoom: "ctrl", select: false, hover: undefined });
    expect(i).toMatchObject({ pan: true, zoom: "ctrl", select: false, hover: true });
    const locked = resolveInteraction(i, { pan: false, zoom: false });
    expect(locked).toMatchObject({ pan: false, zoom: false, select: false, hover: true });
    expect(resolveInteraction(locked, true).pan).toBe(true);
  });
});
