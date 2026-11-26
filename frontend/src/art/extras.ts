// 面板用的少量额外小图：商队驮畜、产业图标、可信度火漆印、海战的海面格与风向罗盘、涨跌箭头、护卫、图钉。
// 由 panels-polish 维护；界面代码只依赖本文件导出的函数签名，画法可以随意重写。
// 全部为原创像素画：共享调色板 + 确定性随机，光源在左上，描边用 ink.brown / ink.blue 而不是纯黑。
import { P, ink, overlay } from "./palette";
import { Px, type Pt } from "./px";
import { memo } from "./render";
import { rng } from "./rng";

// ───────────────────────── 通用小工具 ─────────────────────────

/**
 * 给剪影上色：顶边受光、底边与右边背光，其余为中间阶（光源在左上）。
 * ramp 由暗到亮，至少 3 阶；第 4 阶（若有）用于左上角的高光点。
 */
function shade(mask: Px, ramp: readonly string[]): Px {
  const dark = ramp[0];
  const mid = ramp[1];
  const light = ramp[2];
  const hi = ramp[3] ?? ramp[2];
  const out = new Px(mask.w, mask.h);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.isOpaque(x, y)) continue;
      const up = mask.isOpaque(x, y - 1);
      const down = mask.isOpaque(x, y + 1);
      const left = mask.isOpaque(x - 1, y);
      const right = mask.isOpaque(x + 1, y);
      let c = mid;
      if (!up && !left) c = hi;
      else if (!up) c = light;
      else if (!down) c = dark;
      else if (!right) c = dark;
      else if (!left && right) c = light;
      out.put(x, y, c);
    }
  }
  return out;
}

/** 先画剪影（纯色），再按 ramp 上色后贴到 dst。 */
function solid(dst: Px, ramp: readonly string[], draw: (m: Px) => void): Px {
  const m = new Px(dst.w, dst.h);
  draw(m);
  return dst.blit(shade(m, ramp), 0, 0);
}

/** 描边 + 地面投影：返回四周扩 1 像素、底部再多 1 像素投影的新图。 */
function finish(p: Px, outline: string = ink.brown, shadow = true): Px {
  const o = p.outlined(outline);
  if (!shadow) return o;
  const out = new Px(o.w, o.h + 1);
  const b = o.bounds();
  if (b) out.ellipse(b.x + b.w / 2, o.h - 1, Math.max(2, b.w / 2 - 1), 1, overlay.shadow);
  return out.blit(o, 0, 0);
}

// ───────────────────────── 商队驮畜 ─────────────────────────

/** 驮畜的种类数（caravans.toml 的顺序：0 驮骡、1 骆驼、2 牛车、3 马车）。 */
export const ANIMAL_KINDS = 4;

/** 驮骡：灰褐色，长耳，背上驮着两捆货与红鞍毯。 */
function mule(frame: number): Px {
  const p = new Px(22, 16);
  const coat = P.cloth.brown;
  const dark = [ink.brown, coat[0], coat[1]] as const;
  const step = frame % 2;
  // 远侧的腿（更暗）
  solid(p, dark, (m) => {
    m.rect(6, 11, 2, 5 - step, "#000");
    m.rect(13, 11, 2, 4 + step, "#000");
  });
  // 尾巴
  p.line(3, 8, 1, 12, coat[0]).set(1, 13, ink.brown).set(2, 12, coat[0]);
  // 躯干、脖子、头
  solid(p, [coat[0], coat[1], coat[2], P.wood[3]], (m) => {
    m.ellipse(9.5, 9, 6.5, 3, "#000");
    m.poly(
      [
        [13, 10],
        [15, 5],
        [17, 3],
        [18.5, 7],
        [16.5, 11],
      ],
      "#000",
    );
    m.poly(
      [
        [16, 4],
        [19, 3],
        [21.5, 6],
        [21.5, 8],
        [19, 8],
        [16, 6],
      ],
      "#000",
    );
    // 近侧的腿
    m.rect(4, 11, 2, 4 + step, "#000");
    m.rect(15, 11, 2, 5 - step, "#000");
  });
  // 耳朵（远耳暗、近耳亮）
  p.vline(16, 1, 3, coat[0]).vline(17, 0, 3, coat[1]).set(17, 0, coat[2]);
  // 鬃毛
  p.line(15, 5, 17, 3, P.hair.dark[1]).set(14, 7, P.hair.dark[1]);
  // 口鼻与眼
  p.rect(20, 6, 2, 2, P.parchment).set(21, 7, P.parchmentDark);
  p.set(19, 5, ink.deep);
  // 蹄
  for (const x of [4, 5, 15, 16]) p.set(x, x < 10 ? 14 + step : 15 - step, P.iron[1]);
  // 鞍毯
  p.rect(6, 6, 8, 4, P.red[2]).hline(6, 13, 9, P.red[1]).hline(6, 13, 6, P.red[3]);
  p.set(6, 10, P.gold[3]).set(13, 10, P.gold[3]);
  // 两捆货（奶白麻袋，麻绳捆扎）
  solid(p, [P.cloth.cream[0], P.cloth.cream[1], P.cloth.cream[2], P.white], (m) => {
    m.ellipse(8, 4, 2.5, 2, "#000");
    m.ellipse(12.5, 3.5, 2.5, 2.2, "#000");
  });
  p.vline(8, 2, 5, P.wood[2]).vline(12, 2, 5, P.wood[2]).set(8, 6, P.wood[1]).set(12, 6, P.wood[1]);
  return p;
}

