// R10-U06 养成行动制的视图与命令（docs/tasks/R10-U06K1.md 契约 4、契约 5）。视图里只有键与数，名字与句子由界面按键取。
// U06F2：逐字段对过后端实际输出（crates/manifest-appcore/src/upbringing_view/act.rs 与 docs/drafts/u06k1/ 的三份样例）。
// 后端在 `UpbringingView.act` 里给（只在行动制在跑时）；旧档另给 `act_old_save = true`。
// K2 / K3 的字段（moment、mission、rank、tide、voyage、score、capital_preview）在 K1 恒为 null，界面只留位置。
// U06F3：K2（docs/tasks/R10-U06K2.md 契约 4、契约 6）的字段逐一对过 docs/drafts/u06k2/ 的真实样例；后端可能不给的写成可选。
// U06F4：K3a（docs/tasks/R10-U06K3a.md 契约 5）的潮汐、见闻与识货、人物分级、小结 summary_k3，对过 manifest-cli 的真实导出。
import type { WorldDate } from "./types";

export type Date3 = WorldDate;
export type ActPhase = "plan" | "lessons" | "moment" | "free" | "story" | "voyage" | "summary";
export type ActionKind = "greet" | "job" | "talk" | "gift" | "marker" | "rest" | "pray" | "self_study" | "excursion" | "rumor";
export type StopKey = "tier_open" | "fee" | "fatigue" | "calendar" | "mission_due" | "key_marker" | "restage" | "blocked" | "ill" | "voyage";
export type StageKey = "core" | "ladder" | "review" | "tides" | "voyage" | "rumors" | "family_duty";
export type LessonGrade = "fail" | "ok" | "great" | "ill";
/** K2：总评五档 */
export type Band = "ding" | "bing" | "yi" | "jia" | "te";
/** K2：关键时刻的三张卡 */
export type MomentPick = "steady" | "risky" | "clever";
/** K2：开档还缺的条件 */
export type TierMissing = "structural" | "gain" | "root" | "bond" | "rank" | "requires" | "master";

export interface LessonSlotView {
  index: number;
  /** 本周第几天（1–5） */
  day: number;
  /** K1 只出 day / evening（同一天的第二格是晚课） */
  kind: "day" | "morning" | "evening";
  date: Date3;
  /** 已过去（换阶段落在周中时不结算） */
  past: boolean;
  line: string | null;
  /** 第几档，0 起 */
  tier: number;
  /** 这一格实际结算的活动键 */
  activity: string | null;
  with: string | null;
  /** 本格学费上界（整数） */
  fee: number;
  /** 本格疲劳（十分之一点） */
  fatigue_x10: number;
  /** 主属性每格的期望成长 × 100 */
  yield: number;
  /** 各属性每格成长区间 × 100（已乘效率与系数） */
  gains: Record<string, [number, number]>;
  success_pct: number;
  /** K2；K1 恒 null */
  great_pct: number | null;
  /** K2：这一格带来的器具费（开课时付；同门同档只记在第一格） */
  tool_due?: number;
  /** K2：这一格的关键时刻（结算后才有） */
  moment?: MomentPick | null;
  moment_ok?: boolean | null;
  /** 已结算的格才有 */
  result?: {
    grade: LessonGrade;
    /** 这一格实际记上的整数点（小数部分进了进位，所以“险”失败也可能写 +1） */
    growth: Record<string, number>;
    /** U06F3 第三趟（可选，后端待给）：这一格的成长 × 100（含小数）；有就按它显示 */
    growth_x100?: Record<string, number>;
    skill: Record<string, number>;
    cash: number;
    fatigue: number;
    affinity: Record<string, number>;
    /** K2 */
    moment?: MomentPick | null;
    moment_ok?: boolean | null;
  };
}

