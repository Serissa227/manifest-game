// 第九批 I2（docs/UI-CONTRACT.md）：属性组、评价与岗位的前端。
// - 开局向导按组分配（每组自己的起点、范围、自由点数与开局上限），隐藏属性不显示也不分点；手机竖屏上组多时一组一页；
// - 船长卡按组画雷达图（组多时切换），列出评价读数（名字查 StaticView.captain.ratings）；
// - 航海士：世界追加的能力、世界岗位的任命菜单与 Assigned 命令、在任的岗位名与目标；
// - 日期：world_date 与 calendar.month_names；生日按世界日历的月长；
// - 经典世界（后端 A2 给出一个经典组与五个经典岗位）与旧后端（没有 groups / ratings / roles）画面不变、不崩。
// 世界数据照 data/worlds/testbed/captain.toml（十项属性、三组、两项评价、两个岗位），JSON 形状照 manifest-appcore 的 captain_view.rs。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TopBar from "../components/TopBar";
import MatesPanel from "../components/panels/MatesPanel";
import CaptainCard from "../components/start/CaptainCard";
import { AttributesStep, BirthdayStep, DraftSummary } from "../components/start/CaptainSteps";
import { useCaptainDraft } from "../components/start/useCaptainDraft";
import {
  attrGroups,
  backgroundAttrs,
  canInc,
  creationOf,
  fitAlloc,
  groupLeft,
  isClassicLayout,
  isGenius,
  newDraft,
  pointsLeft,
  ratingValues,
  rollAlloc,
} from "../components/start/wizard";
import { dateShortText, dateText, overviewDate, setWorld } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { CaptainDefsView, CaptainProfileView, MateView, Overview, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { captainDefs, captainStatics, installIpc, mate, mates, overview, startedGame, statics } from "./fixtures";
import { PHONE, mockViewport, resetViewport } from "./viewport";

// ───────────────────────────── 数据：testbed 世界的身世 ─────────────────────────────

/** testbed 世界（data/worlds/testbed/captain.toml）：资质 3 项（自由 3 点）、本领 5 项（自由 5 点）、品行 2 项（0–100，没有自由点数，虔敬隐藏）。 */
const testbedDefs: CaptainDefsView = {
  points: { ...captainDefs.points },
  groups: [
    { key: "aptitude", name: "资质", range: [1, 10], start: 1, free: 3, creation_cap: 7 },
    { key: "craft", name: "本领", range: [1, 10], start: 1, free: 5, creation_cap: 7 },
    { key: "conduct", name: "品行", range: [0, 100], start: 50, free: 0, creation_cap: 100 },
  ],
  attributes: [
    { key: "wit", name: "悟性", group: "aptitude", desc: "学得快。", hidden: false },
    { key: "endurance", name: "耐力", group: "aptitude", desc: "熬得住。", hidden: false },
    { key: "charm", name: "口才", group: "aptitude", desc: "说得动人。", hidden: false },
    { key: "navigation", name: "领航", group: "craft", desc: "认得路。", hidden: false },
    { key: "commerce", name: "交易", group: "craft", desc: "会做买卖。", hidden: false },
    { key: "tactics", name: "战术", group: "craft", desc: "会打仗。", hidden: false },
    { key: "stewardship", name: "管理", group: "craft", desc: "管得住人。", hidden: false },
    { key: "numeracy", name: "算学", group: "craft", desc: "算得清。", hidden: false },
    { key: "honor", name: "守约", group: "conduct", desc: "说话算话。", hidden: false },
    { key: "piety", name: "虔敬", group: "conduct", desc: "信仰。", hidden: true },
  ],
  ratings: [
    // 后端按 key 的顺序输出权重（BTreeMap）
    { key: "mariner", name: "航海评价", weights: [["navigation", 4], ["numeracy", 3], ["tactics", 3]] },
    { key: "society", name: "社交评价", weights: [["charm", 6], ["honor", 1]] },
  ],
  roles: [
    { key: "navigator", name: "领航员", ability: "navigation" },
    { key: "quartermaster", name: "军需官", ability: "management" },
  ],
  signs: [],
  questions: [
    {
      key: "school",
      title: "求学",
      prompt: "曾经怎样学习？",
      options: [
        { key: "library", name: "读书", text: "在书库里学习。", attrs: [["wit", 1], ["numeracy", 1]], effect: null },
        { key: "practice", name: "实习", text: "随船观察航道。", attrs: [["endurance", 1], ["navigation", 1]], effect: null },
      ],
    },
  ],
};
const testbedStatics: StaticView = { ...statics, captain: testbedDefs };
/** testbed 与寰宇的日历（公历的月长，没有闰日）。 */
const GREGORIAN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 后端 A2 给经典世界的形状：一个经典组（名字“属性”）、属性带 group 与 hidden、没有评价、五个经典岗位。 */
const classicA2: CaptainDefsView = {
  ...captainDefs,
  groups: [{ key: "classic", name: "属性", range: [0, 10], start: 1, free: 5, creation_cap: 7 }],
  attributes: captainDefs.attributes.map((a) => ({ ...a, group: "classic", hidden: false })),
  ratings: [],
  roles: [
    { key: "captain", name: "舰长", ability: "navigation" },
    { key: "accountant", name: "会计", ability: "management" },
    { key: "trader", name: "交易员", ability: "trade" },
    { key: "caravan_leader", name: "商队头领", ability: "navigation" },
    { key: "industry_manager", name: "产业管理人", ability: "management" },
  ],
};

/** 渲染属性一步、汇总与船长卡（同一份草稿）。 */
function Wizard({ defs }: { defs: CaptainDefsView }) {
  const api = useCaptainDraft(defs, 3);
  return (
    <div>
      <div data-testid="step">
        <AttributesStep api={api} />
      </div>
      <DraftSummary api={api} statics={null} startYear={1502} withEffects={false} />
      <CaptainCard
        defs={defs}
        data={{ name: "试航者", look: 2, birthday: { month: 1, day: 31, age: 18 }, answers: api.draft.answers, attrs: api.attrs, alloc: api.alloc, methods: [] }}
        testId="card"
      />
    </div>
  );
}

const step = () => screen.getByTestId("step");
const card = () => screen.getByTestId("card");

afterEach(() => {
  resetViewport();
  setWorld(null);
});

// ───────────────────────────── 分组分配的规则（与内核一致） ─────────────────────────────

describe("属性组：分配的规则与内核一致", () => {
  it("身世加点从各组的起点算起；每组只能用本组的自由点数；隐藏属性不分点", () => {
    const bg = backgroundAttrs(testbedDefs, ["library"], 1, 31);
    expect(bg).toEqual([2, 1, 1, 1, 1, 1, 1, 2, 50, 50]);
    const zero = bg.map(() => 0);
    expect(pointsLeft(testbedDefs, zero)).toBe(8);
    expect([0, 1, 2].map((g) => groupLeft(testbedDefs, zero, g))).toEqual([3, 5, 0]);
    // 资质组只有 3 点：悟性要 5 点只给 3；本领组领航最多到开局上限 7（底子 1，至多分 6），本组只有 5 点；品行组与隐藏属性分不到
    expect(fitAlloc(testbedDefs, bg, [5, 0, 0, 9, 0, 0, 0, 0, 3, 4])).toEqual([3, 0, 0, 5, 0, 0, 0, 0, 0, 0]);
    expect(canInc(testbedDefs, bg, zero, 0)).toBe(true);
    expect(canInc(testbedDefs, bg, zero, 8)).toBe(false); // 品行：没有自由点数
    expect(canInc(testbedDefs, bg, zero, 9)).toBe(false); // 虔敬：隐藏
    expect(canInc(testbedDefs, bg, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1)).toBe(false); // 资质已分完，本领还有
    expect(canInc(testbedDefs, bg, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3)).toBe(true);
    expect(isClassicLayout(testbedDefs)).toBe(false);
  });

  it("随机分配逐组投点；命令的 alloc 按世界属性表（含隐藏属性，十项），评价读数与后端测试的数值一致", () => {
    const bg = backgroundAttrs(testbedDefs, ["library"], 1, 31);
    for (let r = 0; r < 30; r++) {
      const a = rollAlloc(testbedDefs, bg, r);
      expect(a.slice(0, 3).reduce((x, y) => x + y, 0)).toBe(3);
      expect(a.slice(3, 8).reduce((x, y) => x + y, 0)).toBe(5);
      expect(a.slice(8)).toEqual([0, 0]);
      expect(rollAlloc(testbedDefs, bg, r)).toEqual(a);
    }
    const draft = { ...newDraft(testbedDefs, 1), month: 1, day: 31, age: 18, answers: ["library"], alloc: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0] };
    // 1 月 31 日：经典的航海历（每月 30 天）没有这一天，testbed 的公历有
    expect(creationOf(testbedDefs, draft, 1502)).toBeNull();
    setWorld({ currency: "金币", era: "公元", start_year: 1502, calendar: { months: GREGORIAN, seasons: [], month_names: [] } });
    const c = creationOf(testbedDefs, draft, 1502);
    expect(c).toEqual({ birthday: { year: 1484, month: 1, day: 31 }, answers: ["library"], alloc: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0], genius: null });
    // 与 crates/manifest-appcore/tests/attributes.rs 同一组输入：航海评价 23、社交评价 62
    const attrs = bg.map((v, i) => v + draft.alloc[i]);
    expect(ratingValues(testbedDefs, attrs)).toEqual([
      ["mariner", 23],
      ["society", 62],
    ]);
    // 算学按 key 找（第 8 项）：到 7 才是算学奇才
    expect(isGenius(testbedDefs, attrs)).toBe(false);
    expect(isGenius(testbedDefs, attrs.map((v, i) => (i === 7 ? 7 : v)))).toBe(true);
    // 点数没分完：没有命令
    expect(creationOf(testbedDefs, { ...draft, alloc: [1, 1, 0, 1, 1, 1, 1, 1, 0, 0] }, 1502)).toBeNull();
  });

  it("经典世界：后端 A2 给出的一个经典组与旧后端（没有 groups）算出同样的组", () => {
    expect(isClassicLayout(captainDefs)).toBe(true);
    expect(isClassicLayout(classicA2)).toBe(true);
    const [a] = attrGroups(captainDefs);
    const [b] = attrGroups(classicA2);
    expect({ ...a, name: "" }).toEqual({ ...b, name: "" });
  });
});

