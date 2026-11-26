// 第九批开局（docs/UI-CONTRACT.md I1）：选世界、剧本、主角名册、自创模板与开局请求；只有一个世界（或旧后端）时界面与以前相同。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import StartScreen from "../components/StartScreen";
import {
  CUSTOM_HERO,
  ageOn,
  buildRequest,
  chineseOnly,
  daysInMonth,
  hasRoster,
  needsWorldStep,
  newGameWorlds,
  portraitAt,
  portraitStages,
  shortName,
  worldSteps,
} from "../components/start/worldKit";
import type { ProtagonistCard, ScenarioCard, WorldCard, WorldCatalog } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";
import { dayDate, dayParts, setWorld, yearDays } from "../i18n";

function hero(key: string, name: string, born: [number, number, number]): ProtagonistCard {
  return {
    key,
    name,
    name_en: null,
    gender: "f",
    born,
    home: "月港",
    region: "中国·月港",
    tagline: `${name}的一句话`,
    style: "灯与禁",
    playstyle: "走私与黑市",
    tags: ["走私"],
    difficulty: 4,
    strengths: ["commerce"],
    start_ship: "鸟船",
    known: ["东海", "台湾海峡"],
    academy: { key: "shexue", name: "社学", city: "漳州" },
    keepsake: "灯笼",
    portraits: [
      { from_age: 16, asset: `t16-${key}-16` },
      { from_age: 12, asset: `t16-${key}-12` },
      { from_age: 14, asset: `t16-${key}-14` },
    ],
    bonds: [{ person: "xu_cai", name: "许 采", kind: "守秘密的人" }],
  };
}

const plusUltra: ScenarioCard = {
  key: "plus_ultra",
  name: "更远之处",
  description: "十位主角任选其一。",
  start_date: [1553, 1, 1],
  control_date: [1553, 1, 1],
  upbringing: true,
  protagonists: [hero("mio", "一条澪", [1540, 6, 21]), hero("lin_wandeng", "林晚灯", [1540, 3, 23])],
  templates: [
    {
      key: "seville_orphan",
      name: "塞维利亚的孤儿领航学徒",
      home: "塞维利亚",
      family: "老领航考官",
      activities: "领航学校",
      style: "探索",
      known: ["伊比利亚"],
      academy: { key: "casa", name: "领航员课", city: "塞维利亚" },
    },
  ],
  goal: { kind: "story", target: 0, years: null },
  options: { history_toggle: true, skip_upbringing: true },
};
const free1557: ScenarioCard = {
  ...plusUltra,
  key: "free_1557",
  name: "自由航海·1557",
  control_date: [1557, 1, 1],
  upbringing: false,
  protagonists: [],
  templates: [],
  options: { history_toggle: true, skip_upbringing: false },
};
const terra16: WorldCard = {
  key: "terra16",
  name: "寰宇·十六世纪",
  tagline: "1553 年。",
  description: "真实的地球。",
  map_key: "earth",
  era: "公元",
  start_year: 1553,
  currency: "金币",
  months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  modules: ["upbringing"],
  scenarios: [plusUltra, free1557],
};
const classic: WorldCard = { ...terra16, key: "classic", name: "维斯塔海", months: undefined, modules: [], scenarios: [] };
// 另一个非经典世界：有别的世界时经典不再出现在新开局里（2026-11-02），选世界一步用寰宇与它测
const testbed: WorldCard = { ...terra16, key: "testbed", name: "框架测试海域", months: undefined, modules: [], scenarios: [] };
const catalog: WorldCatalog = { current: null, worlds: [classic, terra16, testbed] };

