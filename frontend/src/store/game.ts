// 全局状态：静态数据、每日概览、当前选择与提示。视图数据由各面板按需查询（store/views.ts 调度）：
// 每当概览更新（后端推送或命令返回）时 `version` 加一；本地的操作（命令、推进、开局、重取、切换语言）另让 `act` 加一——
// 视图按“世界的状态变没变”（换了日期、内容变了，或有本地操作）重新查询，只改了倍速时不查。
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { setWorld } from "../i18n";
import { currentLocale, setLocale, settingsLocale } from "../i18n/locale";
import { api, errorText } from "../ipc/api";
import { locById } from "../ipc/byId";
import { isCurrentSeq, requestSeq } from "../ipc/sequence";
import { NORMAL_SPEED, nearestTier } from "../time/daylight";
import { share } from "./share";
import type { Captain, CaptainCreation, Command, InfoMode, Locale, NewGameRequest, Overview, StaticView, SubmitResult } from "../ipc/types";

export type Tab =
  | "history"
  | "secrets"
  | "people"
  | "quests"
  | "items"
  | "codex"
  | "port"
  | "fleet"
  | "mates"
  | "futures"
  | "analysis"
  | "caravan"
  | "industry"
  | "colonies"
  | "explore"
  | "reports"
  | "intel"
  | "battle"
  | "settings"
  | "debug";

/** 主舞台：港口街景（town）或航海图（chart）。 */
export type Stage = "town" | "chart";

/** 港口设施（街景中的建筑与港口窗口的分页一一对应）。 */
export type Facility = "market" | "shipyard" | "tavern" | "guild" | "bank" | "exchange" | "warehouse" | "invest" | "office";

/**
 * 港口窗口的分页：设施，加上第九批的世界才有的道具店与拍卖会（街景里暂时没有对应的建筑），
 * 以及旅店（11-03：手动航行的世界里旗舰队在港时间不走，在这里休息才过天；只在旗舰队停着的港口出现，排在酒馆后面）。
 */
export type PortPage = Facility | "shop" | "auction" | "inn";
export const FACILITIES: readonly Facility[] = [
  "market",
  "shipyard",
  "tavern",
  "guild",
  "bank",
  "exchange",
  "warehouse",
  "invest",
  "office",
];

/** 第九批的分页：港口有道具店 / 拍卖会时排在设施之后（PortView.shop、PortView.auction）。 */
export const EXTRA_FACILITIES: readonly PortPage[] = ["shop", "auction"];

/** 这一页是不是街景里有建筑的设施。 */
export function isFacility(p: PortPage): p is Facility {
  return (FACILITIES as readonly string[]).includes(p);
}

export interface GameStore {
  statics: StaticView | null;
  overview: Overview | null;
  version: number;
  /** 本地操作的次数（命令、推进、开局、重取、切换语言）：操作可能改了概览里看不出来的状态，视图据此重新查询 */
  act: number;
  tab: Tab;
  selectedLoc: number | null;
  selectedFleet: number | null;
  /** 殖民地窗口当前选中的殖民地（殖民地 id） */
  selectedColony: number | null;
  message: string | null;
  error: string | null;
  devMode: boolean;
  /** 主舞台显示港口街景还是航海图 */
  stage: Stage;
  /** 港口窗口当前的设施分页 */
  facility: PortPage;
  /** 最近放进来的概览的编号（离开主界面后也留着）：迟到的旧概览据此丢掉 */
  stamp: OverviewStamp | null;
  /**
   * 最近一次运行时的倍速（没运行过时取设置里的默认速度，归到三档；缺省“普通”4×）：暂停后继续、靠港自动暂停之后出港时按它走。
   * 在港暂停（Overview.port_hold）时跟着后端记下的“出港后的倍速”。
   */
  runSpeed: number;