export interface LineTierView {
  activity: string;
  open: boolean;
  used: boolean;
  /** 开了但还没提示过（tier_open 停因） */
  new: boolean;
  gain_need: number | null;
  gain_have: number | null;
  root_need: number | null;
  root_have: number | null;
  bond_need: number | null;
  bond_have: number | null;
  rank_need: number | null;
  exam: boolean | null;
  fee: number | null;
  tool: number | null;
  gift: number | null;
  gate: "master_test" | null;
  // —— K2（阶梯下才有） ——
  /** 身份现在几级（契约外，后端多给的） */
  rank_have?: number | null;
  /** 已付过：永远开着 */
  paid?: boolean;
  /** 这档要师事时是否已过，否则 null */
  master?: boolean | null;
  requires?: { line: string; tier: number; ok: boolean }[];
  /** 空 = 开着（或已付） */
  missing?: TierMissing[];
  /** 这一档此刻一格主属性的期望 × 100 */
  yield_x100?: number;
  /** U06K2c：这一档的成功率与出彩率（按不带同行者算） */
  success_pct?: number;
  great_pct?: number;
}

export interface LineView {
  key: string;
  stage: "home" | "academy";
  academy: string | null;
  place: string;
  attr: string | null;
  side: string | null;
  skill: string | null;
  root: string | null;
  mentor: string | null;
  /** 本周课表里这门用到的最高档（没排为 −1） */
  tier: number;
  tiers: LineTierView[];
  efficiency_pct: number;
  /** 本年主属性还能长多少 */
  year_room: number;
  // —— K2 ——
  root_level?: number | null;
  /** 关键时刻“巧”折给旁属性还是钱 */
  clever?: "side" | "cash";
  /** 有师事那一档的拜师礼（文）；没有师事为 null */
  master_cost?: number | null;
}

export interface ActPlaceAction {
  kind: ActionKind;
  cost: number;
  enabled: boolean;
  /** 做不了的原因（错误码，如 ub.act.points） */
  reason: string | null;
  /** U06K1b（可选）：后端给的原因说明；没有时界面查 actText 的退路 */
  reason_text?: string | null;
  /** 对象：工种活动键 / 人物键 / 标记轨道键 / 自修的“门:档” / 远足节点 */
  targets: string[];
}

export interface ActPlaceView {
  key: string;
  /** K3 起视图自带地点名与一句提示（数据里可能还是“（待写）”）；出海的甲板、停靠港只有这里有名字 */
  name?: string | null;
  hint?: string | null;
  x: number;
  y: number;
  kind: string;
  venue: string;
  open: boolean;
  faded: boolean;
  /** rank：K3 */
  people: { key: string; rank: number | null; greeted: boolean; marker: string | null }[];
  /** ≤ 5（不含寒暄） */
  actions: ActPlaceAction[];
  /** name（U06K1b，可选）：货架物品名 */
  shop: { item: string; price: number; have: number; name?: string }[];
  jobs: {
    activity: string;
    group: string;
    level: number;
    income: [number, number];
    fatigue_x10: number;
    success_pct: number;
    /** 晋级进度（点） */
    progress: number;
    next_at: number | null;
    /** K2：下一档要的交易 + 口才涨幅 */
    next_gain?: number | null;
    /** K3a：income 里已含的加成合计 %（潮汐 + 合伙打工），0 = 照常 */
    bonus_pct?: number;
    /** U06K3a3（可选）：打这份工能摸到的货与各自的识货进度；第一趟夹具里拼过只有键的 string[]，两种都认 */
    goods?: (string | { good: string; name?: string | null; seen: number; need: number; known: boolean })[];
  }[];
}

export interface MarkerView {
  track: string;
  chapter: string;
  place: string;
  person: string | null;
  since: Date3;
  expires: Date3;
  weeks_left: number;
  /** 关键章：过期也会自己发生 */
  key: boolean;
  missed: number;
  /** K3 */
  level: number | null;
  /** 这条故事线这一章的标题（V01；后端没给或还是“（待写）”时按人名起名） */
  title?: string | null;
  /** FIX7b（可选，后端在做）：现在点不点得开；false 时照画但不带“!”，点开写 reason_text。没给当作点得开 */
  openable?: boolean;
  /** FIX7b：点不开的原因码（与真点时被拒的同一处判断，如 ub.act.marker）与填好参数的一句 */
  reason?: string | null;
  reason_text?: string | null;
}

export interface ActCalendarMark {
  date: Date3;
  /** U06K1b（可选）：日历项名字 */
  name?: string | null;
  kind: "festival" | "exam" | "contest" | "academy" | "marker_due" | "agenda" | "mission_due" | "review" | "voyage" | "tide";
  key: string;
}

