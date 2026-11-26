// 与后端通信：Tauri command 发出命令与查询视图；后端通过事件推送状态增量。
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RoutePref } from "./routing";
import { switchingWorld } from "./sequence";
import type {
  AppSettings,
  BargainReply,
  BookView,
  Captain,
  CaravanPlanView,
  ClockView,
  ColoniesView,
  Command,
  DebugView,
  DiscoveriesView,
  FuturesView,
  IndustriesView,
  IntelView,
  MatesView,
  Overview,
  PinRequest,
  PortView,
  ProviderKind,
  ReportsView,
  SailPreview,
  SaveInfo,
  SeriesView,
  SettingsView,
  SiteView,
  StaticView,
  SubmitResult,
  TacticalView,
  TradeQuote,
  WorldCatalog,
  NewGameRequest,
  BootstrapProgress,
  UpbringingProgress,
  UpbringingView,
  PlanSlotInput,
  ContestOutcome,
  ContestPreview,
  ContestView,
  EndingsView,
  PersonCard,
  PersonFleetView,
  PersonDetail,
  GossipView,
  RelationshipsView,
  StoryLog,
  InventoryView,
  ShopView,
  CodexView,
  AuctionSummary,
  AuctionView,
  TimelineView,
  CampaignView,
  ChronicleView,
  SocietiesView,
  ArcanaView,
  IdeasView,
  LegendShipsView,
  RealmsView,
} from "./types";

function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  return tauriListen<T>(event, handler);
}

