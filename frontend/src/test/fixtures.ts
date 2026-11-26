// 组件测试用的小型数据：两个港口、一个城市、三种商品、一个期货交易所。
// 殖民与探险：statics 本身不含殖民点与发现物（命令栏照旧，不出现“殖民地”“探险”）；
// colonialStatics / colonialOverview 在此基础上加一个殖民点、两种殖民地建筑、一件发现物与一个殖民地。
// 主角身世：statics 不含身世数据（开局向导只有剧本、外貌、姓名与启航）；captainStatics 带一份三问的身世数据 captainDefs
// （十二星座与旧版星宫同 data/captain.toml），captainStaticsEn 是英文界面下的同一份数据（星座用 Aries 等英文名）。
// V01 补给：v01Statics（粮水按人日累计、一份够 50 人一天）、v01Fleet（18 人，粮水各 2 份，够 3 天）与 v01Preview（这趟 5 天，各差 1 份）。
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type {
  BookView,
  CaptainDefsView,
  CaptainProfileView,
  ColoniesView,
  DiscoveriesView,
  FleetView,
  FuturesView,
  LocView,
  MateView,
  Overview,
  PortView,
  SiteView,
  TacticalView,
  ReportsView,
  SailPreview,
  SeriesView,
  SettingsView,
  StaticView,
  TradeQuote,
} from "../ipc/types";
import { useGame } from "../store/game";

export const statics: StaticView = {
  data_hash: "test",
  world: { currency: "金币", era: "航海历", start_year: 1502 },
  map: { width: 4, height: 3, rows: ["~~-#", "~--#", "~~~#"] },
  regions: [{ id: 0, name: "内海" }],
  locations: [
    { id: 0, key: "chenggang", name: "澄港", kind: "port", x: 1, y: 1, faction: 0, shipyard: true, founded: 1356, lore: "", site: null },
    { id: 1, key: "liuwan", name: "柳湾", kind: "port", x: 2, y: 2, faction: 1, shipyard: false, founded: null, lore: "", site: null },
    { id: 2, key: "lancheng", name: "兰城", kind: "city", x: 3, y: 1, faction: 0, shipyard: false, founded: null, lore: "", site: null },
  ],
  roads: [{ id: 0, from: 0, to: 2, terrain: "plain", length: 10, toll_bp: 200, security_bp: 8000, faction: 0 }],
  goods: [
    { id: 0, key: "grain", name: "谷物", category: "食品", tier: 0, base_price: 12, license: false, description: "" },
    { id: 1, key: "silk", name: "丝绸", category: "纺织", tier: 1, base_price: 90, license: false, description: "" },
    { id: 2, key: "cannon", name: "火炮", category: "军需", tier: 2, base_price: 400, license: true, description: "" },
  ],
  ships: [
    {
      id: 0,
      key: "swallow",
      name: "单桅帆船",
      description: "",
      sail: "lateen",
      speed: 20000,
      capacity: 80,
      durability: 60,
      crew_min: 8,
      crew_max: 20,
      guns: 2,
      price: 4000,
    },
  ],
  refits: [{ id: 0, name: "加固船体", price: 800, capacity: 0, durability: 20, guns: 0, speed: 0 }],
  factions: [
    { id: 0, key: "cuilan", name: "翠岚", license_price: 3000, marque_price: 8000, color: "#c0392b", style: null },
    { id: 1, key: "jinsui", name: "金穗", license_price: 3000, marque_price: 8000, color: "#2e86c1", style: null },
  ],
  companies: [{ id: 0, name: "海燕商会" }],
  animals: [{ id: 0, name: "骡", capacity: 20, speed: 10000, price: 300, upkeep: 3 }],
  industry_types: [
    { id: 0, name: "作坊", build_cost: 5000, workers: 10, wage: 2, maintenance: 5, manager_salary: 20 },
  ],
  recipes: [{ id: 0, name: "织丝", industry: 0, inputs: [[0, 2]], outputs: [[1, 1]] }],
  exchanges: [
    { id: 0, name: "澄港期货交易所", port: 0, initial_margin_bp: 1000, maintenance_margin_bp: 700, position_limit: 50 },
  ],
  scenarios: [
    {
      key: "newcomer",
      name: "新晋船主",
      description: "一艘小船，一点本钱。",
      start: 0,
      cash: 15000,
      ships: [0],
      crew: 14,
      mates: 1,
      goal: { kind: "net_worth", target: 300000, years: 10 },
    },
  ],
  rules: {
    crew_hire_cost: 10,
    crew_wage: 1,
    food_price: 2,
    water_price: 1,
    crew_per_supply_unit: 20,
    warehouse_rent_per_100: 5,
    warehouse_price_per_unit: 20,
    guard_wage: 4,
    guard_hire_cost: 30,
    invest_min: 1000,
    loan_max_months: 24,
    colony_min_settlers: 20,
    colony_found_cost: 6000,
    colony_found_materials: [[0, 60]],
    colony_tax_levels: [
      [0, 10],
      [50, 5],
      [100, 0],
      [150, -10],
      [200, -20],
    ],
    colony_max: 5,
  },
  colony_buildings: [],
  discoveries: [],
};

