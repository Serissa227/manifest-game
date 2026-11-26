// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 9 组）下的历史与秘闻：只在 v2 下多出的结构与行为——
// 时间线按状态分组、天平写明偏向（色带画在占优的一方那边）、杠杆的操作都在行里（送货表单直接摊开与“全部 n”、出钱的快捷金额、
// 现金不够 / 做不了 / 没办成都就地写原因、办成在提示条回一句）、时间线与编年史的空状态与“下一步”；
// 秘闻的入会、施放、开工在卡底一行并写明做不了的原因，信仰与思想没有选中港口时一键看舰队所在 / 驶向的港口；
// “去某处”的杠杆写明要亲自去办、一键在航海图上看那里；法术与开工缺舰队 / 港口时就地给一键补救。
// 另查 v1 维持原样：同样的数据在 v1 下没有这些结构（原来的写法见 history.test.tsx）。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HistoryPanel from "../components/history/HistoryPanel";
import SecretsPanel from "../components/history/SecretsPanel";
import { balanceLean, balanceSpan } from "../components/history/historyKit";
import { setLocale } from "../i18n/locale";
import type { ArcanaView, IdeasView, LegendShipsView, LeverView, SocietiesView, TimelineEvent, TimelineView } from "../ipc/types";
import { useShell } from "../components/shell/shellState";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

const ev = (o: Partial<TimelineEvent> & Pick<TimelineEvent, "key" | "title">): TimelineEvent => ({
  summary: "",
  region: null,
  date: [1561, 4, 1],
  window: null,
  days_left: 30,
  status: "active",
  campaign: null,
  sides: [
    { key: "ming", name: "明", color: null },
    { key: "jin", name: "后金", color: null },
  ],
  balance: { lo: -20, hi: -8, known: "rough" },
  levers: [],
  why_hard: [],
  outcome: null,
  basis: "extended",
  sources: [],
  ...o,
});

const sarhu = ev({
  key: "sarhu",
  title: "萨尔浒",
  levers: [
    { key: "arms", side: "ming", kind: "arms", label: "把火绳枪与火炮送到登州", where: "登州", goods: [{ good: 3, name: "火绳枪" }], progress: { points: 6, max: 12 }, yours: 3, risk: null, note: null, action: "deliver", enabled: true },
    { key: "pay", side: "ming", kind: "money", label: "辽东的军饷", where: null, goods: [], progress: { points: 0, max: 10 }, yours: 0, risk: null, note: null, action: "money", enabled: true },
    { key: "talk", side: "ming", kind: "negotiate", label: "说服朝鲜中立", where: "汉城", goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: null, note: null, action: "commit", enabled: false, blocked_reason: "要会说朝鲜话的通事" },
    { key: "drill", side: "ming", kind: "train", label: "替戚家军练兵", where: null, goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: null, note: null, action: "commit", enabled: true },
  ],
  why_hard: ["还缺两类杠杆"],
});
const later = ev({ key: "later", title: "宁远", status: "future", days_left: 300, balance: { lo: 5, hi: 20, known: "exact" } });
const past = ev({ key: "rhodes", title: "罗得岛之围", status: "resolved", date: [1555, 1, 1], days_left: null, outcome: { key: "holds", text: "骑士团守住了", historical: false, history: "1522 年陷落" } });
const tl: TimelineView = { events: [past, later, sarhu], deviation: 3, history_on: true };

/** 旗舰队舱里有 25 支火绳枪（货 3），现金 6,000。 */
function withCargo() {
  useGame.setState({
    overview: { ...overview, cash: 6000, fleets: [{ ...overview.fleets[0], cargo: [{ good: 3, qty: 25, avg_cost: 30 }] }] },
  });
}

/** 提交成功时回的概览就是手上这一份（舱里的货与现金不变）。 */
const keepOverview = () => ({ outcome: "Done", overview: useGame.getState().overview });

beforeEach(() => {
  setLocale("zh-CN");
  setUiFor("v2");
  useGame.setState({ statics, overview, version: 1, error: null, message: null, selectedLoc: 0, selectedFleet: overview.fleets[0]?.id ?? null });
});
afterEach(() => {
  // 先卸下组件再切回 v1（否则切换会让还挂着的组件在 act 之外更新）
  cleanup();
  setUiFor("v1");
});