/** 骆驼：沙色，单峰，峰上搭条纹鞍毯（赤砂风情）。 */
function camel(frame: number): Px {
  const p = new Px(24, 18);
  const s = P.sand;
  const step = frame % 2;
  solid(p, [ink.brown, s[0], s[1]], (m) => {
    m.rect(6, 12, 1, 6 - step, "#000");
    m.rect(15, 12, 1, 5 + step, "#000");
  });
  // 尾巴
  p.line(4, 9, 3, 13, s[1]).set(3, 14, ink.brown);
  solid(p, [s[1], s[2], s[3], s[4]], (m) => {
    m.ellipse(10, 10.5, 6, 3, "#000");
    m.ellipse(9, 6.5, 3.5, 3, "#000");
    // 长颈：先向前下，再弯向上
    m.poly(
      [
        [14, 9],
        [18, 9],
        [19, 4],
        [21, 3],
        [21, 6],
        [20, 10],
        [16, 13],
      ],
      "#000",
    );
    m.ellipse(21, 3, 1.6, 1.4, "#000");
    m.rect(21, 3, 3, 2, "#000");
    // 近侧的腿（细长，有膝）
    m.rect(5, 12, 2, 5 + step, "#000");
    m.rect(16, 12, 2, 6 - step, "#000");
  });
  // 膝与蹄
  p.set(5, 14, s[1]).set(17, 15, s[1]);
  p.hline(5, 6, 16 + step, s[0]).hline(16, 17, 17 - step, s[0]);
  // 眼、耳、鼻
  p.set(21, 2, ink.deep).set(20, 1, s[2]).set(23, 4, s[1]);
  // 条纹鞍毯与流苏
  p.rect(6, 4, 7, 4, P.red[2]);
  p.hline(6, 12, 5, P.teal[3]).hline(6, 12, 7, P.gold[3]).hline(6, 12, 4, P.red[3]);
  for (let x = 6; x <= 12; x += 2) p.set(x, 8, P.red[1]);
  return p;
}