export interface ActionRecordView {
  place: string;
  kind: ActionKind;
  target: string | null;
  item: string | null;
  cost: number;
  /** 寒暄句的键 act:greet:<家庭>:<池>:<句> */
  greet: string | null;
  /** K3a：这次拿到的见闻卡键（听消息、1 级好处的寒暄）；没有时后端不给 */
  rumors?: string[];
  result: {
    growth: Record<string, number>;
    skill: Record<string, number>;
    cash: number;
    fatigue: number;
    mood: number;
    affinity: Record<string, number>;
    success: boolean | null;
  };
}

/** FIX7：照周末模板跳过的一步（原因码与地点行动的 reason 同一套；reason_text 是后端填好参数的字） */
export interface FreeSkipView {
  step: number;
  place: string;
  kind: ActionKind;
  target: string | null;
  action: unknown;
  reason: string;
  args?: unknown;
  reason_text?: string | null;
}

export interface ActSummaryView {
  week: number;
  from: Date3;
  to: Date3;
  growth: Record<string, number>;
  skill: Record<string, number>;
  cash: number;
  fatigue: number;
  mood: number;
  affinity: Record<string, number>;
  lessons_ok: number;
  lessons_fail: number;
  points_used: number;
  markers_seen: number;
  /** K2d：好感变化逐项带显示名（人物定义里取不到名字的给 null；“人”一栏用）。旧存档的小结里没有，所以可选 */
  affinity_changes?: { person: string; name: string | null; value: number }[];
  /** FIX7：这周照周末模板做了几件、跳过了哪几件 */
  free_template?: { applied: number; skipped: FreeSkipView[] } | null;
  /** K2：评定（后端给的是 summary_k2.review 的同一份） */
  ranks: { from: number; to: number } | null;
  merit: number | null;
  score_delta: number | null;
}

// ── K2（契约 6） ──

export interface MomentOption {
  pick: MomentPick;
  /** 检定的成功率；稳不检定为 null */
  chance_pct: number | null;
  attr: string | null;
  need_level: number | null;
  have_level: number | null;
  /** 成了这一格的收益 % */
  win_pct: number;
  /** 败了的收益 %（只有险） */
  lose_pct: number | null;
  /** 巧：折给旁属性还是钱 */
  convert: "side" | "cash" | null;
}

export interface MomentView {
  week: number;
  slot: number;
  day: number;
  date: Date3;
  line: string;
  tier: number;
  picked: MomentPick | null;
  options: MomentOption[];
}

export type MissionGoalKind = "deed" | "tier" | "gain" | "skill" | "affinity" | "duty" | "contest" | "flag";

export interface MissionView {
  key: string;
  giver: string;
  month: [number, number];
  due: Date3;
  weeks_left: number;
  status: "active" | "done" | "failed";
  merit: number;
  /** label（U06K2c，可选）：数据里这条目标的一句话；null 时界面用泛称 */
  goals: { kind: MissionGoalKind; target: string | null; have: number; need: number; done: boolean; label?: string | null }[];
  reward: { kind: "cash" | "item" | "affinity"; key: string | null; qty: number }[];
}

export interface RankView {
  level: number;
  merit: number;
  next_at: number | null;
  next_review: Date3 | null;
  quarter: { key: string; month: [number, number]; status: "active" | "done" | "failed" | "none" }[];
  down_risk: boolean;
  names_key: "home" | "academy";
}

export type ScoreItem = "craft" | "root" | "skill" | "rank" | "mission" | "exam" | "contest" | "people" | "deeds";

export interface ScoreView {
  items: Partial<Record<ScoreItem, number>>;
  total: number;
  band: Band;
  next_band_at: number | null;
  bands: Partial<Record<Exclude<Band, "ding">, number>>;
  detail?: {
    craft: { attr: string; from: number; to: number; score: number }[];
    root: { attr: string; from: number; to: number; score: number }[];
    skill_xp: number;
    exams: { exam: string; passed: boolean; honor: boolean }[];
    contests: { contest: string; year: number; rank: number; score: number }[];
    people: { person: string; from: number; to: number; score: number }[];
    deeds: { markers: number; resolved: number; voyages: number; duties: number; savings: number };
  };
}

export type CapitalKind = "cash" | "ship" | "crew" | "food" | "water" | "cargo" | "item" | "license" | "mate" | "ally" | "rumor" | "known_good";

