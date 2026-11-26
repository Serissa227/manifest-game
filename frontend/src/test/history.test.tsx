// 第九批的历史的天平与秘闻（docs/UI-CONTRACT.md I7、I8）：天平区间的位置、事件排序、杠杆份额、史实轨迹的折线；
// 时间线卡片（天平、杠杆、为什么难、揭晓后的对照）、出钱 / 送货 / 去做三种贡献、关掉历史事件时只读；战役链的变量与门槛；
// 结社的等级与入会、法术的施放与冷却、港口的信仰与思想与传播。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import HistoryPanel from "../components/history/HistoryPanel";
import SecretsPanel from "../components/history/SecretsPanel";
import { balanceSpan, driftPath, leverShare, sortEvents } from "../components/history/historyKit";
import type { ArcanaView, CampaignView, IdeasView, SocietiesView, TimelineEvent, TimelineView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

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
  campaign: "liaodong",
  levers: [
    { key: "arms", side: "ming", kind: "arms", label: "把火绳枪与火炮送到登州", where: "登州", goods: [{ good: 3, name: "火绳枪" }], progress: { points: 6, max: 12 }, yours: 3, risk: null, note: "没有练兵只算三分之一", action: "deliver", enabled: true },
    { key: "pay", side: "ming", kind: "money", label: "辽东的军饷", where: null, goods: [], progress: { points: 0, max: 10 }, yours: 0, risk: null, note: null, action: "money", enabled: true },
    { key: "talk", side: "ming", kind: "negotiate", label: "说服朝鲜中立", where: "汉城", goods: [], progress: { points: 0, max: 6 }, yours: 0, risk: "泄密 30%", note: null, action: "commit", enabled: false, blocked_reason: "要会说朝鲜话的通事" },
  ],
  why_hard: ["还缺两类杠杆", "对手会按你给的四成加码"],
});
const past = ev({ key: "rhodes", title: "罗得岛之围", status: "resolved", date: [1555, 1, 1], days_left: null, outcome: { key: "holds", text: "骑士团守住了", historical: false, history: "1522 年陷落" } });

describe("历史的天平的纯逻辑", () => {
  it("天平区间换成条上的位置：0 持平在中间，超出范围夹住", () => {
    expect(balanceSpan(0, 0)).toEqual({ from: 50, to: 50, mid: 50 });
    expect(balanceSpan(-60, 60)).toEqual({ from: 0, to: 100, mid: 50 });
    expect(balanceSpan(20, -10).from).toBeLessThan(balanceSpan(20, -10).to);
    expect(balanceSpan(-500, -400)).toEqual({ from: 0, to: 0, mid: 0 });
  });

  it("事件排序：进行中在前，揭晓过的在后；杠杆份额", () => {
    expect(sortEvents([past, ev({ key: "later", title: "后", status: "future", days_left: 300 }), sarhu]).map((e) => e.key)).toEqual(["sarhu", "later", "rhodes"]);
    expect(leverShare(sarhu.levers[0])).toEqual({ done: 0.5, yours: 0.25 });
  });

  it("史实轨迹的折线", () => {
    expect(driftPath([[1560, 50], [1570, 0]], 100, 50, 1560, 1570)).toBe("M0.0,25.0 L100.0,50.0");
  });
});