/** 牛车：黑褐色水牛拉一辆两轮木车，车上堆着麻袋。 */
function oxCart(frame: number): Px {
  const p = new Px(32, 16);
  const hide = P.hair.dark;
  const w = P.wood;
  const step = frame % 2;
  // 车辕
  p.line(14, 8, 20, 8, w[2]).line(14, 9, 20, 9, w[0]);
  // 牛：远侧的腿
  solid(p, [ink.brown, hide[0], hide[0]], (m) => {
    m.rect(19, 11, 2, 5 - step, "#000");
    m.rect(26, 11, 2, 4 + step, "#000");
  });
  // 尾巴
  p.line(18, 6, 17, 10, hide[1]).set(17, 11, ink.brown);
  solid(p, [hide[0], hide[1], hide[2], P.cloth.brown[2]], (m) => {
    // 厚实的躯干与肩峰
    m.ellipse(23, 8, 5.5, 3.5, "#000");
    m.ellipse(26, 5.5, 2.5, 2, "#000");
    // 前伸低垂的头
    m.poly(
      [
        [27, 5],
        [30, 6],
        [31.5, 9],
        [30.5, 11],
        [28, 10.5],
      ],
      "#000",
    );
    // 近侧的腿（粗短）
    m.rect(18, 10, 3, 5 + step, "#000");
    m.rect(27, 10, 3, 6 - step, "#000");
  });
  // 肚皮的反光与腿上的暗线
  p.hline(20, 26, 11, hide[0]);
  // 弯角（奶白，向两侧后弯）
  p.line(27, 4, 29, 3, P.cloth.cream[2]).set(26, 4, P.cloth.cream[1]).set(30, 3, P.cloth.cream[1]).set(30, 2, P.cloth.cream[0]);
  p.set(29, 7, P.white).set(30, 7, ink.deep);
  p.rect(30, 9, 2, 2, P.skin[1]).set(31, 10, P.skin[0]);
  // 蹄
  for (const x of [18, 19, 20]) p.set(x, 14 + step, P.iron[1]);
  for (const x of [27, 28, 29]) p.set(x, 15 - step, P.iron[1]);
  // 轭
  p.rect(25, 3, 1, 6, w[3]).set(25, 3, w[4]).hline(24, 26, 3, w[2]);
  // 车身
  solid(p, [w[0], w[2], w[3], w[4]], (m) => {
    m.rect(1, 6, 15, 4, "#000");
  });
  p.hline(1, 15, 8, w[1]);
  for (const x of [1, 6, 11, 15]) p.vline(x, 4, 9, w[1]);
  // 麻袋
  solid(p, [P.straw[0], P.straw[1], P.straw[2], P.straw[3]], (m) => {
    m.ellipse(4.5, 4.5, 3, 2, "#000");
    m.ellipse(10, 4, 3, 2.5, "#000");
    m.ellipse(7, 2.5, 2.5, 2, "#000");
  });
  p.set(10, 3, P.straw[0]).set(4, 4, P.straw[0]).set(7, 2, P.straw[0]);
  // 车轮（带辐条）
  p.ring(8, 11.5, 3.5, 3.5, w[0]);
  p.ring(8, 11.5, 2.5, 2.5, w[3]);
  p.line(6, 10, 10, 13, w[2]).line(10, 10, 6, 13, w[2]);
  p.rect(7, 11, 2, 1, P.iron[2]);
  return p;
}

/** 马车：栗色马拉一辆带篷的四轮货车。 */
function wagon(frame: number): Px {
  const p = new Px(34, 18);
  const coat = P.hair.auburn;
  const w = P.wood;
  const step = frame % 2;
  // 车辕
  p.line(15, 11, 22, 10, w[1]);
  solid(p, [ink.brown, coat[0], coat[0]], (m) => {
    m.rect(22, 11, 2, 7 - step, "#000");
    m.rect(29, 11, 2, 6 + step, "#000");
  });
  // 马尾
  p.line(20, 7, 19, 12, P.hair.dark[1]).set(19, 13, P.hair.dark[0]).set(20, 8, P.hair.dark[2]);
  solid(p, [coat[0], coat[1], coat[2], P.autumn[3]], (m) => {
    m.ellipse(25.5, 9, 5, 3, "#000");
    m.poly(
      [
        [28, 9],
        [30, 3],
        [32, 2],
        [33.5, 5],
        [32, 6],
        [31, 10],
      ],
      "#000",
    );
    m.rect(21, 11, 2, 6 + step, "#000");
    m.rect(30, 11, 2, 7 - step, "#000");
  });
  // 鬃毛、耳、眼、白鼻梁
  p.line(29, 4, 30, 2, P.hair.dark[1]).line(28, 6, 29, 5, P.hair.dark[1]);
  p.set(31, 1, coat[1]).set(32, 3, ink.deep).set(33, 5, P.cloth.cream[1]);
  for (const x of [21, 22]) p.set(x, 16 + step, P.cloth.cream[2]);
  for (const x of [30, 31]) p.set(x, 17 - step, P.cloth.cream[2]);
  // 马具
  p.hline(24, 29, 8, P.wood[0]).set(27, 7, P.gold[3]).set(26, 8, P.gold[2]);
  // 车身
  solid(p, [w[0], w[2], w[3], w[4]], (m) => m.rect(1, 9, 16, 4, "#000"));
  p.hline(1, 16, 11, w[1]);
  // 篷布（奶白拱顶，带暗缝）
  solid(p, [P.cloth.cream[0], P.cloth.cream[1], P.cloth.cream[2], P.white], (m) => {
    m.poly(
      [
        [1, 9],
        [2, 3],
        [5, 1],
        [13, 1],
        [16, 3],
        [16, 9],
      ],
      "#000",
    );
  });
  for (const x of [5, 9, 13]) p.vline(x, 2, 8, P.cloth.cream[0]);
  p.rect(16, 4, 1, 5, P.cloth.cream[0]);
  // 前后两个车轮
  for (const cx of [4, 13]) {
    p.ring(cx, 14, 2.5, 2.5, w[0]);
    p.set(cx, 14, P.iron[2]).set(cx - 1, 13, w[3]).set(cx + 1, 15, w[1]);
  }
  return p;
}

