// 海鸥：13×8，正面偏右的“M”形剪影，4 帧振翅（上举 → 平展 → 下压 → 回升）。
import { P, ink } from "../palette";
import { Px } from "../px";

/** 振翅的帧数。 */
export const GULL_FRAMES = 4;

/** 各帧翅膀的形状：[腕部相对肩部的高度, 翼尖相对肩部的高度]（负数向上）。 */
const POSE: readonly (readonly [number, number])[] = [
  [-2, -3],
  [-1, 0],
  [1, 2],
  [-1, -2],
];

/** 海鸥（frame 0..3 振翅）。 */
export function drawGull(frame: number): Px {
  const f = ((Math.floor(frame) % GULL_FRAMES) + GULL_FRAMES) % GULL_FRAMES;
  const [wy, ty] = POSE[f];
  const p = new Px(13, 8);
  const by = 4;
  // 翅膀：内段两像素厚（上亮下灰），外段一像素，翼尖深色
  const wing = (sx: number, dir: number) => {
    const wx = sx + dir * 2;
    const tx = sx + dir * 5;
    p.line(sx, by - 1, wx, by - 1 + wy, P.stone[4]);
    p.line(sx, by, wx, by + wy, P.stone[3]);
    p.line(wx, by - 1 + wy, tx - dir, by - 1 + ty, P.stone[3]);
    p.put(tx, by - 1 + ty, ink.deep);
    p.put(tx - dir, by - 1 + ty, P.stone[1]);
  };
  wing(5, -1);
  wing(7, 1);
  // 身体与头：白色，腹下一抹灰影，橙色短喙朝右
  p.put(5, by, P.white).put(6, by, P.white).put(7, by, P.white);
  p.put(6, by - 1, P.white).put(7, by - 1, P.white);
  p.put(5, by + 1, P.stone[3]).put(6, by + 1, P.snow[1]);
  p.put(8, by - 1, P.gold[2]);
  p.put(7, by - 2, P.white);
  return p;
}
