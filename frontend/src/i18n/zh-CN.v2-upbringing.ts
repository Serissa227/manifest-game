// 界面字符串（zh-CN）：新界面第二阶段（docs/UI-REDESIGN.md 第 8 节）——养成（主画面、比赛与小游戏、学院期）。
// 这一组画面新增的字符串写在这里，键名一律以 v2.upbringing. 开头；同时在 en.v2-upbringing.ts 里补上英文（缺了 tsc 与 en.test.ts 都会报）。
// 这个文件已经在 zh-CN.ts、en.ts 里登记好了：各组只改自己的这一对文件，互不冲突。
// 只在新界面（v2）里出现：活动卡上面的“排进哪一格”、底栏的“本月预计”、开始键做不了时的原因与补救、右栏里空着的志向与考试。
export const v2Upbringing = {
  // 学院期一格的位置：“上旬的课后”（家乡期每旬只有一格，直接用旬名）
  "v2.upbringing.where": "{slot}的{part}",
  // 活动卡上面的一行：点一张卡会放进哪一格（那一格已经排了时，写会换掉什么）
  "v2.upbringing.target": "点一张卡，排进{where}",
  "v2.upbringing.targetReplace": "点一张卡，换掉{where}的「{act}」",
  // 底栏：这样排，这个月大概的收获
  "v2.upbringing.projLabel": "本月预计",
  "v2.upbringing.projNone": "排上活动以后，这里会算出这个月大概的收获。",
  // 底栏的“太累”提醒（旧界面是“这样排会太累（可能生病或闹脾气）”）：短一些，和预计的小签排在一起，手机上两行放得下
  "v2.upbringing.tired": "太累了，可能生病或闹脾气",
  // “开始这个月”还不能按：为什么，以及就地补救的按钮
  "v2.upbringing.goEmpty": "还有 {n} 格没排",
  "v2.upbringing.goNeeds": "{where}的「{act}」还要选：{needs}",
  "v2.upbringing.goEmptyFix": "去排{where}",
  "v2.upbringing.goNeedsFix": "去选",
  // 右栏“志向”分页里空着的两块
  "v2.upbringing.pathNone": "现在还不用定志向。",
  "v2.upbringing.examsNone": "眼下没有要考的试。",
} as const;
