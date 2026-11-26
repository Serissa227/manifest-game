// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——经营扩展（商队、产业、殖民地、探险）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.business. 开头；同时在 en.v2-business.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 只在新界面（v2）里用到：旧界面照旧用原来的字符串（cvPlanLine、inDaily……）。
export const v2Business = {
  // —— 商队：路线规划的五项（原来挤在一句话里），商队卡片的副标题，解散的确认 ——
  "v2.business.cv.planLabel": "这条路线",
  "v2.business.cv.days": "路程",
  "v2.business.cv.distance": "距离",
  "v2.business.cv.cells": "{n} 格",
  "v2.business.cv.tolls": "关卡税",
  "v2.business.cv.risk": "遭劫风险",
  "v2.business.cv.riskPct": "{pct}%",
  "v2.business.cv.upkeep": "路上开销",
  "v2.business.cv.meta": "{animal} × {count} · 护卫 {guards} · 每天 {cost}",
  "v2.business.cv.emptyHint": "商队走陆路，把货运到船去不了的内陆城镇。在上面选好路线与驮畜，点“组建商队”。",
  "v2.business.cv.unloadFirst": "驮着货不能解散：先卸下货物。",
  "v2.business.cv.disbandAsk": "解散商队 #{id}？",
  "v2.business.cv.disbandBody": "驮畜折价卖掉、护卫遣散；想再走陆路要重新组建。",
  "v2.business.cv.disbandConfirm": "解散商队 #{id}",
  "v2.business.cv.disbandDone": "商队 #{id} 已解散",

  // —— 产业：日估算的四项、出售的确认、两种空状态与下一步 ——
  "v2.business.in.dailyLabel": "每日估算",
  "v2.business.in.revenue": "产出",
  "v2.business.in.inputs": "原料",
  "v2.business.in.costs": "人工维护",
  "v2.business.in.profit": "日盈亏",
  "v2.business.in.sellAsk": "出售{name}？",
  "v2.business.in.sellBody": "按账面价值的一半卖出，可得 {v}。卖出后收不回来。",
  "v2.business.in.sellConfirm": "出售，得 {v}",
  "v2.business.in.sellDone": "已出售{name}，得 {v}",
  "v2.business.in.emptyHint": "作坊把便宜的原料加工成值钱的货，每天自己开工。",
  "v2.business.in.emptyHintBuild": "作坊把便宜的原料加工成值钱的货，每天自己开工。在下面选好地点、类型与配方就能建。",
  "v2.business.in.noSite": "还没有可以建设产业的地方",
  "v2.business.in.noSiteHint": "产业的原料与产出都放在当地的仓库里：先在港口租或买一处仓库。",
  "v2.business.in.noSiteAction": "去港口仓库",
  // 船队都在海上、也没有目的地，定不下去哪个港口：先打开航海图点一个
  "v2.business.in.noSiteChart": "打开航海图选港口",

  // —— 殖民地：空状态与下一步、放弃的确认、装卸按钮上写明数量 ——
  "v2.business.col.empty": "你还没有殖民地",
  "v2.business.col.emptyHint": "带上移民、木料与口粮，驶向新大陆的未开拓之地，立下第一块界碑吧。",
  "v2.business.col.emptyAction": "打开航海图找殖民点",
  "v2.business.col.abandonAsk": "放弃{name}？",
  "v2.business.col.abandonConfirm": "放弃{name}",
  "v2.business.col.abandonDone": "已放弃{name}",
  "v2.business.col.moveN": "{verb} {n}",
  // 装卸搬不了的原因（写在那一行里）；能改的给一个“改成 N”
  "v2.business.col.holdFull": "船舱已满，装不下了",
  "v2.business.col.colonyFull": "殖民地仓库已满，放不下了",
  "v2.business.col.holdLeft": "船舱只剩 {n} 的空位",
  "v2.business.col.colonyLeft": "殖民地仓库只剩 {n} 的空位",
  "v2.business.col.onlyHave": "这里只有 {n}",
  "v2.business.col.qtyMin": "数量至少是 1",
  "v2.business.col.fixTo": "改成 {n}",

  // —— 探险：空状态与下一步 ——
  "v2.business.ex.empty": "航海日志上还没有记下任何发现",
  "v2.business.ex.emptyHint": "驶出熟悉的航线，去看看海图空白处有什么。",
  "v2.business.ex.emptyAction": "打开航海图",
  "v2.business.ex.showAll": "看全部的发现",
  // 空状态的补充一句（第二阶段收尾补上）：殖民地的“建筑”“在建工程”与仓库
  "v2.business.col.noBuildingsHint": "在下面的“建造与升级”里挑一座开工。",
  "v2.business.col.noConstructionHint": "在下面的“建造与升级”里挑一座，工期写在旁边。",
  "v2.business.col.stockEmptyHint": "停在这里的船可以在“装卸货物”里把货卸进来。",
  "v2.business.col.siteNoFleetHint": "把一支舰队开到这里停泊，就能在这里建立殖民地。",
} as const;
