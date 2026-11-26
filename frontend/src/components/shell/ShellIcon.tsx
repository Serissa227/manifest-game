import { memo } from "react";
import type { IconName } from "../../art/icons";
import { Sprite } from "../../art/Sprite";
import { iconPx } from "./shellArt";

/** 外壳里的像素图标：纯装饰，对辅助技术隐藏（可访问名称只来自旁边的文字）。 */
export const ShellIcon = memo(function ShellIcon({ name, scale = 2, className }: { name: IconName; scale?: number; className?: string }) {
  return <Sprite px={iconPx(name)} scale={scale} className={className ? `shell-icon ${className}` : "shell-icon"} />;
});
