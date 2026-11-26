// 航行视图（第九批，FRAMEWORK §6.8）的像素图：俯视的船（船头朝上，画布按航向旋转）与港口的小锚标。
// 与海图其余部分同一套调色板；纯函数，可在 Node 里预览。
import { P, ink } from "./palette";
import { Px } from "./px";
import { memo } from "./render";
import type { SailSetting } from "../ipc/types";

/** 俯视船的尺寸（像素，船头朝上）。 */
export const SHIP_TOP_W = 15;
export const SHIP_TOP_H = 29;

/**
 * 俯视的帆船：木色船身（左上受光）、甲板中线、三根桅；帆按档位画——满帆是横贯船宽的鼓起的帆、半帆窄一半、收帆只剩卷在桁上的细条。
 * frame 让满帆微微鼓动（0–1）。船头朝上（航向 0）；航行视图按航向旋转。
 */
export function drawShipTop(sail: SailSetting, frame = 0, flag: string = P.gold[3]): Px {
  return memo(`shiptop:${sail}:${frame & 1}:${flag}`, () => {
    const W = SHIP_TOP_W;
    const H = SHIP_TOP_H;
    const p = new Px(W, H);
    const cx = Math.floor(W / 2);
    // 船身的半宽：船头尖、船腹宽、船尾略收
    const half = (y: number) => {
      if (y < 9) return Math.max(0, Math.round(0.5 + y * 0.42));
      if (y < H - 4) return 4;
      return 3;
    };
    const top = 2;
    for (let y = top; y < H; y++) {
      const hw = half(y - top);
      p.hline(cx - hw, cx + hw, y, P.wood[2]);
      // 左侧受光、右侧背光
      p.set(cx - hw, y, P.wood[3]);
      p.set(cx + hw, y, P.wood[1]);
    }
    // 描边
    for (let y = top; y < H; y++) {
      const hw = half(y - top);
      p.set(cx - hw - 1, y, ink.deep).set(cx + hw + 1, y, ink.deep);
    }
    p.set(cx, top - 1, ink.deep);
    p.hline(cx - 3, cx + 3, H - 1, ink.deep);
    // 甲板中线与船尾楼
    p.vline(cx, top + 4, H - 3, P.wood[4]);
    p.rect(cx - 2, H - 5, 5, 3, P.wood[3]);
    p.hline(cx - 2, cx + 2, H - 5, P.wood[4]);
    // 船尾的小旗
    p.set(cx, H - 2, flag).set(cx + 1, H - 2, flag);
    // 三根桅与帆
    const masts = [top + 7, top + 13, top + 19];
    masts.forEach((my, i) => {
      const span = i === 0 ? 5 : 6;
      if (sail === "furled") {
        // 卷起的帆：桁上一道细条
        p.hline(cx - span, cx + span, my, P.parchmentDark);
        p.set(cx - span - 1, my, ink.deep).set(cx + span + 1, my, ink.deep);
      } else {
        const depth = sail === "full" ? 3 + (frame & 1 && i === 1 ? 1 : 0) : 1;
        // 帆从桁往船头方向鼓起（俯视看是一块弧形的布）
        for (let d = 0; d <= depth; d++) {
          const inset = d === depth && depth > 1 ? 1 : 0;
          p.hline(cx - span + inset, cx + span - inset, my - d, d === 0 ? P.parchment : d === depth ? P.white : P.paper);
        }
        p.set(cx - span - 1, my, ink.deep).set(cx + span + 1, my, ink.deep);
        p.hline(cx - span + 1, cx + span - 1, my + 1, "#1a142355");
      }
      // 桅顶
      p.set(cx, my, P.wood[0]);
    });
    return p;
  });
}

/** 航行视图里看见过的港口：小锚标（白底、深色描边），名字另画。 */
export function drawAnchorMark(known = true): Px {
  return memo(`anchor:${known ? 1 : 0}`, () => {
    const p = new Px(11, 12);
    const c = known ? ink.deep : P.parchmentDeep;
    const fill = known ? P.paper : P.parchment;
    p.circle(5, 5, 5, fill);
    p.ring(5, 5, 5, 5, c);
    // 锚：环、杆、横杆与两爪
    p.set(5, 2, c);
    p.vline(5, 3, 8, c);
    p.hline(3, 7, 4, c);
    p.set(3, 7, c).set(4, 8, c).set(6, 8, c).set(7, 7, c);
    p.set(5, 11, "#1a142355");
    return p;
  });
}