// ───────────────────────────── 主角身世（开局向导） ─────────────────────────────

type SignAttr = CaptainDefsView["signs"][number]["attribute"];

/** 现行的十二星座（与 data/captain.toml 相同的首日、末日与加点，顺序与后端一样从白羊座起；摩羯座跨年并带提灯的特性）。 */
const ZODIAC: [string, string, string, [number, number], [number, number], SignAttr][] = [
  ["aries", "白羊座", "Aries", [3, 21], [4, 19], "arms"],
  ["taurus", "金牛座", "Taurus", [4, 20], [5, 20], "commerce"],
  ["gemini", "双子座", "Gemini", [5, 21], [6, 21], "eloquence"],
  ["cancer", "巨蟹座", "Cancer", [6, 22], [7, 22], "stewardship"],
  ["leo", "狮子座", "Leo", [7, 23], [8, 22], "eloquence"],
  ["virgo", "处女座", "Virgo", [8, 23], [9, 22], "numeracy"],
  ["libra", "天秤座", "Libra", [9, 23], [10, 23], "commerce"],
  ["scorpio", "天蝎座", "Scorpio", [10, 24], [11, 22], "arms"],
  ["sagittarius", "射手座", "Sagittarius", [11, 23], [12, 21], "seamanship"],
  ["capricorn", "摩羯座", "Capricorn", [12, 22], [1, 19], "stewardship"],
  ["aquarius", "水瓶座", "Aquarius", [1, 20], [2, 18], "numeracy"],
  ["pisces", "双鱼座", "Pisces", [2, 19], [3, 20], "seamanship"],
];

/** 旧版星宫（早先按月份判定，只为旧存档保留名字与特性，不参与按生日判定；提灯座带特性）。 */
const LEGACY_SIGNS: [string, string, string, SignAttr][] = [
  ["petrel", "海燕座", "The Petrel", "eloquence"],
  ["quill", "羽笔座", "The Quill", "numeracy"],
  ["anchor", "铁锚座", "The Anchor", "stewardship"],
  ["compass", "罗盘座", "The Compass", "seamanship"],
  ["purse", "钱袋座", "The Purse", "commerce"],
  ["cutlass", "弯刀座", "The Cutlass", "arms"],
  ["astrolabe", "星盘座", "The Astrolabe", "numeracy"],
  ["merchantman", "商船座", "The Merchantman", "commerce"],
  ["hive", "蜂巢座", "The Hive", "stewardship"],
  ["horn", "号角座", "The Horn", "arms"],
  ["lighthouse", "灯塔座", "The Lighthouse", "seamanship"],
  ["lantern", "提灯座", "The Lantern", "eloquence"],
];

/** 后端给的星座表：现行的十二星座在前，旧版星宫在后（名字按语言）。 */
function signTable(lang: "zh" | "en"): CaptainDefsView["signs"] {
  return [
    ...ZODIAC.map(([key, zh, en, start, end, attribute]) => ({
      key,
      name: lang === "zh" ? zh : en,
      desc: lang === "zh" ? `${zh}的说明。` : `About ${en}.`,
      attribute,
      start,
      end,
      legacy: false,
    })),
    ...LEGACY_SIGNS.map(([key, zh, en, attribute]) => ({
      key,
      name: lang === "zh" ? zh : en,
      desc: lang === "zh" ? `${zh}的说明。` : `About ${en}.`,
      attribute,
      start: null,
      end: null,
      legacy: true,
    })),
  ];
}

