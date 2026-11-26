// 界面风格（docs/UI-REDESIGN.md）：缺省是海图室（v2），设置里的“界面风格”（海图室 / 经典像素，立即生效、保存在本机）、
// 重新载入后仍是所选的版本、地址里的 ?ui=v1（强制经典像素）与 ?ui=v2，
// 以及经典像素（v1）下根元素与 DOM 里没有任何 v2 的属性或类、样式表里的每一条规则都只在 <html data-ui="v2"> 下生效。
// 测试环境开头当作本机选了经典像素（test/setup.ts）；缺省值在这里重新载入模块来检查。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import SettingsPanel from "../components/panels/SettingsPanel";
import { UI_KEY, applyUi, parseUi, urlUi, useUiVersion } from "../ui/uiMode";
import { installIpc, startedGame } from "./fixtures";

const root = () => document.documentElement;
// 样式表的原文（测试环境不处理 CSS，直接用 Node 读）。路径放在变量里：写成字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址
const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
// 新界面的样式按模块拆在 styles/ui-v2/ 下（第二阶段，见 docs/DECISIONS.md），index.css 按固定顺序引入各文件
const V2_DIR = "../styles/ui-v2/";
const V2_INDEX = readText(`${V2_DIR}index.css`);
/** index.css 引入的文件（按顺序）。 */
const V2_IMPORTS = [...V2_INDEX.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@import\s+"\.\/([\w-]+\.css)";/g)].map((m) => m[1]);
/** 引入的每个文件的原文。 */
const V2_SHEETS = V2_IMPORTS.map((f) => ({ file: f, css: readText(`${V2_DIR}${f}`) }));

/** 试用期保存选择用的键（缺省改为海图室后不再读）。 */
const LEGACY_UI_KEY = "manifest.ui";

function reset() {
  try {
    localStorage.removeItem(UI_KEY);
    localStorage.removeItem(LEGACY_UI_KEY);
  } catch {
    // 忽略
  }
  window.history.replaceState(null, "", "/");
  applyUi("v1");
  useUiVersion.setState({ ui: "v1" });
}

beforeEach(reset);
afterEach(reset);

