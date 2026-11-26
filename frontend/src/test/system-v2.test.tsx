// 新界面第二阶段——系统组（docs/UI-REDESIGN.md 第 8 节第 10 项）：只在 v2 下加的结构与行为。
// - 设置：常用的在前（游戏、画面、声音排在 AI 之前）；两三个选项的用分段控件（单选按钮，一次点击换过去）；
//   “画面”“声音”标“立即生效”；底边的保存条说有没有没保存的修改，保存后回到“已保存”的说法；AI 组合事件的说明收起来。
// - 功能窗口的内容出错：印章红的就地错误写为什么、怎么办，“重试”再画一次。
// - 手机的触屏尺寸与底部抽屉也给横屏（矮窗口）。
// - 评审第三轮：画面 / 声音的说明不再重复“立即生效”；“重试”与提示条的按钮在触屏上 44 px。
// 以及 v1 下这些都不出现（DOM 里没有 v2 的类，原来的写法照旧）。用模拟的 IPC，不访问任何服务。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "../components/panels/SettingsPanel";
import Window from "../components/Window";
import { setLocale } from "../i18n/locale";
import type { AppSettings } from "../ipc/types";
import { useAudioPrefs } from "../audio/prefs";
import { useGame } from "../store/game";
import { useDaylightPref } from "../time/prefs";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, settingsView, startedGame, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

beforeEach(() => {
  setLocale("zh-CN");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUiFor("v1");
  setLocale("zh-CN");
});

