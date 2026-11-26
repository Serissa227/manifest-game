// 界面字符串（zh-CN）：新界面（docs/UI-REDESIGN.md）共用的反馈组件（components/feedback/）——就地错误、空状态、
// 快捷键小键帽、确认对话框。键名一律以 v2.fb. 开头。第二阶段各画面组的字符串在各自的 zh-CN.v2-<组>.ts 里。
export const v2 = {
  // 快捷键提示：一组小键帽的读屏名称；键名（显示在键帽上的字与读屏念的名字）
  "v2.fb.keys": "快捷键",
  "v2.fb.key.enter": "回车",
  "v2.fb.key.space": "空格",
  "v2.fb.key.up": "上箭头",
  "v2.fb.key.down": "下箭头",
  "v2.fb.key.left": "左箭头",
  "v2.fb.key.right": "右箭头",
  // 确认对话框：主按钮在办事的时候
  "v2.fb.working": "正在办……",
  // 载入：按需载入的界面没能载入时的“怎么办”（为什么用原来的 layout.loadFailed）
  "v2.fb.loadFailedFix": "点“重试”再载入一次，游戏进度不受影响。",
  // 全部快捷键（主界面里按“?”打开）：标题、说明、分组与每一条
  "v2.fb.sc.title": "全部快捷键",
  "v2.fb.sc.lead": "随时按 ? 打开这张表；在输入框里打字时不算。",
  "v2.fb.sc.closeCard": "关上",
  "v2.fb.sc.button": "全部快捷键（按 ?）",
  "v2.fb.sc.market": "交易所",
  "v2.fb.sc.pick": "选货",
  "v2.fb.sc.qty": "调数量",
  "v2.fb.sc.ten": "一次 10 件",
  "v2.fb.sc.settle": "成交（成交单空着时展开这一行）",
  "v2.fb.sc.detail": "看明细",
  "v2.fb.sc.clear": "这一行清零",
  "v2.fb.sc.ends": "第一行 / 最后一行",
  "v2.fb.sc.window": "窗口与对话框",
  "v2.fb.sc.close": "关窗口、取消对话框",
  "v2.fb.sc.help": "打开或关上这张表",
  "v2.fb.sc.nav": "手动航行",
  "v2.fb.sc.steer": "转舵（按住连续转）",
  "v2.fb.sc.sail": "升帆 / 降帆",
  "v2.fb.sc.pause": "暂停 / 继续",
  "v2.fb.sc.world": "切换世界图",
  "v2.fb.sc.tutorial": "新手教程",
  "v2.fb.sc.steps": "上一步 / 下一步",
  "v2.fb.sc.endTutorial": "结束教程",
} as const;
