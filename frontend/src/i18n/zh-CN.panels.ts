// 界面字符串（zh-CN）：舰队、航海士、海战、商队、产业、报表、情报等面板的新增文字。
// 键名加模块前缀（如 `panels.xxx` 或驼峰 `panelsXxx`），避免与其他模块重复。
// 本模块统一用 `pn` 前缀。
export const panels = {
  // 舰队
  pnCaptainLead: "船长 {name} 亲率",
  pnCaptainLeadDefault: "船主亲率",
  pnCaptainDefaultName: "船主",
  pnCaptainPortrait: "船长 {name} 的头像",
  pnFlagship: "旗舰队",
  pnFleetTitle: "舰队 #{id}",
  pnFleetShips: "舰队 #{id} 的船只：{ships}",
  pnMateCaptain: "舰长 {name}",
  pnMatePortrait: "航海士 {name} 的头像",
  pnShipDurability: "耐久 {v}/{max}",
  pnShipGuns: "火炮 {v}",
  pnShipCapacity: "载货 {v}",
  pnShipDamaged: "受损",
  pnStatCargo: "货舱",
  pnStatFood: "粮食",
  pnStatWater: "淡水",
  pnStatMorale: "士气",
  pnStatCrew: "船员",
  pnFoodLine: "粮 {v}（约 {days} 天）",
  pnWaterLine: "水 {v}（约 {days} 天）",
  pnDailyNeed: "每日各需 {need}",
  pnCargoTitle: "货舱清单",
  pnCargoEmpty: "货舱空空如也",
  pnCargoLine: "{name} × {qty}",
  pnCargoCost: "{label} {cost}",

  // 航海士
  pnAbilityNav: "航海",
  pnAbilityTrade: "交易",
  pnAbilityCombat: "战斗",
  pnAbilityMgmt: "管理",
  pnLevelBadge: "Lv{level}",
  pnHireCost: "雇金 {cost}",
  // 高等级航海士的名声门槛（rules.toml [discovery]）
  pnFameNeed: "需名声 {fame}",
  pnFameShort: "名声不足：需要 {need}，现有 {fame}。到港口商会报告探险发现可以提升名声。",

  // 海战
  pnPirateLeader: "海盗头目 {name}",
  pnPirateShip: "海盗船",

  // 商队
  pnAnimalInfo: "每头载 {cap} · 每日开销 {upkeep} {cur}",
  pnCaravanLoad: "驮载 {used}/{capacity}",

  // 产业
  pnRecipeArrow: "→",

  // 期货
  pnBoardTitle: "行情板",

  // 情报：日期（纪年）
  pnDate: "{day:date}",

  // 情报：组合事件卡片（标题、叙事、逐条效果、来源、进行中 / 已结束）
  pnCeTitle: "大事记",
  pnCeNone: "近来海上风平浪静，没有值得记下的大事。",
  pnCeSpan: "{start:date} – {end:date}",
  pnCeNarrative: "“{text}”",
  pnCeEffects: "{title} 的效果",
  "pnCeSource.ai": "AI 生成",
  "pnCeSource.template": "离线模板",
  pnCeActive: "进行中",
  pnCeEnded: "已结束",
  pnCeEndsOn: "至 {end:date}",
  // 效果的格式化：对象 · 方向与幅度 · 持续
  pnCeSep: " · ",
  pnCePair: "{a} ↔ {b}",
  pnCeWorld: "各地",
  pnCeMult: "{hint} {sign}{pct}%",
  pnCeDelta: "{hint} {sign}{v}",
  pnCeDays: "持续 {days} 天",
  pnCeOnce: "一次性",
  pnCePlus: "+",
  pnCeMinus: "−",
  // 殖民扩展的效果对象：殖民地（殖民点）、全部建筑、殖民点易主、发现物传闻
  pnCeColony: "{colony}（{site}）",
  pnCeAllBuildings: "全部建筑",
  pnCeClaim: "{site} → {faction}",
  pnCeRumor: "「{discovery}」据传在{region}一带",
  pnCeRumorNoRegion: "「{discovery}」",

  // 设置：画面（昼夜光影，EXPANSION.md §9.3）
  pnStDisplay: "画面",
  pnStDaylight: "昼夜光影",
  pnStDaylightClock: "跟随时间",
  pnStDaylightDay: "始终白天",
  pnStDaylightHelp:
    "跟随时间：街景、航海图与航行小画面按黎明、白天、黄昏、夜晚调色，夜里窗户与街灯亮起；4× 及以上速度时画面固定为白天，避免闪烁。始终白天：画面一直是白天，时钟照走。立即生效，只保存在本机。",
  // 设置：画面——界面风格（docs/UI-REDESIGN.md）：海图室（缺省）/ 经典像素（改版前的界面）
  pnStUiSkin: "界面风格",
  pnStUiSkinChart: "海图室（缺省）",
  pnStUiSkinClassic: "经典像素",
  pnStUiSkinHelp:
    "海图室：深色的外壳、纸色的内容，字与按钮更大，手机上也顺手。经典像素：改版前的木纹像素界面。只改外观，玩法与存档不变；立即生效，只保存在本机。",

  // 设置：结构化输出与组合事件说明
  pnStStructured: "结构化输出（工具调用 / JSON Schema）",
  pnStStructuredHelp:
    "开启后，模型必须按内核从效果词表生成的 JSON Schema 作答：Anthropic 用工具调用（强制调用 propose_event），OpenAI 兼容接口用 response_format 的 json_schema（strict）。所用服务不支持时请关闭，改为文本输出加修复解析。",
  pnStComposed: "AI 组合事件",
  pnStComposedIntro:
    "格式由结构约束，内容由模型决定：模型从效果词表中挑 1–3 条效果，配上标题与叙事，组合成一件事。提案先经规则裁决器（或 Jev）裁决，再由内核按 data/effects.toml 的边界校验，通过后才写入命令日志、在模拟中执行——模型从不直接改动世界。没有在线模型时，由离线模板确定性地生成。",
  pnStHowTo: "如何接入在线模型",
  pnStStep1: "在“模型提供商”选择 Anthropic 或 OpenAI 兼容接口，必要时修改接口地址。",
  pnStStep2: "粘贴 API 密钥并点“保存密钥”：密钥只存入系统凭据管理器，不写入设置文件、存档或日志。",
  pnStStep3: "选择模型档位（快速 / 均衡 / 高质量），并填好各档位的模型名。",
  pnStStep4: "把“AI 模式”改为“在线模型”，设好每月调用与 token 上限，保存设置。",
  pnStVocab: "效果词表",
  pnStVocabGoods: "商品：某种商品在各地的产量、需求",
  pnStVocabLocal: "当地：某地某商品的产量与需求、一时流行、全部商品的生产与消费",
  pnStVocabSea: "海区：风暴、海盗",
  pnStVocabFaction: "势力：两国关系、关税、港口发展",
  pnStVocabWorld: "全局：银行利率、工坊效率",
  pnStVocabNote:
    "每种效果的系数、天数与变化量都有上下限；另有每件事的效果条数、冷却天数、每年上限与总强度预算。词表与边界都写在数据文件里，改动无需改代码。",
  // 第九批（C11）：船名旁“传说之船”的小签
  "legend.shipTag": "传说之船",
  "legend.shipTagTitle": "有名字、有来历的船；它的故事记在“秘闻 · 传说之船”里",
} as const;