/**
 * 驮畜小图（面朝右，带描边与地面投影）。index 为 caravans.toml 中的顺序：0 驮骡、1 骆驼、2 牛车、3 马车；
 * 越界时取模。frame 0/1 为两帧迈步。宽 24–36、高 19–21（含描边与投影）。
 */
export function drawAnimal(index: number, frame = 0): Px {
  const i = ((index % ANIMAL_KINDS) + ANIMAL_KINDS) % ANIMAL_KINDS;
  const f = ((frame % 2) + 2) % 2;
  return memo(`extras-animal-${i}-${f}`, () => finish([mule, camel, oxCart, wagon][i](f)));
}

/** 护卫：尖底盾与长矛（14×16）。 */
export function drawGuard(): Px {
  return memo("extras-guard", () => {
    const p = new Px(12, 14);
    // 长矛（斜在盾后），矛头为柳叶形
    p.line(1, 13, 9, 3, P.wood[2]).line(2, 13, 10, 3, P.wood[1]);
    p.poly(
      [
        [9, 3],
        [10, 0],
        [12, 0],
        [11, 3],
      ],
      P.iron[3],
    );
    p.set(11, 1, P.iron[2]).set(10, 3, P.iron[2]);
    // 尖底盾：朱红底、金色十字与边
    solid(p, [P.red[1], P.red[2], P.red[3], P.red[4]], (m) =>
      m.poly(
        [
          [1, 4],
          [9, 4],
          [9, 9],
          [5, 13.5],
          [1, 9],
        ],
        "#000",
      ),
    );
    p.vline(5, 5, 12, P.gold[3]).hline(2, 8, 7, P.gold[3]).set(5, 7, P.gold[4]);
    p.hline(1, 9, 4, P.gold[2]);
    return finish(p, ink.brown, false);
  });
}

// ───────────────────────── 产业图标 ─────────────────────────

/** 产业类型数（recipes.toml 的 industries 顺序：0 种植园、1 矿场、2 作坊、3 工场）。 */
export const INDUSTRY_KINDS = 4;

/** 种植园：田垄上一株大嫩芽，旁边是一束麦穗。 */
function plantation(): Px {
  const p = new Px(22, 22);
  // 田垄
  solid(p, [P.wood[0], P.wood[1], P.wood[2], P.wood[3]], (m) => m.ellipse(11, 17.5, 10, 3.5, "#000"));
  for (const y of [16, 18]) p.hline(3, 19, y, P.wood[0]);
  for (let x = 3; x <= 19; x += 4) {
    p.set(x, 15, P.leaf[3]).set(x + 1, 14, P.leaf[4]).set(x - 1, 14, P.leaf[2]);
  }
  // 嫩芽：茎与两片大叶
  p.vline(12, 7, 16, P.leaf[1]).vline(13, 8, 16, P.leaf[2]);
  solid(p, [P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]], (m) => {
    m.poly(
      [
        [12, 8],
        [8, 3],
        [5, 5],
        [8, 9],
      ],
      "#000",
    );
    m.poly(
      [
        [13, 9],
        [15, 3],
        [20, 1],
        [19, 6],
      ],
      "#000",
    );
  });
  p.line(8, 5, 11, 8, P.leaf[1]).line(18, 3, 14, 8, P.leaf[2]);
  return p;
}