describe("界面风格：海图室（缺省）/ 经典像素", () => {
  it("缺省是海图室：本机没有保存过选择、地址里也没写时是 v2，模块载入时（React 挂上之前）就把 data-ui=\"v2\" 写到根元素上", async () => {
    expect(localStorage.getItem(UI_KEY)).toBeNull();
    expect(root().hasAttribute("data-ui")).toBe(false);
    vi.resetModules();
    const m = await import("../ui/uiMode");
    expect(m.DEFAULT_UI).toBe("v2");
    expect(m.storedUi()).toBe("v2");
    expect(m.useUiVersion.getState().ui).toBe("v2");
    expect(root().getAttribute("data-ui")).toBe("v2");
  });

  it("试用期的键（manifest.ui）存下的 v1 不再算数：载入后仍是海图室，旧键原样不动", async () => {
    localStorage.setItem(LEGACY_UI_KEY, "v1");
    vi.resetModules();
    const m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v2");
    expect(root().getAttribute("data-ui")).toBe("v2");
    expect(localStorage.getItem(LEGACY_UI_KEY)).toBe("v1");
    expect(localStorage.getItem(UI_KEY)).toBeNull();
  });

  it("设置“画面”一节：海图室下“界面风格”是分段控件、选中“海图室（缺省）”；选“经典像素”立即换成 v1 并保存在本机，经典像素下是原来的下拉框，选回海图室又是 v2，都不经过“保存设置”", async () => {
    const user = userEvent.setup();
    const calls = installIpc();
    startedGame();
    applyUi("v2");
    useUiVersion.setState({ ui: "v2" });
    const { unmount } = render(<SettingsPanel />);
    const group = await screen.findByRole("radiogroup", { name: "界面风格" });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["海图室（缺省）", "经典像素"]);
    expect(within(group).getByRole("radio", { name: "海图室（缺省）" })).toBeChecked();
    // 在“画面”一节里，排在昼夜光影前面
    const display = screen.getByTestId("settings-display");
    expect(display).toContainElement(group);
    expect(group.compareDocumentPosition(screen.getByRole("radiogroup", { name: "昼夜光影" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(within(group).getByRole("radio", { name: "经典像素" }));
    expect(root().hasAttribute("data-ui")).toBe(false);
    expect(localStorage.getItem(UI_KEY)).toBe("v1");
    expect(useUiVersion.getState().ui).toBe("v1");
    // 经典像素：原来的下拉框，没有单选组与 v2 的类
    const select = await screen.findByRole("combobox", { name: "界面风格" });
    expect(select).toHaveValue("v1");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("settings-panel")).not.toHaveClass("v2-settings");

    await user.selectOptions(select, "v2");
    expect(root().getAttribute("data-ui")).toBe("v2");
    expect(localStorage.getItem(UI_KEY)).toBe("v2");
    expect(within(await screen.findByRole("radiogroup", { name: "界面风格" })).getByRole("radio", { name: "海图室（缺省）" })).toBeChecked();
    // 只是本机的画面偏好：不保存设置、不发命令
    expect(calls.mock.calls.some(([c]) => c === "save_settings" || c === "submit")).toBe(false);
    // 先卸下再由 afterEach 切回 v1（不在挂着的面板上触发重画）
    unmount();
  });

  it("本机保存的选择：重新载入（模块重新执行）后仍是所选——经典像素时根元素上没有 data-ui，海图室时首屏之前就写好", async () => {
    localStorage.setItem(UI_KEY, "v1");
    vi.resetModules();
    let m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v1");
    expect(root().hasAttribute("data-ui")).toBe(false);

    localStorage.setItem(UI_KEY, "v2");
    vi.resetModules();
    m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v2");
    expect(root().getAttribute("data-ui")).toBe("v2");
  });

  it("地址里的 ?ui=v1 强制经典像素、只管这一次（不写入本机，也盖过本机保存的海图室）；?ui=v2 盖过本机保存的经典像素", async () => {
    window.history.replaceState(null, "", "/?ui=v1");
    vi.resetModules();
    let m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v1");
    expect(root().hasAttribute("data-ui")).toBe(false);
    expect(localStorage.getItem(UI_KEY)).toBeNull();

    localStorage.setItem(UI_KEY, "v2");
    vi.resetModules();
    m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v1");
    expect(root().hasAttribute("data-ui")).toBe(false);
    expect(localStorage.getItem(UI_KEY)).toBe("v2");

    localStorage.setItem(UI_KEY, "v1");
    window.history.replaceState(null, "", "/?ui=v2");
    vi.resetModules();
    m = await import("../ui/uiMode");
    expect(m.useUiVersion.getState().ui).toBe("v2");
    expect(root().getAttribute("data-ui")).toBe("v2");
    expect(localStorage.getItem(UI_KEY)).toBe("v1");
  });

  it("只认 v1、v2 两种写法；认不出的当作没有", () => {
    expect(parseUi("v2")).toBe("v2");
    expect(parseUi("v1")).toBe("v1");
    expect(parseUi("V2")).toBeNull();
    expect(parseUi("2")).toBeNull();
    expect(parseUi(null)).toBeNull();
    expect(urlUi("?ui=v2")).toBe("v2");
    expect(urlUi("?foo=1&ui=v1")).toBe("v1");
    expect(urlUi("?ui=new")).toBeNull();
    expect(urlUi("")).toBeNull();
  });
});

describe("v1 不受影响", () => {
  it("v1 的主界面：根元素与整个页面里都没有 data-ui 属性，也没有 v2 开头的类", async () => {
    installIpc();
    startedGame();
    render(<App />);
    expect(await screen.findByTestId("hud")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("port-panel")).toBeInTheDocument());
    expect(root().hasAttribute("data-ui")).toBe(false);
    expect(document.querySelector("[data-ui]")).toBeNull();
    const v2Classes = [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));
    expect(v2Classes).toEqual([]);
  });

  it("新界面的样式表（styles/ui-v2/ 下 index.css 引入的每个文件）的每一条规则都以 :root[data-ui=\"v2\"] 开头（媒体查询、层与容器查询里的也一样），动画名以 v2- 开头", () => {
    const selectors: string[] = [];
    const keyframes: string[] = [];
    const walk = (text: string, file: string) => {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf("{", i);
        if (open < 0) {
          // 块外只能剩空白（不允许 @import、@layer 声明之类的语句）
          expect(text.slice(i).trim(), file).toBe("");
          break;
        }
        const head = text.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
        const body = text.slice(open + 1, j - 1);
        if (head.startsWith("@keyframes")) keyframes.push(head.replace("@keyframes", "").trim());
        else if (head.startsWith("@")) {
          expect(head, file).toMatch(/^@(media|layer|container|supports) /);
          walk(body, file);
        } else selectors.push(...head.split(",").map((s) => `${file}: ${s.trim()}`));
        i = j;
      }
    };
    for (const { file, css } of V2_SHEETS) walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), file);
    expect(selectors.length).toBeGreaterThan(100);
    const loose = selectors.filter((s) => !s.replace(/^[\w-]+\.css: /, "").startsWith(':root[data-ui="v2"]'));
    expect(loose).toEqual([]);
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.filter((k) => !k.startsWith("v2-"))).toEqual([]);
  });

  it("新界面的样式入口 styles/ui-v2/index.css 只有 @import：按固定顺序引入目录里的每一个文件（令牌在最前），App.tsx 引入它", () => {
    // 除了注释与 @import 什么都没有
    const rest = V2_INDEX.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+"\.\/[\w-]+\.css";/g, "");
    expect(rest.trim()).toBe("");
    // 目录里的每个样式文件都引入了、只引入一次；令牌与通用元素在最前、共用的反馈组件紧跟其后、外壳在画面之前
    const onDisk = readdirSync(new URL(V2_DIR, import.meta.url))
      .filter((f) => f.endsWith(".css") && f !== "index.css")
      .sort();
    expect([...V2_IMPORTS].sort()).toEqual(onDisk);
    expect(new Set(V2_IMPORTS).size).toBe(V2_IMPORTS.length);
    expect(V2_IMPORTS.slice(0, 3)).toEqual(["base.css", "feedback.css", "shell.css"]);
    // 第二阶段各画面组的文件都在
    for (const g of ["port", "fleet", "analysis", "business", "voyage", "dialogs", "upbringing", "start", "history", "system"]) expect(V2_IMPORTS).toContain(`${g}.css`);
    expect(readText("../App.tsx")).toContain('import "./styles/ui-v2/index.css";');
  });
});