  init: () => Promise<void>;
  setStatics: (s: StaticView) => void;
  setOverview: (o: Overview) => void;
  /**
   * 后端推送来的概览（每日的 tick）：只在主界面里（已经有概览时）放进来。
   * 还在开局画面（开局向导的几步命令各自也会推送）或已经回到开局画面时不放，免得半途被拉进游戏。
   */
  applyPushed: (o: Overview) => void;
  setTab: (tab: Tab) => void;
  selectLoc: (loc: number | null) => void;
  selectFleet: (fleet: number | null) => void;
  selectColony: (colony: number | null) => void;
  notify: (message: string) => void;
  fail: (e: unknown) => void;
  clearMessages: () => void;
  setDevMode: (on: boolean) => void;
  setStage: (stage: Stage) => void;
  setFacility: (facility: PortPage) => void;
  /** 让打开的视图重新查询（断线重连之后：期间可能有别处的操作）。 */
  refreshViews: () => void;
  /** 提交玩家命令；成功返回结果，失败时显示错误并返回 null（随后向后端重新取一次概览，见 resync）。 */
  submit: (command: Command) => Promise<SubmitResult | null>;
  /**
   * 向后端重新取一次概览（操作失败之后）：界面手上的状态可能已经过时——请求的回复在路上丢了、同一个账号在别的标签页或设备上
   * 先处理了遭遇——这时遭遇对话框还开着，再点只会被拒；重新取回来的概览里没有这个遭遇，对话框就合上了。
   */
  resync: () => Promise<void>;
  /**
   * 开局；给出 captain 时随后设置主角姓名与外貌，给出 creation 时再提交 CreateCaptain 立下身世（开局效果在第 0 天生效）。
   * 三步都完成后才进入游戏；后两步失败时照样进入游戏并显示错误（没有身世的主角一切照旧）。
   */
  /** 开局：`info` 为行情情报（缺省随船传递；选实时时不提交命令，与旧版相同） */
  newGame: (scenario: string, seed?: number, captain?: Captain, creation?: CaptainCreation, info?: InfoMode) => Promise<void>;
  /**
   * 第九批：在指定世界开局（主角、自创模板、跳过养成、历史事件开关、行情情报都在请求里，由后端在玩家取得控制的那天生效）。
   * 成功后按新世界重新取静态数据（地图与属性表都随世界变化），再进入游戏。
   * after：没有主角名册的世界（框架测试海域）照经典向导立的主角——开局后再设置姓名与外貌、提交 CreateCaptain（与 newGame 的后两步相同）。
   */
  newWorldGame: (request: NewGameRequest, after?: { captain?: Captain; creation?: CaptainCreation }) => Promise<void>;
  /**
   * 读档之后进入游戏：存档在别的世界（Overview.world_key 与静态数据的 world.key 不同），或这个世界按看见过的地点过滤静态数据
   * （概览带 sighted）时，先按读进来的这一局重新取静态数据，再放入概览。
   */
  enterLoaded: (overview: Overview) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  step: (days: number) => Promise<void>;
  leave: () => void;
  /**
   * 切换到已经保存进设置的语言：按新语言重新获取静态数据（地名、人名等由后端按语言给出）与概览，再切换界面语言。
   * 后端尚未支持语言、取数失败时界面文字照样切换。语言只影响显示，不改变世界状态。
   */
  applyLocale: (locale: Locale) => Promise<void>;
  /** 把语言保存进设置（只改 language，其余设置原样保留），然后 applyLocale。开局界面的语言下拉用它。 */
  changeLanguage: (locale: Locale) => Promise<void>;
}

/** 概览的编号（见 Overview.epoch / rev）。 */
export interface OverviewStamp {
  epoch: number;
  rev: number;
}

/** 概览的编号；旧后端没有时为 null。 */
export function stampOf(o: Overview | null | undefined): OverviewStamp | null {
  return o && typeof o.epoch === "number" && typeof o.rev === "number" ? { epoch: o.epoch, rev: o.rev } : null;
}

/** 这个概览是不是迟到的旧概览：与手上的同一个 epoch 且 rev 不比它新。没有编号（旧后端、测试里手写的概览）时不算。 */
export function isStale(have: OverviewStamp | null, next: Overview): boolean {
  const s = stampOf(next);
  return !!have && !!s && s.epoch === have.epoch && s.rev <= have.rev;
}

/**
 * 放进一份概览时要改的状态；迟到的旧概览返回 null（不动）。
 * 放进之前与手上的概览做结构共享（store/share.ts）：内容没变的字段沿用旧对象，按字段选取的组件只在用到的字段变了时重渲染。
 * 换了对局（epoch 或世界不同）时不共享——不同局里碰巧相同的东西没有沿用的意义。
 */