describe("天平的倾向", () => {
  it("区间整个在正数一边偏向第一方、负数一边偏向第二方，跨过中线难分高下，情报不足不写", () => {
    expect(balanceLean({ lo: 5, hi: 20, known: "exact" }, "明", "后金")).toEqual({ side: "明" });
    expect(balanceLean({ lo: -20, hi: -8, known: "rough" }, "明", "后金")).toEqual({ side: "后金" });
    expect(balanceLean({ lo: -4, hi: 6, known: "rough" }, "明", "后金")).toEqual({ side: null });
    expect(balanceLean({ lo: 0, hi: 0, known: "exact" }, "明", "后金")).toEqual({ side: null });
    expect(balanceLean({ lo: 0, hi: 0, known: "unknown" }, "明", "后金")).toBeNull();
  });
});

describe("新界面的时间线", () => {
  it("按进行中 / 将要发生 / 已揭晓分组；天平写明偏向，色带画在占优的一方那边", async () => {
    installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    const card = await screen.findByTestId("event-sarhu");
    expect(screen.getByRole("heading", { name: "进行中 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "将要发生 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已揭晓 1" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "进行中 1" })).getByTestId("event-sarhu")).toBe(card);
    expect(screen.getByText(/期限之前在杠杆上出力/)).toBeInTheDocument();
    // −20…−8：偏向第二方（后金，在右），色带在中线右边（v1 画在 33.3%）
    expect(within(card).getByTestId("balance-sarhu")).toHaveTextContent("偏向后金");
    const span = balanceSpan(-20, -8);
    const range = within(card).getByTestId("balance-sarhu").querySelector<HTMLElement>(".hs-scale-range")!;
    expect(range.style.left).toBe(`${100 - span.to}%`);
    expect(screen.getByTestId("balance-later")).toHaveTextContent("偏向明");
    expect(within(card).getByRole("heading", { name: "你能出力的地方" })).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "为什么难" })).toBeInTheDocument();
  });

  it("送货的表单直接摊开：“全部 25”一键填满，交货后提示条回一句", async () => {
    const user = userEvent.setup();
    withCargo();
    const calls = installIpc({ timeline: () => tl, submit: keepOverview });
    render(<HistoryPanel />);
    const arms = await screen.findByTestId("lever-arms");
    expect(within(arms).queryByRole("button", { name: "送货……" })).not.toBeInTheDocument();
    // 只有一支舰队、一种货：不出下拉
    expect(within(arms).queryByLabelText("哪支舰队")).not.toBeInTheDocument();
    expect(within(arms).getByText("火绳枪")).toBeInTheDocument();
    await user.click(within(arms).getByRole("button", { name: "全部 25" }));
    expect(within(arms).getByLabelText("数量")).toHaveValue(25);
    expect(within(arms).getByRole("button", { name: "全部 25" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(arms).getByRole("button", { name: "交货" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { Contribute: { owner: "player", event: "sarhu", lever: "arms", payload: { Deliver: { fleet: overview.fleets[0].id, goods: [[3, 25]], donate: false } } } },
      }),
    );
    await waitFor(() => expect(useGame.getState().message).toBe("已为“把火绳枪与火炮送到登州”出力。"));
  });

  it("舰队没装这种货时写明，数量照样可以填", async () => {
    installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    const arms = await screen.findByTestId("lever-arms");
    expect(arms).toHaveTextContent("这支舰队没装这种货");
    expect(within(arms).queryByRole("button", { name: /^全部/ })).not.toBeInTheDocument();
    expect(within(arms).getByRole("button", { name: "交货" })).toBeEnabled();
  });

  it("出钱：快捷金额一点就换，比现金多的不可点；金额超过现金时按钮不可用、就地写原因", async () => {
    const user = userEvent.setup();
    withCargo();
    const calls = installIpc({ timeline: () => tl, submit: keepOverview });
    render(<HistoryPanel />);
    const pay = await screen.findByTestId("lever-pay");
    const quick = within(pay).getByRole("group", { name: "快捷金额" });
    expect(within(quick).getByRole("button", { name: "10,000" })).toBeDisabled();
    await user.click(within(quick).getByRole("button", { name: "5,000" }));
    expect(within(pay).getByLabelText("金额")).toHaveValue(5000);
    await user.click(within(pay).getByRole("button", { name: "出 5,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Contribute: { owner: "player", event: "sarhu", lever: "pay", payload: { Money: { amount: 5000 } } } } }));
    await waitFor(() => expect(within(pay).getByRole("button", { name: "出 5,000 金币" })).toBeEnabled());
    await user.clear(within(pay).getByLabelText("金额"));
    await user.type(within(pay).getByLabelText("金额"), "8000");
    const give = within(pay).getByRole("button", { name: "出 8,000 金币" });
    expect(give).toBeDisabled();
    expect(pay).toHaveTextContent("现金只有 6,000 金币。");
    expect(give).toHaveAccessibleDescription("现金只有 6,000 金币。");
  });

  it("做不了的原因写在行里，没有按钮；能做的“去做”在行内", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    const talk = await screen.findByTestId("lever-talk");
    expect(within(talk).getByTestId("inline-error")).toHaveTextContent("要会说朝鲜话的通事");
    expect(within(talk).queryByRole("button")).not.toBeInTheDocument();
    await user.click(within(screen.getByTestId("lever-drill")).getByRole("button", { name: "去做" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Contribute: { owner: "player", event: "sarhu", lever: "drill", payload: { Commit: {} } } } }));
  });

  it("没办成：原因写在那个杠杆的行里（别的杠杆不写），再试时清掉", async () => {
    const user = userEvent.setup();
    let fail = true;
    installIpc({
      timeline: () => tl,
      submit: () => {
        if (fail) throw new Error("登州的城门关了");
        return { outcome: "Done", overview };
      },
    });
    render(<HistoryPanel />);
    const drill = await screen.findByTestId("lever-drill");
    await user.click(within(drill).getByRole("button", { name: "去做" }));
    const err = await within(drill).findByRole("alert");
    expect(err).toHaveTextContent("登州的城门关了");
    expect(err).toHaveTextContent("调整之后可以再试一次。");
    expect(within(screen.getByTestId("lever-pay")).queryByRole("alert")).not.toBeInTheDocument();
    fail = false;
    await user.click(within(drill).getByRole("button", { name: "去做" }));
    await waitFor(() => expect(within(drill).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("只读时杠杆的小标题是“杠杆”，没有操作", async () => {
    installIpc({ timeline: () => ({ ...tl, history_on: false }) });
    render(<HistoryPanel />);
    const card = await screen.findByTestId("event-sarhu");
    expect(within(card).getByRole("heading", { name: "杠杆" })).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/期限之前在杠杆上出力/)).not.toBeInTheDocument();
  });

  it("时间线是空的：空状态的“下一步”去编年史；编年史也是空的：“下一步”回时间线", async () => {
    const user = userEvent.setup();
    installIpc({ timeline: () => ({ events: [], deviation: 0, history_on: true }), chronicle: () => ({ entries: [] }) });
    render(<HistoryPanel />);
    expect(await screen.findByText("眼下没有能介入的历史事件。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看编年史" }));
    expect(screen.getByRole("tab", { name: "编年史" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("编年史还是空白。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看时间线" }));
    expect(screen.getByRole("tab", { name: "时间线" })).toHaveAttribute("aria-selected", "true");
  });

  it("编年史：与史实不同的条目读屏念得出来，上面有图例", async () => {
    const user = userEvent.setup();
    installIpc({
      timeline: () => tl,
      chronicle: () => ({
        entries: [
          { date: [1554, 8, 15], text: "的黎波里没有陷落。", history: "1551 年陷落", deviates: true },
          { date: [1556, 1, 16], text: "腓力二世即位。", history: null, deviates: false },
        ],
      }),
    });
    render(<HistoryPanel />);
    await screen.findByTestId("event-sarhu");
    await user.click(screen.getByRole("tab", { name: "编年史" }));
    const first = (await screen.findByText("的黎波里没有陷落。")).closest("li")!;
    expect(first).toHaveTextContent("与史实不同");
    expect(screen.getByText("腓力二世即位。").closest("li")).not.toHaveTextContent("与史实不同");
  });

  it("编年史：年度回顾写成“某年回顾”，不再另挂史实行；模型写的带羽毛笔标记", async () => {
    const user = userEvent.setup();
    installIpc({
      timeline: () => tl,
      chronicle: () => ({
        entries: [
          { date: [1554, 8, 15], text: "的黎波里没有陷落。", history: "1551 年陷落", deviates: true },
          { date: [1554, 12, 31], text: "1554年的册子不厚。", history: "1551 年陷落", deviates: true, annual: true, ai: true },
          { date: [1555, 12, 31], text: "1555年平平过去。", history: "", deviates: false, annual: true, ai: false },
        ],
      }),
    });
    render(<HistoryPanel />);
    await screen.findByTestId("event-sarhu");
    await user.click(screen.getByRole("tab", { name: "编年史" }));
    const annual = (await screen.findByText("1554年的册子不厚。")).closest("li")!;
    expect(annual).toHaveTextContent("1554 年回顾");
    expect(annual).not.toHaveTextContent("史实：");
    expect(within(annual).getByLabelText("AI 写的")).toBeInTheDocument();
    const plain = screen.getByText("1555年平平过去。").closest("li")!;
    expect(plain).toHaveTextContent("1555 年回顾");
    expect(within(plain).queryByLabelText("AI 写的")).not.toBeInTheDocument();
  });
});

describe("新界面的秘闻", () => {
  const soc: SocietiesView = {
    suspicion: [{ faction: 0, name: "西班牙", value: 30, level: "留意" }],
    societies: [
      { key: "pilots", name: "七海的引航人", secrecy: 2, known: "met", rank: null, rank_name: null, ranks: [], trial: null, allies: [], enemies: [], seat: "里斯本", basis: null, sources: [], active: null, can_join: true },
      { key: "rosy", name: "玫瑰与十字", secrecy: 5, known: "rumor", rank: null, rank_name: null, ranks: [], trial: null, allies: [], enemies: [], seat: null, basis: "legend", sources: [], active: null, can_join: false, blocked_reason: "只听说过名字：先找到一位成员" },
    ],
  };
  const arc: ArcanaView = {
    schools: [{ key: "daoist", name: "符箓与斋醮", level: 1, basis: null, sources: [] }],
    spells: [
      { key: "fair_wind", name: "顺风之符", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["fleet"], enabled: true, source: null },
      { key: "veil", name: "雾", school: "daoist", rank: 2, desc: "", cost: "", cooldown_left: 12, targets: ["fleet"], enabled: true, source: null },
      { key: "omen", name: "占兆", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["event"], enabled: true, source: null },
      { key: "whisper", name: "听传闻", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["rumor"], enabled: true, source: null },
    ],
  };
  const ideas: IdeasView = {
    loc: 1,
    name: "柳湾",
    shares: [{ idea: "catholic", name: "天主教", share: 22, delta_year: 3 }],
    modes: [{ mode: "court", idea: "catholic", label: "托人说情", needs: [], points: 0, cap: 6, enabled: false, blocked_reason: "要先与总督府有交情" }],
    hostility: null,
  };
  const ships: LegendShipsView = {
    ships: [
      { key: "michael", name: "大迈克尔号", hull: "卡拉克", traits: [], state: "blueprint", lore: "", acquire: null, basis: null, sources: [], can_commission: false, blocked_reason: "这里没有船坞" },
    ],
  };

  it("结社：入会在卡底一行，办成回一句；做不了的写原因并由按钮指过去；嫌疑有小标题", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ societies: () => soc });
    render(<SecretsPanel />);
    const pilots = await screen.findByTestId("society-pilots");
    expect(screen.getByRole("heading", { name: "各势力的嫌疑" })).toBeInTheDocument();
    await user.click(within(pilots).getByRole("button", { name: "请求入会" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { JoinSociety: { owner: "player", society: "pilots" } } }));
    await waitFor(() => expect(useGame.getState().message).toBe("已向“七海的引航人”请求入会。"));
    const rosy = screen.getByTestId("society-rosy");
    const join = within(rosy).getByRole("button", { name: "请求入会" });
    expect(join).toBeDisabled();
    expect(join).toHaveAccessibleDescription("只听说过名字：先找到一位成员");
  });

  it("秘术：没选舰队、冷却中、要在别处施放，都写明原因", async () => {
    const user = userEvent.setup();
    useGame.setState({ selectedFleet: null });
    installIpc({ arcana: () => arc });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const fair = await screen.findByTestId("spell-fair_wind");
    expect(within(fair).getByRole("button", { name: "施放" })).toBeDisabled();
    expect(fair).toHaveTextContent("要先选一支舰队。");
    expect(screen.getByTestId("spell-veil")).toHaveTextContent("还在冷却：12 天后能再用。");
    // B12：对象是一件事的法术就在这里从时间线上选；时间线上还没有可选的事时写明
    expect(screen.getByTestId("spell-omen")).toHaveTextContent("眼下还不知道有什么事可以占卜");
    expect(within(screen.getByTestId("spell-omen")).getByRole("button", { name: "施放" })).toBeDisabled();
    expect(screen.getByTestId("spell-whisper")).toHaveTextContent("这道法术要在事件或传闻那里施放。");
    expect(screen.getByRole("heading", { name: "法术" })).toBeInTheDocument();
  });

  it("信仰与思想：没有选中港口时一键看舰队驶向的港口；做不了的传播方式写原因", async () => {
    const user = userEvent.setup();
    useGame.setState({ selectedLoc: null, overview: { ...overview, fleets: [{ ...overview.fleets[0], docked: null, dest: 1 }] } });
    const calls = installIpc({ ideas: () => ideas });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "信仰与思想" }));
    expect(screen.getByText("信仰与思想是按港口看的：先选一个港口。")).toBeInTheDocument();
    expect(within(screen.getByLabelText("选港口")).getByRole("option", { name: "澄港" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看柳湾" }));
    expect(useGame.getState().selectedLoc).toBe(1);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("ideas", { loc: 1 }));
    expect(await screen.findByText("柳湾的信仰与思想")).toBeInTheDocument();
    expect(screen.getByText("一年 +3")).toBeInTheDocument();
    const court = screen.getByRole("button", { name: "宫廷的门路" });
    expect(court).toBeDisabled();
    expect(court).toHaveAccessibleDescription("要先与总督府有交情");
  });

  it("传说之船：照图纸开工做不了时写明原因（原来只在悬停提示里）", async () => {
    const user = userEvent.setup();
    installIpc({ legend_ships: () => ships });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    const michael = await screen.findByTestId("ship-michael");
    const go = within(michael).getByRole("button", { name: "在这里开工" });
    expect(go).toBeDisabled();
    expect(go).toHaveAccessibleDescription("这里没有船坞");
  });
});

describe("旧界面（v1）维持原样", () => {
  it("时间线不分组、送货要先点“送货……”、色带照旧的位置、没有就地的原因框；秘闻没有操作行与小标题", async () => {
    const user = userEvent.setup();
    setUiFor("v1");
    installIpc({ timeline: () => tl, societies: () => soc2 });
    const { unmount } = render(<HistoryPanel />);
    const card = await screen.findByTestId("event-sarhu");
    expect(screen.queryByRole("heading", { name: /进行中/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/期限之前在杠杆上出力/)).not.toBeInTheDocument();
    expect(within(card).getByTestId("balance-sarhu")).not.toHaveTextContent("偏向");
    const range = within(card).getByTestId("balance-sarhu").querySelector<HTMLElement>(".hs-scale-range")!;
    expect(range.style.left).toBe(`${balanceSpan(-20, -8).from}%`);
    expect(within(screen.getByTestId("lever-arms")).getByRole("button", { name: "送货……" })).toBeInTheDocument();
    expect(screen.queryByTestId("inline-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "快捷金额" })).not.toBeInTheDocument();
    // v1 办成以后不在提示条回话（与改版前一样）
    const act0 = useGame.getState().act;
    await user.click(within(screen.getByTestId("lever-drill")).getByRole("button", { name: "去做" }));
    await waitFor(() => expect(useGame.getState().act).toBe(act0 + 1));
    expect(useGame.getState().message).toBeNull();
    unmount();
    render(<SecretsPanel />);
    const rosy = await screen.findByTestId("society-rosy");
    expect(within(rosy).getByRole("button", { name: "请求入会" })).toHaveClass("ts-btn", "ts-btn-small");
    expect(rosy.querySelector(".it-why")).toHaveTextContent("只听说过名字：先找到一位成员");
    expect(document.querySelector(".sc-actions, .hs-mini-head, [class*='v2-']")).toBeNull();
  });
});

const soc2: SocietiesView = {
  suspicion: [],
  societies: [{ key: "rosy", name: "玫瑰与十字", secrecy: 5, known: "rumor", rank: null, rank_name: null, ranks: [], trial: null, allies: [], enemies: [], seat: null, basis: null, sources: [], active: null, can_join: false, blocked_reason: "只听说过名字：先找到一位成员" }],
};

describe("新界面：去某处的杠杆与缺对象时的补救", () => {
  const siege = ev({
    key: "siege",
    title: "马耳他之围",
    levers: [
      { key: "convoy", side: "ming", kind: "battle", label: "在柳湾外海截下运粮船", where: "柳湾", goods: [], progress: { points: 3, max: 12 }, yours: 0, risk: null, note: null, action: "goto", enabled: true },
      { key: "letters", side: "ming", kind: "intel", label: "把求援信送进堡里", where: "圣艾尔摩堡", goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: null, note: null, action: "goto", enabled: true },
      { key: "track", side: "ming", kind: "track", label: "走完一条故事", where: null, goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: null, note: null, action: "goto", enabled: true },
    ],
  });
  const siegeTl: TimelineView = { events: [siege], deviation: 0, history_on: true };

  it("去某处：行里写明要亲自去办；地名对得上地点时一键在航海图上看（选中那里、关掉窗口、换到航海图），对不上的写小签", async () => {
    const user = userEvent.setup();
    useGame.setState({ stage: "town" });
    useShell.setState({ windowOpen: true });
    installIpc({ timeline: () => siegeTl });
    render(<HistoryPanel />);
    const convoy = await screen.findByTestId("lever-convoy");
    expect(convoy).toHaveTextContent("这一项要亲自到柳湾去办：到了那里照着做，就记在你名下。");
    await user.click(within(convoy).getByRole("button", { name: "在航海图上看柳湾" }));
    expect(useGame.getState().selectedLoc).toBe(1);
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
    const letters = screen.getByTestId("lever-letters");
    expect(within(letters).queryByRole("button")).not.toBeInTheDocument();
    expect(letters).toHaveTextContent("到圣艾尔摩堡去办");
    const track = screen.getByTestId("lever-track");
    expect(track).toHaveTextContent("这一项要亲自去办：照着做了，就记在你名下。");
    expect(track).toHaveTextContent("亲自去办");
  });

  it("去某处：没看见过的地点（隐藏未知港口的世界）不给“在航海图上看”，只写小签", async () => {
    useGame.setState({ overview: { ...overview, sighted: [0] } });
    installIpc({ timeline: () => siegeTl });
    render(<HistoryPanel />);
    const convoy = await screen.findByTestId("lever-convoy");
    expect(within(convoy).queryByRole("button")).not.toBeInTheDocument();
    expect(convoy).toHaveTextContent("到柳湾去办");
  });

  it("只读时去某处的杠杆不写说明、没有按钮；v1 维持原样（没有说明）", async () => {
    installIpc({ timeline: () => ({ ...siegeTl, history_on: false }) });
    const { unmount } = render(<HistoryPanel />);
    const convoy = await screen.findByTestId("lever-convoy");
    expect(convoy).not.toHaveTextContent("亲自");
    expect(within(convoy).queryByRole("button")).not.toBeInTheDocument();
    unmount();
    setUiFor("v1");
    installIpc({ timeline: () => siegeTl });
    render(<HistoryPanel />);
    const v1 = await screen.findByTestId("lever-convoy");
    expect(v1).not.toHaveTextContent("亲自");
    expect(within(v1).queryByRole("button")).not.toBeInTheDocument();
  });

  it("秘术：没选舰队时写明怎么办，一键选旗舰队，选了就能施放", async () => {
    const user = userEvent.setup();
    useGame.setState({ selectedFleet: null });
    const arc: ArcanaView = {
      schools: [],
      spells: [{ key: "fair_wind", name: "顺风之符", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["fleet"], enabled: true, source: null }],
    };
    installIpc({ arcana: () => arc });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const fair = await screen.findByTestId("spell-fair_wind");
    expect(fair).toHaveTextContent("要先选一支舰队。");
    expect(fair).toHaveTextContent("法术施在选中的舰队上。");
    await user.click(within(fair).getByRole("button", { name: `选舰队 #${overview.fleets[0].id}` }));
    expect(useGame.getState().selectedFleet).toBe(overview.fleets[0].id);
    expect(within(fair).getByRole("button", { name: "施放" })).toBeEnabled();
    expect(within(fair).queryByTestId("inline-error")).not.toBeInTheDocument();
  });

  it("传说之船：没选港口时写明怎么办，一键选舰队所在的港口，选了就能开工；舰队都不在港口附近时只说在航海图上点一个", async () => {
    const user = userEvent.setup();
    useGame.setState({ selectedLoc: null });
    const yard: LegendShipsView = {
      ships: [{ key: "michael", name: "大迈克尔号", hull: "卡拉克", traits: [], state: "blueprint", lore: "", acquire: null, basis: null, sources: [], can_commission: true }],
    };
    installIpc({ legend_ships: () => yard });
    const { unmount } = render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    const michael = await screen.findByTestId("ship-michael");
    expect(michael).toHaveTextContent("要先选一个港口。");
    expect(within(michael).getByRole("button", { name: "在这里开工" })).toBeDisabled();
    await user.click(within(michael).getByRole("button", { name: "选澄港" }));
    expect(useGame.getState().selectedLoc).toBe(0);
    expect(within(michael).getByRole("button", { name: "在这里开工" })).toBeEnabled();
    unmount();
    useGame.setState({ selectedLoc: null, overview: { ...overview, fleets: [{ ...overview.fleets[0], docked: null, dest: null }] } });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    const again = await screen.findByTestId("ship-michael");
    expect(again).toHaveTextContent("在航海图上点一个港口。");
    expect(within(again).queryByRole("button", { name: /^选/ })).not.toBeInTheDocument();
  });
});

// 评审第二轮：没有舰队时的交货、窗口开着时舰队变了、去某处对不上地点时不放小签、只读时不写“做不了的原因”、
// 冷却只写一次、秘境“听说过”的虚线框、变量卡不画印章红的顶线
describe("新界面：评审第二轮的修改", () => {
  const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const HISTORY_CSS = "../styles/ui-v2/history.css";
  /** 样式表里选择器含 needle 的那一条规则（选择器与块）。 */
  const ruleWith = (css: string, needle: string) => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => r.sel.split(",").some((s) => s.trim().endsWith(needle)));
  };

  it("一支舰队都没有时（养成开局不带船）：交货不可用，行里写明先要有一支舰队并由按钮指过去，不再说“这支舰队没装这种货”", async () => {
    useGame.setState({ overview: { ...overview, fleets: [] } });
    installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    const arms = await screen.findByTestId("lever-arms");
    const deliver = within(arms).getByRole("button", { name: "交货" });
    expect(deliver).toBeDisabled();
    expect(arms).not.toHaveTextContent("这支舰队没装这种货");
    const why = within(arms).getByTestId("inline-error");
    expect(why).toHaveTextContent("先要有一支舰队。");
    expect(why).toHaveTextContent("货要从舰队的货舱里交；有了第一条船就能交。");
    expect(why.id).not.toBe("");
    expect(deliver).toHaveAttribute("aria-describedby", why.id);
    // 别的杠杆（出钱、去做）照常
    expect(within(screen.getByTestId("lever-drill")).getByRole("button", { name: "去做" })).toBeEnabled();
  });

  it("窗口开着时舰队变了：选过的那支不在了就用剩下的第一支交货；舰队都没了就不可用并写原因", async () => {
    const user = userEvent.setup();
    const first = { ...overview.fleets[0], cargo: [{ good: 3, qty: 25, avg_cost: 30 }] };
    const second = { ...overview.fleets[0], id: 5, cargo: [{ good: 3, qty: 7, avg_cost: 30 }] };
    useGame.setState({ overview: { ...overview, fleets: [first, second] } });
    const calls = installIpc({ timeline: () => tl, submit: keepOverview });
    render(<HistoryPanel />);
    const arms = await screen.findByTestId("lever-arms");
    await user.selectOptions(within(arms).getByLabelText("哪支舰队"), "5");
    expect(within(arms).getByRole("button", { name: "全部 7" })).toBeInTheDocument();
    // 第二支卖掉了：退回第一支（下拉也跟着不见了，只剩一支）
    await act(async () => useGame.setState({ overview: { ...overview, fleets: [first] } }));
    expect(within(arms).queryByLabelText("哪支舰队")).not.toBeInTheDocument();
    expect(within(arms).getByRole("button", { name: "全部 25" })).toBeInTheDocument();
    await user.click(within(arms).getByRole("button", { name: "交货" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { Contribute: { owner: "player", event: "sarhu", lever: "arms", payload: { Deliver: { fleet: first.id, goods: [[3, 10]], donate: false } } } },
      }),
    );
    await waitFor(() => expect(useGame.getState().message).toBe("已为“把火绳枪与火炮送到登州”出力。"));
    await waitFor(() => expect(within(screen.getByTestId("lever-arms")).getByRole("button", { name: "交货" })).toBeEnabled());
    // 一支都没了：按钮不可用，原因写在行里
    await act(async () => useGame.setState({ overview: { ...overview, fleets: [] } }));
    const row = screen.getByTestId("lever-arms");
    expect(within(row).getByRole("button", { name: "交货" })).toBeDisabled();
    expect(within(row).getByTestId("inline-error")).toHaveTextContent("先要有一支舰队。");
  });

  it("去某处：地名对不上地点时，右边的操作列不放东西（不画像按钮的小签），去哪里只在说明里写一次", async () => {
    const letters: LeverView = { key: "letters", side: "ming", kind: "intel", label: "把求援信送进堡里", where: "圣艾尔摩堡", goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: null, note: null, action: "goto", enabled: true };
    const track: LeverView = { ...letters, key: "track", label: "走完一条故事", where: null };
    installIpc({ timeline: () => ({ events: [ev({ key: "siege", title: "马耳他之围", levers: [letters, track] })], deviation: 0, history_on: true }) });
    render(<HistoryPanel />);
    for (const id of ["lever-letters", "lever-track"]) {
      const row = await screen.findByTestId(id);
      expect(row.querySelector(".hs-lever-do")).toBeNull();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    }
    const text = screen.getByTestId("lever-letters").textContent ?? "";
    expect(text.split("圣艾尔摩堡去办").length - 1).toBe(1);
    expect(screen.getByTestId("lever-track").textContent?.split("亲自去办").length).toBe(2);
  });

  it("只读时：做不了的杠杆在 v2 下也不写“做不了的原因”（写了像是补上条件就能做）；v1 照旧写那行灰字", async () => {
    installIpc({ timeline: () => ({ ...tl, history_on: false }) });
    const { unmount } = render(<HistoryPanel />);
    const talk = await screen.findByTestId("lever-talk");
    expect(talk).not.toHaveTextContent("要会说朝鲜话的通事");
    expect(within(screen.getByTestId("event-sarhu")).queryByTestId("inline-error")).not.toBeInTheDocument();
    unmount();
    setUiFor("v1");
    installIpc({ timeline: () => ({ ...tl, history_on: false }) });
    render(<HistoryPanel />);
    expect(await screen.findByTestId("lever-talk")).toHaveTextContent("要会说朝鲜话的通事");
  });

  it("秘术：冷却中的法术只在卡底写一次冷却，卡头不再写“冷却 n 天”；做不了又在冷却的，卡头照旧写；v1 照旧", async () => {
    const user = userEvent.setup();
    const arc: ArcanaView = {
      schools: [],
      spells: [
        { key: "veil", name: "雾", school: "daoist", rank: 2, desc: "", cost: "", cooldown_left: 12, targets: ["fleet"], enabled: true, source: null },
        { key: "seal", name: "封门", school: "daoist", rank: 3, desc: "", cost: "", cooldown_left: 5, targets: ["fleet"], enabled: false, blocked_reason: "要先学会第三级", source: null },
      ],
    };
    installIpc({ arcana: () => arc });
    const { unmount } = render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const veil = await screen.findByTestId("spell-veil");
    expect(veil).toHaveTextContent("还在冷却：12 天后能再用。");
    expect(veil).not.toHaveTextContent("冷却 12 天");
    const seal = screen.getByTestId("spell-seal");
    expect(seal).toHaveTextContent("冷却 5 天");
    expect(seal).toHaveTextContent("要先学会第三级");
    unmount();
    setUiFor("v1");
    installIpc({ arcana: () => arc });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    expect(await screen.findByTestId("spell-veil")).toHaveTextContent("冷却 12 天");
  });

  it("样式：秘境的“听说过”与结社的“听说过”、传说之船的“传闻”同一条虚线框规则；战役链的变量卡不画顶上的色线", () => {
    const css = readText(HISTORY_CSS);
    const rumor = ruleWith(css, ".sc-card--rumor");
    expect(rumor).toHaveLength(1);
    const sels = rumor[0].sel.split(",").map((s) => s.trim());
    for (const k of [".sc-ship--rumor", ".sc-realm--heard", ".sc-realm--unknown"]) expect(sels.some((s) => s.endsWith(k))).toBe(true);
    expect(rumor[0].body).toMatch(/border-style:\s*dashed/);
    const vars = ruleWith(css, ".hs-var");
    expect(vars.length).toBeGreaterThan(0);
    for (const r of vars) {
      expect(r.body).not.toMatch(/border-top/);
      expect(r.body).not.toMatch(/--v2-seal/);
    }
    expect(ruleWith(css, ".hs-var--idea")).toHaveLength(0);
  });
});