export interface CapitalRowView {
  kind: CapitalKind;
  key: string;
  qty: number;
  value: number;
  /** common / grade:<档> / aspiration:<志向> / mate:<人> / ally:<人> / slot_cash:<mate|ally> / family_duty:<键> / rank:4 / ending:<键> / savings
   *  K3a：rumor:<卡>（每张有效的见闻卡，value = 一份行情通报的价）、known_good:<货>（认熟的货，value 0）；这两种不进资本与事迹分 */
  source: string;
  condition: number | null;
  /** U06F3 第三趟（可选，后端待给）：这一行的显示名（物品名、船名、人名） */
  name?: string | null;
}

export interface CapitalPreview {
  band: Band;
  aspiration: string | null;
  fulfilled: boolean;
  value: number;
  rows: CapitalRowView[];
  savings: { cash: number; given: number; kept: number; score: number };
  /** U06K2c：现在跳过养成会按哪一档结业 */
  skip_band?: Band | null;
  /** FIX5（后端合入前没有）：志向的显示名；没有时界面不写名字，绝不显示 aspiration 的键 */
  aspiration_name?: string | null;
  /** R10-FE4 / U06B4（后端在加）：家里在家乡的钱庄作的保；没有不画 */
  guarantee?: { amount: number; rate_pct: number } | null;
}

export interface ActSummaryK2 {
  mission: { key: string; status: "done" | "failed" | "active" } | null;
  review: { from: number; to: number } | null;
  ill: boolean;
  moment: { pick: MomentPick; ok: boolean | null } | null;
}

export interface ActView {
  enabled: true;
  stages: StageKey[];
  phase: ActPhase;
  week: { index: number; from: Date3; to: Date3; day: number; stage: "home" | "academy"; academy: string | null };
  stops: StopKey[];
  stop_targets: Partial<Record<StopKey, string[]>>;
  /** U06K3a3：与 stop_targets 同名数组逐项对应的显示名（现在只有 tier_open 的课程线），null = 数据里还没名字 */
  stop_target_names?: Partial<Record<StopKey, (string | null)[]>>;
  /** FIX6（可选，旧后端不给）：每条停因的分类；blocking = 要玩家拿主意（自动推进会停），false = 只提醒、照样开课 */
  stop_info?: { kind: StopKey; blocking: boolean; targets: string[] }[];
  /**
   * FIX6（可选）：自由日没能自动走下去的原因（“每月停 / 有事才停”下，后端不代办周末时给）。
   * step：模板里卡住的那一步（从 0 起，null = 不是某一步的事）；place：那一步的地点；reason_text：后端出好的一句。
   */
  free_stop?: {
    kind: string;
    step: number | null;
    targets: string[];
    place: string | null;
    reason: string;
    args?: unknown;
    reason_text?: string | null;
  } | null;
  lessons: {
    slots: LessonSlotView[];
    templates: { slot: number; lines: string[] | null }[];
    fee_week: number;
    fatigue_week_x10: number;
    /** 本周课表来自数据缺省 */
    defaults: boolean;
  };
  lines: LineView[];
  points: { left: number; max: number; base: number; bonus: { kind: "constitution" | "rank"; value: number }[] };
  /** 本周至今 */
  money: { cash: number; week_in: number; week_out: number };
  fatigue: { value: number; week_delta: number; projected: number; fail_at: number; ill_at: number; ill_chance_pct: number | null };
  mood: { value: number; week_delta: number };
  places: ActPlaceView[];
  markers: MarkerView[];
  calendar: ActCalendarMark[];
  /** name（U06K1b，可选）：礼物名 */
  gift_items: { item: string; qty: number; name?: string }[];
  free: {
    template: { place: string; kind: ActionKind; target: string | null }[];
    duty: string | null;
    auto_ok: boolean;
    /** reason_text（U06K1b，可选）：后端给的说明；没有时界面查 actText 的退路 */
    halt: { step: number; reason: string; reason_text?: string | null } | null;
    done: ActionRecordView[];
    /** FIX7：本周照模板做成了几件 */
    applied?: number;
    /** FIX7：本周照模板跳过的步与原因（做不了的那一步跳过、接着做后面的） */
    skipped?: FreeSkipView[];
  };
  family_duty: {
    /** FIX7：这周还做得了任何一项吗；做不了时整栏的原因（病中、出海、本周做过……） */
    enabled?: boolean;
    reason?: string | null;
    reason_text?: string | null;
    options: { key: string; progress: number; milestone: number; enabled?: boolean; reason?: string | null; reason_text?: string | null }[];
    done_this_week: boolean;
    /** U06K1b（可选）：本周做过家业时的收获，与 free.done[].result 同形 */
    last_result?: ActionRecordView["result"] | null;
  } | null;
  /** 只在 summary 阶段给 */
  summary: ActSummaryView | null;
  // K2：阶梯与总评开着时才有，否则 null
  moment: MomentView | null;
  mission: MissionView | null;
  rank: RankView | null;
  score: ScoreView | null;
  capital_preview: CapitalPreview | null;
  illness?: { until_week: number; weeks_left: number } | null;
  /** 打工晋级（按工种组） */
  jobs?: { group: string; points: number; level: number; next_at: number | null; next_gain: number | null }[];
  /** 只在 summary 阶段给 */
  summary_k2?: ActSummaryK2 | null;
  // K3a：潮汐（段关着、没有潮汐表、不在家乡时为 null）
  tide: TideView | null;
  /** K3a：见闻卡与识货簿（段关着为 null） */
  rumors?: RumorsView | null;
  /** K3a：这一家的全部人物（含还没见过的），等级、好感、各级好处、结业去向的预判 */
  people?: PersonLevelView[] | null;
  /** K3a：只在 summary 阶段给 */
  summary_k3?: ActSummaryK3 | null;
  /** K3b：在海上时这一程；不在海上为 null */
  voyage: VoyageView | null;
  /** K3b：这一家的各趟出海（段关着为空数组） */
  voyages?: VoyageOptionView[];
  /** U06K1b（可选）：行动的固定效果，带正负号；growth 单位是百分之一点。缺哪项界面用 actKit.K1_EFFECTS 的数 */
  effects?: {
    rest?: { fatigue?: number };
    pray?: { fatigue?: number; mood?: number; growth?: Record<string, number> };
    talk?: { affinity?: number; mood?: number };
    excursion?: { fatigue?: number };
  } | null;
  // 内容文字（门名、家业、寒暄句）不在这里：后端给在静态数据 `StaticView.upbringing_act_texts`（U06F2 核对 act.rs 的 texts()）。
}