function overviewPatch(s: GameStore, next: Overview): Partial<GameStore> | null {
  // 迟到的旧概览（排在后面的推送、晚到的请求结果）：不动
  if (isStale(s.stamp, next)) return null;
  const prev = s.overview;
  const overview = prev && prev.epoch === next.epoch && prev.world_key === next.world_key ? share(prev, next) : next;
  // 首次进入游戏时默认选中第一支舰队及其所在港口
  const first = overview.fleets[0];
  const selectedFleet = s.selectedFleet ?? first?.id ?? null;
  const selectedLoc = s.selectedLoc ?? first?.docked ?? null;
  // 在港暂停时跟着后端记下的“出港后的倍速”（在港按了哪一档）
  const runSpeed = overview.speed > 0 ? overview.speed : (overview.port_hold?.resume ?? s.runSpeed);
  return { overview, version: s.version + 1, selectedFleet, selectedLoc, stamp: stampOf(overview) ?? s.stamp, runSpeed };
}

export const useGame = create<GameStore>((set, get) => ({
  statics: null,
  overview: null,
  version: 0,
  act: 0,
  tab: "port",
  selectedLoc: null,
  selectedFleet: null,
  selectedColony: null,
  message: null,
  error: null,
  devMode: false,
  stage: "town",
  facility: "market",
  stamp: null,
  runSpeed: NORMAL_SPEED,

  init: async () => {
    try {
      // 语言：设置里有就按设置，旧设置（首次启动）没有时按系统语言；
      // 先切语言再放入静态数据，首屏就是对的语言
      const settings = await api.getSettings();
      const locale = settingsLocale(settings.settings.language);
      const statics = await api.staticData();
      setLocale(locale);
      // 还没开过钟时，“继续”按设置里的默认速度（归到三档）
      const runSpeed = get().overview ? get().runSpeed : nearestTier(settings.settings.speed);
      set({ statics, devMode: settings.settings.dev_mode, runSpeed });
    } catch (e) {
      get().fail(e);
    }
  },
  setStatics: (statics) => set({ statics }),
  setOverview: (overview) => set((s) => overviewPatch(s, overview) ?? s),
  applyPushed: (overview) => {
    if (get().overview) get().setOverview(overview);
  },
  setTab: (tab) => set({ tab }),
  selectLoc: (selectedLoc) => set({ selectedLoc }),
  selectFleet: (selectedFleet) => set({ selectedFleet }),
  selectColony: (selectedColony) => set({ selectedColony }),
  notify: (message) => set({ message, error: null }),
  fail: (e) => set({ error: errorText(e), message: null }),
  clearMessages: () => set({ message: null, error: null }),
  setDevMode: (devMode) => set({ devMode }),
  setStage: (stage) => set({ stage }),
  setFacility: (facility) => set({ facility }),
  refreshViews: () => set((s) => ({ act: s.act + 1 })),

  submit: async (command) => {
    try {
      const r = await api.submit(command);
      // 概览与“本地操作”在同一次更新里放进去：视图调度（store/views.ts）只看到一次变化、只重新查询一次
      // （以前分两次 set：先因概览变了查一次，回来后又因 act 变了再查一次）
      set((s) => ({ ...overviewPatch(s, r.overview), error: null, act: s.act + 1 }));
      return r;
    } catch (e) {
      get().fail(e);
      void get().resync();
      return null;
    }
  },
  resync: async () => {
    if (!get().overview) return;
    try {
      const o = await api.overview();
      // 取回来之前已经离开主界面（回到开局画面）时不再放进来
      if (o && typeof o === "object" && Array.isArray(o.fleets) && get().overview) {
        get().setOverview(o);
        get().refreshViews();
      }
    } catch {
      // 取不到时等下一次推送
    }
  },
  newGame: async (scenario, seed, captain, creation, info = "carried") => {
    let o: Overview;
    try {
      set({ selectedFleet: null, selectedLoc: null, selectedColony: null });
      o = await api.newGame(scenario, seed);
    } catch (e) {
      get().fail(e);
      return;
    }
    let failure: unknown = null;
    try {
      // 行情情报是这一局的第一条命令（只在第 0 天有效）；实时（经典）不用提交
      if (info === "carried") o = (await api.submit({ SetInfoMode: { owner: "player", mode: "carried" } })).overview;
      if (captain) o = (await api.setCaptain(captain)) ?? o;
      if (creation) o = (await api.submit({ CreateCaptain: { owner: "player", ...creation } })).overview;
    } catch (e) {
      failure = e;
    }
    get().setOverview(o);
    set((s) => ({ tab: "port", stage: "town", facility: "market", act: s.act + 1 }));
    if (failure !== null) get().fail(failure);
  },
  newWorldGame: async (request, after) => {
    let o: Overview;
    try {
      set({ selectedFleet: null, selectedLoc: null, selectedColony: null });
      o = await api.newWorldGame(request);
      // 世界换了：按当前语言重新取这个世界的静态数据（地图、地点、商品、属性表……），纪年与货币跟着换
      const statics = await api.staticData();
      setWorld(statics.world);
      set({ statics });
      staticsSight = sightKey(o);
    } catch (e) {
      get().fail(e);
      return;
    }
    let failure: unknown = null;
    try {
      if (after?.captain) o = (await api.setCaptain(after.captain)) ?? o;
      if (after?.creation) o = (await api.submit({ CreateCaptain: { owner: "player", ...after.creation } })).overview;
    } catch (e) {
      failure = e;
    }
    get().setOverview(o);
    set((s) => ({ tab: "port", stage: "town", facility: "market", act: s.act + 1 }));
    if (failure !== null) get().fail(failure);
  },
  enterLoaded: async (overview) => {
    const have = get().statics?.world?.key ?? CLASSIC;
    if ((overview.world_key ?? CLASSIC) !== have || Array.isArray(overview.sighted)) {
      try {
        const statics = await api.staticData();
        setWorld(statics.world);
        set({ statics });
        staticsSight = sightKey(overview);
      } catch (e) {
        // 取不到时照样进入（后端已经换成这一局）；看见的地点或世界对不上时下面的 syncSight 会再取
        get().fail(e);
      }
    }
    // S02nF7：读进来的是另一局：上一局选中的地点、舰队、殖民地不再有意义（开着的港口面板会拿着上一局的地点去查，报“地点不存在”）。
    // 与开新局一样先清掉，放进概览时再按新一局的旗舰队选上它停着的港
    set({ selectedFleet: null, selectedLoc: null, selectedColony: null });
    get().setOverview(overview);
    set((s) => ({ act: s.act + 1 }));
  },
  setSpeed: async (speed) => {
    try {
      get().setOverview(await api.setSpeed(speed));
    } catch (e) {
      get().fail(e);
      void get().resync();
    }
  },
  step: async (days) => {
    try {
      get().setOverview(await api.step(days));
      get().refreshViews();
    } catch (e) {
      get().fail(e);
      void get().resync();
    }
  },
  leave: () => {
    void api.setSpeed(0).catch(() => {});
    set({ overview: null, selectedFleet: null, selectedLoc: null, selectedColony: null });
  },
  applyLocale: async (locale) => {
    if (locale === currentLocale()) return;
    let statics: StaticView | null = null;
    let overview: Overview | null = null;
    try {
      statics = await api.staticData();
    } catch {
      // 后端没有给出新语言的静态数据：只切换界面文字
    }
    if (get().overview) {
      try {
        overview = await api.overview();
      } catch {
        // 概览取不到时沿用现有的（下一次推送会更新）
      }
    }
    // 同一轮里先放数据再切语言：界面按新语言重新挂载时拿到的就是新语言的名字
    if (statics) set({ statics });
    if (overview) get().setOverview(overview);
    // 视图里的名字按语言给出：重新查询
    get().refreshViews();
    setLocale(locale);
  },
  changeLanguage: async (locale) => {
    try {
      const view = await api.getSettings();
      await api.saveSettings({ ...view.settings, language: locale });
    } catch (e) {
      get().fail(e);
      return;
    }
    await get().applyLocale(locale);
  },
}));

