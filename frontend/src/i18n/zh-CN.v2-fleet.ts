// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——舰队与人（舰队、航海士、行囊 / 装备、图鉴、人物关系图、任务日志）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.fleet. 开头；同时在 en.v2-fleet.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 这些字只在新界面（v2）里出现：空状态的“下一步”、就地的原因、解雇前的确认、行内的一键操作、关系图的图例。
export const v2Fleet = {
  // —— 舰队 ——
  // 舰队不多时，选舰队是一排按钮（一次点击），多了才是下拉框
  "v2.fleet.pick": "选舰队",
  // 货舱空：下一步去交易所（停在港口时）；在海上、锚泊在殖民点（那里没有交易所）时只写靠港以后
  "v2.fleet.cargoHint": "停在{loc}：交易所就在码头边。",
  "v2.fleet.cargoHintSea": "靠港以后可以在交易所进货。",
  "v2.fleet.goMarket": "去交易所",
  // 出航按钮旁就地写明开不了船的原因，并给一键补员
  "v2.fleet.crewBlocked": "船员不够 {min} 人，开不了船（现有 {crew} 人）。",
  "v2.fleet.crewBlockedSea": "靠港以后才能招到人手。",

  // —— 航海士 ——
  "v2.fleet.matesHint": "各港酒馆里有人在等船，下面列着他们在哪儿。",
  "v2.fleet.matesHintSea": "靠港以后可以去酒馆招募。",
  "v2.fleet.goTavern": "去酒馆",
  // 不在同一个港口的航海士：写明去哪里招
  "v2.fleet.hireAt": "要到{loc}的酒馆才能招募。",
  // 解雇前先问一句（收不回来：要回老家港口的酒馆重新付雇金）
  "v2.fleet.dismissTitle": "解雇{name}？",
  "v2.fleet.dismissBody": "{name}会回到老家港口的酒馆；想再请回来，得去那里重新付雇金。",
  "v2.fleet.dismissBodyRole": "{name}会回到老家港口的酒馆，“{role}”这个岗位会空出来；想再请回来，得去那里重新付雇金。",
  "v2.fleet.dismissConfirm": "解雇{name}",
  "v2.fleet.dismissed": "已解雇{name}。",

  // —— 行囊 ——
  // 物品行里的一键操作（按钮上的短字；读屏念带物品名的全称）
  "v2.fleet.equip": "装上",
  "v2.fleet.equipNamed": "给{wearer}装上{item}",
  "v2.fleet.read": "读",
  "v2.fleet.readNamed": "开始读{item}",
  "v2.fleet.use": "使用",
  "v2.fleet.useNamed": "使用{item}",
  "v2.fleet.worn": "穿戴中",
  // 书的一键“读”：这本正在读时写“正在读”；在读别的书时按钮不可用，原因写在这一行里（一次只能读一本）
  "v2.fleet.readingThis": "正在读",
  "v2.fleet.readAfter": "先读完《{name}》",
  "v2.fleet.itemsEmpty": "行囊还是空的。",
  "v2.fleet.itemsEmptyHint": "道具店、拍卖会买来的东西和请托的谢礼都会放进这里。",
  "v2.fleet.filterEmptyHint": "别的分类里还有东西。",
  "v2.fleet.showAll": "看全部物品",
  "v2.fleet.setsEmpty": "还没有在凑的套装。",
  // 桌面上详情一栏一开始就留着（点第一下时列表不会变窄、跳位置），还没选的时候写一句
  "v2.fleet.itemPick": "点一件物品，看它的说明与用法。",

  // —— 图鉴 ——
  "v2.fleet.codexPick": "点一条，看它的说明与出处。",

  // —— 任务日志 ——
  "v2.fleet.questsHint": "人物的请托、故事的章节与约定，会记在这里。",
  "v2.fleet.goPeople": "去见见人",
  "v2.fleet.showDone": "也看看完成与失败的",

  // —— 关系图 ——
  "v2.fleet.graphHint": "点一个名字，看这个人的详情。",
  "v2.fleet.graphLegend": "线的颜色",
  "v2.fleet.edge.love": "恋人 · 在意的人",
  "v2.fleet.edge.bond": "朋友 · 结拜 · 姐妹",
  "v2.fleet.edge.rival": "对手 · 仇敌",
  "v2.fleet.edge.mentor": "师徒",
  "v2.fleet.graphEmpty": "还没有认识的人。",
  "v2.fleet.graphEmptyHint": "在港口、酒馆和故事里遇到的人，会连成这张图。",

  // —— 自由对话（手机）——
  // 手机上输入框窄，长的占位字（“想对某某说什么？（200 字以内）”）会被截掉：占位字用短的，字数上限写在下面一行
  "v2.fleet.chatPlaceholderShort": "说点什么……",
  "v2.fleet.chatLimit": "每句 {max} 字以内",
  // 空状态的补充一句与“下一步”（第二阶段收尾补上）：没有舰队、人物名单、见闻簿
  "v2.fleet.noFleetHint": "在有造船厂的港口买一艘船，就能组起一支新的舰队。",
  "v2.fleet.toShipyard": "去造船厂",
  "v2.fleet.pp.nobodyHereHint": "认识的人都在别处。",
  "v2.fleet.pp.showAll": "显示全部的人",
  "v2.fleet.pp.nobodyHint": "在酒馆打听、接下请托、走访各处港口时，会结识更多的人。",
  "v2.fleet.pp.newsHereHint": "别的地方也许听到过一些。",
  "v2.fleet.pp.newsAll": "看全部的见闻",
} as const;