/** 三问的身世数据：点数规则与 data/captain.toml 一致（开局年龄 16–45 岁，向导里缺省 18 岁）。 */
export const captainDefs: CaptainDefsView = {
  points: {
    base: 1,
    free: 5,
    creation_cap: 7,
    max: 10,
    genius_numeracy: 7,
    manual_numeracy: 4,
    learn_numeracy: 5,
    learn_days: 360,
    age_min: 16,
    age_max: 45,
    age_default: 18,
    birthday_morale: 5,
  },
  attributes: [
    { key: "seamanship", name: "航海", desc: "旗舰的航速。" },
    { key: "commerce", name: "交易", desc: "交易税的折扣。" },
    { key: "arms", name: "武艺", desc: "旗舰的海战。" },
    { key: "stewardship", name: "管理", desc: "工资的折扣。" },
    { key: "numeracy", name: "算学", desc: "行情窗口。" },
    { key: "eloquence", name: "口才", desc: "议价与招募。" },
  ],
  signs: signTable("zh"),
  questions: [
    {
      key: "family",
      title: "你的家世",
      prompt: "你出生在什么样的人家？",
      options: [
        { key: "merchant_house", name: "港口商人之家", text: "你生在商行的后院。", attrs: [["commerce", 2]], effect: { kind: "cash_pct", value: 10 } },
        { key: "lighthouse_scribes", name: "灯塔修道院的抄写员", text: "你在修道院里长大。", attrs: [["numeracy", 2]], effect: { kind: "chart", region: 0 } },
      ],
    },
    {
      key: "youth",
      title: "你的少年",
      prompt: "十几岁时，你在哪里学本事？",
      options: [
        { key: "university", name: "在大学学算学与天文", text: "你在讲堂里学几何。", attrs: [["numeracy", 2]], effect: null },
        {
          key: "naval_cadet",
          name: "海军见习生",
          text: "你穿上见习生的蓝外套。",
          attrs: [
            ["arms", 1],
            ["seamanship", 1],
          ],
          effect: null,
        },
      ],
    },
    {
      key: "motive",
      title: "出海的理由",
      prompt: "是什么让你出海经商？",
      options: [
        { key: "family_debt", name: "还清家族的债务", text: "你以家族的名义又借了一笔。", attrs: [["stewardship", 1]], effect: { kind: "loan", amount: 8000, months: 12 } },
        { key: "new_world", name: "去新大陆看看", text: "你想亲眼看看新世界。", attrs: [["seamanship", 1]], effect: { kind: "goods", good: 1, qty: 5 } },
      ],
    },
  ],
};

export const captainStatics: StaticView = { ...statics, captain: captainDefs };

/** 英文界面下后端给的身世数据：只把星座换成英文名（Aries…；旧版星宫 The Lantern…），其余与 captainDefs 相同。 */
export const captainStaticsEn: StaticView = { ...statics, captain: { ...captainDefs, signs: signTable("en") } };

/** 已立下身世的主角档案（2 月 12 日生，水瓶座；算学 7、会一种奇才之法）。 */
export const captainProfile: CaptainProfileView = {
  birthday: { year: 1480, month: 2, day: 12 },
  sign: "aquarius",
  sign_name: "水瓶座",
  answers: ["lighthouse_scribes", "university", "new_world"],
  attrs: [
    ["seamanship", 2],
    ["commerce", 1],
    ["arms", 1],
    ["stewardship", 1],
    ["numeracy", 7],
    ["eloquence", 3],
  ],
  methods: ["ar1"],
  created: 0,
};

