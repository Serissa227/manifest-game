// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——开局（标题、读档、开局向导、世界与主角名册）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.start. 开头；同时在 en.v2-start.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
export const v2Start = {
  // 读档：没有存档时的补充一句与“下一步”
  "v2.start.noSavesHint": "开一局之后，在游戏里随时可以存档。",
  "v2.start.newVoyage": "开始新的航程",
  // 删除存档的确认对话框：标题问删哪一个、后果、主按钮写清动作
  "v2.start.deleteTitle": "删除存档「{slot}」？",
  "v2.start.deleteBody": "删掉之后找不回来。",
  "v2.start.deleteConfirm": "删除「{slot}」",
  // 启航一步：随机种子的说明（种子从底栏挪进正文）
  "v2.start.seedHint": "填同一个数字，开出来的世界就一样（适合和朋友比同一局）；留空则每局不同。",
  // 船长卡在手机上收成一行时，名字旁展开整张卡的键（看得见的字与读屏的名字）
  "v2.start.cardDetails": "详情",
  "v2.start.cardDetailsLabel": "船长卡详情",
} as const;
