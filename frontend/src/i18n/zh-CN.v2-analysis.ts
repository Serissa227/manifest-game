// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——数字类（行情、期货、报表、情报与编年史）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.analysis. 开头；同时在 en.v2-analysis.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 这些字只在新界面（v2）里出现（空状态的补充一句与“下一步”、行内的一键下单、确认对话框、贴底的“记下预测”条）；旧界面照旧。
export const v2Analysis = {
  // —— 行情：空状态与“下一步” ——
  "v2.analysis.fc.noDataHint": "收盘价每天记一次，过一天就有了。",
  "v2.analysis.fc.bookEmptyHint": "在“推算”里选好方法与期限，点“记下这个预测”，预测簿会逐日对照它准不准。",
  "v2.analysis.fc.toWork": "去推算",
  "v2.analysis.fc.advHint": "算学奇才会在各港的酒馆里出没；请到一位，就能把每个法子放回旧账里试一遍。",
  // —— 行情：贴底的“记下预测”条（记下的是什么） ——
  "v2.analysis.fc.pinWhat": "{method} · 往后 {days} 天",
  "v2.analysis.fc.pinBar": "记下预测",
  // —— 预测簿：删除前问一句 ——
  "v2.analysis.fc.removeTitle": "删除第 {id} 条预测？",
  "v2.analysis.fc.removeBody": "{entry}。删除后预测簿不再追踪它，它的复盘也一并删去，收不回来。",
  "v2.analysis.fc.removeConfirm": "删除这条预测",
  "v2.analysis.fc.removed": "已删除第 {id} 条预测",
  // —— 期货：保证金金额、行内一键下单 ——
  "v2.analysis.fu.amountHint": "存入、取回都按这个金额，对下面每个账户都适用。",
  "v2.analysis.fu.lotsHint": "每次下单的手数；在合约那一行直接开多、开空或平仓。",
  "v2.analysis.fu.actions": "下单",
  "v2.analysis.fu.long": "开多 {n}",
  "v2.analysis.fu.short": "开空 {n}",
  "v2.analysis.fu.close": "平仓",
  "v2.analysis.fu.longAria": "{contract}：买入开多 {n} 手",
  "v2.analysis.fu.shortAria": "{contract}：卖出开空 {n} 手",
  "v2.analysis.fu.closeAria": "{contract}：平仓 {n} 手",
  "v2.analysis.fu.delivery": "交割 {port}",
  // 交割方式：持仓那一格里两段的切换（字固定，选中的那段高亮）；整组的读屏名带合约名
  "v2.analysis.fu.settle": "到期",
  "v2.analysis.fu.cash": "现金结算",
  "v2.analysis.fu.physical": "实物交割",
  "v2.analysis.fu.settleAria": "{contract}：到期交割方式",
  "v2.analysis.fu.callRisk": "明天盯市后若仍低于维持保证金，交易所会强行平仓。",
  "v2.analysis.fu.callShort": "至少还差 {short:money}。",
  // 追保：差额旁的一键补救（按差额直接存入；读屏名带交易所）
  "v2.analysis.fu.topUp": "存入差额 {short:money}",
  "v2.analysis.fu.topUpAria": "{exchange}：存入差额 {short:money}，补到维持保证金",
  "v2.analysis.fu.empty": "眼下没有挂牌的期货合约。",
  "v2.analysis.fu.emptyHint": "期货交易所只开在几处大港；旧合约到期后，月末会挂出新的。",
  // —— 报表 ——
  "v2.analysis.rp.emptyHint": "每月最后一天结账，月报就会出现在这里；年报在年末。",
  // —— 情报：空状态 ——
  "v2.analysis.it.newsEmpty": "还没有听到什么消息。",
  "v2.analysis.it.newsHint": "每隔几天就有传言、商人的消息与官府的公告传来，船在哪儿都收得到；设置里把 AI 关掉时不再有新消息。",
  "v2.analysis.it.eventsEmpty": "眼下没有进行中的事件。",
  "v2.analysis.it.logEmpty": "日志里还没有记下什么。",
  // 勾了“只看与我有关”、筛完一条不剩（日志本身不空）
  "v2.analysis.it.logMineEmpty": "还没有与你有关的记录。",
  "v2.analysis.it.logMineHint": "日志里记的都是别人的事。",
  "v2.analysis.it.logShowAll": "看全部",
  "v2.analysis.it.chronicleEmpty": "编年史还是空白的。",
  "v2.analysis.it.chronicleHint": "每到年末，这一年的大事会写成一篇。",
  // 空状态的补充一句与“下一步”（第二阶段收尾补上）：预测算不出来、复盘还没有日子、复盘缺这处的行情
  "v2.analysis.fc.shortHint": "每过一天多一个收盘价；记录够长了，这个法子就算得出来。",
  "v2.analysis.fc.toMonthly": "切到月线",
  "v2.analysis.fc.monthShortHint": "月线每满一个月才多一个点；先看日线吧。",
  "v2.analysis.fc.toDaily": "看日线",
  "v2.analysis.fc.rvWaitHint": "记下预测以后再过几天，这里会拿实际的价格与预测对照。",
  "v2.analysis.fc.rvNoAttrHint": "要调出这处的行情，才分得清是什么推着价格走。",
  "v2.analysis.fc.rvLoadMarket": "调出这处的行情",
} as const;
