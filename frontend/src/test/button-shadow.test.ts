// v1 的按钮字影（docs/UI-REDESIGN.md 1.2 第 1 条，第二阶段修正，见 docs/DECISIONS.md）：
// 外壳的通用按钮主题（styles.css 的 shell-theme 层）给所有按钮加了深色字影，配的是木色底白字；
// 模块把按钮改成浅底深字时要去掉，否则深字叠深影、笔画糊成双影（剧情选项、人物名单、养成的活动卡……）。
// 这里逐条核对这些按钮在模块样式里写了 text-shadow: none，外壳的缺省字影本身没有动。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 路径放在变量里：写成模板字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址（同 ui-v2.test.tsx）
const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = (file: string) => readText("../styles/" + file).replace(/\/\*[\s\S]*?\*\//g, "");

/** 选择器列表里正好有 selector 的那些规则的内容（只看顶层，不进 @media）。 */
function bodiesOf(text: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

/** 浅底深字的按钮：[样式文件, 选择器]。 */
const LIGHT_BUTTONS: [string, string][] = [
  ["story.css", ".sd-choice"],
  ["story.css", ".sd-later"],
  ["people.css", ".pp-card"],
  ["people.css", ".pp-tie"],
  ["upbringing.css", ".ub-cell-btn"],
  ["upbringing.css", ".ub-act-btn"],
  ["upbringing.css", ".ub-tab:not(.is-on)"],
  ["upbringing.css", ".ct-opt"],
  ["port.css", ".scene-depart"],
  ["captain.css", ".cw-group-head"],
  ["start.css", ".ts-save"],
  ["items.css", ".it-slot-btn"],
  ["items.css", ".it-grid-btn"],
  ["items.css", ".it-offer-main"],
];

describe("v1 的按钮字影", () => {
  it.each(LIGHT_BUTTONS)("%s 的 %s 去掉了外壳按钮的深色字影", (file, selector) => {
    const bodies = bodiesOf(css(file), selector);
    expect(bodies.length, `${file} 里找不到 ${selector}`).toBeGreaterThan(0);
    expect(bodies.some((b) => /text-shadow:\s*none\s*;/.test(b))).toBe(true);
  });

  it("外壳的缺省按钮（木色底白字）照旧带深色字影；养成分类签选中时（木色底白字）也照旧", () => {
    const shell = css("../styles.css");
    const button = bodiesOf(shell, "button").find((b) => b.includes("background: var(--wood-2)"));
    expect(button).toMatch(/text-shadow:\s*1px 1px 0 var\(--ink\);/);
    const on = bodiesOf(css("upbringing.css"), ".ub-tab.is-on");
    expect(on.join("")).not.toMatch(/text-shadow/);
  });
});
