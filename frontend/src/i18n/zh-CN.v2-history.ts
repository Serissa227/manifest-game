// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——历史与秘闻（时间线、战役链、编年史、结社 / 秘术 / 信仰）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.history. 开头；同时在 en.v2-history.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 只在新界面（v2）里出现：分组标题、天平的倾向、行内的快捷数量、做不了的原因、空状态的“下一步”、办成后的回音。
export const v2History = {
  // —— 时间线 ——
  // 时间线页顶上的一句引导（新手看得懂天平与杠杆是干什么的）
  "v2.history.lead": "大事都有期限。期限之前在杠杆上出力，能把天平推向一边。",
  // 事件按状态分组的标题
  "v2.history.group.active": "进行中",
  "v2.history.group.future": "将要发生",
  "v2.history.group.resolved": "已揭晓",
  // 天平下面的一行字：倾向哪一方（区间整个在一边时）、难分高下（区间跨过中线）；后面跟着情报的新旧
  "v2.history.lean": "偏向{side}",
  "v2.history.even": "难分高下",
  // 杠杆列表与“为什么难”的小标题
  "v2.history.leversHead": "你能出力的地方",
  // 送货：所选舰队舱里有多少这种货；一键填满数量；没装这种货时的提示；一支舰队都没有时（养成开局不带船）的原因与怎么办
  "v2.history.all": "全部 {n}",
  "v2.history.noCargo": "这支舰队没装这种货",
  "v2.history.noFleet": "先要有一支舰队。",
  "v2.history.noFleetFix": "货要从舰队的货舱里交；有了第一条船就能交。",
  // 出钱：一排快捷金额（读屏名）
  "v2.history.quickAmount": "快捷金额",
  // “去某处”的杠杆（action = goto）：不在这里点，就地写明要亲自去办；地点在航海图上时一键去看（对不上时右边不放东西）
  "v2.history.gotoHint": "这一项要亲自到{where}去办：到了那里照着做，就记在你名下。",
  "v2.history.gotoHintAny": "这一项要亲自去办：照着做了，就记在你名下。",
  "v2.history.seeOnChart": "在航海图上看{where}",
  // 出钱：金额比现金多时按钮不可用，就地写原因
  "v2.history.shortCash": "现金只有 {v}。",
  // 办成后的回音（提示条）；没办成时就地写原因，下面一句是怎么办
  "v2.history.contributed": "已为“{label}”出力。",
  "v2.history.retry": "调整之后可以再试一次。",
  // 空状态与“下一步”
  "v2.history.emptyTimeline": "眼下没有能介入的历史事件。",
  "v2.history.emptyTimelineHint": "大事临近时会出现在这里；揭晓过的记进编年史。",
  "v2.history.emptyChronicle": "编年史还是空白。",
  "v2.history.emptyChronicleHint": "历史事件揭晓以后，本世界线的结果会记在这里。",
  "v2.history.toTimeline": "看时间线",
  "v2.history.toChronicle": "看编年史",
  // 战役链：小标题与折线的图例
  "v2.history.varsHead": "各方的变量",
  "v2.history.chainHead": "事件链",
  "v2.history.legendDrift": "虚线：史实轨迹",
  "v2.history.legendNow": "色带：现在的估计",
  // 编年史：与史实不同的条目前面的红点（图例与读屏）
  "v2.history.deviates": "与史实不同",

  // —— 秘闻 ——
  "v2.history.schoolsHead": "会的流派",
  "v2.history.spellsHead": "法术",
  "v2.history.spreadHead": "怎么传播",
  "v2.history.keysHead": "钥匙",
  // 法术与开工做不了的原因（原来只在悬停提示里，触屏看不到）
  "v2.history.needFleet": "要先选一支舰队。",
  "v2.history.needPort": "要先选一个港口。",
  "v2.history.castElsewhere": "这道法术要在事件或传闻那里施放。",
  "v2.history.cooling": "还在冷却：{n} 天后能再用。",
  // 没选舰队 / 港口时的“怎么办”与一键补救（选旗舰队、选舰队所在或驶向的港口）
  "v2.history.needFleetFix": "法术施在选中的舰队上。",
  "v2.history.pickOnChart": "在航海图上点一个港口。",
  "v2.history.pick": "选{name}",
  // 信仰与思想：一年里的变化；没有选中港口时的空状态与选港口
  "v2.history.deltaYear": "一年 {n}",
  "v2.history.noPort": "信仰与思想是按港口看的：先选一个港口。",
  "v2.history.noPortHint": "也可以在航海图上点一个港口。",
  "v2.history.seePort": "看{name}",
  "v2.history.pickPort": "选港口",
  "v2.history.pickPortHolder": "选港口……",
  // 秘境：还不知道名字的地方（读屏念这一句，画面上是“？”）
  "v2.history.unknownRealm": "还不知道名字的地方",
  // 办成后的回音
  "v2.history.joined": "已向“{name}”请求入会。",
  "v2.history.casted": "已施放“{name}”。",
  "v2.history.propagated": "已在{place}着手：{label}。",
  "v2.history.commissioned": "“{name}”在这里开工了。",
} as const;