describe("设置（v2）", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("常用的在前：游戏、画面、声音排在 AI 与模型之前，AI 组合事件的说明收在“展开说明”里；v1 的顺序与写法不变", async () => {
    setUiFor("v2");
    const { unmount } = render(<SettingsPanel />);
    const panel = await screen.findByTestId("settings-panel");
    const titles = within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titles.slice(0, 5)).toEqual(["语言 / Language", "游戏", "画面", "声音", "AI 与模型"]);
    const composed = screen.getByTestId("settings-composed");
    const more = within(composed).getByText("展开说明");
    expect(more.closest("details")).not.toHaveAttribute("open");
    // 说明还在（收起而已），点开看得到
    expect(composed).toHaveTextContent("如何接入在线模型");
    unmount();

    setUiFor("v1");
    render(<SettingsPanel />);
    const v1 = await screen.findByTestId("settings-panel");
    expect(
      within(v1)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent)
        .slice(0, 3),
    ).toEqual(["语言 / Language", "AI 与模型", "AI 组合事件"]);
    expect(screen.queryByText("展开说明")).toBeNull();
    expect(screen.queryByTestId("settings-savestate")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it("两三个选项的用分段控件：语言、昼夜光影、配乐风格一次点击换过去（单选按钮，读屏念得出整组的名字）", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    useDaylightPref.setState({ pref: "clock" });
    useAudioPrefs.getState().set({ style: "orchestral" });
    render(<SettingsPanel />);
    await screen.findByTestId("settings-panel");
    const daylight = screen.getByRole("radiogroup", { name: "昼夜光影" });
    expect(within(daylight).getByRole("radio", { name: "跟随时间" })).toBeChecked();
    await user.click(within(daylight).getByRole("radio", { name: "始终白天" }));
    expect(useDaylightPref.getState().pref).toBe("day");
    expect(within(daylight).getByRole("radio", { name: "始终白天" })).toBeChecked();

    const style = screen.getByRole("radiogroup", { name: "配乐风格" });
    await user.click(within(style).getByRole("radio", { name: "复古合成" }));
    expect(useAudioPrefs.getState().style).toBe("synth");

    const language = screen.getByRole("radiogroup", { name: "语言 / Language" });
    expect(within(language).getByRole("radio", { name: "简体中文" })).toBeChecked();
    expect(within(language).getByRole("radio", { name: "English" })).not.toBeChecked();
    // “画面”“声音”标出立即生效
    for (const id of ["settings-display", "settings-sound"]) expect(screen.getByTestId(id)).toHaveTextContent("立即生效 · 只存在本机");
    expect(screen.getByTestId("settings-language")).not.toHaveTextContent("立即生效");
  });

  it("B11：当前世界的内容只有中文时，语言一节说明英文版稍后提供，英文仍可选；中英都有的世界不写", async () => {
    setUiFor("v2");
    useGame.setState({ statics: { ...statics, world: { ...statics.world, key: "terra16", languages: ["zh"] } } });
    const { unmount } = render(<SettingsPanel />);
    const language = await screen.findByTestId("settings-language");
    expect(within(language).getByTestId("settings-zh-only")).toHaveTextContent("英文版稍后提供");
    expect(within(language).getByRole("radio", { name: "English" })).toBeEnabled();
    unmount();
    useGame.setState({ statics: { ...statics, world: { ...statics.world, languages: ["zh", "en"] } } });
    render(<SettingsPanel />);
    expect(await screen.findByTestId("settings-language")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-zh-only")).toBeNull();
    useGame.setState({ statics });
  });

  it("保存条：改了要保存的项写“有未保存的修改”，保存后回到说明；画面与声音的改动不算", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    // 默认速度只有慢、普通、快三档（2 / 4 / 8，11-03 时间机制）：基准取“普通”，才能改了再改回来
    const calls = installIpc({ get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, speed: 4 } }) });
    render(<SettingsPanel />);
    await screen.findByTestId("settings-panel");
    const state = screen.getByTestId("settings-savestate");
    expect(state).toHaveTextContent("画面与声音立即生效；其余改动点“保存设置”后生效");
    expect(state).toHaveAttribute("role", "status");
    // 只改画面：不算没保存
    await user.click(screen.getByRole("radio", { name: "始终白天" }));
    expect(state).toHaveTextContent("画面与声音立即生效");
    // 改默认速度：没保存
    await user.selectOptions(screen.getByLabelText("默认速度"), "2");
    expect(state).toHaveTextContent("有未保存的修改");
    // 改回来：又一样了
    await user.selectOptions(screen.getByLabelText("默认速度"), "4");
    expect(state).toHaveTextContent("画面与声音立即生效");
    // 选了与当前界面相同的语言（旧设置没有 language 字段）：也不算改动
    await user.click(screen.getByRole("radio", { name: "简体中文" }));
    expect(state).toHaveTextContent("画面与声音立即生效");
    await user.selectOptions(screen.getByLabelText("默认速度"), "8");
    expect(state).toHaveTextContent("有未保存的修改");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.speed).toBe(8);
    // 后端回的设置（模拟的是原来那份）成了新的基准
    await waitFor(() => expect(state).toHaveTextContent("画面与声音立即生效"));
    expect(useGame.getState().message).toBe("设置已保存");
  });

  it("画面、声音的说明不再重复标题行小签上的“立即生效 · 只存在本机”（一节只说一次）；v1 的说明照旧带这一句", async () => {
    setUiFor("v2");
    const { unmount } = render(<SettingsPanel />);
    await screen.findByTestId("settings-panel");
    const count = (id: string, word: string) => (screen.getByTestId(id).textContent ?? "").split(word).length - 1;
    for (const id of ["settings-display", "settings-sound"]) {
      expect(count(id, "立即生效")).toBe(1);
      expect(count(id, "本机")).toBe(1);
    }
    // 说明本身还在
    expect(screen.getByTestId("settings-display")).toHaveTextContent("始终白天：画面一直是白天，时钟照走。");
    expect(screen.getByTestId("settings-sound")).toHaveTextContent("只想关音乐时把音乐音量拖到 0。");
    unmount();

    setUiFor("v1");
    render(<SettingsPanel />);
    await screen.findByTestId("settings-panel");
    expect(screen.getByTestId("settings-display")).toHaveTextContent("立即生效，只保存在本机。");
    expect(screen.getByTestId("settings-sound")).toHaveTextContent("只保存在本机，立即生效。");
  });
});

/** 渲染时出错的窗口内容（flag.broken 为 false 时正常画出来）。 */
const flag = { broken: true };
function FlakyPanel() {
  if (flag.broken) throw new Error("找不到第 7 号舰队的航海日志");
  return <p>航海士名单</p>;
}

