// 舞台比街景高时向上延伸天空（纯函数，可在 Node 中预览与测试）。
import { P } from "../art/palette";
import { Px, rgba } from "../art/px";

const SKY_DAY = rgba(P.sky[0]);

/**
 * 舞台比街景高时，把街景贴在底部，上方接着天空：逐列沿用街景最上一行的颜色，越往上越多地抖入更深的天色，
 * 不留一条平涂的色带。out 尺寸合适时复用，避免每帧分配。deep 为更深的天色（夜里、阴雨天由调用方按天空给出；缺省为白天的深蓝）。
 */
export function extendSky(scene: Px, height: number, out?: Px, deep?: string): Px {
  const extra = height - scene.h;
  if (extra <= 0) return scene;
  const SKY_DEEP = deep ? rgba(deep) : SKY_DAY;
  const px = out && out.w === scene.w && out.h === height ? out : new Px(scene.w, height);
  const W = scene.w;
  px.data.set(scene.data, extra * W);
  for (let y = 0; y < extra; y++) {
    const depth = 1 - y / extra; // 最上方为 1
    const level = depth > 0.8 ? 3 : depth > 0.55 ? 2 : depth > 0.3 ? 1 : 0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const hit =
        level === 3 ? !(x % 2 === 1 && y % 2 === 1) : level === 2 ? (x + y) % 2 === 0 : level === 1 ? x % 2 === 0 && y % 2 === 0 : false;
      px.data[row + x] = hit ? SKY_DEEP : scene.data[x];
    }
  }
  return px;
}
