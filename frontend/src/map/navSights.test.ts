// H04 海上所见的像素图元：九种都有图、大小一致、彼此不同。
import { describe, expect, it } from "vitest";
import type { SightKind } from "../ipc/types";
import { sightPixels } from "./navSights";

const KINDS: SightKind[] = ["flotsam", "wreck", "castaway", "birds", "shoal", "fishing", "weed", "ice", "reef"];

describe("海上所见的小标记", () => {
  it("九种都有像素、都在 11 × 9 以内、两两不同", () => {
    const sigs = new Set<string>();
    for (const k of KINDS) {
      const px = sightPixels(k);
      expect(px.length).toBeGreaterThan(5);
      expect(px.every(([x, y]) => x >= 0 && x < 11 && y >= 0 && y < 9)).toBe(true);
      sigs.add(JSON.stringify(px));
    }
    expect(sigs.size).toBe(KINDS.length);
  });
});
