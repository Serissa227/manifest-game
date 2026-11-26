// 界面字符串（en）：舰队、航海士、海战、商队、产业、报表、情报、设置等面板的新增文字。与 zh-CN.panels.ts 的键一一对应。
// 术语：舰队 / 旗舰 Fleet / Flagship、船员 Crew、士气 Morale、航海士 Mate、组合事件 Composed event、昼夜光影 Day–night lighting。
import type { Translation } from "./translation";
import type { panels as zh } from "./zh-CN.panels";

export const panels: Translation<typeof zh> = {
  // 舰队
  pnCaptainLead: "Led by Captain {name}",
  pnCaptainLeadDefault: "Led by the owner",
  pnCaptainDefaultName: "Owner",
  pnCaptainPortrait: "Portrait of Captain {name}",
  pnFlagship: "Flagship fleet",
  pnFleetTitle: "Fleet #{id}",
  pnFleetShips: "Ships of fleet #{id}: {ships}",
  pnMateCaptain: "Commander {name}",
  pnMatePortrait: "Portrait of mate {name}",
  pnShipDurability: "Hull {v}/{max}",
  pnShipGuns: "Guns {v}",
  pnShipCapacity: "Cargo {v}",
  pnShipDamaged: "Damaged",
  pnStatCargo: "Hold",
  pnStatFood: "Food",
  pnStatWater: "Water",
  pnStatMorale: "Morale",
  pnStatCrew: "Crew",
  pnFoodLine: "Food {v} (~{days:plural(day,days)})",
  pnWaterLine: "Water {v} (~{days:plural(day,days)})",
  pnDailyNeed: "{need} of each per day",
  pnCargoTitle: "Cargo manifest",
  pnCargoEmpty: "The hold is empty",
  pnCargoLine: "{name} × {qty}",
  pnCargoCost: "{label} {cost}",

  // 航海士
  pnAbilityNav: "Nav",
  pnAbilityTrade: "Trade",
  pnAbilityCombat: "Combat",
  pnAbilityMgmt: "Mgmt",
  pnLevelBadge: "Lv {level}",
  pnHireCost: "Fee {cost}",
  pnFameNeed: "Needs fame {fame}",
  pnFameShort: "Not enough fame: {need} needed, you have {fame}. Report discoveries at a port's guild to raise your fame.",

  // 海战
  pnPirateLeader: "Pirate chief {name}",
  pnPirateShip: "Pirate ship",

  // 商队
  pnAnimalInfo: "Carries {cap} each · upkeep {upkeep} {cur}/day",
  pnCaravanLoad: "Load {used}/{capacity}",

  // 产业
  pnRecipeArrow: "→",

  // 期货
  pnBoardTitle: "Price board",

  // 情报：日期（纪年）
  pnDate: "{day:date}",

  // 情报：组合事件卡片
  pnCeTitle: "Events of note",
  pnCeNone: "The seas have been quiet lately; nothing worth recording.",
  pnCeSpan: "{start:date} – {end:date}",
  pnCeNarrative: "“{text}”",
  pnCeEffects: "Effects of {title}",
  "pnCeSource.ai": "AI-written",
  "pnCeSource.template": "Offline template",
  pnCeActive: "Ongoing",
  pnCeEnded: "Ended",
  pnCeEndsOn: "Until {end:date}",
  // 效果的格式化
  pnCeSep: " · ",
  pnCePair: "{a} ↔ {b}",
  pnCeWorld: "Everywhere",
  pnCeMult: "{hint} {sign}{pct}%",
  pnCeDelta: "{hint} {sign}{v}",
  pnCeDays: "{days:plural(day,days)}",
  pnCeOnce: "One-off",
  pnCePlus: "+",
  pnCeMinus: "−",
  // 殖民扩展的效果对象
  pnCeColony: "{colony} ({site})",
  pnCeAllBuildings: "All buildings",
  pnCeClaim: "{site} → {faction}",
  pnCeRumor: "“{discovery}”, said to lie in the {region}",
  pnCeRumorNoRegion: "“{discovery}”",

  // 设置：画面（昼夜光影）
  pnStDisplay: "Display",
  pnStDaylight: "Day–night lighting",
  pnStDaylightClock: "Follow the clock",
  pnStDaylightDay: "Always day",
  pnStDaylightHelp:
    "Follow the clock: the port view, sea chart and voyage scene are tinted for dawn, day, dusk and night, and windows and street lamps light up after dark; at 4× and faster the view stays in daylight to avoid flicker. Always day: the view stays in daylight while the clock keeps running. Takes effect immediately and is stored on this computer only.",
  // 设置：画面——界面风格：海图室（缺省）/ 经典像素
  pnStUiSkin: "Interface style",
  pnStUiSkinChart: "Chart room (default)",
  pnStUiSkinClassic: "Classic pixel",
  pnStUiSkinHelp:
    "Chart room: a dark navy frame around paper panels, with larger type and buttons that work well on phones. Classic pixel: the wood-and-pixel interface from before the redesign. Looks only — gameplay and saves are untouched. Takes effect immediately and is stored on this computer only.",

  // 设置：结构化输出与组合事件说明
  pnStStructured: "Structured output (tool calls / JSON Schema)",
  pnStStructuredHelp:
    "When on, the model must answer with the JSON Schema the core builds from the effect vocabulary: Anthropic uses a tool call (propose_event is forced), OpenAI-compatible endpoints use response_format json_schema (strict). Turn it off if your provider does not support it; text output with repair parsing is used instead.",
  pnStComposed: "AI composed events",
  pnStComposedIntro:
    "The structure constrains the format; the model decides the content. It picks 1–3 effects from the effect vocabulary and adds a title and narrative to compose one event. The proposal is first judged by the rules adjudicator (or Jev), then checked by the core against the bounds in data/effects.toml; only then is it written to the command log and run in the simulation. The model never changes the world directly. Without an online model, offline templates generate events deterministically.",
  pnStHowTo: "Connecting an online model",
  pnStStep1: "Under “Model provider”, choose Anthropic or an OpenAI-compatible endpoint, and change the endpoint URL if needed.",
  pnStStep2: "Paste your API key and click “Save key”. The key is kept only in the system credential manager, never in settings files, saves or logs.",
  pnStStep3: "Pick a model tier (Fast / Balanced / Quality) and fill in the model name for each tier.",
  pnStStep4: "Set “AI mode” to “Online model”, set the monthly call and token limits, and save the settings.",
  pnStVocab: "Effect vocabulary",
  pnStVocabGoods: "Goods: output and demand of a good everywhere",
  pnStVocabLocal: "Local: output and demand of a good in one place, a passing fashion, production and consumption of all goods",
  pnStVocabSea: "Sea region: storms, pirates",
  pnStVocabFaction: "Nation: relations between two nations, tariffs, port development",
  pnStVocabWorld: "Global: bank interest rates, workshop efficiency",
  pnStVocabNote:
    "Every effect has bounds on its multiplier, duration and size; each event also has limits on its number of effects, a cooldown, a yearly cap and a total strength budget. The vocabulary and bounds live in data files and can be changed without touching code.",
  "legend.shipTag": "Legendary",
  "legend.shipTagTitle": "A named ship with a history of its own; see Secrets · Legendary Ships",
};