export const api = {
  /** 静态数据（名字按后端设置里的语言；隐藏未知港口的世界里只含本局看见过的）。 */
  staticData: () => invoke<StaticView>("static_data"),
  // 开新局、读档、换世界会换掉后端的整局世界：回来之后本地请求序号加一（ipc/sequence.ts），此前发出的视图、航行、迷雾请求的回复一律不再采用
  newGame: (scenario: string, seed?: number) => switchingWorld("new_game", invoke<Overview>("new_game", { scenario, seed: seed ?? null })),
  /** 第九批：开局界面用的世界目录（世界、剧本、主角与自创模板）。旧后端没有这个命令时 reject。 */
  worldCatalog: () => invoke<WorldCatalog>("world_catalog"),
  /** 第九批：在指定世界开局（主角、自创模板、跳过养成、历史事件开关）；推演期间后端推送 bootstrap 事件。 */
  newWorldGame: (request: NewGameRequest) => switchingWorld("new_game", invoke<Overview>("new_world_game", { request })),
  /** 第九批：养成主画面（不在养成中时为 null）。 */
  upbringing: () => invoke<UpbringingView | null>("upbringing"),
  /** 第九批：按预设算好的这个月的日程（前端填进日程表，再照常提交 PlanMonth）。 */
  autoPlan: (preset: string) => invoke<{ slots: PlanSlotInput[] }>("auto_plan", { preset }),
  /** 第九批：比赛的小游戏。 */
  contest: (key: string) => invoke<ContestView>("contest", { key }),
  /** 比赛的小游戏：照现在的输入（没选的一步是 null）能加几分、约多少能赢。 */
  contestPreview: (key: string, moves: unknown[]) => invoke<ContestPreview | null>("contest_preview", { key, moves }),
  /** 已经结算的比赛：名次是怎么来的（给了交卷时的输入还讲到每一步）。 */
  contestOutcome: (key: string, moves: unknown[] | null) => invoke<ContestOutcome | null>("contest_outcome", { key, moves }),
  /** 第九批：结局图鉴（跨局保留）。 */
  endings: () => invoke<EndingsView>("endings"),
  /** 第九批：见过的人物（给 loc 时只列此刻在那里的）。 */
  persons: (loc?: number) => invoke<{ persons: PersonCard[]; fleets?: PersonFleetView[] }>("persons", { loc: loc ?? null }),
  person: (key: string) => invoke<PersonDetail>("person", { key }),
  relationships: () => invoke<RelationshipsView>("relationships"),
  /** 任务日志：旧的 tracks 照旧；后端开了 quests（R10-Q01）时另有 quests / pinned / pinned_auto。 */
  storyLog: () => invoke<StoryLog>("story_log"),
  /** R10-Q01：置顶一条在办的任务（id 为 null 取消置顶，回到自动选），返回新的概览。旧后端没有这个命令时 reject。 */
  pinQuest: (id: string | null) => invoke<Overview>("pin_quest", { id }),
  /**
   * 第九批（I5b）：见闻簿——配角之间的事里主角知道的部分（最近的在前；给 loc 时只列与那个港口有关的）。
   * 旧后端（统一拒绝）时 reject，界面当作“没有见闻”。已读走 submit 的 MarkNewsRead。
   */
  gossip: (q: { loc?: number; limit?: number } = {}) => invoke<GossipView>("gossip", { loc: q.loc ?? null, limit: q.limit ?? null }),
  /** 第九批：物品栏、装备、读书、书目、套装与送礼累计。 */
  inventory: () => invoke<InventoryView>("inventory"),
  /** 第九批：港口的道具店（没有时为 null）。 */
  itemShop: (loc: number) => invoke<ShopView | null>("item_shop", { loc }),
  /** 第九批：图鉴。 */
  codex: (category?: string) => invoke<CodexView>("codex", { category: category ?? null }),
  /** 第九批：今后的拍卖会（给 loc 时只列那个港口的）。 */
  auctions: (loc?: number) => invoke<{ auctions: AuctionSummary[] }>("auctions", { loc: loc ?? null }),
  auction: (key: string) => invoke<AuctionView>("auction", { key }),
  /** 第九批：时间线（历史的天平）、战役链与编年史。 */
  timeline: () => invoke<TimelineView>("timeline"),
  campaign: (key: string) => invoke<CampaignView>("campaign", { key }),
  chronicle: () => invoke<ChronicleView>("chronicle"),
  /** 第九批：结社与嫌疑、秘术、某港的信仰与思想、传说之船、秘境。 */
  societies: () => invoke<SocietiesView>("societies"),
  arcana: () => invoke<ArcanaView>("arcana"),
  ideas: (loc: number) => invoke<IdeasView>("ideas", { loc }),
  legendShips: () => invoke<LegendShipsView>("legend_ships"),
  realms: () => invoke<RealmsView>("realms"),
  /** 第九批：开局界面选定世界（没有进行中的对局时切换后端的当前世界），返回这个世界的静态数据。 */
  selectWorld: (world: string) => switchingWorld("world", invoke<StaticView>("select_world", { world })),
  overview: () => invoke<Overview>("overview"),
  /** 设置主角姓名与外貌，返回更新后的概览。 */
  setCaptain: (captain: Captain) => invoke<Overview | null>("set_captain", { captain }),
  step: (days: number) => invoke<Overview>("step", { days }),
  setSpeed: (speed: number) => invoke<Overview>("set_speed", { speed }),
  submit: (command: Command) => invoke<SubmitResult>("submit", { command }),
  quote: (loc: number, good: number, side: "buy" | "sell", qty: number) =>
    invoke<TradeQuote>("quote", { request: { loc, good, side, qty } }),
  port: (loc: number) => invoke<PortView>("port", { loc }),
  /** 某地某商品的行情序列（日线、月线、上下限、进行中的事件、价格曲线）；未到访的港口后端报错。 */
  marketSeries: (loc: number, good: number) => invoke<SeriesView>("market_series", { loc, good }),
  /** 行情预测簿。 */
  forecastBook: () => invoke<BookView>("forecast_book"),
  /** 记下一条预测（修订版须带 revises 与 basis）。 */
  pinForecast: (request: PinRequest) => invoke<BookView>("pin_forecast", { request }),
  removeForecast: (id: number) => invoke<BookView>("remove_forecast", { id }),
  sailPreview: (fleet: number, dest: number) => invoke<SailPreview | null>("sail_preview", { fleet, dest }),
  caravanPlan: (request: {
    animal: number;
    count: number;
    guards: number;
    from: number;
    to: number;
    cargo_value: number;
  }) => invoke<CaravanPlanView | null>("caravan_plan", { request }),
  futures: () => invoke<FuturesView>("futures"),
  industries: () => invoke<IndustriesView>("industries"),
  reports: () => invoke<ReportsView>("reports"),
  intel: () => invoke<IntelView>("intel"),
  mates: () => invoke<MatesView>("mates"),
  battle: (id: number) => invoke<TacticalView | null>("battle", { id }),
  fog: () => invoke<string[]>("fog"),
  /** 玩家的殖民地详情（人口、士气、粮食、库存、建筑与工程、产出预估、税率、袭击风险、可建设项目）。 */
  colonies: () => invoke<ColoniesView>("colonies"),
  /** 殖民点详情：自然条件、归属、能否建立殖民地与所需物资；不是殖民点时后端报错。 */
  site: (loc: number) => invoke<SiteView>("site", { loc }),
  /** 探险记录：已发现、已报告的发现物与名声。 */
  discoveries: () => invoke<DiscoveriesView>("discoveries"),
  bargain: (loc: number, text: string) => invoke<BargainReply>("bargain", { loc, text }),
  /** 请账房点评一条预测（ECONOMY.md 8.6）：facts 为复盘算出的诊断与驱动（按界面语言） */
  reviewComment: (entry: number, place: string, facts: string[]) => invoke<string>("review_comment", { entry, place, facts }),
  /** 主角的身世序章（ECONOMY.md 8.7） */
  prologue: () => invoke<string>("prologue"),
  getSettings: () => invoke<SettingsView>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<SettingsView>("save_settings", { settings }),
  setApiKey: (provider: ProviderKind, key: string) => invoke<SettingsView>("set_api_key", { provider, key }),
  clearApiKey: (provider: ProviderKind) => invoke<SettingsView>("clear_api_key", { provider }),
  saveGame: (slot: string) => invoke<SaveInfo>("save_game", { slot }),
  loadGame: (slot: string) => switchingWorld("load", invoke<Overview>("load_game", { slot })),
  listSaves: () => invoke<SaveInfo[]>("list_saves"),
  /** 删除一个存档，返回删除后的存档列表。 */
  deleteSave: (slot: string) => invoke<SaveInfo[]>("delete_save", { slot }),
  debug: () => invoke<DebugView>("debug"),
};

