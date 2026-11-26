// v1 / v2 各显示各的：第二阶段在 v2 下加的结构（按钮、提示、新的排列）用它包起来，v1 原样保留（docs/UI-REDESIGN.md 第 9 节）。
import type { ReactNode } from "react";
import { useIsV2 } from "./uiMode";

/** 新界面显示 v2，旧界面显示 v1（不给 v1 时旧界面什么都不显示）。 */
export function UiSwitch({ v1 = null, v2 }: { v1?: ReactNode; v2: ReactNode }) {
  return <>{useIsV2() ? v2 : v1}</>;
}