export const overview: Overview = {
  day: 12,
  year: 1,
  month: 1,
  date: 13,
  season: 0,
  scenario: "新晋船主",
  cash: 12345,
  deposit: 0,
  loans: 0,
  net_worth: 20000,
  total_assets: 21000,
  speed: 0,
  ai_mode: "offline",
  budget: { month: 0, calls_used: 3, calls_limit: 60, tokens_used: 1200, tokens_limit: 200000 },
  fleets: [
    {
      id: 0,
      docked: 0,
      dest: null,
      x: 1,
      y: 1,
      path: [],
      days_at_sea: 0,
      ships: [{ kind: 0, durability: 60, max_durability: 60, capacity: 80, guns: 2, refits: [], resale: 2400 }],
      crew: 12,
      crew_min: 8,
      crew_max: 20,
      morale: 80,
      food: 10,
      water: 10,
      daily_need: 1,
      capacity: 80,
      used: 20,
      cargo: [],
      repair_cost: 0,
    },
  ],
  caravans: [],
  others: [{ owner: "海燕商会", x: 2, y: 1 }],
  winds: [{ region: 0, x: 1, y: 1, dir: 2, strength: 2 }],
  notices: [],
  reorganizations: 0,
  pending_battles: [],
  tactical_battles: [],
  pirates: [[3, 2]],
  fog_version: 100,
  goal: { kind: "net_worth", current: 20000, target: 300000, deadline: 3600 },
  outcome: null,
  calendar_year: 1502,
  fame: 0,
  colonies: [],
  discoveries_unreported: 0,
  site_claims: [],
};

// ── V01 补给（寰宇的粮水按船员人日累计；数值同 copy-needed-v01.json 的例子） ──

/** 累计规则：一份粮或水够 50 人一天（food_price 2、water_price 1 照 statics）。 */
export const v01Statics: StaticView = { ...statics, rules: { ...statics.rules, crew_per_supply_unit: 50, fractional_supplies: true } };

/**
 * 18 人，粮水各 2 份，打开的那份已吃掉 40 人日（各 60 人日）：够 3 天（按旧算法“每天各需 1”只算得出 2 天）；
 * 每天各用 0.36 份；够 10 天要各有 5 份、够 30 天各 12 份。舱位 80，已用 20。
 */
export const v01Fleet: FleetView = {
  ...overview.fleets[0],
  crew: 18,
  food: 2,
  water: 2,
  daily_need: 1,
  daily_need_milli: 360,
  supplies_days: 3,
  supplies_for_10_days: 5,
  supplies_for_30_days: 12,
};

/** 这趟 5 天：本身要各 3 份、各差 1 份；含余量的建议是各 4 份。 */
export const v01Preview: SailPreview = {
  days: 5,
  path: [
    [1, 1],
    [2, 1],
    [2, 2],
  ],
  supplies: 4,
  supplies_days: 3,
  required: { food: 3, water: 3 },
  shortfall: { food: 1, water: 1 },
};

// ── 殖民与探险 ──

/** 殖民点“银雾河口”（地点 3）：森林，产木料与谷物。 */
export const siteLoc: LocView = {
  id: 3,
  key: "silvermist_mouth",
  name: "银雾河口",
  kind: "site",
  x: 2,
  y: 0,
  faction: 0,
  shipyard: false,
  founded: null,
  lore: "河口终年笼着银色的雾，第一批殖民者曾在此熬过热病之冬。",
  site: { terrain: "forest", fertility: 60, hazard: 30, resources: [[0, 70]] },
};

/** 带殖民点、殖民地建筑与发现物的静态数据。 */
export const colonialStatics: StaticView = {
  ...statics,
  locations: [...statics.locations, siteLoc],
  colony_buildings: [
    {
      id: 0,
      key: "farm",
      name: "农庄",
      kind: "food",
      cost: 1500,
      materials: [[0, 20]],
      build_days: 20,
      workers: 25,
      upkeep: 40,
      max_level: 3,
      goods: [0],
      output: 12,
      inputs: [],
      outputs: [],
      capacity: 0,
      defense: 0,
      morale: 0,
      housing: 0,
      description: "开垦河岸的沃土，种下谷物。",
    },
    {
      id: 1,
      key: "fort",
      name: "栅栏堡",
      kind: "defense",
      cost: 2500,
      materials: [[0, 30]],
      build_days: 30,
      workers: 15,
      upkeep: 60,
      max_level: 2,
      goods: [],
      output: 0,
      inputs: [],
      outputs: [],
      capacity: 0,
      defense: 20,
      morale: 0,
      housing: 0,
      description: "削尖的原木围成一圈，防备海盗夜袭。",
    },
  ],
  discoveries: [
    {
      id: 0,
      key: "sunken_arcan_gate",
      name: "沉没的阿尔坎之门",
      kind: "ruins",
      fame: 30,
      value: 4000,
      lore: "退潮时，古帝国的石门从海面下露出拱顶。",
    },
  ],
};

