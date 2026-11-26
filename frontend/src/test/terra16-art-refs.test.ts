// 寰宇数据里写下的插画 key 都要有图：养成事件的 art（活动场景与回忆插画，sceneAssets.ts）、
// 传说之船与秘境故事章节的 art（场景插画清单 loreArt.ts）。原来 84 幕养成回忆写了 key 却没有图，界面只剩底色与图标。
import { describe, expect, it } from "vitest";
import { loreVariants } from "../art/lore";
import { sceneArtPath } from "../components/upbringing/ubKit";

const UPBRINGING = import.meta.glob<string>("../../../data/worlds/terra16/upbringing/**/*.toml", { query: "?raw", import: "default", eager: true });
const STORIES = import.meta.glob<string>("../../../data/worlds/terra16/stories/c11_{ships,realms}.toml", { query: "?raw", import: "default", eager: true });

/** 文件里 art 字段的值（`art = "…"` 与 `"art" = "…"` 两种写法；跳过注释行）→ 出现在哪个文件。 */
function artKeys(files: Record<string, string>): Map<string, string> {
  const keys = new Map<string, string>();
  const re = /(?:^|[{,\s])"?art"?\s*=\s*"([^"]+)"/g;
  for (const [name, text] of Object.entries(files)) {
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      for (const m of line.matchAll(re)) keys.set(m[1], name.replace("../../../data/worlds/terra16/", ""));
    }
  }
  return keys;
}

describe("寰宇数据引用的插画", () => {
  it("养成事件的插画（活动场景、回忆）都有图", () => {
    const keys = artKeys(UPBRINGING);
    expect(keys.size).toBeGreaterThan(100);
    const missing = [...keys].filter(([k]) => sceneArtPath(k, "large") === null).map(([k, f]) => `${k}（${f}）`);
    expect(missing).toEqual([]);
  });

  it("传说之船与秘境故事章节的插画都在场景插画清单里", () => {
    expect(Object.keys(STORIES)).toHaveLength(2);
    const keys = artKeys(STORIES);
    expect(keys.size).toBeGreaterThan(20);
    const missing = [...keys.keys()].filter((k) => loreVariants(k).length === 0);
    expect(missing).toEqual([]);
  });
});

describe("活动场景的季节版", () => {
  it("画了具体地方的场景按月份挑季节；热带场景分雨季、旱季；没有季节版的照旧；不给月份用最早的一版", () => {
    expect(sceneArtPath("kemari_jp", "large", 4)).toBe("scenes/kemari_jp.webp");
    expect(sceneArtPath("kemari_jp", "large", 7)).toBe("scenes/kemari_jp--summer.webp");
    expect(sceneArtPath("kemari_jp", "small", 10)).toBe("scenes/kemari_jp--autumn-s.webp");
    expect(sceneArtPath("kemari_jp", "large", 1)).toBe("scenes/kemari_jp--winter.webp");
    expect(sceneArtPath("kemari_jp", "large")).toBe("scenes/kemari_jp.webp");
    expect(sceneArtPath("canoe_maya", "large", 7)).toBe("scenes/canoe_maya--wet.webp");
    expect(sceneArtPath("canoe_maya", "large", 1)).toBe("scenes/canoe_maya.webp");
    expect(sceneArtPath("pesantren_giri", "large", 1)).toBe("scenes/pesantren_giri--wet.webp");
    expect(sceneArtPath("library", "large", 1)).toBe("scenes/library.webp");
    // 通用 key 借用的插画也按季节挑
    expect(sceneArtPath("harbor", "large", 1)).toBe("scenes/harbor_eu--winter.webp");
  });
});