// 静态数据变化时（载入、测试中直接设置）同步货币名称与纪年，供 money() 与日期格式化使用
setWorld(useGame.getState().statics?.world);
useGame.subscribe((s, prev) => {
  if (s.statics !== prev.statics) setWorld(s.statics?.world);
});

// ───────────────────────────── 看见新地点之后重取静态数据 ─────────────────────────────
// hide_unknown_ports 的世界里，static_data 只给看见过的地点与发现过的发现物（见 ipc/byId.ts）。概览里看见的地点（Overview.sighted）
// 有静态数据里没有的、发现物总数（discovered_count）多过静态数据里的发现物，或概览的世界与静态数据的世界不同时，重新取一次静态数据：
// 新望见的港口、新发现的发现物这才出现在海图与各窗口里。
// 每次推送都来查一遍，但只在缺东西时取；同一份“看见”（sightKey）只取一次（取回来还缺也不再追着取），取的时候不再排第二个。

/** 发现缺东西之后等这么久再取（高倍速下一秒推送好几次概览，接连看见几处：攒一下，只取一次）。开局、读档自己先取过。 */
export const SIGHT_REFETCH_MS = 300;
const CLASSIC = "classic";
/** 静态数据是按哪一份“看见”取的（null：还没按哪一局取过） */
let staticsSight: string | null = null;
let sightTimer: ReturnType<typeof setTimeout> | null = null;
let sightBusy = false;