/** 取消订阅时忽略运行环境已卸载等错误。 */
function safe(un: UnlistenFn): UnlistenFn {
  return () => {
    try {
      const r = un() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      // 运行环境已卸载
    }
  };
}

/** 订阅后端推送的每日概览；在非 Tauri 环境（如浏览器预览）下静默失败。 */
export async function onTick(handler: (o: Overview) => void): Promise<UnlistenFn> {
  try {
    return safe(await listen<Overview>("tick", (e) => handler(e.payload)));
  } catch {
    return () => {};
  }
}

/** 订阅后端推送的时钟 `{ day, minute }`（运行中实时每 ≥100 ms 一次）；在非 Tauri 环境下静默失败。 */
export async function onClock(handler: (c: ClockView) => void): Promise<UnlistenFn> {
  try {
    return safe(await listen<ClockView>("clock", (e) => handler(e.payload)));
  } catch {
    return () => {};
  }
}

/** 订阅开局前推演的进度 `{ day, total }`（第九批：control_date 晚于 start_date 的剧本）；在非 Tauri 环境下静默失败。 */
export async function onBootstrap(handler: (p: BootstrapProgress) => void): Promise<UnlistenFn> {
  try {
    return safe(await listen<BootstrapProgress>("bootstrap", (e) => handler(e.payload)));
  } catch {
    return () => {};
  }
}

