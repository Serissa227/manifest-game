// 第六批追加的商品图标：古籍（books）。
// 风格与 goods.ts 一致：16×16、透明底、1 像素深色描边、左上受光、2–3 阶明暗；内容画在中间 14×14 内。
import { Px } from "../px";
import { P, canvas, ink, outline } from "./kit";

type Maker = () => Px;

/** 酒红皮面：[深边, 暗, 基, 受光, 高光] */
const LEATHER = [P.red[0], P.cloth.crimson[0], P.red[1], P.cloth.crimson[1], P.red[2]] as const;
/** 金饰：[暗, 基, 亮, 高光] */
const GILT = [P.gold[1], P.gold[2], P.gold[3], P.gold[4]] as const;

/**
 * 古籍：一本厚厚的酒红皮面古书，左侧书脊上三道金箍，封面四角包金、正中一枚金色的菱形纹章，
 * 右沿一条带铆钉的金搭扣；上沿与右沿露出一页页米色的纸边。
 */
const books: Maker = () => {
  const p = canvas();
  // 书页：上沿一条、右沿一列（一道道纸边）
  for (let x = 4; x <= 12; x++) p.put(x, 2, x === 12 ? P.parchment : P.paper);
  for (let y = 3; y <= 13; y++) p.put(13, y, y % 2 === 0 ? P.parchment : P.paper);
  p.put(13, 14, P.parchmentDark);
  // 封面：左侧与上沿受光，右沿与下沿背光
  for (let y = 3; y <= 14; y++) {
    for (let x = 5; x <= 12; x++) {
      let c: string = LEATHER[2];
      if (x <= 6 || y === 3) c = LEATHER[3];
      if (x === 12 || y === 14) c = LEATHER[1];
      p.put(x, y, c);
    }
  }
  // 书脊：受光的圆背、与封面之间的一道凹槽，三道金箍
  for (let y = 3; y <= 14; y++) {
    p.put(2, y, LEATHER[4]).put(3, y, LEATHER[3]).put(4, y, LEATHER[0]);
  }
  for (const y of [5, 9, 13]) p.put(2, y, GILT[2]).put(3, y, GILT[1]);
  // 包金的四角
  p.put(5, 3, GILT[3]).put(6, 3, GILT[2]).put(5, 4, GILT[2]);
  p.put(11, 3, GILT[1]).put(12, 3, GILT[1]).put(12, 4, GILT[0]);
  p.put(5, 13, GILT[1]).put(5, 14, GILT[1]).put(6, 14, GILT[0]);
  p.put(12, 13, GILT[0]).put(11, 14, GILT[0]).put(12, 14, GILT[0]);
  // 正中的菱形纹章
  p.put(8, 6, GILT[2]).put(7, 7, GILT[2]).put(8, 7, GILT[3]).put(9, 7, GILT[1]).put(8, 8, GILT[1]);
  p.put(8, 10, GILT[1]).put(7, 11, GILT[0]).put(8, 11, GILT[1]).put(9, 11, GILT[0]);
  // 右沿的金搭扣与铆钉
  p.put(11, 8, GILT[1]).put(12, 8, GILT[3]).put(13, 8, GILT[1]);
  p.put(11, 9, GILT[0]).put(12, 9, GILT[1]).put(13, 9, GILT[0]);
  return outline(p, ink.brown);
};

/** 第六批追加的商品（key 同 goods.toml，追加在末尾）→ 专属图样。 */
export const GOOD_ICONS_BOOKS: Record<string, Maker> = {
  books,
};