/** 矿场：岩丘上木框加固的矿洞，门前斜靠一把镐。 */
function mine(): Px {
  const p = new Px(22, 22);
  const r = rng("extras-mine");
  solid(p, [P.stone[0], P.stone[1], P.stone[2], P.stone[3]], (m) =>
    m.poly(
      [
        [0, 21],
        [3, 11],
        [8, 5],
        [12, 4],
        [16, 7],
        [20, 13],
        [22, 21],
      ],
      "#000",
    ),
  );
  // 岩缝与矿脉
  p.line(5, 12, 7, 15, P.stone[1]).line(15, 9, 17, 12, P.stone[1]);
  for (let i = 0; i < 4; i++) {
    const x = r.int(5, 16);
    const y = r.int(7, 11);
    p.set(x, y, P.gold[3]).set(x + 1, y, P.gold[2]);
  }
  // 矿洞
  p.rect(8, 13, 7, 9, P.night[0]).rect(9, 12, 5, 1, P.night[0]);
  p.rect(9, 14, 5, 7, P.night[1]).set(11, 15, P.lamp[1]);
  // 木框
  p.rect(7, 12, 1, 10, P.wood[2]).rect(15, 12, 1, 10, P.wood[1]);
  p.rect(6, 11, 11, 2, P.wood[3]).hline(6, 16, 12, P.wood[1]);
  // 铁轨
  p.hline(8, 20, 21, P.iron[2]);
  // 镐
  p.line(16, 21, 20, 13, P.wood[3]).line(17, 21, 21, 13, P.wood[1]);
  p.line(17, 13, 21, 11, P.iron[3]).set(22, 12, P.iron[2]).line(18, 12, 17, 14, P.iron[2]);
  return p;
}

/** 作坊：木墩上的铁砧，上方悬着锤子与火花。 */
function workshop(): Px {
  const p = new Px(22, 22);
  // 木墩
  solid(p, [P.wood[0], P.wood[1], P.wood[2], P.wood[3]], (m) => m.rect(6, 15, 9, 7, "#000"));
  p.hline(6, 14, 15, P.wood[4]).vline(9, 16, 21, P.wood[1]).vline(12, 17, 20, P.wood[1]);
  // 铁砧：顶面、腰、角
  solid(p, [P.iron[0], P.iron[1], P.iron[2], P.iron[3]], (m) => {
    m.poly(
      [
        [3, 9],
        [18, 9],
        [18, 12],
        [15, 12],
        [14, 15],
        [7, 15],
        [6, 12],
        [4, 11],
      ],
      "#000",
    );
    m.poly(
      [
        [18, 9],
        [21, 10],
        [18, 11],
      ],
      "#000",
    );
  });
  p.hline(4, 17, 9, P.iron[3]);
  // 锤：斜放在砧面上方，木柄 + 铁锤头
  p.line(10, 7, 19, 2, P.wood[3]).line(10, 8, 19, 3, P.wood[1]);
  solid(p, [P.iron[0], P.iron[1], P.iron[2], P.iron[3]], (m) =>
    m.poly(
      [
        [5, 5],
        [8, 2],
        [13, 7],
        [10, 10],
      ],
      "#000",
    ),
  );
  // 火花
  for (const [x, y] of [
    [2, 3],
    [4, 1],
    [1, 6],
    [15, 7],
    [17, 6],
  ] as Pt[]) {
    p.set(x, y, P.lamp[2]);
  }
  p.set(3, 2, P.lamp[1]).set(16, 6, P.gold[3]);
  return p;
}

