// 设施招牌图样：九种设施各一个 9×9 的图样，各风格共用同一图样（只换招牌底板与边框），
// 玩家不看文字也能认出设施。图样用字符网格定义，可以直接改这里的网格换图。
import type { Facility } from "../../store/game";
import { P } from "../palette";
import type { Px } from "../px";

/** 图样字符 → 颜色。F/f/g 是旗色（亮、中、暗），由调用方传入。 */
function keyOf(flag: readonly string[]): Record<string, string> {
  return {
    Y: P.gold[4],
    y: P.gold[3],
    o: P.gold[2],
    O: P.gold[1],
    W: P.white,
    w: P.plaster[2],
    R: P.red[3],
    r: P.red[2],
    I: P.iron[3],
    i: P.iron[2],
    j: P.iron[1],
    B: P.wood[4],
    b: P.wood[3],
    d: P.wood[2],
    D: P.wood[1],
    P: P.paper,
    p: P.parchmentDark,
    S: P.stone[4],
    s: P.stone[3],
    t: P.stone[2],
    F: flag[2],
    f: flag[1],
    g: flag[0],
  };
}

/** 九种图样（9×9）。 */
export const EMBLEMS: Readonly<Record<Facility, readonly string[]>> = {
  // 交易所：天平
  market: [
    "....Y....", //
    ".oooyooo.",
    ".O..o..O.",
    "O.O.o.O.O",
    "yyy.o.yyy",
    "....o....",
    "....o....",
    "...ooo...",
    "..OOOOO..",
  ],
  // 造船厂：锚与锤（锤斜压在锚后）
  shipyard: [
    "....I..bb",
    "...I.Ibbd",
    "....I..d.",
    ".IIIIIId.",
    "....Id...",
    "...dI....",
    "I.d.I...I",
    "II..I..II",
    ".iiiiiii.",
  ],
  // 酒馆：带泡沫的酒杯
  tavern: [
    ".WWWW....",
    "WWWWWW...",
    "bbbbbdoo.",
    "byyyyyo.o",
    "bbbbbdo.o",
    "bbbbbdo.o",
    "byyyyyo.o",
    "bbbbbdoo.",
    ".DDDDD...",
  ],
  // 商会：卷轴与印章
  guild: [
    "b.......b",
    "dPPPPPPPd",
    "dPppppPPd",
    "dPPPPPPPd",
    "dPpppPPPd",
    "dPPPPrRrd",
    "dPpPPrrrd",
    "dPPPPPPPd",
    "b.......b",
  ],
  // 银行：钱币（方孔）
  bank: [
    "..ooooo..",
    ".oyyyyyo.",
    "oyYyyyyoO",
    "oyy...yoO",
    "oyy.O.yoO",
    "oyy...yoO",
    "oyyyyyyoO",
    ".ooooooO.",
    "..OOOOO..",
  ],
  // 期货交易所：钟面与行情板
  exchange: [
    "..IIIII..",
    ".IWWjWWI.",
    ".IWWjWWI.",
    ".IWWjjjI.",
    "..IIIII..",
    "jjjjjjjjj",
    "jRjyjRjyj",
    "jRjyyRjyj",
    "jjjjjjjjj",
  ],
  // 仓库：木箱
  warehouse: [
    "DDDDDDDDD",
    "DbbbbbbdD",
    "DbDbbbDdD",
    "DbbDbDbdD",
    "DbbbDbbdD",
    "DbbDbDbdD",
    "DbDbbbDdD",
    "DddddddDD",
    "DDDDDDDDD",
  ],
  // 港口投资：卷轴与柱
  invest: [
    "SSSSSSSSS",
    ".sssssst.",
    "..SsSst..",
    "bPPPPPPPb",
    "dpppppppd",
    "..SsSst..",
    "..SsSst..",
    ".sssssst.",
    "ttttttttt",
  ],
  // 势力办事处：旗杆与势力旗
  office: [
    "Y........",
    "oFFFFFF..",
    "oFFFFFFF.",
    "oFFWFFFF.",
    "offfffff.",
    "offfffg..",
    "o........",
    "o........",
    "O........",
  ],
};

/** 把图样画到 (x, y)；flag 是旗色色阶（取前三阶：暗、中、亮）。 */
export function drawEmblem(p: Px, fac: Facility, x: number, y: number, flag: readonly string[]): void {
  p.stamp(EMBLEMS[fac], keyOf(flag), x, y);
}