describe("功能窗口的内容出错（v2）", () => {
  it("印章红的就地错误（role=alert）写为什么、怎么办，“重试”再画一次；v1 照旧是一行空状态的字", async () => {
    // React 会把错误边界接住的错误打到控制台：这里是故意的
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      flag.broken = true;
      setUiFor("v2");
      const user = userEvent.setup();
      const { unmount } = render(
        <Window title="航海士">
          <FlakyPanel />
        </Window>,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("v2-inline-error", "v2-panel-error");
      expect(alert).toHaveTextContent("这个窗口出错了：找不到第 7 号舰队的航海日志");
      expect(alert).toHaveTextContent("还不行就关掉这个窗口再打开");
      flag.broken = false;
      await user.click(within(alert).getByRole("button", { name: "重试" }));
      expect(screen.getByText("航海士名单")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      unmount();

      flag.broken = true;
      setUiFor("v1");
      render(
        <Window title="航海士">
          <FlakyPanel />
        </Window>,
      );
      expect(screen.getByText("这个窗口出错了：找不到第 7 号舰队的航海日志")).toHaveClass("empty");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
      expect(v2Classes()).toEqual([]);
    } finally {
      flag.broken = true;
      quiet.mockRestore();
    }
  });
});

const SYSTEM_CSS = "../styles/ui-v2/system.css";

describe("系统组的样式（system.css）", () => {
  /** 逐条规则：选择器、声明，以及外层的 @media / @supports。 */
  function rules(css: string) {
    const out: { at: string[]; selector: string; body: string }[] = [];
    const walk = (text: string, at: string[]) => {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf("{", i);
        if (open < 0) break;
        const head = text.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
        const body = text.slice(open + 1, j - 1);
        if (head.startsWith("@keyframes")) {
          // 动画帧不是规则
        } else if (head.startsWith("@")) walk(body, [...at, head]);
        else out.push({ at, selector: head, body });
        i = j;
      }
    };
    walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), []);
    return out;
  }
  const all = rules(readFileSync(new URL(SYSTEM_CSS, import.meta.url), "utf8"));
  const phoneLike = (at: string[]) => at.some((a) => a.includes("max-height: 499px") || a.includes("pointer: coarse"));

  it("手机的触屏尺寸（44 px）与从底部升起的对话框也给横屏的矮窗口（与 hooks/useViewport.ts 的 short 一致），不只看宽 < 720", () => {
    const touch = all.filter((r) => r.body.includes("--v2-h-touch"));
    expect(touch.length).toBeGreaterThan(10);
    expect(touch.filter((r) => !phoneLike(r.at)).map((r) => r.selector)).toEqual([]);
    const sheets = all.filter((r) => r.body.includes("v2-sheet-up"));
    expect(sheets.map((r) => r.selector).join(" ")).toContain(".outcome");
    expect(sheets.filter((r) => !phoneLike(r.at)).map((r) => r.selector)).toEqual([]);
  });

  it("设置的保存条伸到窗口两边与底边时，负外边距取窗口内边距的变量（手机竖屏与横屏一起换），不写死", () => {
    const bar = all.filter((r) => r.selector.includes(".pn-savebar.v2-st-savebar") && /margin|bottom/.test(r.body));
    expect(bar.length).toBeGreaterThan(0);
    // 外边距与 bottom 里没有写死的负像素（阴影 0 -8px 不算）
    const offsets = bar.flatMap((r) => r.body.split(";").map((d) => d.trim()).filter((d) => /^(margin|bottom)/.test(d)));
    expect(offsets.length).toBeGreaterThan(1);
    for (const d of offsets) expect(d).not.toMatch(/-\s?\d+px/);
    expect(bar.some((r) => r.body.includes("calc(-1 * var(--st-pad-x))") && r.body.includes("calc(-1 * var(--st-pad-b))"))).toBe(true);
    const pads = all.filter((r) => r.body.includes("--st-pad-x:"));
    expect(pads.map((r) => r.selector).join(" ")).toContain('[data-layout="short"] .pn-settings');
    expect(pads.map((r) => r.selector).join(" ")).toContain('[data-layout="phone"] .pn-settings');
  });

  it("触屏 44 px 也给就地错误的“重试”（设置）与提示条的按钮", () => {
    const touch = all.filter((r) => phoneLike(r.at) && r.body.includes("min-height: var(--v2-h-touch)")).map((r) => r.selector);
    const joined = touch.join(" | ");
    for (const sel of [
      ".pn-settings .v2-inline-error-action",
      ".shell-main > .toast button",
    ])
      expect(joined).toContain(sel);
  });
});