/** 一局的“看见”：世界、看见的地点数与发现物数（同一局里只增不减；不过滤的世界没有 sighted，记作 -）。 */
function sightKey(o: Overview | null): string | null {
  if (!o) return null;
  return `${o.world_key ?? ""}|${o.sighted?.length ?? "-"}|${o.discovered_count ?? 0}`;
}

/** 静态数据缺不缺这一局已经看见的东西（或者干脆是别的世界的）。 */
export function staticsBehind(statics: StaticView | null, o: Overview | null): boolean {
  if (!statics || !o) return false;
  if (o.world_key !== undefined && statics.world?.key !== undefined && o.world_key !== statics.world.key) return true;
  if (!Array.isArray(o.sighted)) return false;
  if (o.sighted.some((id) => !locById(statics, id))) return true;
  return typeof o.discovered_count === "number" && o.discovered_count > statics.discoveries.length;
}

function scheduleSight() {
  if (sightTimer !== null || sightBusy) return;
  const g = useGame.getState();
  if (!staticsBehind(g.statics, g.overview) || sightKey(g.overview) === staticsSight) return;
  sightTimer = setTimeout(() => void syncSight(), SIGHT_REFETCH_MS);
}

async function syncSight() {
  sightTimer = null;
  const g = useGame.getState();
  const key = sightKey(g.overview);
  if (!staticsBehind(g.statics, g.overview) || key === staticsSight) return;
  sightBusy = true;
  const seq = requestSeq();
  try {
    const statics = await api.staticData();
    // 换了一局（读档、开新局、换世界、重连）之后迟到的回复不用；已经回到开局画面时也不放
    if (isCurrentSeq(seq) && useGame.getState().overview) {
      useGame.setState({ statics });
      staticsSight = key;
    }
  } catch {
    // 取不到时这一份“看见”不再追着取，等下一次看见新东西
    staticsSight = key;
  } finally {
    sightBusy = false;
  }
  scheduleSight();
}

useGame.subscribe((s, prev) => {
  if (s.overview && s.overview !== prev.overview) scheduleSight();
});

/** 测试用：清掉“按哪一份看见取过”的记录与排着的重取。 */
export function resetSightSync() {
  if (sightTimer !== null) clearTimeout(sightTimer);
  sightTimer = null;
  sightBusy = false;
  staticsSight = null;
}

/**
 * 按字段选取概览（P14a）：只取这几项顶层字段，浅比较——放进概览时做了结构共享（store/share.ts），
 * 内容没变的字段还是同一个对象，用到它们的组件在换日时不重渲染。没有概览时为 null。
 * 例：`const o = useOverviewFields("fleets", "cash")`，之后照旧写 `o.fleets`、`o.cash`。
 */
export function useOverviewFields<K extends keyof Overview>(...keys: K[]): Pick<Overview, K> | null {
  return useGame(
    useShallow((s) => {
      const o = s.overview;
      if (!o) return null;
      const out = {} as Pick<Overview, K>;
      for (const k of keys) out[k] = o[k];
      return out;
    }),
  );
}

/** 主角亲自率领的旗舰队：第一支舰队（开局舰队）。 */
export function flagship(o: Pick<Overview, "fleets"> | null | undefined) {
  return o?.fleets[0];
}

/** 以当前选中的舰队为准；没有选中时取第一支。 */
export function currentFleet(o: Pick<Overview, "fleets"> | null, id: number | null) {
  if (!o) return undefined;
  return o.fleets.find((f) => f.id === id) ?? o.fleets[0];
}