// ── K3a（docs/tasks/R10-U06K3a.md 契约 5） ──

export interface TideView {
  /** 本周生效的潮键（可能几段同时） */
  this_week: string[];
  /** 本周合计：工种组 → 打工收入 +%（places[].jobs[].income 里已算进去） */
  jobs: Record<string, number>;
  /** 这段时间多在码头的人（在场已改过） */
  people: string[];
  /** 听消息每次多几张 */
  rumors: number;
  /** 去不了的远足节点 "<远足>:<节点>" */
  closed: string[];
  /** 家业键 → 失手的机会 % */
  duty_fail: Record<string, number>;
  /** 后 4 周各周生效的潮（week 是周序，与 week.index 同一套） */
  next: { week: number; kinds: string[] }[];
}

export type RumorKind = "demand" | "supply" | "pirates";

export interface RumorCardView {
  key: string;
  port: string;
  /** pirates 可为 null */
  good: string | null;
  kind: RumorKind;
  valid: [Date3, Date3];
  /** 拿到的周序 */
  week: number;
  expired: boolean;
  /** K3R1：这张卡的正文（后端已按当前语言、第二套文本、遮名处理好）；旧后端没有，界面回退静态表、再回退拼句 */
  text?: string;
}

export interface RumorsView {
  cards: RumorCardView[];
  /** U06K3a3：听一次给几张（已含潮多给的）、要几点行动 */
  per_listen?: number;
  cost?: number;
  /** 识货簿：这一家打工能摸到的货与已摸过的；seen 到 need 就认熟 */
  goods: { good: string; seen: number; need: number; known: boolean }[];
}

export type PerkKind = "rumor" | "job_partner" | "companion" | "teach" | "introduce";

