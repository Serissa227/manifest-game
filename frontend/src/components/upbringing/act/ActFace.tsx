// 行动制界面里的人物小头像：有专属头像的用它，没有的按人物键挑一张程序画的像素头像（同一个人每次都是同一张）。
import { PortraitArt } from "../../portrait/PortraitArt";
import { captainPortrait } from "../../start/captain";
import type { ActCtx } from "./actCtx";

function faceOf(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

/** 一位在场的人的小头像。 */
export function MiniFace({ ctx, person, size = 26 }: { ctx: ActCtx; person: string; size?: number }) {
  return (
    <PortraitArt asset={ctx.names.portrait(person)} fallback={faceOf(person)} size={size} label={ctx.names.person(person)} className="ua-face" />
  );
}
