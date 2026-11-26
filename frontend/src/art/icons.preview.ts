// 图标预览（npx vite-node scripts/art-preview.ts icons）：全部界面图标、商品图标与类别兜底图样的放大总览，
// 分别放在浅色（羊皮纸）与深色（木框）底上检查描边与可读性；另附 1 倍原大小的一排，检查实际观感。
// new-* 为航海历 1502 年追加的图标：10 个殖民与探险图标、14 个殖民建筑图标、33 种商品图标。
// sky-* 为第四批追加的天况与时刻图标（9 个）与 8 个方向的风向小箭头（顶栏在木板底上显示）。
import { ICON_NAMES, GOOD_ICON_KEYS, SKY_ICON_NAMES, drawGoodIcon, drawIcon, drawSkyIcon, drawWindIcon } from "./icons";
import { P } from "./palette";
import { Px, sheet, type Preview } from "./px";

const CATEGORIES = ["粮食", "原料", "矿产", "嗜好品", "奢侈品", "加工品", "军需", "未知"];
/** 原有的界面图标与商品图标个数。 */
const OLD_UI = 47;
const OLD_GOODS = 38;

function onBg(items: readonly Px[], bg: string, cols: number): Px {
  const s = sheet(items, { cols, gap: 4, pad: 4 });
  return new Px(s.w, s.h).fill(bg).blit(s, 0, 0);
}

export default function preview(): Preview[] {
  const ui = ICON_NAMES.map((n) => drawIcon(n));
  const goods = GOOD_ICON_KEYS.map((k) => drawGoodIcon(k));
  const cats = CATEGORIES.map((c) => drawGoodIcon(`__${c}`, c));
  const newUi = ui.slice(OLD_UI);
  const newGoods = goods.slice(OLD_GOODS);
  const sky = [...SKY_ICON_NAMES.map((n) => drawSkyIcon(n)), ...Array.from({ length: 8 }, (_, d) => drawWindIcon(d))];
  return [
    { name: "ui-light", px: onBg(ui, P.parchment, 12), scale: 6 },
    { name: "ui-dark", px: onBg(ui, P.wood[1], 12), scale: 6 },
    { name: "goods-light", px: onBg([...goods, ...cats], P.parchment, 12), scale: 6 },
    { name: "goods-dark", px: onBg([...goods, ...cats], P.wood[1], 12), scale: 6 },
    { name: "new-ui-light", px: onBg(newUi, P.parchment, 12), scale: 8 },
    { name: "new-ui-dark", px: onBg(newUi, P.wood[1], 12), scale: 8 },
    { name: "new-goods-light", px: onBg(newGoods, P.parchment, 11), scale: 8 },
    { name: "new-goods-dark", px: onBg(newGoods, P.wood[1], 11), scale: 8 },
    { name: "actual-size", px: onBg([...ui, ...goods], P.paper, 24), scale: 2 },
    { name: "actual-size-new", px: onBg([...newUi, ...newGoods], P.paper, 19), scale: 2 },
    { name: "sky-light", px: onBg(sky, P.parchment, 9), scale: 8 },
    { name: "sky-dark", px: onBg(sky, P.wood[1], 9), scale: 8 },
    { name: "sky-actual", px: onBg(sky, P.wood[1], 17), scale: 2 },
  ];
}
