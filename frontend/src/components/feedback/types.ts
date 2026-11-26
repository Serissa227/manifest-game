// 共用的反馈组件（docs/UI-REDESIGN.md 第 4、9 节）的公共类型。

/** 反馈里就地的一个按钮：“去交易所”“下一天”“重试”……写清动作。 */
export interface FeedbackAction {
  /** 按钮上的字：写动作（“去交易所”），不写“确定” */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** 这个动作的键盘快捷键（如 "Enter"）：v2 下在按钮旁显示成小键帽，触屏上不显示 */
  shortcut?: string;
  /** FIX5F：这一处的补救就是眼下最该做的事时，按钮用主按钮的样式（InlineError 里） */
  primary?: boolean;
}

/** 放在什么底色上：纸面（窗口、对话框，缺省）或深色的夜航底（顶栏、账台、舞台浮层）。 */
export type FeedbackSurface = "paper" | "night";