describe("历史与秘闻窗口", () => {
  beforeEach(() => {
    useGame.setState({ statics, overview, version: 1, error: null, message: null, selectedLoc: 0, selectedFleet: overview.fleets[0]?.id ?? null });
  });

  it("时间线：天平、杠杆、为什么难；出钱、送货、不能做的写原因；揭晓的写对照", async () => {
    const user = userEvent.setup();
    const tl: TimelineView = { events: [past, sarhu], deviation: 3, history_on: true };
    const calls = installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    const card = await screen.findByTestId("event-sarhu");
    expect(within(card).getByRole("meter", { name: "天平" })).toHaveAttribute("aria-valuetext", "大致（消息不新）");
    expect(card).toHaveTextContent("还缺两类杠杆");
    expect(card).toHaveTextContent("没有练兵只算三分之一");
    const pay = within(card).getByTestId("lever-pay");
    await user.clear(within(pay).getByLabelText("金额"));
    await user.type(within(pay).getByLabelText("金额"), "3000");
    await user.click(within(pay).getByRole("button", { name: "出 3,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Contribute: { owner: "player", event: "sarhu", lever: "pay", payload: { Money: { amount: 3000 } } } } }));
    const arms = within(card).getByTestId("lever-arms");
    await user.click(within(arms).getByRole("button", { name: "送货……" }));
    await user.clear(within(arms).getByLabelText("数量"));
    await user.type(within(arms).getByLabelText("数量"), "40");
    await user.click(within(arms).getByLabelText("捐（不收钱，点数全额）"));
    await user.click(within(arms).getByRole("button", { name: "交货" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { Contribute: { owner: "player", event: "sarhu", lever: "arms", payload: { Deliver: { fleet: overview.fleets[0].id, goods: [[3, 40]], donate: true } } } },
      }),
    );
    expect(within(card).getByTestId("lever-talk")).toHaveTextContent("要会说朝鲜话的通事");
    expect(within(within(card).getByTestId("lever-talk")).queryByRole("button", { name: "去做" })).not.toBeInTheDocument();
    expect(screen.getByTestId("event-rhodes")).toHaveTextContent("本世界线： 骑士团守住了");
    expect(screen.getByText("世界线偏离 3")).toBeInTheDocument();
  });

  it("关掉历史事件时只读：杠杆没有按钮", async () => {
    installIpc({ timeline: () => ({ events: [sarhu], deviation: 0, history_on: false }) });
    render(<HistoryPanel />);
    const card = await screen.findByTestId("event-sarhu");
    expect(screen.getByText(/开局时关掉了历史事件/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /出 / })).not.toBeInTheDocument();
  });

  it("战役链：变量区间、史实轨迹、门槛、走向", async () => {
    const user = userEvent.setup();
    const c: CampaignView = {
      key: "liaodong",
      name: "辽东之战",
      summary: "明清之战提前约 55 年。",
      inertia: 25,
      vars: [{ key: "ming_catholic", name: "明·天主", kind: "idea", court: "明廷", value: { lo: 12, hi: 20, known: "rough" }, baseline: 2, drift: [[1561, 0], [1589, 2]], cap: 40, gates: [{ event: "eclipse", name: "日食的比试", passed: null }] }],
      events: [{ key: "sarhu", title: "萨尔浒", date: [1561, 4, 1], status: "active", outcome: null }],
      outlook: "明守住辽东 × 史实的走向",
    };
    installIpc({ timeline: () => ({ events: [sarhu], deviation: 0, history_on: true }), campaign: () => c });
    render(<HistoryPanel />);
    await screen.findByTestId("event-sarhu");
    await user.click(screen.getByRole("tab", { name: "战役链" }));
    const v = await screen.findByTestId("var-ming_catholic");
    expect(v).toHaveTextContent("现在约 12–20（史实轨迹 2）");
    expect(v).toHaveTextContent("门没过：最多到 40");
    expect(v).toHaveTextContent("○ 日食的比试");
    expect(screen.getByText("照现在的样子：明守住辽东 × 史实的走向")).toBeInTheDocument();
  });

  it("秘闻：结社的等级与入会；法术冷却时不能施放；港口的信仰与传播", async () => {
    const user = userEvent.setup();
    const soc: SocietiesView = {
      societies: [
        { key: "hermetic", name: "赫尔墨斯的圈子", secrecy: 4, known: "met", rank: 1, rank_name: "求知者", ranks: [{ n: 1, name: "求知者", requirement: "读过《翠玉录》的注本", reward: "暗室", done: true }, { n: 2, name: "炉边人", requirement: "第二级试炼", reward: "炼成", done: false }], trial: { track: "hermes_2", text: "去帕多瓦找卡尔达诺的信" }, allies: [], enemies: ["宗教裁判所"], seat: "威尼斯", basis: "historical", sources: ["迪伊与卡尔达诺的书信"], active: "16 世纪", can_join: false, blocked_reason: "已经是成员" },
      ],
      suspicion: [{ faction: 0, name: "西班牙", value: 30, level: "留意" }],
    };
    const arc: ArcanaView = {
      schools: [{ key: "daoist", name: "符箓与斋醮", level: 1, basis: "historical", sources: [] }],
      spells: [
        { key: "fair_wind", name: "顺风之符", school: "daoist", rank: 1, desc: "舰队航速 +10%，五天", cost: "符纸 ×1", cooldown_left: 0, targets: ["fleet"], enabled: true, source: "《道法会元》" },
        { key: "veil", name: "雾", school: "daoist", rank: 2, desc: "", cost: "", cooldown_left: 12, targets: ["fleet"], enabled: true, source: null },
      ],
    };
    const ideas: IdeasView = { loc: 0, name: "长崎", shares: [{ idea: "catholic", name: "天主教", share: 22, delta_year: 3 }], modes: [{ mode: "print", idea: "catholic", label: "印《日葡辞书》", needs: ["书 ×20"], points: 2, cap: 10, enabled: true }], hostility: null };
    const calls = installIpc({ societies: () => soc, arcana: () => arc, ideas: () => ideas });
    render(<SecretsPanel />);
    const h = await screen.findByTestId("society-hermetic");
    expect(h).toHaveTextContent("试炼：去帕多瓦找卡尔达诺的信");
    expect(h).toHaveTextContent("敌对：宗教裁判所");
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const fair = await screen.findByTestId("spell-fair_wind");
    await user.click(within(fair).getByRole("button", { name: "施放" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { CastSpell: { owner: "player", spell: "fair_wind", target: { Fleet: overview.fleets[0].id } } } }));
    expect(within(screen.getByTestId("spell-veil")).getByRole("button", { name: "施放" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "信仰与思想" }));
    expect(await screen.findByText("长崎的信仰与思想")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "印书与译书" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Propagate: { owner: "player", idea: "catholic", loc: 0, mode: "print" } } }));
  });

  it("秘闻：占卜的对象是一件事——从时间线上进行中与将来的事里选（揭晓过的不列），提交 { Event: key }", async () => {
    const user = userEvent.setup();
    const later = ev({ key: "eclipse", title: "日食的比试", status: "future", days_left: 200 });
    const arc: ArcanaView = {
      schools: [],
      spells: [{ key: "divine", name: "观星", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["event"], enabled: true, source: null }],
    };
    const calls = installIpc({ arcana: () => arc, timeline: () => ({ events: [past, later, sarhu], deviation: 0, history_on: true }) });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const card = await screen.findByTestId("spell-divine");
    const pick = await within(card).findByLabelText("占卜哪件事");
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["萨尔浒", "日食的比试"]);
    // 缺省是进行中、期限最近的那件
    const cast = within(card).getByRole("button", { name: "施放" });
    await user.click(cast);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { CastSpell: { owner: "player", spell: "divine", target: { Event: "sarhu" } } } }));
    await user.selectOptions(pick, "eclipse");
    await waitFor(() => expect(cast).toBeEnabled());
    await user.click(cast);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { CastSpell: { owner: "player", spell: "divine", target: { Event: "eclipse" } } } }));
  });

  it("秘闻：时间线上没有可以占卜的事（只有揭晓过的）时不能施放，写明原因", async () => {
    const user = userEvent.setup();
    const arc: ArcanaView = {
      schools: [],
      spells: [{ key: "divine", name: "观星", school: "daoist", rank: 1, desc: "", cost: "", cooldown_left: 0, targets: ["event"], enabled: true, source: null }],
    };
    const calls = installIpc({ arcana: () => arc, timeline: () => ({ events: [past], deviation: 0, history_on: true }) });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘术" }));
    const card = await screen.findByTestId("spell-divine");
    // 时间线取回来以后（只有揭晓过的那件）照样没有可选的
    await waitFor(() => expect(calls.mock.calls.some(([c]) => c === "timeline")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(card).toHaveTextContent("眼下还不知道有什么事可以占卜");
    expect(within(card).queryByLabelText("占卜哪件事")).toBeNull();
    expect(within(card).getByRole("button", { name: "施放" })).toBeDisabled();
  });
});
