// 养成主画面的“城中各处”（UbTown.tsx / townKit.ts）：背景挑这一阶段所在城市的 CG（城市的养成场景插画 → 城市的港口 CG → 同文化的图 → 渐变底），
// 按游戏日期的月份挑季节版（热带按雨季 / 旱季；港口 CG 白天优先、雪景只在冬天）；地点按 x、y 摆成能点的图标，
// 点一个地点等同于在原来的“去哪里”下拉框里选它（空格先放进“去走走”的活动），之后照旧补选同伴、提交 PlanMonth；
// 没开放的地点、这个月排不了“去走走”时图标是灰的（aria-disabled），写明原因，点了不改日程。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ICON_NAMES } from "../art/icons";
import { loreVariants } from "../art/lore";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { SCENE_FILES } from "../components/upbringing/sceneAssets";
import {
  CITY_SCENES,
  CULTURE_ART,
  PLACE_ICONS,
  chosenSlots,
  goPlace,
  labelSides,
  outings,
  placeIcon,
  portVariant,
  spotPos,
  townArt,
  townArtOf,
  townCell,
} from "../components/upbringing/townKit";
import { draftOf, refine, assign } from "../components/upbringing/ubKit";
import type { ActivityView, PlaceView, StaticView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const act = (o: Partial<ActivityView> & Pick<ActivityView, "key" | "name" | "kind">): ActivityView => ({
  desc: "",
  scene: "dock",
  cost: 0,
  income: [0, 0],
  fatigue: 2,
  mood: 0,
  gains: [],
  skills: [],
  mentor: null,
  companions: [],
  tier: null,
  risk: 0,
  needs: [],
  enabled: true,
  tags: [],
  new: false,
  ...o,
});

const place = (o: Partial<PlaceView> & Pick<PlaceView, "key" | "name" | "kind">): PlaceView => ({ x: 50, y: 50, open: true, people: [], hint: null, ...o });

function view(stage: "home" | "academy" = "home", month = 5): UpbringingView {
  return {
    stage,
    stage_name: stage === "home" ? "家乡 · 下田" : "学院 · 第一年",
    home: "下田（土佐）",
    culture: "japanese",
    town: stage === "home" ? { key: "shimoda_tosa", name: "下田（土佐）", culture: "japanese" } : { key: "kyoto", name: "京都", culture: "japanese" },
    academy: stage === "academy" ? { key: "kyoto_court", name: "京都宫中女房见习", city: "kyoto" } : null,
    today: [1553, month, 1],
    phase: "plan",
    protagonist: { key: "mio", name: "一条澪", age: 12, birthday: [6, 21], portrait: null, outfit: null, season: 0 },
    meters: {
      stamina: { value: 70, max: 100, label: "精神" },
      fatigue: { value: 10, max: 100, label: "还好" },
      mood: { value: 60, max: 100, label: "雀跃" },
      fame: { value: 10, max: 100, label: "无名" },
    },
    cash: 120,
    growth: [{ attr: "seamanship", value: 400, projected: 4 }],
    ratings: [],
    skills: [],
    plan: {
      month: [1553, month],
      editable: true,
      slots: [0, 1, 2].map((i) => ({
        index: i,
        label: ["上旬", "中旬", "下旬"][i],
        from: [1553, month, i * 10 + 1] as [number, number, number],
        to: [1553, month, i * 10 + 10] as [number, number, number],
        lesson: null,
        after: null,
        status: "empty" as const,
      })),
    },
    lessons: stage === "academy" ? [act({ key: "latin", name: "拉丁文", kind: "lesson" })] : [],
    activities: [
      act({ key: "dock", name: "码头搬运", kind: "job", fatigue: 10 }),
      act({ key: "walk", name: "家乡探访", kind: "free", needs: ["place", "companion"] }),
      act({ key: "rest", name: "休息", kind: "rest", fatigue: -20 }),
    ],
    places: [
      place({ key: "market", name: "市集", kind: "market", x: 15, y: 65, people: [{ key: "ase", name: "阿濑", portrait: null }] }),
      place({ key: "dock", name: "码头", kind: "dock", x: 45, y: 65 }),
      place({ key: "shrine", name: "祭所", kind: "shrine", x: 12, y: 43, open: false, hint: "要等祭礼那天才开门" }),
    ],
    excursions: [],
    companions: [
      { key: "ase", name: "阿濑", portrait: null, role: "family", bond: "B", affinity: 60, heart: null, heart_stage: null, romance_open: false, relation: [], call_name: "姬样", birthday: [2, 3], days_to_birthday: 40, likes_known: [], dislikes_known: [], where_now: null, next_hint: null },
    ],
    calendar: [],
    exams: [],
    path: { choose_on: null, chosen: null, options: [] },
    memories: [],
    letters: [],
    diary: [],
    presets: [],
    last: [],
  };
}

describe("城中各处：背景图", () => {
  it("清单都对得上：城市与文化用到的图都在场景插画或港口 CG 的清单里，地点图标都在图标表里", () => {
    for (const v of Object.values(CITY_SCENES)) expect(SCENE_FILES, v).toContain(v);
    for (const v of Object.values(CULTURE_ART)) expect(SCENE_FILES.includes(v) || (v.startsWith("port_") && loreVariants(v).length > 0), v).toBe(true);
    for (const v of Object.values(PLACE_ICONS)) expect(ICON_NAMES).toContain(v);
    expect(placeIcon("market")).toBe("market");
    expect(placeIcon("home")).toBe("cb_housing");
    // 没登记的种类、原型链上的名字都用望远镜
    expect(placeIcon("observatory")).toBe("discovery");
    expect(placeIcon("toString")).toBe("discovery");
  });

  it("城市有自己的养成场景插画：按月份挑四季版（3–5 春、6–8 夏、9–11 秋、12–2 冬；最早一版是夏）", () => {
    const at = (m: number) => townArt("shimoda_tosa", ["japanese"], m);
    expect(at(1)).toEqual({ src: "scenes/dock_jp--winter.webp", file: "dock_jp--winter", from: "city" });
    expect(at(4)?.file).toBe("dock_jp--spring");
    expect(at(7)?.file).toBe("dock_jp");
    expect(at(10)?.file).toBe("dock_jp--autumn");
    // 学院所在的城市用学院一带的图（京都：公家庭院，最早一版是春）
    expect(townArt("kyoto", ["japanese"], 4)?.file).toBe("kemari_jp");
    expect(townArt("kyoto", ["japanese"], 12)?.file).toBe("kemari_jp--winter");
  });

  it("热带的城市按雨季 / 旱季挑；只有一版的图四季都用它", () => {
    expect(townArt("kilwa", ["swahili"], 2)?.file).toBe("quay_kilwa--wet");
    expect(townArt("kilwa", ["swahili"], 8)?.file).toBe("quay_kilwa");
    expect(townArt("cairo", ["ottoman"], 1)?.file).toBe("azhar_cairo");
    expect(townArt("cairo", ["ottoman"], 7)?.file).toBe("azhar_cairo");
  });

  it("没有养成插画的城市用它的港口 CG：白天优先（晨昏次之），雪景只在冬天用；不是冬天又只有雪景时回退到同文化的图", () => {
    expect(townArt("lisbon", ["mediterranean"], 5)).toEqual({ src: "scenes/port_lisbon--day-clear.webp", file: "port_lisbon--day-clear", from: "city" });
    // 威尼斯只有黎明雨景与夜景：挑黎明
    expect(townArt("venice", ["mediterranean"], 5)?.file).toBe("port_venice--dawn-rain");
    // 吕贝克只画了雪景：冬天用它，夏天回退到同文化（北方汉萨）的汉堡
    expect(townArt("lubeck", ["nordic"], 1)).toEqual({ src: "scenes/port_lubeck--day-snow.webp", file: "port_lubeck--day-snow", from: "city" });
    expect(townArt("lubeck", ["nordic"], 7)).toEqual({ src: "scenes/port_hamburg--day-clear.webp", file: "port_hamburg--day-clear", from: "culture" });
    // 冬天有雪景的港口偏向雪景（安特卫普的雪景是夜里，白天优先，仍挑白天的雾景）
    expect(portVariant("port_antwerp", 1)).toBe("port_antwerp--day-fog");
    expect(portVariant("port_bergen", 1)).toBe("port_bergen--day-snow");
    expect(portVariant("port_bergen", 6)).toBe("port_bergen--night-clear");
    expect(portVariant("port_no_such_place", 6)).toBeNull();
  });

  it("城市没有图：按文化回退（先地图上的文化，再学院的文化），都没有时为 null（渐变底）", () => {
    expect(townArt("chincha", ["andean"], 3)).toEqual({ src: "scenes/port_callao--dawn-clear.webp", file: "port_callao--dawn-clear", from: "culture" });
    expect(townArt("some_village", ["ming"], 1)?.file).toBe("harbor_cn--winter");
    expect(townArt("some_village", ["atlantean", "iberian"], 4)).toEqual({ src: "scenes/harbor_eu--spring.webp", file: "harbor_eu--spring", from: "culture" });
    expect(townArt("some_village", ["atlantean"], 4)).toBeNull();
    expect(townArt(null, [undefined, null], 4)).toBeNull();
    // 旧后端没有 town：只按 culture 回退
    const old = { ...view(), town: undefined, culture: "japanese" };
    expect(townArtOf(old)?.file).toBe("dock_jp--spring");
    expect(townArtOf(old)?.from).toBe("culture");
  });
});

describe("城中各处：点地点改日程", () => {
  it("地点的位置往里收一圈（图标与地名不出画），坏数据落在正中", () => {
    expect(spotPos(0, 0)).toEqual({ left: 6, top: 9 });
    expect(spotPos(100, 100)).toEqual({ left: 94, top: 83 });
    expect(spotPos(-20, 140)).toEqual({ left: 6, top: 83 });
    expect(spotPos(Number.NaN, 50)).toEqual({ left: 50, top: 46 });
  });

  it("地名小签缺省在图标下面；下面会压到邻近的图标时换到上面，上下都挤时放到旁边（家乡十个地点的那一套坐标）", () => {
    const fam: [string, number, number][] = [
      ["家中", 15, 20],
      ["学堂", 45, 20],
      ["书房", 75, 20],
      ["市集", 15, 65],
      ["码头", 45, 65],
      ["作坊", 75, 65],
      ["屋顶", 85, 45],
      ["祭所", 12, 43],
      ["商馆", 42, 43],
      ["庭院", 64, 43],
    ];
    const sides = labelSides(fam.map(([name, x, y]) => ({ key: name, name, x, y })));
    // 上排的家中、学堂下面正对着中排的祭所、商馆：小签放上面；中排的祭所、商馆上下都有图标：放右边；其余照旧在下面
    expect(sides).toEqual({ 家中: "above", 学堂: "above", 书房: "below", 市集: "below", 码头: "below", 作坊: "below", 屋顶: "below", 祭所: "right", 商馆: "right", 庭院: "below" });
    // 靠右边、上下都挤的地点放左边
    expect(labelSides([
      { key: "a", name: "上", x: 90, y: 20 },
      { key: "b", name: "中间的地方", x: 90, y: 43 },
      { key: "c", name: "下", x: 90, y: 66 },
    ]).b).toBe("left");
  });

  it("“去走走”的活动：能排的在前，同样能排时只要地点的在前", () => {
    const v = view();
    v.activities = [
      act({ key: "blocked", name: "被挡住", kind: "free", needs: ["place"], enabled: false }),
      act({ key: "date", name: "约人", kind: "date", needs: ["place", "companion"] }),
      act({ key: "roam", name: "自由行动", kind: "free", needs: ["place"] }),
      act({ key: "dock", name: "码头搬运", kind: "job" }),
    ];
    expect(outings(v).map((a) => a.key)).toEqual(["roam", "date", "blocked"]);
  });

  it("空格：放进“去走走”的活动并选好地点；已经是要选地点的活动：只补地点、同伴不动；没开放的地点与没有能排的活动时不改", () => {
    const v = view();
    let d = draftOf(v.plan);
    const cell = { index: 1, part: "after" as const };
    d = goPlace(v, d, cell, "market")!;
    expect(d.after[1]).toEqual({ activity: "walk", place: "market" });
    d = refine(d, 1, { companion: "ase" });
    d = goPlace(v, d, cell, "dock")!;
    expect(d.after[1]).toEqual({ activity: "walk", place: "dock", companion: "ase" });
    expect(chosenSlots(v, d, "dock")).toEqual(["中旬"]);
    // 别的活动：换成“去走走”
    d = assign(d, { index: 0, part: "after" }, "dock");
    d = goPlace(v, d, { index: 0, part: "after" }, "market")!;
    expect(d.after[0]).toEqual({ activity: "walk", place: "market" });
    // 没开放、找不到的地点、课业格：不改
    expect(goPlace(v, d, cell, "shrine")).toBeNull();
    expect(goPlace(v, d, cell, "nowhere")).toBeNull();
    expect(goPlace(v, d, { index: 1, part: "lesson" }, "market")).toBeNull();
    // 这个月没有能排的“去走走”
    const none = { ...v, activities: v.activities.map((a) => (a.needs.includes("place") ? { ...a, enabled: false } : a)) };
    expect(goPlace(none, draftOf(v.plan), cell, "market")).toBeNull();
  });

  it("学院期选着课业格时，点地点排进同一旬的课后格；没选中时排进第一个课后格", () => {
    const v = view("academy");
    expect(townCell(v, { index: 2, part: "lesson" })).toEqual({ index: 2, part: "after" });
    expect(townCell(v, { index: 1, part: "after" })).toEqual({ index: 1, part: "after" });
    expect(townCell(v, undefined)).toEqual({ index: 0, part: "after" });
  });
});

describe("城中各处：养成主画面", () => {
  const s: StaticView = { ...statics };
  beforeEach(() => {
    useGame.setState({ statics: s, overview: { ...overview, speed: 0, mode: "upbringing" }, version: 1, error: null, message: null });
  });

  it("日程纸最上面是这座城的 CG（按游戏日期挑季节版，像素画）与地点图标；读屏名是地名", async () => {
    installIpc({ upbringing: () => view("home", 5) });
    render(<UpbringingScreen />);
    const town = await screen.findByRole("region", { name: "城中各处" });
    expect(town).toHaveAttribute("data-town", "shimoda_tosa");
    expect(town).toHaveAttribute("data-art-from", "city");
    expect(within(town).getByTestId("ub-town-img").getAttribute("src")).toMatch(/scenes\/dock_jp--spring\.webp$/);
    expect(within(town).getByText("下田（土佐）")).toHaveClass("ub-town-name");
    expect(within(town).getByText("点一处地方，去那里走走（排进上旬）")).toBeInTheDocument();
    const market = within(town).getByRole("button", { name: "市集" });
    expect(market).toHaveAttribute("data-kind", "market");
    expect(market.parentElement).toHaveAttribute("data-label", "below");
    // 位置：数据的 (15, 65) 往里收一圈
    expect(market.parentElement?.style.getPropertyValue("--x")).toBe("19.2%");
    expect(market.parentElement?.style.getPropertyValue("--y")).toBe("57.1%");
    // 有人在：图标上一枚人数签，读屏描述写是谁
    expect(market).toHaveAccessibleDescription("阿濑在这里");
    expect(within(market).getByText("1")).toHaveClass("ub-spot-people");
    // 日程纸本身照旧（教程指着的几块都在）
    expect(document.querySelector(".ub-planner .ub-grid")).not.toBeNull();
    expect(document.querySelector(".ub-planner .ub-acts")).not.toBeNull();
  });

  it("学院期用学院所在城市的图；城市与文化都没有图时是按季节着色的渐变底", async () => {
    const academy = view("academy", 12);
    installIpc({ upbringing: () => academy });
    const { unmount } = render(<UpbringingScreen />);
    const town = await screen.findByRole("region", { name: "城中各处" });
    expect(within(town).getByTestId("ub-town-img").getAttribute("src")).toMatch(/scenes\/kemari_jp--winter\.webp$/);
    expect(within(town).getByText("点一处地方，去那里走走（排进上旬的课后）")).toBeInTheDocument();
    unmount();

    installIpc({ upbringing: () => ({ ...view(), town: { key: "atlantis", name: "沉城", culture: "atlantean" }, culture: "atlantean" }) });
    render(<UpbringingScreen />);
    const plain = await screen.findByRole("region", { name: "城中各处" });
    expect(plain).toHaveAttribute("data-art-from", "none");
    expect(within(plain).queryByTestId("ub-town-img")).toBeNull();
    expect(within(plain).getByTestId("ub-town-plain")).toBeInTheDocument();
    // 渐变底也照样摆地点
    expect(within(plain).getByRole("button", { name: "码头" })).toBeInTheDocument();
  });

  it("点一个地点：选中的那一旬放进“去走走”并选好地点（与在“去哪里”里选一样），接着补选同伴，提交 PlanMonth", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ upbringing: () => view(), submit: () => ({ outcome: "Done", overview: { ...overview, speed: 0, mode: "upbringing" } }) });
    render(<UpbringingScreen />);
    const town = await screen.findByRole("region", { name: "城中各处" });
    await user.click(within(screen.getByTestId("act-dock")).getByRole("button"));
    await user.click(within(screen.getByTestId("act-rest")).getByRole("button"));
    // 选中自动移到了下旬：点“市集”就排进下旬
    expect(within(town).getByText("点一处地方，去那里走走（排进下旬）")).toBeInTheDocument();
    await user.click(within(town).getByRole("button", { name: "市集" }));
    expect(screen.getByTestId("cell-2:after")).toHaveTextContent("家乡探访");
    expect(screen.getByLabelText("去哪里")).toHaveValue("market");
    // 排过的地点：黄铜底，上面写着哪一旬
    const market = within(town).getByRole("button", { name: "市集" });
    expect(market).toHaveClass("is-chosen");
    expect(within(market).getByText("下旬")).toHaveClass("ub-spot-when");
    // 换个地点：同一格只改地点
    await user.click(within(town).getByRole("button", { name: "码头" }));
    expect(screen.getByLabelText("去哪里")).toHaveValue("dock");
    expect(market).not.toHaveClass("is-chosen");
    await user.selectOptions(screen.getByLabelText("和谁"), "ase");
    const go = screen.getByRole("button", { name: "开始这个月" });
    expect(go).toBeEnabled();
    await user.click(go);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlanMonth: {
            owner: "player",
            slots: [
              { index: 0, after: { activity: "dock" } },
              { index: 1, after: { activity: "rest" } },
              { index: 2, after: { activity: "walk", place: "dock", companion: "ase" } },
            ],
          },
        },
      }),
    );
  });

  it("键盘也能点：停在地点上按回车，排进选中的那一格", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    render(<UpbringingScreen />);
    const town = await screen.findByRole("region", { name: "城中各处" });
    within(town).getByRole("button", { name: "码头" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("cell-0:after")).toHaveTextContent("家乡探访");
    expect(screen.getByLabelText("去哪里")).toHaveValue("dock");
  });

  it("没开放的地点是灰的、写明原因，点了不改日程；这个月排不了“去走走”时整片灰掉，上方写原因", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    const { unmount } = render(<UpbringingScreen />);
    let town = await screen.findByRole("region", { name: "城中各处" });
    const shrine = within(town).getByRole("button", { name: "祭所" });
    expect(shrine).toHaveAttribute("aria-disabled", "true");
    expect(shrine).toHaveClass("is-off");
    expect(shrine).toHaveAccessibleDescription("要等祭礼那天才开门");
    expect(shrine).toHaveAttribute("title", expect.stringContaining("要等祭礼那天才开门"));
    await user.click(shrine);
    expect(screen.getByTestId("cell-0:after")).not.toHaveTextContent("家乡探访");
    expect(screen.queryByLabelText("去哪里")).toBeNull();
    // 开着的地点照常能点
    expect(within(town).getByRole("button", { name: "码头" })).not.toHaveAttribute("aria-disabled");
    unmount();

    const v = view();
    v.activities = v.activities.map((a) => (a.key === "walk" ? { ...a, enabled: false, blocked_reason: "这个月阿濑不在家" } : a));
    installIpc({ upbringing: () => v });
    render(<UpbringingScreen />);
    town = await screen.findByRole("region", { name: "城中各处" });
    expect(within(town).getByText("这个月阿濑不在家")).toHaveClass("is-blocked");
    for (const name of ["市集", "码头", "祭所"]) expect(within(town).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(town).getByRole("button", { name: "码头" }));
    expect(screen.queryByLabelText("去哪里")).toBeNull();
  });

  it("执行中不显示城中各处（中栏是这一旬的场景）；日程定了（结业）时地点灰掉", async () => {
    installIpc({ upbringing: () => ({ ...view(), phase: "running", plan: { ...view().plan, editable: false } }) });
    const { unmount } = render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "这个月进行中" });
    expect(screen.queryByRole("region", { name: "城中各处" })).toBeNull();
    unmount();

    installIpc({ upbringing: () => ({ ...view(), phase: "graduation", plan: { ...view().plan, editable: false } }) });
    render(<UpbringingScreen />);
    const town = await screen.findByRole("region", { name: "城中各处" });
    expect(within(town).getByText("这个月的日程已经定了")).toBeInTheDocument();
    expect(within(town).getByRole("button", { name: "市集" })).toHaveAttribute("aria-disabled", "true");
  });
});
