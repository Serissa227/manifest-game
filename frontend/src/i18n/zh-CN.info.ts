// 界面字符串（zh-CN）：信息时效——行情情报的开局设置、远方行情的时效与来源、行情通报，
// 以及行情窗口对过时行情的衔接与复盘（docs/ECONOMY.md 第 7 节）。
// 用语：“快照”只在代码里用；界面上说“行情”“消息”。来源有三种：自己到过、随船消息、行情通报。
export const info = {
  // ── 开局向导（启航一步） ──
  "info.title": "行情情报",
  "info.mode.carried": "随船传递（推荐）",
  "info.mode.carriedHint":
    "远方港口的行情是随船带来的消息，写明是几天前、从哪里来的；亲自到港、在港时听进港的船说、或者花钱买行情通报才会更新。商会也只知道自己船队带回来的行情。",
  "info.mode.live": "实时（经典）",
  "info.mode.liveHint": "到过的港口，行情一直实时可见。",

  // ── 远方行情的时效与来源 ──
  "info.seen": "{age} 天前 · {source}",
  "info.seenToday": "今天 · {source}",
  "info.src.visit": "自己到过",
  "info.src.ship": "随船消息",
  "info.src.report": "行情通报",
  "info.staleNote": "价格与库存是那时的，现在可能已经变了；不在这里，问不到现价。",
  "info.band.0": "紧缺",
  "info.band.1": "偏少",
  "info.band.2": "正常",
  "info.band.3": "偏多",
  "info.band.4": "充足",
  "info.bandHint": "库存档位（{age} 天前）",

  // ── 行情通报（交易所） ──
  "info.report.title": "行情通报",
  "info.report.offer": "告示板上有 {n} 处港口的行情比你手上的新（{ports}），整份买下要 {price}。",
  "info.report.none": "告示板上没有比你手上更新的行情。",
  "info.report.buy": "买下行情通报",

  // ── 行情窗口：过时行情的衔接 ──
  "fc.stale": "这里的行情是 {age} 天前的（{source}），日线只到那一天。你的旗舰队到这里约 {voyage} 天：期限取 {age} + {voyage} = {h} 天，终点就是抵达的那天。",
  "fc.staleNoVoyage": "这里的行情是 {age} 天前的（{source}），日线只到那一天：期限从那天算起。",
  "fc.staleArrive": "按抵达时预测",

  // ── 复盘 ──
  "fc.f.stale": "预测所用的行情已经过时：起点是记下之前 {n} 天的行情，这些天里的变化事先无从得知",
  "fc.rv.waiting": "预测期已经结束，那边的行情还没传回来：等有船带来消息、买一份行情通报或者亲自去一趟，才能复盘剩下的日子。",
  "fc.book.waiting": "等消息",

  // ── 第八批 E7：势力的经济政策、商会传闻、市场月报、复盘点评、身世序章 ──
  "pol.ban": "禁运",
  "pol.banHint": "这里的势力禁止运出这种货：买不到（本地消费照常）",
  "pol.export": "出口税 ×{x}",
  "pol.exportHint": "这里的势力对运出去的这种货加征出口税：买入时交易税乘上这个倍数",
  "pol.import": "进口关税 ×{x}",
  "pol.importHint": "这里的势力对运进来的这种货加征关税：卖出时交易税乘上这个倍数",
  "pnCeSource.rule": "官府政令",
  tvOutlook: "听说{company}：{memo}",
  itReports: "市场月报",
  itReportTitle: "{region} · 第 {day} 天发布",
  itPrologue: "序章",
  "fc.rv.comment": "请账房点评",
  "fc.rv.commentBusy": "账房正在看……",

  // ── 账簿 ──
  "memo.MarketReport": "行情通报",
  "flow.MarketReport": "行情通报的费用（流出）",
} as const;
