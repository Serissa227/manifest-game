// 界面字符串（en）：城镇的人口、繁荣度与市况，城镇工坊，商品的需求层级。与 zh-CN.town.ts 的键一一对应。
// 用语：prosperity 专指城镇的繁荣（0–100）；港口投资带来的是 development。
import type { Translation } from "./translation";
import type { town as zh } from "./zh-CN.town";

export const town: Translation<typeof zh> = {
  // ── 市况（港口窗口、海图、日志） ──
  "portCondition.stable": "Steady",
  "portCondition.boom": "Boom",
  "portCondition.depression": "Slump",
  "portCondition.famine": "Famine",
  "portCondition.glut": "Glut",
  "portConditionHint.stable": "Business as usual",
  "portConditionHint.boom": "Well supplied and thriving: the town is growing, and comforts and luxuries sell better",
  "portConditionHint.depression": "Hard times: the town is shrinking, and comforts and luxuries are hard to sell",
  "portConditionHint.famine": "Staples, salt and cloth are far scarcer than usual: a good time to bring grain",
  "portConditionHint.glut": "Stocks are higher than usual across the board: goods are cheap here, a good place to buy",
  "log.PortCondition": "{loc}: conditions turn to {condition:@portCondition}",

  // ── 港口窗口：标题下的一行 ──
  townLine: "Population {pop} · Prosperity {v}",

  // ── 港口投资页：城镇 ──
  townTitle: "Town",
  townPopulation: "Population",
  townPopulationValue: "{pop} (founding {pop0})",
  townGrowth: "{sign}{pct}% a month",
  townProsperity: "Prosperity",
  townProsperityValue: "{v}, moving toward {goal}",
  townCondition: "Conditions",
  townConditionSince: "{condition} (since {date})",
  townNeeds: "Needs met last month",
  "townNeed.essential": "Necessities",
  "townNeed.comfort": "Comforts",
  "townNeed.luxury": "Luxuries",
  townNeedsHint:
    "Measured by each good's stock against its target stock; goods that meet the same need (grain, maize and potatoes, say) count together. When needs are met better than usual, prosperity rises, the town grows, and demand for comforts and luxuries grows with it.",
  townLearning: "First year: the townsfolk are still learning what a usual year looks like here; prosperity and population hold steady.",

  // ── 交易所页：城镇工坊 ──
  wsTitle: "Town workshops",
  wsHint:
    "Workshops buy their materials in the local market and sell their output back to it: short of materials they make less, and when the output is worth less than the materials they stop.",
  wsRecipe: "{name}: {inputs} → {output} {qty}",
  wsInput: "{good} {qty}",
  wsCapacity: "Makes {v} a day ({pct}% of founding capacity), {share}% of the local output",
  wsToday: "Made {n} today",
  wsValue: "Last month the output was worth {v}× its materials",
  wsShort: "Short of materials",
  wsStopped: "Stopped (losing money)",
  wsLearning: "First year of trading",

  // ── 账簿：商会 2.0 的年末分红（ECONOMY.md 6.7） ──
  "memo.Dividend": "Dividend",
  "flow.Dividend": "Trading companies' year-end dividends (paid out)",

  // ── 交易所页：商品的需求层级 ──
  "need.essential": "Necessity: demand moves only with population",
  "need.comfort": "Comfort: the more prosperous the town, the more it wants",
  "need.luxury": "Luxury: demand rises and falls steeply with prosperity",
};
