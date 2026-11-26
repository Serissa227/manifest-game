import { describe, expect, it } from "vitest";
import { MODULES } from "./zh-CN";

describe("字符串表", () => {
  it("各模块之间没有重复的键（重复会被后合并的模块静默覆盖）", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [mod, table] of Object.entries(MODULES)) {
      for (const key of Object.keys(table)) {
        const prev = seen.get(key);
        if (prev) dup.push(`${key}（${prev} 与 ${mod}）`);
        seen.set(key, mod);
      }
    }
    expect(dup).toEqual([]);
  });
});