/** 有一个殖民地、一件未报告发现的概览。 */
export const colonialOverview: Overview = {
  ...overview,
  fame: 45,
  colonies: [
    { id: 0, name: "新晨港", loc: 3, population: 120, morale: 62, starving_days: 0, food_days: 40, construction: [0, 1, 30] },
  ],
  discoveries_unreported: 1,
  site_claims: [{ loc: 3, faction: null, colony: 0, mine: true }],
};

/** 殖民地详情（api.colonies()）。 */
export const coloniesView: ColoniesView = {
  slots_left: 4,
  colonies: [
    {
      id: 0,
      name: "新晨港",
      loc: 3,
      founded: 2,
      population: 120,
      housing: 150,
      morale: 62,
      starving_days: 0,
      food_stock: 144,
      food_need: 4,
      food_days: 36,
      stock: [{ good: 0, qty: 144, avg_cost: 12 }],
      capacity: 400,
      used: 144,
      buildings: [[0, 1]],
      construction: { building: 1, level: 1, start_day: 10, done_day: 40 },
      workers_needed: 25,
      staffing_bp: 10000,
      morale_mult_bp: 10000,
      estimates: [{ building: 0, inputs: [], outputs: [[0, 72000]] }],
      tax: 1,
      tax_estimate: 72,
      upkeep: 40,
      defense: 0,
      raid_bp: 12,
      last_raid: null,
      dock: false,
      book_value: 7500,
      last_month: { produced: [[0, 210]], food_eaten: 108, births: 2, immigrants: 3, deaths: 0, tax: 60, upkeep: 40, satisfaction_bp: 8000, raids: 0 },
      build_options: [
        { building: 0, level: 1, cost: 1500, materials: [[0, 20]], missing: [], build_days: 20, ok: false, reason: "已有工程在建", produces: [0, 42] },
        { building: 1, level: 0, cost: 2500, materials: [[0, 30]], missing: [], build_days: 30, ok: false, reason: "已有工程在建", produces: null },
      ],
      fleets_here: [0],
    },
  ],
};

/** 殖民点详情（api.site(3)）。 */
export const siteView: SiteView = {
  loc: 3,
  info: { terrain: "forest", fertility: 60, hazard: 30, resources: [[0, 70]] },
  lore: siteLoc.lore ?? "",
  known: true,
  claim: null,
  can_found: true,
  reason: null,
  found_cost: 6000,
  found_materials: [[0, 60]],
  min_settlers: 20,
  fleets_here: [[0, null]],
  producible: [[0, 0, 42]],
  colony: null,
};

/** 探险记录（api.discoveries()）。 */
export const discoveriesView: DiscoveriesView = {
  fame: 45,
  found: [{ id: 0, day: 8, reported: false, x: 2, y: 0 }],
  total: 1,
  mate_fame: [
    [4, 20],
    [5, 60],
  ],
  report_at: [0],
};

export const mate: MateView = {
  id: 1,
  name: "周明远",
  bio: "前任钱庄账房。",
  level: 2,
  xp: 5,
  navigation: 18,
  trade: 58,
  combat: 12,
  management: 66,
  salary: 500,
  hire_cost: 1500,
  loyalty: 65,
  at: 0,
  hired: false,
  role: { kind: "none", target: null },
};

export const port: PortView = {
  loc: 0,
  known: true,
  mates_here: [mate],
  charts: [
    { region: 0, price: 800, owned: true },
    { region: 1, price: 900, owned: false },
  ],
  tax_bp: 500,
  market: [
    {
      good: 0,
      price: 11,
      base_price: 12,
      stock: 900,
      target: 1000,
      specialty: true,
      popular: false,
      history: [12, 12, 11],
      held: 0,
      avg_cost: 0,
    },
    {
      good: 1,
      price: 95,
      base_price: 90,
      stock: 100,
      target: 120,
      specialty: false,
      popular: true,
      history: [90, 93, 95],
      held: 0,
      avg_cost: 0,
    },
  ],
  shipyard: [0],
  fleets_here: [0],
  caravans_here: [],
  warehouse: { rented: 0, owned: 0, capacity: 0, used: 0, stock: [] },
  invest: { development: 50, mine: 0, share_bp: 0, ally: null, ally_is_me: false },
  office: { faction: 0, reputation: 3, license: false, marque: false, at_war: false, relations: [] },
  bank: {
    deposit: 0,
    loans: [],
    credit_score: 60,
    grade: "BBB",
    defaults: 0,
    limit: 10000,
    rate_bp: 900,
    deposit_rate_bp: 200,
  },
  contracts: [],
  bargain: null,
  dialogs: [],
  exchange: 0,
  industries_here: [],
};

