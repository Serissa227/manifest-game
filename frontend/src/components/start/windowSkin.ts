// 标题画面窗口的像素窗框与羊皮纸底纹（生成一次，作为 CSS 变量传给样式表；没有画布时为空，样式退回纯色）。
// 开局向导与游戏里的补建身世窗口共用。
import type { CSSProperties } from "react";
import { toDataURL } from "../../art/render";
import { drawParchmentTile, drawWindowFrame } from "./titleArt";

export function windowSkin(): CSSProperties {
  const frame = toDataURL(drawWindowFrame(), "start-frame");
  const parchment = toDataURL(drawParchmentTile(), "start-parchment");
  const vars: Record<string, string> = {};
  if (frame) vars["--ts-frame"] = `url(${frame})`;
  if (parchment) vars["--ts-parchment"] = `url(${parchment})`;
  return vars as CSSProperties;
}