describe("开局流程的纯逻辑", () => {
  it("可见的世界多于一个时才先选世界；有主角或模板的剧本才有名册", () => {
    expect(needsWorldStep(null)).toBe(false);
    expect(needsWorldStep({ current: null, worlds: [classic] })).toBe(false);
    expect(needsWorldStep(catalog)).toBe(true);
    // 新开局：有别的世界时不列经典；只有经典（旧后端）时照旧
    expect(newGameWorlds(catalog.worlds).map((w) => w.key)).toEqual(["terra16", "testbed"]);
    expect(newGameWorlds([classic, terra16]).map((w) => w.key)).toEqual(["terra16"]);
    expect(newGameWorlds([classic]).map((w) => w.key)).toEqual(["classic"]);
    expect(hasRoster(terra16)).toBe(true);
    expect(hasRoster(classic)).toBe(false);
  });

  it("步骤：剧本（多于一个时）→ 主角 → 自创时模板、外貌、姓名 → 启航；自由航海只有剧本与启航", () => {
    expect(worldSteps(terra16, plusUltra, "mio")).toEqual(["scenario", "hero", "confirm"]);
    expect(worldSteps(terra16, plusUltra, CUSTOM_HERO)).toEqual(["scenario", "hero", "template", "look", "name", "confirm"]);
    expect(worldSteps(terra16, free1557, null)).toEqual(["scenario", "confirm"]);
    expect(worldSteps({ ...terra16, scenarios: [plusUltra] }, plusUltra, "mio")).toEqual(["hero", "confirm"]);
  });

  it("按年龄挑头像：取不超过年龄的最后一张，太小时取第一张；年龄段按年龄排序", () => {
    const p = plusUltra.protagonists[0];
    expect(portraitAt(p, 12)).toBe("t16-mio-12");
    expect(portraitAt(p, 13)).toBe("t16-mio-12");
    expect(portraitAt(p, 15)).toBe("t16-mio-14");
    expect(portraitAt(p, 30)).toBe("t16-mio-16");
    expect(portraitAt(p, 5)).toBe("t16-mio-12");
    expect(portraitAt({ portraits: [] }, 12)).toBeNull();
    expect(portraitStages(p).map((s) => s.from_age)).toEqual([12, 14, 16]);
    // 寰宇数据里 0 岁与 12 岁指向同一张 12 岁的图：名册不显示“童年 · 0 岁”这一段
    const zero = { portraits: [{ from_age: 0, asset: "a-12" }, { from_age: 12, asset: "a-12" }, { from_age: 14, asset: "a-14" }, { from_age: 16, asset: "a-16" }] };
    expect(portraitStages(zero)).toEqual([
      { from_age: 12, asset: "a-12" },
      { from_age: 14, asset: "a-14" },
      { from_age: 16, asset: "a-16" },
    ]);
    expect(portraitAt(zero, 5)).toBe("a-12");
  });

  it("周岁按年月日比较，生日当天算满", () => {
    expect(ageOn([1540, 6, 21], [1553, 1, 1])).toBe(12);
    expect(ageOn([1540, 6, 21], [1553, 6, 21])).toBe(13);
    expect(ageOn([1540, 6, 21], [1553, 6, 20])).toBe(12);
    expect(ageOn([1540, 1, 2], [1557, 1, 1])).toBe(16);
  });

  it("开局请求：选主角只带主角；自创带模板与姓名外貌性别生日；开关只在剧本允许时带上", () => {
    const custom = { name: " 阿桑 ", look: 3, gender: "m" as const, month: 2, day: 28 };
    const base = { world: terra16, scenario: plusUltra, template: "seville_orphan", custom, seed: 7, skipUpbringing: true, history: false, info: "carried" as const };
    expect(buildRequest({ ...base, hero: "mio" })).toEqual({
      world: "terra16",
      scenario: "plus_ultra",
      seed: 7,
      info: "carried",
      history: false,
      skip_upbringing: true,
      protagonist: "mio",
    });
    expect(buildRequest({ ...base, hero: CUSTOM_HERO })).toMatchObject({
      template: "seville_orphan",
      captain: { name: "阿桑", look: 3, gender: "m", birthday: [2, 28] },
    });
    const free = buildRequest({ ...base, scenario: free1557, hero: null });
    expect(free).not.toHaveProperty("skip_upbringing");
    expect(free).not.toHaveProperty("protagonist");
  });

  it("每月天数取世界日历，缺省 30 天；名册格子只写名", () => {
    expect(daysInMonth(terra16.months, 2)).toBe(28);
    expect(daysInMonth(undefined, 2)).toBe(30);
    expect(shortName("莉芙·德克莱尔克")).toBe("莉芙");
    expect(shortName("林晚灯")).toBe("林晚灯");
  });
});