/** 工场：锯齿屋顶的砖房，高烟囱冒着烟，窗里亮着灯。 */
function factory(): Px {
  const p = new Px(22, 22);
  // 烟
  solid(p, [P.stone[2], P.stone[3], P.stone[4], P.white], (m) => {
    m.circle(16, 4, 2.5, "#000");
    m.circle(19, 2, 2, "#000");
    m.circle(13, 2, 1.5, "#000");
  });
  // 烟囱
  solid(p, [P.brick[0], P.brick[1], P.brick[2], P.brick[3]], (m) => m.rect(15, 5, 3, 10, "#000"));
  p.hline(14, 18, 5, P.brick[1]);
  // 墙
  solid(p, [P.brick[0], P.brick[1], P.brick[2], P.brick[3]], (m) => m.rect(1, 12, 20, 10, "#000"));
  for (let y = 13; y < 22; y += 2) p.hline(1, 20, y, P.brick[1]);
  // 锯齿屋顶
  solid(p, [P.slate[0], P.slate[1], P.slate[2], P.slate[3]], (m) => {
    for (const x of [1, 7, 13]) {
      m.poly(
        [
          [x, 12],
          [x, 7],
          [x + 6, 12],
        ],
        "#000",
      );
    }
  });
  for (const x of [1, 7, 13]) p.vline(x, 7, 12, P.lamp[1]);
  // 窗与门
  for (const x of [3, 9]) p.rect(x, 15, 3, 3, P.lamp[1]).set(x, 15, P.lamp[2]).hline(x, x + 2, 17, P.lamp[0]);
  p.rect(15, 16, 4, 6, P.wood[0]).rect(16, 17, 2, 5, P.wood[1]);
  return p;
}

/** 产业图标（24×24，带描边）。index 为产业类型顺序：0 种植园、1 矿场、2 作坊、3 工场；越界时取模。 */
export function drawIndustryIcon(index: number): Px {
  const i = ((index % INDUSTRY_KINDS) + INDUSTRY_KINDS) % INDUSTRY_KINDS;
  return memo(`extras-industry-${i}`, () => finish([plantation, mine, workshop, factory][i](), ink.brown, false));
}

// ───────────────────────── 火漆印、图钉、箭头 ─────────────────────────

/** 3×5 像素数字。 */
const DIGITS: Record<string, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
};

function digits(p: Px, text: string, x: number, y: number, c: string): void {
  let cx = x;
  for (const ch of text) {
    const g = DIGITS[ch];
    if (g) p.stamp(g, { "#": c }, cx, y);
    cx += 4;
  }
}

/**
 * 可信度火漆印（20×20：一滴压扁的封蜡，边缘不规则，中间压出一圈凸起的印环与两位数字）。
 * 可信度越低，蜡色越暗越褪、裂纹越多、边缘崩掉的缺口越多——印得清楚与否本身就是可信度的暗示。credibility 取 0–100。
 */
export function drawSeal(credibility: number): Px {
  const v = Math.max(0, Math.min(99, Math.round(credibility)));
  return memo(`extras-seal-${v}`, () => {
    const p = new Px(20, 20);
    // 可信度高：鲜红封蜡；中：暗红；低：褪成赭褐
    const ramp = v >= 80 ? [P.red[0], P.red[1], P.red[2], P.red[3]] : v >= 55 ? [P.red[0], P.cloth.crimson[0], P.red[1], P.red[2]] : [P.wood[0], P.autumn[0], P.autumn[1], P.autumn[2]];
    const [deep, dark, face, lit] = ramp;
    // 压出的字比蜡面亮一阶，读得清
    const emboss = v >= 80 ? P.red[4] : v >= 55 ? P.red[3] : P.autumn[3];
    const r = rng(`seal-${v}`);
    // 蜡滴的轮廓：按角度起伏的圆，外加两处溢出的小蜡珠
    const wobble = Array.from({ length: 12 }, () => r.next());
    const edge = (a: number) => {
      const t = ((a / (Math.PI * 2)) * 12 + 12) % 12;
      const i = Math.floor(t);
      const f = t - i;
      return 8.2 + (wobble[i] * (1 - f) + wobble[(i + 1) % 12] * f - 0.5) * 1.4;
    };
    const blobs: [number, number, number][] = [
      [3.6 + r.next() * 2, 15 + r.next() * 1.5, 1.6],
      [16 + r.next() * 1.2, 5 + r.next() * 3, 1.3],
    ];
    const inside = (x: number, y: number) => {
      const dx = x + 0.5 - 10;
      const dy = y + 0.5 - 10;
      if (Math.hypot(dx, dy) <= edge(Math.atan2(dy, dx))) return true;
      return blobs.some(([bx, by, br]) => Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= br);
    };
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        if (!inside(x, y)) continue;
        // 蜡面受光：左上亮、右下暗，边缘一圈暗
        const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        const l = -((x - 10) * 0.62 + (y - 10) * 0.78) / 9;
        let c = l > 0.45 ? lit : l > -0.35 ? face : dark;
        if (rim) c = l > 0.3 ? face : deep;
        p.put(x, y, c);
      }
    }
    // 压出的印环：左上是阴影、右下是高光（凹进去的一圈）
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const dx = x + 0.5 - 10;
        const dy = y + 0.5 - 10;
        const d = Math.hypot(dx, dy);
        if (d < 5.2 || d > 6.2) continue;
        p.put(x, y, dx + dy < 0 ? dark : lit);
      }
    }
    // 两位数字：凸起的字，右下一格投影
    const s = String(v).padStart(2, "0");
    digits(p, s, 7, 8, deep);
    digits(p, s, 6, 7, emboss);
    // 裂纹与崩口：可信度越低越多
    const cracks = Math.round(((100 - v) / 100) * 5);
    for (let i = 0; i < cracks; i++) {
      const a = r.next() * Math.PI * 2;
      const len = 3 + r.int(0, 3);
      let x = 10 + Math.cos(a) * 8;
      let y = 10 + Math.sin(a) * 8;
      for (let k = 0; k < len; k++) {
        x -= Math.cos(a + (r.next() - 0.5) * 0.8);
        y -= Math.sin(a + (r.next() - 0.5) * 0.8);
        // 裂纹只在印环外，不压到数字
        if (Math.hypot(x - 10, y - 10) > 6.4 && p.isOpaque(Math.floor(x), Math.floor(y))) p.put(x, y, deep);
      }
    }
    const chips = Math.round(((100 - v) / 100) * 16);
    for (let i = 0; i < chips; i++) {
      const a = r.next() * Math.PI * 2;
      const x = Math.floor(10 + Math.cos(a) * (6.5 + r.next() * 2.5));
      const y = Math.floor(10 + Math.sin(a) * (6.5 + r.next() * 2.5));
      p.put(x, y, null);
      if (r.chance(0.6)) p.put(x + 1, y, null);
      if (r.chance(0.4)) p.put(x, y + 1, null);
    }
    return p;
  });
}

