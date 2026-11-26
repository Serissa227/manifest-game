// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——遭遇（海战、遭遇海盗、结局横幅）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.dialogs. 开头；同时在 en.v2-dialogs.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
export const v2Dialogs = {
  // 遭遇海盗：两个选择下面各写一句会发生什么（新手不知道“自动结算”与“战术海战”差在哪里）
  "v2.dialogs.battle.autoHint": "按双方的船、炮与船员，马上算出胜负",
  "v2.dialogs.battle.tacticalHint": "在六角格上亲自指挥：移动、转向、开炮、接舷",
  // 战术海战：棋盘下的图例、没有进行中的海战时的下一步
  "v2.dialogs.tactical.legend": "图例",
  "v2.dialogs.tactical.legendMove": "可以移动到的格子",
  "v2.dialogs.tactical.legendTarget": "射程内的敌船：点它开火",
  "v2.dialogs.tactical.legendSelected": "你正在指挥的船",
  "v2.dialogs.tactical.noneHint": "遭遇海盗时选“战术海战”，就在这里指挥。",
  "v2.dialogs.tactical.toChart": "回到航海图",
  // 新手教程：说明框里的快捷键
  "v2.dialogs.tut.keys": "翻页",
  // 比赛：交卷按钮（就到这里 / 吟出 / 交卷）不可用时，就地写出为什么（{n} 是还差几句 / 几份）
  "v2.dialogs.contest.whyMatch": "至少翻完一对（两张）牌，才能就此收手",
  "v2.dialogs.contest.whyPoem": "每句都挑好一个词才能吟出（还差 {n} 句）",
  "v2.dialogs.contest.whyIdentify": "每份样品都认一个答案才能交卷（还差 {n} 份）",
} as const;