export interface PersonLevelView {
  key: string;
  /** 0–4 */
  level: number;
  affinity: number;
  /** 下一级的好感线；4 级为 null */
  next_at: number | null;
  /** 每级的好处（数据 act_perks；kind 以后可能多，界面不认识的写泛称） */
  perks: { level: number; kind: PerkKind | string; line: string | null; flag: string | null; active: boolean; /** U06K3a3（可选）：这种好处的数值（合伙 30、同行 10），没有数值的种类为 null */ value?: number | null }[];
  /** U06K3a3（可选）：各级的好感线，从 1 级起 */
  levels?: number[];
  /** 照现在结业的去向：航海士 / 盟友 / 对手；家人、师长与没分类的为 null */
  class: "mate" | "ally" | "rival" | null;
}

export interface ActSummaryK3 {
  /** 本周拿到的见闻卡 */
  rumors: string[];
  /** 本周摸满（认熟）的货 */
  goods: string[];
  /** 本周升降级的人：[前, 后] */
  levels: Record<string, [number, number]>;
  /** 本周到了里程的家业 */
  duty_milestones: string[];
  /** U06K3a3：这一周做的家业与结果（act/state.rs DutySummary）；没做为 null */
  duty?: { key: string; success: boolean | null; cash: number; fame?: number | null; milestone?: boolean } | null;
  /** K3b：这一周走完的出海（只在归航那周） */
  voyage?: VoyageSummaryView | null;
}

// ── K3b 见习出海（docs/tasks/R10-U06K3b.md 契约 5） ──

export type GateGrade = "fail" | "ok" | "good";
/** FIX7：future = 报名期还没到（出发前 4 周起才能报） */
export type VoyageStatus = "locked" | "future" | "open" | "joined" | "sailing" | "done" | "missed";
/** 报名还缺的：身份、某人的等级、要先走过的那一趟、钱 */
export type VoyageMissing = "rank" | "person" | "after" | "cash";

export interface VoyageView {
  key: string;
  /** 第几程（0 起） */
  leg: number;
  legs: number;
  /** 这一程停靠的港（地点键） */
  port: string;
  weeks_left: number;
  /** 船课按哪门课、第几档（0 起） */
  line: string;
  tier: number;
  gate: { game: "race" | "identify"; attr: string; chance_pct: number };
  /** FIX7b（可选）：这一趟出不出海（回乡的 6a / 6b 为 false）；没给时界面按键认 */
  at_sea?: boolean;
}

export interface VoyageOptionView {
  key: string;
  start: Date3;
  weeks: number;
  fee: number;
  status: VoyageStatus;
  /** FIX7：现在是不是报名期（出发前 4 周之内、还没出发） */
  registration_open?: boolean;
  /** FIX7b（可选）：这一趟出不出海；没给时界面按键认 */
  at_sea?: boolean;
  missing: (VoyageMissing | string)[];
  grade: GateGrade | null;
}

export interface VoyageSummaryView {
  key: string;
  leg: number;
  legs: number;
  gate: GateGrade | null;
  merit: number;
}

// ── 命令（契约 4，只在 Command 枚举末尾追加） ──

export interface LessonPlanInput {
  line: string;
  tier: number;
  with?: string | null;
}

export type TemplateKind = "lessons" | "free";

export type ActActionInput =
  | { greet: { person: string } }
  | { talk: { person: string } }
  | { gift: { person: string; item: string } }
  | { job: { activity: string } }
  | { marker: { track: string } }
  | "rest"
  | "pray"
  | { self_study: { line: string; tier: number } }
  | { excursion: { excursion: string; node: string } }
  | "rumor";

type P<T> = T & { owner: "player" };

export type ActCommand =
  | { PlanLessons: P<{ slots: LessonPlanInput[] }> }
  | { SaveTemplate: P<{ slot: number; kind: TemplateKind }> }
  | { UseTemplate: P<{ slot: number; kind: TemplateKind }> }
  | { StartWeek: P<object> }
  | { DoAction: P<{ place: string; action: ActActionInput }> }
  | { EndFree: P<object> }
  | { FamilyDuty: P<{ duty: string }> }
  | { CloseWeek: P<object> }
  // K2（契约 4）
  | { AnswerMoment: P<{ pick: MomentPick }> }
  | { MasterTest: P<{ line: string; play: boolean }> }
  // K3b
  | { JoinVoyage: P<{ voyage: string }> };
