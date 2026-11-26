// 共用的反馈组件（docs/UI-REDESIGN.md 第 4、9 节）：每个画面都用这一套，不各写各的。
// 新界面（v2）用新的样式（styles/ui-v2/feedback.css）；旧界面（v1）维持原样（各组件的 v1 参数，见各文件开头的说明）。
// - InlineError：就地错误 / 做不了的原因（为什么、怎么办、补救按钮）
// - EmptyState：空状态 + 一个“下一步”主按钮
// - Kbd、KeyHints：快捷键小键帽
// - ConfirmDialog、useConfirm：收不回来的操作先确认；办成后在提示条里回一句（提示条本身是 store 的 notify / fail）
// - Loading：载入中（一行安静的说明 + 骨架细条），不借用空状态的虚线框
// - ShortcutHelp：主界面里按“?”打开的全部快捷键
// 另见 ui/uiMode.ts 的 useIsV2() 与 ui/UiSwitch.tsx：只在 v2 下加的结构用它们包起来。
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmOptions } from "./ConfirmDialog";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { InlineError, type InlineErrorProps } from "./InlineError";
export { Kbd, KeyHints, type KeyHint } from "./KeyHints";
export { keyLabel, type KeyLabel } from "./keys";
export { Loading, type LoadingProps } from "./Loading";
export { ShortcutHelp, ShortcutHelpButton } from "./ShortcutHelp";
export { closeShortcutHelp, openShortcutHelp, useShortcutHelp } from "./shortcutHelpState";
export type { FeedbackAction, FeedbackSurface } from "./types";
export { useConfirm, type Confirm, type ConfirmRunOptions } from "./useConfirm";
