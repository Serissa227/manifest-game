// 数据与海图美术的对齐（第五批集成）：data/world/landmarks.toml 里的每处地标都能归到一种专门的图标，
// 不落到类别的通用图样；图标的名字与数据的 kind 对得上。
import { describe, expect, it } from "vitest";
import landmarksToml from "../../../data/world/landmarks.toml?raw";
import { drawLandmarkIcon, LANDMARK_KINDS, landmarkIconKey } from "./map";
import type { LandmarkCategory } from "./map/types";

interface DataLandmark {
  key: string;
  category: LandmarkCategory;
  kind: string;
}

/** 粗读 landmarks.toml 的 [[landmarks]] 表（只取 key、category、kind）。 */
function readLandmarks(text: string): DataLandmark[] {
  return text
    .split(/\r?\n\[\[landmarks\]\]/)
    .slice(1)
    .map((block) => ({
      key: /\nkey\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "",
      category: (/\ncategory\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "") as LandmarkCategory,
      kind: /\nkind\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "",
    }));
}

describe("数据里的地标与海图图标", () => {
  const list = readLandmarks(landmarksToml);

  it("读到了数据里的全部地标", () => {
    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const l of list) {
      expect(l.key, JSON.stringify(l)).not.toBe("");
      expect(["natural", "arcane", "ancient", "civic"]).toContain(l.category);
      expect(l.kind, l.key).not.toBe("");
    }
  });

  it("每处地标都画成专门的图标，不落到类别的通用图样", () => {
    for (const l of list) {
      const icon = landmarkIconKey(l.kind, l.category);
      expect(icon, `${l.key}（kind ${l.kind}）`).not.toBeNull();
      expect(LANDMARK_KINDS).toContain(icon);
      // 与“认不出”的通用图样不同
      const generic = drawLandmarkIcon("__unknown__", l.category);
      const px = drawLandmarkIcon(l.kind, l.category);
      const same = px.w === generic.w && px.h === generic.h && px.data.every((v, i) => v === generic.data[i]);
      expect(same, `${l.key} 画成了通用图样`).toBe(false);
    }
  });

  it("数据里的 kind 归到对应的图样（别名）", () => {
    const want: Record<string, string> = {
      colossus: "colossus",
      broken_chain: "chain",
      sunken_city: "sunken_city",
      lighthouse_ruin: "lighthouse_ruin",
      stone_idols: "colossus",
      bell_tower: "bell_tower",
      maelstrom: "maelstrom",
      storm_eye: "storm_eye",
      crater: "crater",
      crystal_spires: "crystal",
      floating_isles: "floating_isles",
      world_tree: "world_tree",
      waterfall: "waterfall",
      basalt_columns: "basalt",
      bone_reef: "bone_reef",
      glass_dunes: "glass_dunes",
      arch: "arch",
      monument: "obelisk",
      academy: "university",
      oasis: "oasis",
    };
    for (const l of list) {
      if (l.kind in want) expect(landmarkIconKey(l.kind, l.category), l.key).toBe(want[l.kind]);
    }
    // 常见的写法也能接住
    expect(landmarkIconKey("ruined_lighthouse", "ancient")).toBe("lighthouse_ruin");
    expect(landmarkIconKey("drowned_bell_tower", "ancient")).toBe("bell_tower");
    expect(landmarkIconKey("eternal_storm", "arcane")).toBe("storm_eye");
    expect(landmarkIconKey("desert_spring", "natural")).toBe("oasis");
    expect(landmarkIconKey("ruined_tower", "ancient")).toBe("ruins");
  });
});