/** 订阅跳过养成的分段进度（P05）；在非 Tauri 环境下静默失败。 */
export async function onUpbringingProgress(handler: (p: UpbringingProgress) => void): Promise<UnlistenFn> {
  try {
    return safe(await listen<UpbringingProgress>("upbringing_progress", (e) => handler(e.payload)));
  } catch {
    return () => {};
  }
}

/** 订阅后端推送的错误（例如自动推进失败）。 */
export async function onError(handler: (message: string) => void): Promise<UnlistenFn> {
  try {
    return safe(await listen<string>("error", (e) => handler(e.payload)));
  } catch {
    return () => {};
  }
}

/** 把后端返回的错误整理成文字。 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

// ───────────────────────────── 第九批：地图资源、迷雾增量与手动航行（docs/UI-CONTRACT.md I3） ─────────────────────────────
// 查询走 Tauri 命令；命令照旧走 api.submit（Command 联合类型的末尾并入了 NavCommand）。
import type { CoursePreview, FogDelta, MapFineResource, MapResource, NavCommand, NavDestsView, NavView, SailSetting, SteerInput } from "./types";

export const navApi = {
  /** 大地图的图层（按 hash 永久缓存，见 map/mapResource.ts）。 */
  mapResource: (map: string) => invoke<MapResource>("map_resource", { map }),
  /** 细图层（M01“细海图”）：细海岸、细高程、细河流；没有细图层的地图返回空的一份（见 map/fineLayers.ts）。 */
  mapFine: (map: string) => invoke<MapFineResource>("map_fine", { map }),
  /** 迷雾增量：自 since 版本以来新揭开的格（太旧或换了对局时给全量位图）。 */
  fogDelta: (since: number, epoch?: string | null) => invoke<FogDelta>("fog_delta", epoch ? { since, epoch } : { since }),
  /** 航行视图：舰队在海上、手动航行的世界才有（否则为 null）。 */
  navigation: (fleet: number) => invoke<NavView | null>("navigation", { fleet }),
  /**
   * H10b 的按需目的地清单（与航行视图的 known_dests 同一个算法，在港时也能问）。FIX5F：寰宇的出港框“自动驶往”用。
   * 旧后端没有这条命令时会 reject，调用方要有退路。
   */
  navigationDests: (fleet: number) => invoke<NavDestsView | null>("navigation_dests", { fleet }),
  /** 预测：照还没提交的操舵，从上次结算到 minute 的位置与当天剩下的航迹（纯函数，与结算逐分钟一致）。 */
  previewCourse: (fleet: number, steers: SteerInput[], minute: number) =>
    invoke<CoursePreview>("preview_course", { fleet, steers, minute }),
};

/** 手动航行命令的构造（minute 为从当天 6:00 起的分钟）。 */
export const navCommand = {
  steer: (fleet: number, minute: number, change: { heading?: number; sail?: SailSetting }): NavCommand => ({
    Steer: { owner: "player", fleet, minute, ...change },
  }),
  depart: (fleet: number, minute: number, heading: number): NavCommand => ({ Depart: { owner: "player", fleet, minute, heading } }),
  // H07：route 是寻路偏好（ipc/routing.ts）；不给时不写进命令（后端按缺省：有领航员最快，没有按距离）
  autopilot: (fleet: number, dest: number, minute: number, stopAtKnownEdge = false, route?: RoutePref): NavCommand => ({
    Autopilot: {
      ...(stopAtKnownEdge ? { owner: "player", fleet, dest, minute, stop_at_known_edge: true } : { owner: "player", fleet, dest, minute }),
      ...(route ? { route } : {}),
    },
  }),
  landing: (fleet: number, days: number): NavCommand => ({ Landing: { owner: "player", fleet, days } }),
};