/** 图钉（6×6 铜钉，告示卡片用）。 */
export function drawTack(): Px {
  return memo("extras-tack", () => {
    const p = new Px(7, 7);
    p.ellipse(3.5, 4, 2.5, 2, overlay.shadow);
    p.circle(3, 3, 2.5, P.gold[1]);
    p.circle(3, 3, 1.5, P.gold[2]);
    p.set(2, 2, P.gold[4]).set(3, 2, P.gold[3]);
    p.set(1, 3, P.gold[2]);
    return p;
  });
}

/** 涨跌箭头（7×7）：up 绿色向上、down 朱红向下、flat 金色横杠。 */
export function drawTrendArrow(dir: "up" | "down" | "flat"): Px {
  return memo(`extras-trend-${dir}`, () => {
    const p = new Px(7, 7);
    if (dir === "flat") {
      p.rect(1, 2, 5, 3, P.gold[2]).hline(1, 5, 2, P.gold[3]).hline(0, 6, 5, null);
      return p.stroke(0, 1, 7, 5, P.gold[0]);
    }
    const up = dir === "up";
    const ramp = up ? P.leaf : P.red;
    const head: Pt[] = up
      ? [
          [3.5, 0],
          [7, 4],
          [0, 4],
        ]
      : [
          [3.5, 7],
          [7, 3],
          [0, 3],
        ];
    p.poly(head, ramp[3]);
    p.rect(2, up ? 4 : 0, 3, 3, ramp[2]);
    p.set(3, up ? 1 : 5, ramp[4]);
    return p.outlined(up ? ramp[0] : ramp[0]).crop(1, 1, 7, 7);
  });
}

// ───────────────────────── 海战：海面格与风向罗盘 ─────────────────────────

