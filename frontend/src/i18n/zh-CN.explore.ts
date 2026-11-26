// 界面字符串（zh-CN）：探险——探险记录窗口、发现物、名声，以及发现相关的日志、提醒与账簿用语。
// 键名加模块前缀（如 `explore.xxx`、`discoveryKind.xxx`），避免与其他模块重复（见 i18n.test.ts）。
// 金额写 `{cur}`（自动填货币名称）或 `{x:money}`；日期写 `{day:date}`（见 i18n/index.ts）。
export const explore = {
  // 功能页
  "tab.explore": "探险",
  "explore.panelTitle": "探险记录",
  "explore.placeholder": "探险日志正在誊写……",
  "explore.empty": "航海日志上还没有记下任何发现。驶出熟悉的航线，去看看海图空白处有什么。",

  // 探险窗口：卷首
  "explore.journal": "探险日志",
  "explore.subtitle": "记下每一处望见的遗迹、奇观与传说——到港口商会呈报，便能领取赏金、扬名四海。",

  // 名声与航海士招募门槛
  "explore.fame": "名声",
  "explore.fameNext": "再得 {need} 点名声，可招募 {level} 级航海士",
  "explore.fameAll": "你的名声已足以招募任何航海士",
  "explore.ladder": "航海士招募门槛",
  "explore.rung": "{level} 级航海士 · 名声 {fame}",
  "explore.rungOk": "已达",
  "explore.rungNo": "未达",

  // 统计
  "explore.progress": "已发现 {found} / {total}",
  "explore.pending": "待报告 {n} 项",
  "explore.kinds": "各类发现",
  "explore.kindCount": "{found} / {total}",
  "explore.filterAll": "全部",

  // 发现物卡片
  "explore.foundOn": "发现于 {day:date}",
  "explore.coords": "海图坐标 {x}, {y}",
  "explore.lore": "“{text}”",
  "explore.bounty": "赏金 {value:money} · 名声 +{fame}",
  "explore.reported": "已报告",
  "explore.unreported": "待报告",
  "explore.noneOfKind": "这一类还没有发现。",

  // 尚未发现
  "explore.unknownName": "？？？",
  "explore.unknownCount": "？？？ × {n}",
  "explore.unknownHint": "海图上还有 {n} 处未解之谜，等着你的船队去望见。",

  // 海上传闻（组合事件“发现物传闻”：只给大致海区，要亲自驶去望见才算发现）
  "explore.rumors": "海上传闻",
  "explore.rumorHint": "酒馆与码头上听来的传闻，只指出大致的海区——要亲自驶去望见，才算真正的发现。",
  "explore.rumorLine": "传闻：「{name}」在{region}一带",
  "explore.rumorFar": "某片远海",
  "explore.rumorHeard": "听闻于 {day:date}",
  "explore.rumorOpen": "待查证",
  "explore.rumorConfirmed": "已证实",

  // 向商会报告
  "explore.report": "向商会报告",
  "explore.reportAll": "全部报告（{n} 项）",
  "explore.reportAt": "报告港口",
  "explore.reportHere": "停靠 {port}：可以向当地商会报告发现，领取赏金与名声。",
  "explore.reportNoPort": "舰队或商队停靠港口后，才能向当地商会报告发现。",
  "explore.reportDone": "在 {port} 的商会呈报「{name}」：领得赏金 {reward:money}，名声 +{fame}",
  "explore.reportAllDone": "在 {port} 的商会呈报 {n} 项发现：领得赏金 {reward:money}，名声 +{fame}",

  // B12：潜水点（要潜下去才找得到；海上须收帆，或靠港）。清单不给名字：听过传闻的按传闻称呼
  "explore.dives": "潜水点",
  "explore.diveHint": "这几处要潜下去才找得到。舰队停在那片海面、收起帆（或靠港）时可以下潜。",
  "explore.dive": "潜水",
  "explore.diveRumor": "{region}一带的潜水点",
  "explore.diveUnknown": "未探明的潜水点",
  "explore.diveDone": "潜水完成：{name}",

  // 顶部状态栏
  hudFame: "名声",
  hudDiscoveriesUnreported: "{n} 项发现待报告",
  hudDiscoveriesHint: "到任意港口的商会报告发现，可领取赏金并扬名四海",

  // 发现物的种类
  "discoveryKind.ruins": "遗迹",
  "discoveryKind.wonder": "奇观",
  "discoveryKind.wreck": "沉船",
  "discoveryKind.relic": "遗物",
  "discoveryKind.beast": "海兽",
  "discoveryKind.landmark": "地标",
  "discoveryKind.animal": "鸟兽",
  "discoveryKind.plant": "草木",
  "discoveryKind.fallen": "陨石",
  "discoveryKind.phantom": "幻岛",

  // 事件日志
  "log.Discovered": "{owner} 的船队望见了「{discovery}」，记入航海日志",
  "log.DiscoveryReported": "{owner} 在 {loc} 的商会呈报「{discovery}」，领得赏金 {reward:money}，名声 +{fame}",

  // 航海日志的提醒
  "notice.discoveryUnreported": "有 {n} 项发现尚未报告，到港口商会可领取赏金",

  // 账簿用语
  "memo.Discovery": "发现赏金",
  "flow.Discovery": "探险：报告发现的赏金",
} as const;