// ───────────────────────────── 开局向导 ─────────────────────────────

describe("开局向导：按组分配", () => {
  it("每组一段：组名、规则与本组剩余点数；隐藏属性不显示；没有自由点数的组只读", async () => {
    const user = userEvent.setup();
    render(<Wizard defs={testbedDefs} />);
    const s = within(step());
    expect(s.getByText(/属性分成几组/)).toBeInTheDocument();
    expect(s.getByTestId("cw-points-left")).toHaveTextContent("尚余 8 点");
    expect(s.getByRole("region", { name: "资质" })).toBeInTheDocument();
    expect(s.getByRole("region", { name: "本领" })).toBeInTheDocument();
    const conduct = s.getByRole("region", { name: "品行" });
    expect(within(conduct).getByText("这一组没有自由点数，由身世决定")).toBeInTheDocument();
    expect(within(conduct).getByText("守约")).toBeInTheDocument();
    expect(within(conduct).queryByRole("button", { name: /守约/ })).toBeNull();
    // 隐藏属性：向导、汇总与船长卡都不出现
    expect(screen.queryByText("虔敬")).toBeNull();
    expect(screen.queryByText(/虔敬/)).toBeNull();
    expect(s.getByTestId("cw-group-left-aptitude")).toHaveTextContent("本组尚余 3 点");
    expect(s.getByTestId("cw-group-left-craft")).toHaveTextContent("本组尚余 5 点");
    expect(s.getByText("自由 3 点 · 开局单项至多 7（取值 1–10）")).toBeInTheDocument();

    // 资质组的 3 点分完：资质组的“加一点”都不能再点，本领组照常
    for (let i = 0; i < 3; i++) await user.click(s.getByRole("button", { name: "悟性 加一点" }));
    expect(s.getByTestId("cw-group-left-aptitude")).toHaveTextContent("本组已分完");
    expect(s.getByRole("button", { name: "耐力 加一点" })).toBeDisabled();
    expect(s.getByRole("button", { name: "领航 加一点" })).toBeEnabled();
    expect(s.getByTestId("cw-points-left")).toHaveTextContent("尚余 5 点");
    expect(s.getByLabelText("悟性 4（身世与星座 1，自由分配 3）")).toBeInTheDocument();
    for (let i = 0; i < 5; i++) await user.click(s.getByRole("button", { name: "领航 加一点" }));
    expect(s.getByTestId("cw-points-left")).toHaveTextContent("尚余 0 点");
    expect(s.getByRole("button", { name: "算学 加一点" })).toBeDisabled();
    // 汇总按组写
    expect(screen.getByTestId("cw-summary")).toHaveTextContent("资质：悟性 4、耐力 1、口才 1");
    expect(screen.getByTestId("cw-summary")).toHaveTextContent("品行：守约 50");
  });

  it("组的标题可以折叠与展开", async () => {
    const user = userEvent.setup();
    render(<Wizard defs={testbedDefs} />);
    const s = within(step());
    const head = s.getByRole("button", { name: /^▾?\s*资质/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(s.queryByRole("button", { name: "悟性 加一点" })).toBeNull();
    expect(s.getByRole("button", { name: "领航 加一点" })).toBeInTheDocument();
    await user.click(head);
    expect(s.getByRole("button", { name: "悟性 加一点" })).toBeInTheDocument();
  });

  it("手机竖屏：组多时一组一页，上面一排组名切换（带本组剩余点数）", async () => {
    mockViewport(PHONE);
    const user = userEvent.setup();
    render(<Wizard defs={testbedDefs} />);
    const s = within(step());
    const tabs = s.getByRole("tablist", { name: "属性组" });
    expect(within(tabs).getAllByRole("tab").map((x) => x.textContent)).toEqual(["资质3", "本领5", "品行"]);
    expect(s.getAllByRole("tabpanel")).toHaveLength(1);
    expect(s.getByRole("button", { name: "悟性 加一点" })).toBeInTheDocument();
    expect(s.queryByRole("button", { name: "领航 加一点" })).toBeNull();
    await user.click(within(tabs).getByRole("tab", { name: /本领/ }));
    expect(within(tabs).getByRole("tab", { name: /本领/ })).toHaveAttribute("aria-selected", "true");
    expect(s.getByRole("button", { name: "领航 加一点" })).toBeInTheDocument();
    expect(s.queryByRole("button", { name: "悟性 加一点" })).toBeNull();
  });

  it("经典世界：后端 A2 的形状（经典组、五个经典岗位）与旧后端画出的向导、汇总与船长卡逐 DOM 相同", () => {
    const { container: a, unmount } = render(<Wizard defs={captainDefs} />);
    const before = a.innerHTML;
    unmount();
    const { container: b } = render(<Wizard defs={classicA2} />);
    expect(b.innerHTML).toBe(before);
    // 经典版面：没有组名、没有雷达图与评价
    expect(screen.queryByRole("region", { name: "属性" })).toBeNull();
    expect(screen.queryByRole("img", { name: /属性/ })).toBeNull();
    expect(screen.queryByTestId("cw-card-ratings")).toBeNull();
  });

  it("生日按世界日历：公历的二月只有 28 天，换到二月时 31 日夹成 28 日", async () => {
    setWorld({ currency: "金币", era: "公元", start_year: 1502, calendar: { months: GREGORIAN, seasons: [], month_names: [] } });
    const user = userEvent.setup();
    function Birthday() {
      const api = useCaptainDraft(testbedDefs, 3);
      return <BirthdayStep api={api} startYear={1502} era="公元" />;
    }
    render(<Birthday />);
    await user.selectOptions(screen.getByLabelText("月"), "1");
    expect(screen.getByLabelText("日").querySelectorAll("option")).toHaveLength(31);
    await user.selectOptions(screen.getByLabelText("日"), "31");
    await user.selectOptions(screen.getByLabelText("月"), "2");
    expect(screen.getByLabelText("日").querySelectorAll("option")).toHaveLength(28);
    expect(screen.getByLabelText("日")).toHaveValue("28");
  });
});

// ───────────────────────────── 船长卡 ─────────────────────────────

describe("船长卡：按组的雷达图与评价读数", () => {
  it("开局向导的船长卡：一组一张，组名切换；不足三项的组画横条；评价按权重预览", async () => {
    const user = userEvent.setup();
    render(<Wizard defs={testbedDefs} />);
    const c = within(card());
    expect(c.getByRole("img", { name: "资质：悟性 1、耐力 1、口才 1" })).toBeInTheDocument();
    await user.click(within(step()).getByRole("button", { name: "悟性 加一点" }));
    expect(c.getByRole("img", { name: "资质：悟性 2、耐力 1、口才 1" })).toBeInTheDocument();
    const tabs = c.getByRole("tablist", { name: "属性组" });
    await user.click(within(tabs).getByRole("tab", { name: "本领" }));
    expect(c.getByRole("img", { name: "本领：领航 1、交易 1、战术 1、管理 1、算学 1" })).toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: "品行" }));
    expect(c.getByLabelText("守约 50")).toBeInTheDocument();
    expect(c.queryByText(/虔敬/)).toBeNull();
    // 评价：航海评价 = 领航×4 + 算学×3 + 战术×3；社交评价 = 口才×6 + 守约
    const ratings = c.getByTestId("cw-card-ratings");
    expect(within(ratings).getByLabelText("航海评价 10")).toBeInTheDocument();
    expect(within(ratings).getByLabelText("社交评价 56")).toBeInTheDocument();
  });

  it("游戏里的船长卡：属性按 key 对上，评价读数用档案给的 profile.ratings", async () => {
    const user = userEvent.setup();
    installIpc({ static_data: () => testbedStatics });
    startedGame();
    const profile: CaptainProfileView = {
      birthday: { year: 1484, month: 1, day: 31 },
      sign: "",
      sign_name: "",
      answers: ["library"],
      attrs: [
        ["wit", 3],
        ["endurance", 2],
        ["charm", 2],
        ["navigation", 2],
        ["commerce", 2],
        ["tactics", 2],
        ["stewardship", 2],
        ["numeracy", 3],
        ["honor", 50],
        ["piety", 50],
      ],
      ratings: [
        ["mariner", 23],
        ["society", 62],
      ],
      methods: [],
      created: 0,
    };
    useGame.setState({ statics: testbedStatics, overview: { ...overview, captain: { name: "试航者", portrait: 3 }, profile } });
    render(<TopBar />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = within(screen.getByTestId("hud-profile"));
    expect(pop.getByRole("img", { name: "资质：悟性 3、耐力 2、口才 2" })).toBeInTheDocument();
    expect(pop.getByLabelText("航海评价 23")).toBeInTheDocument();
    expect(pop.getByLabelText("社交评价 62")).toBeInTheDocument();
    expect(pop.queryByText(/虔敬/)).toBeNull();
  });

  it("旧后端：档案没有 ratings、身世没有 groups / ratings，船长卡照旧（六项属性条，没有评价）", async () => {
    const user = userEvent.setup();
    installIpc({ static_data: () => captainStatics });
    startedGame();
    const old: CaptainProfileView = {
      birthday: { year: 1480, month: 2, day: 12 },
      sign: "aquarius",
      sign_name: "水瓶座",
      answers: ["lighthouse_scribes", "university", "new_world"],
      attrs: [
        ["seamanship", 3],
        ["commerce", 1],
        ["arms", 1],
        ["stewardship", 1],
        ["numeracy", 7],
        ["eloquence", 1],
      ],
      methods: [],
      created: 0,
    };
    useGame.setState({ statics: captainStatics, overview: { ...overview, captain: { name: "林远舟", portrait: 3 }, profile: old } });
    render(<TopBar />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = within(screen.getByTestId("hud-profile"));
    expect(pop.getByLabelText("算学 7")).toBeInTheDocument();
    expect(pop.queryByRole("img", { name: /算学/ })).toBeNull();
    expect(pop.queryByTestId("cw-card-ratings")).toBeNull();
  });
});

// ───────────────────────────── 航海士 ─────────────────────────────

describe("航海士：世界的能力与岗位", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    startedGame();
  });

  function withMates(hired: MateView[], s: StaticView = testbedStatics) {
    calls = installIpc({ mates: () => ({ hired, available: [] }) });
    useGame.setState({ statics: s });
  }

  it("任命菜单列出世界的岗位 × 目标；提交 Assigned（舰队、商会）；在任显示岗位名与目标", async () => {
    const user = userEvent.setup();
    withMates([{ ...mate, id: 0, name: "林海燕", hired: true, role: { kind: "none", target: null } }]);
    render(<MatesPanel />);
    const c = await screen.findByTestId("mate-0");
    expect(screen.getByText("各岗位看航海士的一项能力：领航员看航海、军需官看管理")).toBeInTheDocument();
    const select = within(c).getByLabelText("任命");
    // 后端还没给出岗位的作用对象：四种对象都列（这里只有舰队 #0 与商会）；经典的五种任职不再列出
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "待命",
      "领航员（舰队 #0）",
      "领航员（商会）",
      "军需官（舰队 #0）",
      "军需官（商会）",
    ]);
    await user.selectOptions(select, "领航员（舰队 #0）");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { AssignMate: { owner: "player", mate: 0, role: { Assigned: { role: 0, target: { Fleet: 0 } } } } },
      }),
    );
    await user.selectOptions(within(screen.getByTestId("mate-0")).getByLabelText("任命"), "军需官（商会）");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { AssignMate: { owner: "player", mate: 0, role: { Assigned: { role: 1, target: "Owner" } } } },
      }),
    );
  });

  it("岗位带作用对象时只列这一种对象；在任的 assigned 视图写岗位名与目标，下拉框选中它", async () => {
    const scoped: StaticView = {
      ...testbedStatics,
      captain: { ...testbedDefs, roles: [{ ...testbedDefs.roles![0], scope: "fleet" }, { ...testbedDefs.roles![1], scope: "owner" }] },
    };
    withMates(
      [
        { ...mate, id: 0, name: "林海燕", hired: true, role: { kind: "assigned", role: 0, scope: "fleet", target: 0 } },
        { ...mate, id: 1, name: "周明远", hired: true, role: { kind: "assigned", role: 1, scope: "owner", target: null } },
      ],
      scoped,
    );
    render(<MatesPanel />);
    const a = await screen.findByTestId("mate-0");
    expect(within(a).getAllByText("领航员（舰队 #0）").length).toBeGreaterThan(0);
    const select = within(a).getByLabelText("任命") as HTMLSelectElement;
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["待命", "领航员（舰队 #0）", "军需官（商会）"]);
    expect(select.selectedOptions[0].textContent).toBe("领航员（舰队 #0）");
    const b = screen.getByTestId("mate-1");
    expect((within(b).getByLabelText("任命") as HTMLSelectElement).selectedOptions[0].textContent).toBe("军需官（商会）");
  });

  it("H01：岗位写了“在海上管什么”时收成一行可展开的说明，逐个列出；没写的岗位只列名字", async () => {
    const described: StaticView = {
      ...testbedStatics,
      captain: { ...testbedDefs, roles: [{ ...testbedDefs.roles![0], desc: "观星定位，远远认出港口。" }, testbedDefs.roles![1]] },
    };
    withMates([{ ...mate, id: 0, name: "林海燕", hired: true, role: { kind: "none", target: null } }], described);
    render(<MatesPanel />);
    const duties = await screen.findByTestId("role-duties");
    expect(within(duties).getByText("各岗位管什么")).toBeInTheDocument();
    expect([...duties.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "领航员（看航海）：观星定位，远远认出港口。",
      "军需官",
    ]);
    expect(screen.queryByText(/各岗位看航海士的一项能力/)).toBeNull();
  });

  it("详情里显示世界追加的能力（名字按能力表，缺省时按属性名或 key）", async () => {
    const named: StaticView = { ...testbedStatics, captain: { ...testbedDefs, abilities: [{ key: "astronomy", name: "观星" }] } };
    const m: MateView = {
      ...mate,
      id: 0,
      hired: true,
      role: { kind: "none", target: null },
      abilities: [
        ["navigation", 18],
        ["trade", 58],
        ["combat", 12],
        ["management", 66],
        ["astronomy", 83],
        ["charm", 40],
      ],
    };
    withMates([m], named);
    const { unmount } = render(<MatesPanel />);
    const c = await screen.findByTestId("mate-0");
    const astro = c.querySelector('[data-ability="astronomy"]') as HTMLElement;
    expect(astro).toHaveTextContent("观星");
    expect(astro).toHaveTextContent("83");
    // 同 key 的属性名
    expect(c.querySelector('[data-ability="charm"]')).toHaveTextContent("口才");
    // 经典四项不重复
    expect(c.querySelectorAll(".pn-ability")).toHaveLength(6);
    unmount();
    withMates([m]);
    render(<MatesPanel />);
    expect((await screen.findByTestId("mate-0")).querySelector('[data-ability="astronomy"]')).toHaveTextContent("astronomy");
  });

  it("经典世界：五个经典岗位时菜单与命令照旧（Captain / Trader）；旧后端的航海士没有 abilities 也不崩", async () => {
    const user = userEvent.setup();
    calls = installIpc();
    useGame.setState({ statics: { ...captainStatics, captain: classicA2 } });
    render(<MatesPanel />);
    const c = await screen.findByTestId("mate-0");
    expect(screen.getByText(/舰长：航速与海战/)).toBeInTheDocument();
    expect(c.querySelectorAll(".pn-ability")).toHaveLength(4);
    const select = within(c).getByLabelText("任命");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["待命", "舰长（舰队 #0）", "会计", "交易员"]);
    await user.selectOptions(select, "trader");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { AssignMate: { owner: "player", mate: 0, role: "Trader" } } }));
    expect(mates.hired[0].abilities).toBeUndefined();
  });

  it("旧后端没有岗位表、却收到 assigned 视图：写“岗位 #n”，不崩", async () => {
    withMates([{ ...mate, id: 0, hired: true, role: { kind: "assigned", role: 2, scope: "caravan", target: 4 } }], captainStatics);
    render(<MatesPanel />);
    const c = await screen.findByTestId("mate-0");
    expect(within(c).getAllByText("岗位 #2（商队 #4）").length).toBeGreaterThan(0);
  });
});