/** 海面贴图（32×32，可无缝平铺）：成团的浅色水纹、水纹下的暗槽与零星浪花。frame 0..3 让浪花错位。 */
export function drawSeaTile(frame = 0): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`extras-seatile-${f}`, () => {
    const W = 32;
    const p = new Px(W, W).fill(P.sea[2]);
    const r = rng("extras-seatile");
    // 横向拉长的水纹：一道 1 像素的亮纹，下方错开一格是更短的暗槽；按坐标取模实现无缝平铺
    const wrap = (x: number, y: number, c: string) => p.set(((x % W) + W) % W, ((y % W) + W) % W, c);
    for (let i = 0; i < 12; i++) {
      const x0 = r.int(0, W - 1);
      const y0 = r.int(0, W - 1);
      const len = r.int(3, 7);
      for (let k = 0; k < len; k++) wrap(x0 + k, y0, P.sea[3]);
      for (let k = 1; k < len - 1; k++) wrap(x0 + k + 1, y0 + 1, P.sea[1]);
    }
    // 浪花（随帧右移 8 像素）
    for (let i = 0; i < 3; i++) {
      const x = r.int(0, W - 1) + f * 8;
      const y = r.int(0, W - 1);
      wrap(x, y, P.foam);
      wrap(x + 1, y, P.sea[4]);
      wrap(x - 1, y + 1, P.sea[4]);
    }
    return p;
  });
}

/** 六角方向（0 东、1 东北、2 西北、3 西、4 西南、5 东南）的单位向量（屏幕坐标，y 向下）。 */
const HEX_DIR: readonly Pt[] = [
  [1, 0],
  [0.5, -0.866],
  [-0.5, -0.866],
  [-1, 0],
  [-0.5, 0.866],
  [0.5, 0.866],
];

/** 风向罗盘（32×32）：黄铜刻度环，粗箭头指向风吹去的方向 dir（六角方向 0–5）。 */
export function drawWindRose(dir: number): Px {
  const d = ((dir % 6) + 6) % 6;
  return memo(`extras-windrose-${d}`, () => {
    const p = new Px(32, 32);
    const c = 15.5;
    // 盘面与投影
    p.circle(c + 1, c + 1, 14, overlay.shadow);
    p.circle(c, c, 14, P.gold[1]);
    p.circle(c, c, 13, P.gold[2]);
    p.circle(c, c, 11, P.paper);
    p.dither(4, 4, 24, 24, P.parchment, 1);
    p.circle(c, c, 11, null);
    p.circle(c, c, 11, P.paper);
    p.ring(c, c, 11, 11, P.parchmentDark);
    // 左上的高光弧
    for (let a = 200; a <= 250; a += 6) {
      const r = (a * Math.PI) / 180;
      p.set(Math.round(c + Math.cos(r) * 13), Math.round(c + Math.sin(r) * 13), P.gold[4]);
    }
    p.ring(c, c, 14, 14, P.gold[0]);
    // 八个刻度
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const long = k % 2 === 0;
      const r0 = long ? 7 : 9;
      p.line(
        Math.round(c + Math.cos(a) * r0),
        Math.round(c + Math.sin(a) * r0),
        Math.round(c + Math.cos(a) * 10),
        Math.round(c + Math.sin(a) * 10),
        long ? P.parchmentDeep : P.parchmentDark,
      );
    }
    // 箭头：单独画在一张图上再描边，箭身与箭头用多边形（斜向也不会断线），受光半边亮、背光半边暗
    const [dx, dy] = HEX_DIR[d];
    let nx = -dy;
    let ny = dx;
    // 让 n 指向受光的左上方
    if (nx + ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const at = (k: number, side: number): Pt => [c + dx * k + nx * side, c + dy * k + ny * side];
    const arrow = new Px(32, 32);
    // 暗半边（整支箭先铺暗色），再叠亮半边
    arrow.poly([at(-8, 1.4), at(3, 1.4), at(3, -1.4), at(-8, -1.4)], P.teal[1]);
    arrow.poly([at(10.5, 0), at(3, 4.5), at(3, -4.5)], P.teal[1]);
    arrow.poly([at(-8, 1.4), at(3, 1.4), at(3, 0), at(-8, 0)], P.teal[3]);
    arrow.poly([at(10.5, 0), at(3, 4.5), at(3, 0)], P.teal[3]);
    // 尾羽
    arrow.poly([at(-8, 0), at(-10.5, 3.5), at(-6, 1)], P.teal[2]);
    arrow.poly([at(-8, 0), at(-10.5, -3.5), at(-6, -1)], P.teal[2]);
    p.blit(arrow.outlined(ink.blue).crop(1, 1, 32, 32), 0, 0);
    // 中心铆钉
    p.rect(15, 15, 2, 2, P.gold[3]).set(15, 15, P.gold[4]).set(16, 16, P.gold[1]);
    return p;
  });
}