export function quoteFor(side: "Buy" | "Sell", qty: number): TradeQuote {
  const avg = side === "Buy" ? 12 : 10;
  const gross = avg * qty;
  const tax = Math.round(gross * 0.05);
  return {
    loc: 0,
    good: 0,
    side,
    qty,
    gross,
    tax,
    tax_rate: 500,
    total: side === "Buy" ? gross + tax : gross - tax,
    avg_price: avg,
    price_before: 11,
    price_after: side === "Buy" ? 13 : 9,
    stock_after: 890,
  };
}

export const futures: FuturesView = {
  accounts: [{ exchange: 0, balance: 5000, initial_requirement: 900, maintenance_requirement: 630, call_since: 11 }],
  contracts: [
    {
      id: 7,
      exchange: 0,
      good: 1,
      lot: 10,
      delivery: 0,
      expiry_day: 60,
      days_left: 48,
      bid: 94,
      ask: 97,
      fair: 95,
      mark: 95,
      spot: 95,
      position: { lots: 2, avg_price: 90, physical: false, pnl: 100 },
    },
  ],
};

const bs = {
  assets: [
    ["Cash", 12345],
    ["Ships", 4000],
  ] as [string, number][],
  liabilities: [] as [string, number][],
  equity: [["Capital", 15000]] as [string, number][],
  current_earnings: 1345,
  total_assets: 16345,
  total_liabilities: 0,
  total_equity: 16345,
};

export const reports: ReportsView = {
  monthly: [
    {
      kind: "Month",
      index: 0,
      start_day: 0,
      end_day: 30,
      balance_sheet: bs,
      income: {
        revenues: [["Sales", 3000]],
        expenses: [
          ["CostOfGoods", 1500],
          ["Wages", 155],
        ],
        total_revenue: 3000,
        total_expense: 1655,
        net_income: 1345,
      },
      cash_flow: {
        operating: 1345,
        investing: 0,
        financing: 0,
        net_change: 1345,
        opening_cash: 11000,
        closing_cash: 12345,
      },
    },
  ],
  yearly: [],
  current: bs,
  trend: [
    { day: 30, total_assets: 16000, equity: 15500 },
    { day: 42, total_assets: 16345, equity: 16345 },
  ],
};

export const settingsView: SettingsView = {
  settings: {
    ai: {
      mode: "Offline",
      provider: "Anthropic",
      base_url: "https://api.anthropic.com",
      models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
      tier: "Balanced",
      monthly_calls: 60,
      monthly_tokens: 200000,
      timeout_secs: 60,
      jev_enabled: false,
      jev_url: "http://127.0.0.1:7700",
      jev_timeout_ms: 1500,
      jev_min_score: 0.5,
    },
    speed: 1,
    autosave_days: 30,
    dev_mode: false,
  },
  keys: [
    ["Anthropic", false],
    ["OpenAiCompatible", false],
  ],
  jev_available: false,
};

export const mates = {
  hired: [
    { ...mate, id: 0, name: "林海燕", hired: true, role: { kind: "captain" as const, target: 0 } },
  ],
  available: [mate],
};

export const tactical: TacticalView = {
  battle: {
    id: 4,
    fleet: 0,
    pirate: 2,
    started: 12,
    turn: 1,
    wind: 0,
    radius: 3,
    units: [
      { id: 0, player: true, ship: 0, kind: 0, q: -2, r: 0, facing: 0, hp: 60, max_hp: 60, crew: 12, guns: 2, mp: 4, mp_left: 4, fired: false, boarded: false, status: "Active" },
      { id: 1, player: false, ship: 0, kind: 0, q: 0, r: -1, facing: 3, hp: 40, max_hp: 60, crew: 10, guns: 2, mp: 4, mp_left: 4, fired: false, boarded: false, status: "Active" },
      { id: 2, player: false, ship: 0, kind: 0, q: 2, r: 0, facing: 3, hp: 0, max_hp: 60, crew: 0, guns: 2, mp: 4, mp_left: 4, fired: false, boarded: false, status: "Sunk" },
    ],
    log: [[1, { Fire: { from: 1, to: 0, damage: 5 } }]],
  },
  gun_range: 3,
  max_turns: 30,
  options: [{ unit: 0, moves: [[-1, 0, 1], [-1, -1, 2]], fire: [1], board: [] }],
};