describe("英文界面", () => {
  afterEach(() => setLocale("zh-CN"));

  it("组的规则、剩余点数与评价的标题是英文（组名、属性名、岗位名由后端按语言给出）", () => {
    setLocale("en");
    render(<Wizard defs={testbedDefs} />);
    const s = within(step());
    expect(s.getByText("3 free · up to 7 at the start (range 1–10)")).toBeInTheDocument();
    expect(s.getByTestId("cw-group-left-craft")).toHaveTextContent("5 left in this group");
    expect(s.getByText("No free points here: set by your background")).toBeInTheDocument();
    expect(within(card()).getByRole("list", { name: "Ratings" })).toBeInTheDocument();
  });
});

// ───────────────────────────── 日期 ─────────────────────────────

describe("日期：world_date 与月份名", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("概览给了 world_date 时以它为准；没有时照旧", () => {
    const o = { ...overview, world_date: [1503, 2, 28] as [number, number, number] };
    expect(overviewDate(o)).toEqual({ year: overview.year, calendar_year: 1503, month: 2, date: 28 });
    expect(overviewDate(overview)).toBe(overview);
    useGame.setState({ overview: o as Overview });
    render(<TopBar />);
    expect(screen.getByTestId("date")).toHaveTextContent("1503年2月28日");
  });

  it("世界日历有月份名：日期写月份名（中文与短日期）；月份名不全时照旧写数字", () => {
    const names = ["雾月", "霜月", "雪月", "雨月", "芽月", "花月", "牧月", "获月", "热月", "果月", "葡月", "风月"];
    setWorld({ currency: "金币", era: "公元", start_year: 1502, calendar: { months: Array(12).fill(30), seasons: [], month_names: names } });
    expect(dateText({ year: 1, month: 3, date: 9 })).toBe("1502年雪月9日");
    expect(dateShortText(3, 9)).toBe("雪月9日");
    setWorld({ currency: "金币", era: "公元", start_year: 1502, calendar: { months: Array(12).fill(30), seasons: [], month_names: names.slice(0, 5) } });
    expect(dateText({ year: 1, month: 3, date: 9 })).toBe("1502年3月9日");
    expect(dateShortText(3, 9)).toBe("3月9日");
  });
});