describe("开局界面：选世界与主角名册", () => {
  beforeEach(() => {
    useGame.setState({ statics, overview: null, version: 0, error: null, message: null });
  });

  it("旧后端（没有 world_catalog）：不出现选世界，照旧是剧本向导", async () => {
    installIpc();
    render(<StartScreen roll={3} />);
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(screen.queryByText("选择世界")).not.toBeInTheDocument();
  });

  it("经典 + 寰宇：新开局不出现经典与选世界，直接切到寰宇的名册（读档照旧能读经典）", async () => {
    const calls = installIpc({
      world_catalog: () => ({ current: null, worlds: [classic, terra16] }),
      select_world: () => ({ ...statics, world: { ...statics.world, key: "terra16" } }),
    });
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("select_world", { world: "terra16" }));
    expect(await screen.findByTestId("scenario-plus_ultra")).toBeInTheDocument();
    expect(screen.queryByText("选择世界")).not.toBeInTheDocument();
    expect(screen.queryByTestId("world-classic")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("select_world", { world: "classic" });
  });

  it("选寰宇 → 剧本 → 名册里选林晚灯 → 启航：提交 new_world_game，带主角与开关", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      world_catalog: () => catalog,
      select_world: () => ({ ...statics, world: { ...statics.world, key: "terra16" } }),
      new_world_game: () => overview,
    });
    render(<StartScreen roll={3} />);
    await user.click(await screen.findByTestId("world-terra16"));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("select_world", { world: "terra16" }));
    // 剧本一步：缺省选中带名册的"更远之处"
    expect(await screen.findByTestId("scenario-plus_ultra")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    // 名册：缺省选中第一位，换成林晚灯后小传跟着换
    const strip = screen.getByRole("radiogroup", { name: "选择主角" });
    expect(within(strip).getByTestId("hero-mio")).toHaveAttribute("aria-checked", "true");
    await user.click(within(strip).getByTestId("hero-lin_wandeng"));
    const detail = screen.getByTestId("hero-detail");
    expect(detail).toHaveAttribute("data-hero", "lin_wandeng");
    expect(within(detail).getByText("林晚灯的一句话")).toBeInTheDocument();
    expect(within(detail).getByText("许 采")).toBeInTheDocument();
    // 年龄段：童年 / 学院 / 出航三张，开局时 12 岁亮着童年
    expect(within(detail).getByRole("button", { name: /童年/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "开始养成" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("new_world_game", {
        request: { world: "terra16", scenario: "plus_ultra", seed: null, info: "carried", history: true, skip_upbringing: false, protagonist: "lin_wandeng" },
      }),
    );
  });

  it("自创：模板 → 外貌 → 姓名、性别与生日（2 月只有 28 天）→ 启航带模板与主角", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      world_catalog: () => ({ current: "terra16", worlds: [classic, terra16, testbed] }),
      select_world: () => statics,
      new_world_game: () => overview,
    });
    render(<StartScreen roll={3} />);
    // current 是寰宇：选世界一步缺省高亮它
    expect(await screen.findByTestId("world-terra16")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    await user.click(screen.getByTestId("hero-custom"));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("template-seville_orphan")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    const name = screen.getByLabelText("姓名") as HTMLInputElement;
    await user.clear(name);
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    await user.type(name, "阿桑");
    await user.click(screen.getByLabelText("男"));
    await user.selectOptions(screen.getByLabelText("月份"), "2");
    expect(within(screen.getByLabelText("日")).getAllByRole("option")).toHaveLength(28);
    await user.selectOptions(screen.getByLabelText("日"), "14");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "开始养成" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("new_world_game", expect.anything()));
    const req = (calls.mock.calls.find((c) => c[0] === "new_world_game")?.[1] as { request: Record<string, unknown> }).request;
    expect(req).toMatchObject({ world: "terra16", template: "seville_orphan", captain: { name: "阿桑", gender: "m", birthday: [2, 14] } });
    expect(req).not.toHaveProperty("protagonist");
  });

  it("B11：内容只有中文的世界在卡片上写“英文版稍后提供”；中英都有或旧后端没有 languages 的世界不写", async () => {
    expect(chineseOnly(["zh"])).toBe(true);
    expect(chineseOnly(["zh", "en"])).toBe(false);
    expect(chineseOnly(undefined)).toBe(false);
    installIpc({ world_catalog: () => ({ current: null, worlds: [{ ...testbed, languages: ["zh", "en"] }, { ...terra16, languages: ["zh"] }] }) });
    render(<StartScreen roll={3} />);
    expect(await screen.findByTestId("world-terra16")).toHaveTextContent("暂只有中文 · 英文版稍后提供");
    expect(screen.getByTestId("world-testbed")).not.toHaveTextContent("英文版稍后提供");
  });

  it("只有中文的世界英文名退回中文名时，卡片上不重复写两遍；有英文名时照写", async () => {
    installIpc({
      world_catalog: () => ({
        current: null,
        worlds: [
          { ...testbed, name_en: "Testbed Sea" },
          { ...terra16, name: "寰宇·十六世纪", name_en: "寰宇·十六世纪", languages: ["zh"] },
        ],
      }),
    });
    render(<StartScreen roll={3} />);
    const card = await screen.findByTestId("world-terra16");
    expect(card.querySelector("small[lang='en']")).toBeNull();
    expect(screen.getByTestId("world-testbed").querySelector("small[lang='en']")).toHaveTextContent("Testbed Sea");
  });

  it("从名册“换个世界”回到选世界", async () => {
    const user = userEvent.setup();
    installIpc({ world_catalog: () => catalog, select_world: () => statics });
    render(<StartScreen roll={3} />);
    await user.click(await screen.findByTestId("world-terra16"));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("button", { name: "换个世界" }));
    expect(await screen.findByText("选择世界")).toBeInTheDocument();
  });
});

describe("世界日历的日期换算", () => {
  it("公历月长：第 0 天是 1 月 1 日，第 31 天是 2 月 1 日，第 59 天是 3 月 1 日，第 365 天是次年 1 月 1 日；经典世界照旧 12 × 30", () => {
    setWorld({ currency: "金币", era: "公元", start_year: 1553, calendar: { months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], seasons: [], month_names: [] } });
    expect(yearDays()).toBe(365);
    expect(dayParts(0)).toEqual({ year: 1, month: 1, date: 1 });
    expect(dayParts(31)).toEqual({ year: 1, month: 2, date: 1 });
    expect(dayParts(59)).toEqual({ year: 1, month: 3, date: 1 });
    expect(dayParts(364)).toEqual({ year: 1, month: 12, date: 31 });
    expect(dayParts(365)).toEqual({ year: 2, month: 1, date: 1 });
    expect(dayDate(365)).toBe("1554年1月1日");
    setWorld(null);
    expect(yearDays()).toBe(360);
    expect(dayParts(31)).toEqual({ year: 1, month: 2, date: 2 });
  });
});