/** 与 data/rules.toml 相同的价格曲线（万分之一）。 */
export const PRICE_CURVE: [number, number][] = [
  [0, 50000],
  [1000, 40000],
  [2500, 28000],
  [5000, 17500],
  [7500, 13000],
  [10000, 10000],
  [12500, 8200],
  [15000, 7000],
  [20000, 5200],
  [30000, 3600],
  [40000, 2800],
  [60000, 2000],
];

/** 行商的老法子（人人会）。 */
export const COMMON = ["naive", "ma", "drift", "seasonal", "fair", "astrology"];

/** 某港某商品的行情序列：60 天围绕基准价起伏的收盘价（确定性）。 */
export function seriesFor(loc: number, good: number, over: Partial<SeriesView> = {}): SeriesView {
  const base = statics.goods[good]?.base_price ?? 10;
  const daily = Array.from({ length: 60 }, (_, i) => Math.round(base * (1 + 0.08 * Math.sin(i / 3) + 0.03 * Math.cos(i * 1.7))));
  return {
    loc,
    good,
    today: 60,
    last_close: 59,
    daily,
    monthly: [base, base],
    monthly_last: 59,
    base_price: base,
    floor: Math.max(1, Math.round(base * 0.2)),
    cap: base * 5,
    price: daily[59],
    stock: 300,
    target: 300,
    popular_until: null,
    events: [],
    curve: PRICE_CURVE,
    popular_bonus_bp: 5000,
    methods: COMMON,
    ...over,
  };
}

/** 空的预测簿：开局港口（0）交易谷物与丝绸，没有算学奇才。 */
export const emptyBook: BookView = {
  today: 60,
  last_close: 59,
  max_active: 12,
  active: 0,
  entries: [],
  methods: COMMON,
  geniuses: [],
  places: [{ loc: 0, goods: [0, 1] }],
};

/** 安装模拟的 Tauri IPC；返回记录每次调用的函数。 */
export function installIpc(overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls = vi.fn<(cmd: string, args: Record<string, unknown>) => void>();
  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    calls(cmd, args);
    if (overrides[cmd]) return overrides[cmd](args);
    switch (cmd) {
      case "static_data":
        return statics;
      case "overview":
      case "new_game":
      case "load_game":
      case "set_speed":
      case "step":
        return overview;
      case "port":
        return port;
      case "quote": {
        const req = args.request as { side: string; qty: number };
        return quoteFor(req.side === "buy" ? "Buy" : "Sell", req.qty);
      }
      case "submit":
        return { outcome: "Done", overview };
      case "futures":
        return futures;
      case "reports":
        return reports;
      case "get_settings":
      case "save_settings":
      case "set_api_key":
      case "clear_api_key":
        return settingsView;
      case "mates":
        return mates;
      case "battle":
        return tactical;
      case "fog":
        return statics.map.rows.map((row) => "1".repeat(row.length));
      case "industries":
        return { industries: [], sites: [] };
      case "intel":
        return { news: [], events: [], log: [], chronicles: [], composed: [] };
      case "colonies":
        return coloniesView;
      case "site":
        return siteView;
      case "discoveries":
        return discoveriesView;
      case "list_saves":
        return [];
      case "set_captain":
        // 设置主角：返回带主角的概览
        return { ...overview, captain: args.captain };
      case "market_series":
        return seriesFor(args.loc as number, args.good as number);
      case "forecast_book":
      case "pin_forecast":
      case "remove_forecast":
        return emptyBook;
      default:
        return null;
    }
  }, { shouldMockEvents: true });
  return calls;
}

/** 把全局状态重置为“已开局”。 */
export function startedGame() {
  useGame.setState({
    statics,
    overview,
    version: 1,
    tab: "port",
    selectedLoc: 0,
    selectedFleet: 0,
    message: null,
    error: null,
    devMode: false,
    stage: "town",
    facility: "market",
  });
}
