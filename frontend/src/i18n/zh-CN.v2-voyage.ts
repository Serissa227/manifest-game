// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——航海（航海图舞台、图例、缩放、出港对话框、手动航行的罗盘与航行 HUD）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.voyage. 开头；同时在 en.v2-voyage.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 只在新界面（v2）里出现；旧界面（v1）照旧用原来的字符串（chart*、nav.*）。
export const v2Voyage = {
  // 地点列表：查找没有结果时的“下一步”
  "v2.voyage.clearFilter": "清除查找",
  // 出航确认：做不了、有风险时的“怎么办”
  "v2.voyage.noRouteFix": "点“重新选择”换一个目的地。",
  "v2.voyage.shortFixSea": "先就近靠港补足粮水，再接着走。",
  "v2.voyage.noFleetFix": "先在造船厂买一艘船，组成舰队。",
  // 航行状态：本次航程走了多少
  "v2.voyage.progress": "航程进度",
  "v2.voyage.progressText": "已航行 {done} 天，预计还需 {left} 天",
  // 手动航行：按钮上的字（快捷键改用小键帽显示，触屏上不显示）
  "v2.voyage.worldMap": "世界图",
  "v2.voyage.backToNav": "回到航行",
  "v2.voyage.pause": "暂停",
  "v2.voyage.resume": "继续",
  // 手动航行：快捷键提示
  "v2.voyage.keySteer": "转舵",
  "v2.voyage.keySail": "升降帆",
  "v2.voyage.keyPause": "暂停 / 继续",
  "v2.voyage.keyWorld": "世界图",
} as const;
