// 界面字符串（zh-CN）：城镇的人口、繁荣度与市况，城镇工坊，商品的需求层级（docs/ECONOMY.md 6.4、6.5）。
// 键名加模块前缀（town / ws / need / portCondition），避免与其他模块重复。
// 用语：“繁荣度”专指城镇的繁荣（0–100，随满足度变化）；港口投资带来的是“发展度”，两者不要混用。
export const town = {
  // ── 市况（港口窗口、海图、日志） ──
  "portCondition.stable": "平稳",
  "portCondition.boom": "繁荣",
  "portCondition.depression": "萧条",
  "portCondition.famine": "饥荒",
  "portCondition.glut": "过剩",
  "portConditionHint.stable": "日子照常",
  "portConditionHint.boom": "供货充足、日子好过：人口在增长，舒适品与奢侈品卖得更好",
  "portConditionHint.depression": "日子难过：人口在减少，舒适品与奢侈品不好卖",
  "portConditionHint.famine": "主食、盐、布这些必需品远比往常短缺：运粮来正是时候",
  "portConditionHint.glut": "库存普遍比往常多：这里的货便宜，适合进货",
  "log.PortCondition": "{loc} 的市况转为{condition:@portCondition}",

  // ── 港口窗口：标题下的一行 ──
  townLine: "人口 {pop} · 繁荣度 {v}",

  // ── 港口投资页：城镇 ──
  townTitle: "城镇",
  townPopulation: "人口",
  townPopulationValue: "{pop}（开局 {pop0}）",
  townGrowth: "每月 {sign}{pct}%",
  townProsperity: "繁荣度",
  townProsperityValue: "{v}，正在向 {goal} 靠近",
  townCondition: "市况",
  townConditionSince: "{condition}（{date}起）",
  townNeeds: "上月的需求满足度",
  "townNeed.essential": "必需品",
  "townNeed.comfort": "舒适品",
  "townNeed.luxury": "奢侈品",
  townNeedsHint:
    "按各商品的库存与目标库存计；满足同一种需求的几样商品（例如谷物、玉米、马铃薯）合在一起算。比往常满足得好，繁荣度上升、人口增长，舒适品与奢侈品的需求也随之变大。",
  townLearning: "头一年：城里人还在熟悉本地往常的年景，繁荣度与人口暂不变化。",

  // ── 交易所页：城镇工坊 ──
  wsTitle: "城镇工坊",
  wsHint: "工坊从本地市场取原料、把产出放回本地市场：原料短缺时少做，产出不值原料时停工。",
  wsRecipe: "{name}：{inputs} → {output} {qty}",
  wsInput: "{good} {qty}",
  wsCapacity: "产能每天 {v} 件（开局的 {pct}%），接手当地产量的 {share}%",
  wsToday: "今天做了 {n} 件",
  wsValue: "上月产出价值是原料的 {v} 倍",
  wsShort: "缺料",
  wsStopped: "亏本停工",
  wsLearning: "开张头一年",

  // ── 账簿：商会 2.0 的年末分红（ECONOMY.md 6.7） ──
  "memo.Dividend": "分红",
  "flow.Dividend": "商会的年末分红（流出）",

  // ── 交易所页：商品的需求层级 ──
  "need.essential": "必需品：需求只随人口变",
  "need.comfort": "舒适品：城镇越繁荣需求越大",
  "need.luxury": "奢侈品：需求随繁荣度成倍变化",
} as const;
