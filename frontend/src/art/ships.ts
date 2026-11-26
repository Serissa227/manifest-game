// 船：侧视图（船头朝右）。large 用于港口码头、船厂与舰队界面，small 用于大地图。
// 接口由界面代码依赖，不要改；画法可以随意重写。
//
// 画法概要（large）：
//   1. 由船型参数（SPECS）算出几何：舷弧线、船体轮廓（艏柱弧线、龙骨、艉部）、艏艉楼、桅位。
//   2. 先画桅杆，再画船体盖住桅脚：按舷弧分层着色（舷缘、舷墙、色带、船板与断续的板缝），
//      水线以下是铜红色船底；再画艏艉楼、炮门、舷窗、艉窗、艏像、锚、舵、艉灯。
//   3. 帆：用多边形蒙版画出鼓起的轮廓，按“到蒙版左右上下边缘的距离”估计受光面（光在左上），
//      分 3 阶奶白色着色，布缝随帆的鼓起弯曲；帆边用最暗一阶。艏三角帆画在横帆后面。
//      帆型：横帆（square，可在桅后再挂一面斜桁帆 spanker）、三角帆（lateen）、斜桁帆（gaff）、
//      东方硬帆（junk：竹骨把赭色篾帆分成一片片，每片的后缘在两根竹骨之间外鼓，帆脚索呈扇形收束）。
//   4. 旗与三角长旗，船体与旗的 1 像素描边，缆绳（只画在空白处，因而总在船体与帆的后面），受损时的烟与火。
//   另有几种船型特有的部件：桨（加莱赛战船，随帧划动）、撞角、龙目、搭接船板与城垛（柯克船）、瞭望斗。
// small 用一组逐像素定位的图元（SMALL），保证 14–22 像素宽内轮廓与帆型仍可辨认。
// 同样的参数永远画出同样的图（受损的破洞用确定性随机）；结果按参数缓存。
//
// 第九批“寰宇·十六世纪”按船型 key 加画了 16 种船（规格在 ./ships16.ts；接口见 drawShipByKey）。
// 新帆型：编席或棉布的矩形帆（rect）、东南亚倾斜的矩形硬帆（tanja）、波利尼西亚的蟹爪帆（crab）、只挂旗的旗杆（pole）。
// 新部件：翘起的艏艉柱、缝合船板、刳木独木舟、圆木排筏与中插板、双体船、楯板墙与板屋、楼阁（安宅船的矢仓）、
// 加莱船艉的条纹篷、棕榈叶篷与小屋、幟（日本的旗指物）、舷外支架、成排的桨手（剪影，不画脸）、披水板、
// 东方船的木碇与开孔大舵、舷侧舵与操舵桨。这些部件只在新船型的规格里出现，经典的 19 种船逐像素不变。
// 新船型的 small 是逐像素画好的字符网格（ships16.ts 的 T16_GLYPHS，见 GlyphSpec），帆、桨、旗与受损按同样的约定随帧与参数变化。
// 界面按船型 key 取图（drawShipByKey、waterlineByKey；船型表 + id → key 见 shipArtKey），drawShip 的下标只认经典世界的顺序。
import { P, ink } from "./palette";
import { Px, rgba, type Pt } from "./px";
import { memo } from "./render";
import { rng, type Rng } from "./rng";
import { BRIGANTINE_GLYPH, BRIGANTINE_SPEC, T16_GLYPHS, T16_KEYS, T16_SPECS } from "./ships16";

export interface ShipArtOpts {
  size: "large" | "small";
  /** 旗帜颜色（势力色，"#rrggbb"） */
  flag?: string;
  /** 海盗船：黑帆（三角帆船为暗红帆）、鱼骨旗 */
  pirate?: boolean;
  /** 帆与旗的飘动（0..SHIP_FRAMES-1） */
  frame?: number;
  /** 受损（破帆、焦痕、烟与火） */
  damaged?: boolean;
}

/** 船帆与旗帜飘动的帧数。 */
export const SHIP_FRAMES = 4;

/** 船型数（ships.toml 中的顺序）。 */
export const SHIP_TYPES = 19;

// ───────────────────────── 颜色工具 ─────────────────────────

export type Ramp3 = readonly [string, string, string];
export type Ramp5 = readonly [string, string, string, string, string];

function toHex(v: number): string {
  return `#${[24, 16, 8].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, "0")).join("")}`;
}

/** 两色按 t（0–1）混合，只用于势力旗这种外部传入的颜色。 */
function mix(a: string, b: string, t: number): string {
  const va = rgba(a);
  const vb = rgba(b);
  let out = 0;
  for (const s of [24, 16, 8]) {
    const c = Math.round(((va >>> s) & 0xff) * (1 - t) + ((vb >>> s) & 0xff) * t);
    out |= c << s;
  }
  return toHex(out >>> 0);
}

/** 合法的 "#rgb" / "#rrggbb" 颜色规范成 "#rrggbb"（去掉透明度），否则返回 null。 */
function cleanColor(c: string | undefined): string | null {
  if (!c) return null;
  try {
    return toHex(rgba(c));
  } catch {
    return null;
  }
}

function frameOf(f: number | undefined): number {
  const n = Number.isFinite(f) ? Math.floor(f as number) : 0;
  return ((n % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
}

// ───────────────────────── 画布：颜色 + 材质 ─────────────────────────

/** 材质：决定描边与缆绳的遮挡关系。 */
const M_HULL = 1;
const M_SAIL = 2;
const M_SPAR = 3;
const M_FLAG = 4;
const M_ROPE = 5;
const M_FX = 6;
const M_EDGE = 7;
const M_PEN = 8;

class Canvas {
  readonly px: Px;
  readonly mat: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Px(w, h);
    this.mat = new Uint8Array(w * h);
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  m(x: number, y: number): number {
    return this.has(x, y) ? this.mat[y * this.w + x] : 0;
  }

  dot(x: number, y: number, c: string | null, m: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.has(x, y)) return;
    this.px.put(x, y, c);
    this.mat[y * this.w + x] = c === null ? 0 : m;
  }

  /** 只画在空白处：缆绳这样画就总在已有东西的后面。 */
  back(x: number, y: number, c: string, m: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (this.has(x, y) && this.mat[y * this.w + x] === 0) this.dot(x, y, c, m);
  }

  rect(x: number, y: number, w: number, h: number, c: string, m: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.dot(xx, yy, c, m);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, m: number, behind = false): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (behind) this.back(x0, y0, c, m);
      else this.dot(x0, y0, c, m);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** 按字符网格贴图（"." 与未列出的字符透明）。 */
  stamp(rows: readonly string[], key: Readonly<Record<string, string>>, x: number, y: number, m: number): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const c = key[row[i]];
        if (c) this.dot(x + i, y + r, c, m);
      }
    }
  }

  /** 给指定材质描 1 像素外边（只描在空白处）。 */
  outline(color: (m: number) => string | null): void {
    const todo: [number, number, string][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.mat[y * this.w + x] !== 0) continue;
        let pick: string | null = null;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as const) {
          const c = color(this.m(nx, ny));
          if (c) {
            pick = c;
            break;
          }
        }
        if (pick) todo.push([x, y, pick]);
      }
    }
    for (const [x, y, c] of todo) this.dot(x, y, c, M_EDGE);
  }
}

// ───────────────────────── 几何小工具 ─────────────────────────

/** 二次贝塞尔曲线采样（含两端）。 */
function quad(a: Pt, c: Pt, b: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/**
 * 从 a 到 b 的一段向外鼓 amt 像素的弧（多边形按屏幕上的顺时针方向绕行时，外侧在前进方向的左手边）。
 * 返回不含 a、含 b 的采样点。
 */
function bulge(a: Pt, b: Pt, amt: number, n = 8): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  const c: Pt = [(a[0] + b[0]) / 2 + nx * amt * 2, (a[1] + b[1]) / 2 + ny * amt * 2];
  return quad(a, c, b, n).slice(1);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 多边形蒙版（以包围盒为界）。 */
interface Mask {
  x0: number;
  y0: number;
  w: number;
  h: number;
  on: Uint8Array;
}

function maskOf(pts: readonly Pt[]): Mask {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)) - 1;
  const y0 = Math.floor(Math.min(...ys)) - 1;
  const w = Math.ceil(Math.max(...xs)) - x0 + 2;
  const h = Math.ceil(Math.max(...ys)) - y0 + 2;
  const tmp = new Px(w, h).poly(
    pts.map((p) => [p[0] - x0, p[1] - y0] as const),
    "#fff",
  );
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = tmp.data[i] ? 1 : 0;
  return { x0, y0, w, h, on };
}

function maskHas(m: Mask, x: number, y: number): boolean {
  const lx = x - m.x0;
  const ly = y - m.y0;
  return lx >= 0 && ly >= 0 && lx < m.w && ly < m.h && m.on[ly * m.w + lx] === 1;
}

function maskSet(m: Mask, x: number, y: number, v: 0 | 1): void {
  const lx = x - m.x0;
  const ly = y - m.y0;
  if (lx >= 0 && ly >= 0 && lx < m.w && ly < m.h) m.on[ly * m.w + lx] = v;
}

function maskArea(m: Mask): number {
  let n = 0;
  for (const v of m.on) n += v;
  return n;
}

// ───────────────────────── 船型参数 ─────────────────────────

export type Figure = "bird" | "beast" | "maiden" | "falcon" | "scroll" | "none";

/** 艏楼 / 艉楼的一层：自船端量起的长度与高出下一层的高度。 */
export interface Tier {
  len: number;
  h: number;
}

export interface MastSpec {
  /** 桅位：自船尾起占船长的比例 */
  at: number;
  /** 自舷缘（船中）到桅顶的高度；lateen 为横桁顶角的高度 */
  h: number;
  /**
   * junk：东方硬帆（竹骨分段的斜桁四角帆）；以下为寰宇·十六世纪新增：
   * rect 挂在横桁上的一面矩形帆（编席或棉布）；tanja 东南亚倾斜的矩形硬帆（上下两根平行的斜桁，前低后高）；
   * crab 波利尼西亚的蟹爪帆（两根桁自帆前角张开，上缘内凹成两只“爪”）；pole 只挂旗的旗杆。
   */
  rig: "square" | "lateen" | "gaff" | "junk" | "rect" | "tanja" | "crab" | "pole";
  /** 横帆层数；junk 为竹骨分出的帆片数 */
  tiers?: number;
  /** 横帆：最下层帆脚宽；gaff：帆杠长；junk：帆宽；rect：帆宽；tanja：帆脚桁长；crab：下桁向后伸出多远 */
  spread?: number;
  /** lateen：帆前角在桅前多远；junk：帆前缘在桅前多远；rect：帆的中线在桅前多远；tanja、crab：帆前角在桅前多远 */
  lead?: number;
  /** lateen：横桁顶角在桅后多远；crab：上桁梢在帆前角后多远 */
  reach?: number;
  /** junk：斜桁前端比后端低多少（帆宽的比例，缺省 0.42）；越小帆越方 */
  drop?: number;
  /** tanja：帆脚桁自前角向后抬起多高；crab：下桁梢比帆前角高多少 */
  rise?: number;
  /** tanja：帆的前缘自下而上向后斜出多远 */
  lean?: number;
  /** 两脚桅、三脚桅：另一条桅脚在甲板上离主脚多远（正为向前） */
  legs?: number;
  /** rect：帆脚也有一根桁 */
  boom?: boolean;
  /** 桅杆后倾：每 1 像素高度向后偏移的像素（负数为前倾） */
  rake?: number;
  /** 横帆桅后面再挂一面斜桁帆（后桅纵帆），值为帆杠长 */
  spanker?: number;
  /** 桅顶的瞭望斗 */
  nest?: boolean;
  /** 横帆：最上层帆顶到桅顶多留出的长度（挂旗） */
  topmast?: number;
}

/** 一排桨：桨门离舷缘 d 行，首尾桨离船尾、船头的距离。 */
export interface OarSpec {
  n: number;
  d: number;
  from: number;
  to: number;
  /** 桨叶入水处比桨门再往船尾斜出多远（加莱船的长桨、日本船的橹）；缺省 0 */
  rake?: number;
}

/** 船舷色带：d 为距舷缘的行数。 */
export interface BandSpec {
  d: number;
  h: number;
  ramp: Ramp3;
}

/** 船艏或船尾高高翘起的柱（独木舟、姆泰佩的长艏、双体船的艉柱、和船的水押）。 */
export interface PostSpec {
  /** 柱梢高出船端舷缘的高度 */
  h: number;
  /** 柱梢伸出船端的水平长度 */
  reach: number;
  /** 根部粗细（像素） */
  w: number;
  /** 弯法：1 先向外伸再向上翘（钩状），0 先竖起再向外弯，0.5 笔直斜伸 */
  bend: number;
  /** 柱梢的装饰：curl 向内回卷、knob 一颗圆头 */
  tip?: "curl" | "knob";
  /** 柱身的漆色（缺省木色） */
  paint?: Ramp3;
}

/** 加莱船船尾的条纹篷：自船尾 from 到 to 像素，篷顶高出甲板 h。 */
export interface AwningSpec {
  from: number;
  to: number;
  h: number;
  stripes: readonly [Ramp3, Ramp3];
}

/**
 * 甲板上的一道墙：tate 日本的楯板（竖板、一两排狭间，顶上一道栏木）；panok 朝鲜板屋船的板屋（横板、两排炮眼、顶上女墙）；
 * hu 福船两舷的护板（竖着钉的板，一排小窗）。自船尾 from 像素到离船头 to 像素，高 h。
 */
export interface WallSpec {
  from: number;
  to: number;
  h: number;
  style: "tate" | "panok" | "hu";
  ramp: Ramp3;
  /** 开几排枪眼（狭间、炮眼） */
  loops: number;
}

/** 墙顶上的楼阁：安宅船的矢仓（白墙黑框、瓦顶翘角），open 为朝鲜板屋船顶上敞开的将台（红柱、栏杆）。 */
export interface TowerSpec {
  /** 中心自船尾起占船长的比例 */
  at: number;
  /** 自下而上每层的宽与墙高（不含屋顶） */
  floors: readonly { w: number; h: number }[];
  open?: boolean;
}

/** 篷与小屋：arch 拱形的篷顶，ridge 人字顶；under 为 open 时敞开（看得见货包），cane 为竹苇编的墙。 */
export interface HutSpec {
  from: number;
  to: number;
  h: number;
  roof: "arch" | "ridge";
  under: "open" | "cane";
  /** palm 新鲜的棕榈叶（绿），straw 晒干的叶与草（黄褐） */
  leaf: "palm" | "straw";
}

/** 日本船的幟（旗指物）：竖长的旗挂在旗杆与顶上的横竿上，每面 [底色, 上缘色带]。 */
export interface BannerSpec {
  /** 旗杆位置：自船尾起占船长的比例 */
  at: readonly number[];
  /** 旗杆高出甲板（墙顶）多少 */
  h: number;
  colors: readonly (readonly [string, string])[];
}

/** 舷外支架（科拉科拉）：水线处一根浮木，几根撑木连到舷边的横杆上；自船尾 from 到离船头 to 像素。 */
export interface OutriggerSpec {
  from: number;
  to: number;
  struts: number;
}

/** 一排桨手（剪影）：坐在舷边（seat 为离舷缘的行数，负数在舷缘之上），各执一支短桨，随帧划动。 */
export interface PaddlerSpec {
  n: number;
  from: number;
  to: number;
  seat: number;
}

/** 双体船：远侧的船体相对近侧向左 dx、向上 dy（负数）；两船之间自船尾 from 到离船头 to 像素铺一层平台。 */
export interface TwinSpec {
  dx: number;
  dy: number;
  from: number;
  to: number;
}

/** 一排炮门。 */
export interface PortRow {
  d: number;
  n: number;
  w: number;
  h: number;
  /** 首尾炮门离船尾、船头的距离 */
  from: number;
  to: number;
  lid: string;
}

export interface Spec {
  len: number;
  freeboard: number;
  /** 水线以下画出的船底行数 */
  below: number;
  /** 船尾、船头的舷弧抬升 */
  sheer: readonly [number, number];
  /** 艏柱：弧线水平跨度、控制点位置（0,0 为圆钝的艏，0.5,0.5 为笔直的斜艏） */
  bow: readonly [number, number, number];
  /** 艉部：船底弧线跨度、艉板后倾 */
  stern: readonly [number, number];
  aft: readonly Tier[];
  fore: readonly Tier[];
  /** 艉楼向后外伸 */
  over: number;
  /** 艏斜桅：伸出船头的水平长度、抬升 */
  sprit: readonly [number, number];
  jibs: number;
  masts: readonly MastSpec[];
  bands: readonly BandSpec[];
  ports: readonly PortRow[];
  /** 上层船壳涂漆（代替木色），涂到距舷缘 topsidesTo 行 */
  topsides?: Ramp5;
  topsidesTo?: number;
  /** 艏艉楼壁板的漆色 */
  paint: Ramp3;
  /** 艏艉楼各层之间用金色饰线 */
  ornate?: boolean;
  portholes: number;
  /** 艉楼侧窗个数 */
  windows: number;
  /** 艉灯：0 无，1 一盏，2 两盏，3 灯塔级的大灯笼 */
  lantern: 0 | 1 | 2 | 3;
  figure: Figure;
  /** 甲板上堆着货箱 */
  cargo?: boolean;
  /** 船艏的吃水标志 */
  marks?: boolean;
  /** 桅顶旗的大小 */
  flag: readonly [number, number];
  /** 帆的底色：junk 为东方硬帆的赭色篾帆，mat 为草黄的编席帆（默认奶白帆布） */
  sailTone?: "junk" | "mat";
  /** 船底颜色（默认铜红；三角帆商船抹白色的油灰） */
  bottom?: readonly [string, string];
  /** 桨帆船的一排桨 */
  oars?: OarSpec;
  /** 船艏的撞角：伸出船头的长度 */
  ram?: number;
  /** 船艏两侧画的龙目（东方船） */
  eye?: boolean;
  /** 搭接的船板（柯克船）：每道板的下缘压着下一道板 */
  clinker?: boolean;
  /** 艏艉楼顶是城垛 */
  crenel?: boolean;
  /** 无支索的桅（东方硬帆船）：只画帆脚索 */
  unstayed?: boolean;

  // —— 以下部件只用于寰宇·十六世纪新增的船型（./ships16.ts），经典船型都不设 ——

  /** 船体表面：sewn 缝合的船板（一排排针脚）、dugout 刳木的独木舟（不画板缝）、logs 圆木排筏（捆扎的圆木、苇编甲板） */
  skin?: "sewn" | "dugout" | "logs";
  /** 锚：缺省铁锚；wood 东方船的木碇；none 不画 */
  anchor?: "wood" | "none";
  /**
   * 舵：缺省挂在艉柱上；junk 中国船吊在艉下的开孔大舵；hung 同样吊在艉下、不开孔的大舵（和船、朝鲜船）；
   * quarter 舷侧舵（爪哇大船）；oar 艉部的操舵桨；none 不画
   */
  rudder?: "junk" | "hung" | "quarter" | "oar" | "none";
  /** 不画船艏的金色饰线 */
  plainBow?: boolean;
  /** 翘起的艏柱、艉柱 */
  posts?: { aft?: PostSpec; fore?: PostSpec };
  awning?: AwningSpec;
  wall?: WallSpec;
  tower?: TowerSpec;
  hut?: HutSpec;
  banners?: BannerSpec;
  outrigger?: OutriggerSpec;
  /** 一排或几排桨手（按顺序画，后画的在前面） */
  paddlers?: readonly PaddlerSpec[];
  /** 披水板（沙船）：吊在舷边、自船尾起占船长 at 处，伸到水线下 */
  leeboard?: { at: number; len: number };
  /** 圆木排筏的中插板：自船尾起占船长的比例 */
  boards?: readonly number[];
  twin?: TwinSpec;
  /** 海盗帆色（缺省：没有横帆的船为暗红帆，其余黑帆） */
  pirateSail?: "black" | "red";
  /** 龙目上方画一道眉（鸟船的“绿眉毛”）的颜色 */
  brow?: string;
  /** 船艏正面（方头）的漆色：画在艏柱一侧的几列 */
  bowFace?: Ramp3;
}

const TEAL: Ramp3 = [P.teal[1], P.teal[2], P.teal[3]];
const TAR: Ramp3 = [P.iron[0], P.iron[1], P.iron[2]];
const GOLD: Ramp3 = [P.gold[1], P.gold[2], P.gold[3]];
const CRIMSON: Ramp3 = [P.cloth.crimson[0], P.cloth.crimson[1], P.cloth.crimson[2]];
const NAVY: Ramp3 = [P.cloth.navy[0], P.cloth.navy[1], P.cloth.navy[2]];
const BLUE: Ramp3 = [P.cloth.blue[0], P.cloth.blue[1], P.cloth.blue[2]];
const GREEN: Ramp3 = [P.cloth.green[0], P.cloth.green[1], P.cloth.green[2]];
const PALE: Ramp3 = [P.stone[3], P.stone[4], P.white];
const SLATE: Ramp3 = [P.slate[1], P.slate[2], P.slate[3]];
const SILVER5: Ramp5 = [P.stone[1], P.stone[2], P.stone[3], P.stone[4], P.white];
const SLATE5: Ramp5 = [P.slate[0], P.slate[1], P.slate[2], P.slate[3], P.slate[4]];
const OCHRE: Ramp3 = [P.cloth.ochre[0], P.cloth.ochre[1], P.cloth.ochre[2]];
/** 涂黑的船壳（巡防舰、飞剪船、战列舰） */
const BLACK5: Ramp5 = [ink.deep, P.iron[0], P.iron[1], P.iron[2], P.stone[2]];
/** 深蓝船壳（探险快船） */
const NAVY5: Ramp5 = [P.cloth.navy[0], P.cloth.navy[1], P.cloth.navy[2], P.cloth.blue[1], P.cloth.blue[2]];
/** 暗红船壳（加莱赛战船） */
const RED5: Ramp5 = [P.red[0], P.cloth.crimson[0], P.red[1], P.cloth.crimson[1], P.cloth.crimson[2]];

/** 19 种船型（顺序同 ships.toml；8–18 为航海历 1502 年追加的船型）。 */
const SPECS: readonly Spec[] = [
  // 0 卡拉维尔帆船（swallow）：小巧，双桅三角帆，长艏斜桅，燕尾长旗
  {
    len: 42,
    freeboard: 7,
    below: 3,
    sheer: [2, 3],
    bow: [12, 0.35, 0.3],
    stern: [8, 2],
    aft: [{ len: 11, h: 2 }],
    fore: [],
    over: 1,
    sprit: [12, 5],
    jibs: 1,
    masts: [
      { at: 0.2, h: 30, rig: "lateen", lead: 6, reach: 11 },
      { at: 0.6, h: 46, rig: "lateen", lead: 11, reach: 13 },
    ],
    bands: [{ d: 3, h: 1, ramp: TEAL }],
    ports: [],
    paint: TEAL,
    portholes: 2,
    windows: 0,
    lantern: 1,
    figure: "bird",
    flag: [9, 4],
  },
  // 1 卡拉克帆船（tradewind）：均衡的三桅横帆船，后桅三角帆
  {
    len: 56,
    freeboard: 10,
    below: 3,
    sheer: [3, 4],
    bow: [14, 0.2, 0.15],
    stern: [9, 3],
    aft: [
      { len: 17, h: 4 },
      { len: 8, h: 3 },
    ],
    fore: [{ len: 10, h: 3 }],
    over: 3,
    sprit: [14, 6],
    jibs: 1,
    masts: [
      { at: 0.19, h: 42, rig: "lateen", lead: 7, reach: 10 },
      { at: 0.5, h: 58, rig: "square", tiers: 3, spread: 25 },
      { at: 0.79, h: 50, rig: "square", tiers: 2, spread: 21 },
    ],
    bands: [{ d: 3, h: 2, ramp: BLUE }],
    ports: [{ d: 6, n: 3, w: 2, h: 2, from: 18, to: 14, lid: P.red[1] }],
    paint: BLUE,
    portholes: 0,
    windows: 2,
    lantern: 1,
    figure: "scroll",
    flag: [10, 5],
  },
  // 2 福禄特货船（whale）：船腹宽胖、圆钝的艏、吃水深，桅较矮，甲板上堆满货
  {
    len: 66,
    freeboard: 14,
    below: 6,
    sheer: [4, 3],
    bow: [20, 0, 0.05],
    stern: [16, 5],
    aft: [{ len: 14, h: 5 }],
    fore: [{ len: 8, h: 2 }],
    over: 1,
    sprit: [11, 6],
    jibs: 1,
    masts: [
      { at: 0.19, h: 38, rig: "gaff", spread: 14 },
      { at: 0.5, h: 50, rig: "square", tiers: 2, spread: 29 },
      { at: 0.8, h: 44, rig: "square", tiers: 2, spread: 24 },
    ],
    bands: [
      { d: 3, h: 3, ramp: TAR },
      { d: 6, h: 1, ramp: GOLD },
    ],
    ports: [],
    paint: GREEN,
    portholes: 3,
    windows: 2,
    lantern: 1,
    figure: "beast",
    cargo: true,
    marks: true,
    flag: [10, 5],
  },
  // 3 双桅纵帆船（silvergull）：修长低矮，双桅后倾的三角帆，银白船舷
  {
    len: 60,
    freeboard: 7,
    below: 3,
    sheer: [2, 4],
    bow: [16, 0.6, 0.55],
    stern: [10, 2],
    aft: [{ len: 12, h: 2 }],
    fore: [],
    over: 1,
    sprit: [15, 5],
    jibs: 2,
    masts: [
      { at: 0.3, h: 52, rig: "lateen", lead: 11, reach: 14, rake: 0.12 },
      { at: 0.66, h: 56, rig: "lateen", lead: 12, reach: 13, rake: 0.12 },
    ],
    bands: [{ d: 2, h: 1, ramp: NAVY }],
    ports: [{ d: 4, n: 4, w: 2, h: 2, from: 12, to: 16, lid: P.cloth.navy[1] }],
    topsides: SILVER5,
    topsidesTo: 6,
    paint: NAVY,
    portholes: 0,
    windows: 0,
    lantern: 1,
    figure: "bird",
    flag: [10, 5],
  },
  // 4 大盖伦帆船（bastion）：高耸的多层艏艉楼，三桅，朱红与金
  {
    len: 76,
    freeboard: 12,
    below: 4,
    sheer: [3, 4],
    bow: [16, 0.15, 0.15],
    stern: [12, 4],
    aft: [
      { len: 26, h: 6 },
      { len: 16, h: 5 },
      { len: 7, h: 3 },
    ],
    fore: [
      { len: 14, h: 5 },
      { len: 7, h: 3 },
    ],
    over: 4,
    sprit: [14, 7],
    jibs: 1,
    masts: [
      { at: 0.23, h: 60, rig: "lateen", lead: 8, reach: 12 },
      { at: 0.5, h: 72, rig: "square", tiers: 3, spread: 30 },
      { at: 0.77, h: 62, rig: "square", tiers: 2, spread: 24 },
    ],
    bands: [{ d: 3, h: 2, ramp: CRIMSON }],
    ports: [{ d: 6, n: 5, w: 3, h: 2, from: 28, to: 18, lid: P.red[1] }],
    paint: CRIMSON,
    ornate: true,
    portholes: 0,
    windows: 4,
    lantern: 2,
    figure: "beast",
    flag: [11, 5],
  },
  // 5 武装商船（beacon）：三桅全横帆，船舷一整排炮门的黄色炮带，艉部大灯笼
  {
    len: 74,
    freeboard: 13,
    below: 4,
    sheer: [3, 3],
    bow: [15, 0.2, 0.15],
    stern: [11, 3],
    aft: [
      { len: 18, h: 5 },
      { len: 8, h: 3 },
    ],
    fore: [{ len: 11, h: 4 }],
    over: 3,
    sprit: [16, 7],
    jibs: 2,
    masts: [
      { at: 0.22, h: 56, rig: "square", tiers: 2, spread: 20 },
      { at: 0.51, h: 72, rig: "square", tiers: 3, spread: 28 },
      { at: 0.79, h: 62, rig: "square", tiers: 3, spread: 23 },
    ],
    bands: [
      { d: 3, h: 1, ramp: TAR },
      { d: 5, h: 4, ramp: GOLD },
    ],
    ports: [{ d: 6, n: 8, w: 3, h: 2, from: 7, to: 14, lid: P.red[1] }],
    paint: SLATE,
    portholes: 0,
    windows: 3,
    lantern: 3,
    figure: "maiden",
    flag: [11, 5],
  },
  // 6 谢贝克帆船（mistfalcon）：低矮修长，三桅后倾三角帆，青灰船身与炮门，尖锐的船艏
  {
    len: 82,
    freeboard: 9,
    below: 3,
    sheer: [3, 6],
    bow: [18, 0.55, 0.6],
    stern: [12, 2],
    aft: [{ len: 15, h: 3 }],
    fore: [{ len: 8, h: 2 }],
    over: 2,
    sprit: [16, 4],
    jibs: 1,
    masts: [
      { at: 0.23, h: 50, rig: "lateen", lead: 10, reach: 13, rake: 0.1 },
      { at: 0.53, h: 66, rig: "lateen", lead: 14, reach: 16, rake: 0.1 },
      { at: 0.81, h: 56, rig: "lateen", lead: 11, reach: 14, rake: 0.1 },
    ],
    bands: [{ d: 3, h: 1, ramp: PALE }],
    ports: [{ d: 5, n: 7, w: 3, h: 2, from: 12, to: 20, lid: P.slate[1] }],
    topsides: SLATE5,
    topsidesTo: 9,
    paint: SLATE,
    portholes: 0,
    windows: 2,
    lantern: 1,
    figure: "falcon",
    flag: [11, 5],
  },
  // 7 远洋大帆船（farstar）：原有船型中最大，四桅，多层横帆，两排炮门，金饰艉楼
  {
    len: 92,
    freeboard: 16,
    below: 4,
    sheer: [3, 4],
    bow: [18, 0.2, 0.2],
    stern: [13, 4],
    aft: [
      { len: 24, h: 5 },
      { len: 12, h: 4 },
    ],
    fore: [{ len: 14, h: 4 }],
    over: 4,
    sprit: [16, 8],
    jibs: 3,
    masts: [
      { at: 0.11, h: 60, rig: "gaff", spread: 17 },
      { at: 0.35, h: 80, rig: "square", tiers: 3, spread: 25 },
      { at: 0.58, h: 94, rig: "square", tiers: 4, spread: 31 },
      { at: 0.8, h: 84, rig: "square", tiers: 4, spread: 26 },
    ],
    bands: [
      { d: 3, h: 2, ramp: CRIMSON },
      { d: 5, h: 4, ramp: GOLD },
      { d: 10, h: 3, ramp: GOLD },
    ],
    ports: [
      { d: 6, n: 9, w: 3, h: 2, from: 8, to: 16, lid: P.red[1] },
      { d: 11, n: 8, w: 3, h: 2, from: 12, to: 20, lid: P.red[1] },
    ],
    paint: CRIMSON,
    ornate: true,
    portholes: 0,
    windows: 4,
    lantern: 3,
    figure: "maiden",
    flag: [12, 6],
  },
  // 8 柯克船：单桅一面大横帆，平底高舷、搭接船板，艏艉各一座带城垛的木楼，没有艏三角帆
  {
    len: 48,
    freeboard: 11,
    below: 3,
    sheer: [3, 4],
    bow: [9, 0.5, 0.5],
    stern: [6, 1],
    aft: [{ len: 12, h: 6 }],
    fore: [{ len: 10, h: 6 }],
    over: 1,
    sprit: [10, 6],
    jibs: 0,
    masts: [{ at: 0.52, h: 48, rig: "square", tiers: 1, spread: 30, topmast: 6 }],
    bands: [{ d: 2, h: 1, ramp: TAR }],
    ports: [],
    paint: PALE,
    portholes: 0,
    windows: 0,
    lantern: 1,
    figure: "none",
    clinker: true,
    crenel: true,
    flag: [10, 5],
  },
  // 9 单桅快船：一根高桅挂一面大斜桁帆，两面艏三角帆，长艏斜桅，低矮的绿船舷
  {
    len: 44,
    freeboard: 7,
    below: 3,
    sheer: [2, 4],
    bow: [13, 0.35, 0.35],
    stern: [8, 2],
    aft: [{ len: 9, h: 2 }],
    fore: [],
    over: 1,
    sprit: [15, 5],
    jibs: 2,
    masts: [{ at: 0.6, h: 52, rig: "gaff", spread: 28 }],
    bands: [{ d: 2, h: 1, ramp: GOLD }],
    ports: [{ d: 3, n: 3, w: 2, h: 2, from: 11, to: 13, lid: P.cloth.green[1] }],
    topsides: [P.cloth.green[0], P.cloth.green[1], P.cloth.green[2], P.leaf[3], P.leaf[4]],
    topsidesTo: 5,
    paint: GREEN,
    portholes: 0,
    windows: 0,
    lantern: 1,
    figure: "bird",
    flag: [9, 4],
  },
  // 10 三角帆商船：前倾的主桅挂一面极长横桁的大三角帆，小后桅；尖长的艏柱、高翘的艉，白色油灰船底，没有艏斜桅
  {
    len: 61,
    freeboard: 9,
    below: 3,
    sheer: [6, 4],
    bow: [17, 0.6, 0.4],
    stern: [9, 3],
    aft: [{ len: 13, h: 3 }],
    fore: [],
    over: 2,
    sprit: [5, 3],
    jibs: 0,
    masts: [
      { at: 0.17, h: 30, rig: "lateen", lead: 7, reach: 9 },
      { at: 0.55, h: 46, rig: "lateen", lead: 24, reach: 25, rake: -0.08 },
    ],
    bands: [
      { d: 2, h: 1, ramp: TEAL },
      { d: 4, h: 1, ramp: PALE },
    ],
    ports: [],
    paint: TEAL,
    portholes: 0,
    windows: 0,
    lantern: 0,
    figure: "none",
    bottom: [P.plaster[1], P.plaster[2]],
    flag: [9, 4],
  },
  // 11 双桅横帆船：两根桅都挂三层横帆，主桅后再挂一面斜桁帆；绿色炮带
  {
    len: 62,
    freeboard: 9,
    below: 3,
    sheer: [2, 4],
    bow: [15, 0.3, 0.25],
    stern: [10, 3],
    aft: [{ len: 12, h: 2 }],
    fore: [],
    over: 2,
    sprit: [14, 6],
    jibs: 2,
    masts: [
      { at: 0.32, h: 58, rig: "square", tiers: 3, spread: 25, spanker: 21 },
      { at: 0.7, h: 54, rig: "square", tiers: 3, spread: 22 },
    ],
    bands: [
      { d: 2, h: 1, ramp: GOLD },
      { d: 3, h: 3, ramp: GREEN },
    ],
    ports: [{ d: 4, n: 5, w: 2, h: 2, from: 13, to: 16, lid: P.red[1] }],
    paint: GREEN,
    portholes: 0,
    windows: 2,
    lantern: 1,
    figure: "scroll",
    flag: [10, 5],
  },
  // 12 探险快船：两根斜桁帆桅（纵帆船），主桅顶有瞭望斗，深蓝船身、金色腰线
  {
    len: 50,
    freeboard: 8,
    below: 3,
    sheer: [2, 4],
    bow: [14, 0.45, 0.4],
    stern: [8, 2],
    aft: [{ len: 11, h: 3 }],
    fore: [],
    over: 1,
    sprit: [14, 6],
    jibs: 2,
    masts: [
      { at: 0.36, h: 56, rig: "gaff", spread: 24, nest: true },
      { at: 0.68, h: 50, rig: "gaff", spread: 15 },
    ],
    bands: [{ d: 3, h: 1, ramp: GOLD }],
    ports: [{ d: 4, n: 3, w: 2, h: 2, from: 14, to: 15, lid: P.cloth.navy[1] }],
    topsides: NAVY5,
    topsidesTo: 7,
    paint: NAVY,
    portholes: 0,
    windows: 0,
    lantern: 1,
    figure: "falcon",
    flag: [10, 5],
  },
  // 13 移民船：宽胖高舷，三桅横帆，甲板上堆满货箱木桶，船舷一长排住人的舷窗
  {
    len: 72,
    freeboard: 15,
    below: 5,
    sheer: [4, 3],
    bow: [19, 0.05, 0.08],
    stern: [14, 4],
    aft: [{ len: 15, h: 5 }],
    fore: [{ len: 9, h: 3 }],
    over: 2,
    sprit: [12, 6],
    jibs: 1,
    masts: [
      { at: 0.2, h: 44, rig: "square", tiers: 2, spread: 21 },
      { at: 0.5, h: 56, rig: "square", tiers: 3, spread: 30 },
      { at: 0.79, h: 50, rig: "square", tiers: 2, spread: 25 },
    ],
    bands: [
      { d: 3, h: 2, ramp: OCHRE },
      { d: 9, h: 1, ramp: TAR },
    ],
    ports: [],
    paint: OCHRE,
    portholes: 7,
    windows: 3,
    lantern: 1,
    figure: "beast",
    cargo: true,
    flag: [10, 5],
  },
  // 14 巡防舰：平甲板、一层炮甲板，黑船壳上一道开满炮门的黄带，三桅高耸
  {
    len: 90,
    freeboard: 12,
    below: 4,
    sheer: [2, 4],
    bow: [18, 0.3, 0.25],
    stern: [12, 3],
    aft: [{ len: 22, h: 3 }],
    fore: [{ len: 12, h: 2 }],
    over: 3,
    sprit: [16, 7],
    jibs: 3,
    masts: [
      { at: 0.2, h: 64, rig: "square", tiers: 3, spread: 22, spanker: 18 },
      { at: 0.49, h: 80, rig: "square", tiers: 4, spread: 28 },
      { at: 0.76, h: 72, rig: "square", tiers: 3, spread: 25 },
    ],
    bands: [{ d: 5, h: 3, ramp: OCHRE }],
    ports: [{ d: 6, n: 12, w: 2, h: 2, from: 11, to: 18, lid: P.red[1] }],
    topsides: BLACK5,
    topsidesTo: 12,
    paint: NAVY,
    portholes: 0,
    windows: 3,
    lantern: 2,
    figure: "maiden",
    flag: [11, 5],
  },
  // 15 加莱赛战船：低长的暗红船身，一排长桨，三桅三角帆，船艏镀金撞角，艏楼架重炮
  {
    len: 94,
    freeboard: 11,
    below: 3,
    sheer: [3, 4],
    bow: [14, 0.5, 0.5],
    stern: [10, 3],
    aft: [
      { len: 18, h: 5 },
      { len: 8, h: 2 },
    ],
    fore: [{ len: 16, h: 4 }],
    over: 3,
    sprit: [0, 0],
    jibs: 0,
    masts: [
      { at: 0.2, h: 50, rig: "lateen", lead: 10, reach: 13 },
      { at: 0.5, h: 66, rig: "lateen", lead: 14, reach: 17 },
      { at: 0.78, h: 58, rig: "lateen", lead: 12, reach: 14 },
    ],
    bands: [
      { d: 2, h: 1, ramp: GOLD },
      { d: 6, h: 1, ramp: GOLD },
    ],
    ports: [{ d: 3, n: 7, w: 2, h: 2, from: 22, to: 22, lid: P.gold[1] }],
    topsides: RED5,
    topsidesTo: 11,
    paint: CRIMSON,
    ornate: true,
    portholes: 0,
    windows: 2,
    lantern: 2,
    figure: "none",
    oars: { n: 14, d: 7, from: 21, to: 20 },
    ram: 15,
    flag: [11, 5],
  },
  // 16 瑶华宝船：东方硬帆——竹骨把赭色篾帆分成一片片，帆脚索呈扇形；船身两头高翘，高耸外伸的艉楼，船艏画龙目，桅无支索
  {
    len: 92,
    freeboard: 13,
    below: 4,
    sheer: [10, 7],
    bow: [12, 0.45, 0.3],
    stern: [10, 5],
    aft: [
      { len: 22, h: 5 },
      { len: 12, h: 4 },
    ],
    fore: [{ len: 9, h: 2 }],
    over: 10,
    sprit: [4, 2],
    jibs: 0,
    masts: [
      { at: 0.17, h: 52, rig: "junk", spread: 20, lead: 4, tiers: 6 },
      { at: 0.5, h: 78, rig: "junk", spread: 34, lead: 7, tiers: 9 },
      { at: 0.82, h: 60, rig: "junk", spread: 24, lead: 5, tiers: 7, rake: -0.1 },
    ],
    bands: [
      { d: 2, h: 1, ramp: GOLD },
      { d: 3, h: 2, ramp: CRIMSON },
      { d: 6, h: 1, ramp: GREEN },
    ],
    ports: [],
    paint: CRIMSON,
    ornate: true,
    portholes: 0,
    windows: 3,
    lantern: 2,
    figure: "none",
    sailTone: "junk",
    eye: true,
    unstayed: true,
    flag: [11, 5],
  },
  // 17 飞剪船：狭长低矮的黑船身、刀一样前伸的艏柱，三根后倾的高桅挂满四层窄横帆，长长的艏斜桅
  {
    len: 86,
    freeboard: 8,
    below: 3,
    sheer: [2, 5],
    bow: [24, 0.62, 0.7],
    stern: [10, 3],
    aft: [{ len: 12, h: 2 }],
    fore: [],
    over: 3,
    sprit: [14, 6],
    jibs: 3,
    masts: [
      { at: 0.22, h: 70, rig: "square", tiers: 4, spread: 19, rake: 0.07, spanker: 18 },
      { at: 0.5, h: 82, rig: "square", tiers: 4, spread: 23, rake: 0.07 },
      { at: 0.76, h: 76, rig: "square", tiers: 4, spread: 21, rake: 0.07 },
    ],
    bands: [{ d: 2, h: 1, ramp: GOLD }],
    ports: [],
    topsides: BLACK5,
    topsidesTo: 8,
    paint: NAVY,
    portholes: 0,
    windows: 0,
    lantern: 1,
    figure: "maiden",
    flag: [11, 5],
  },
  // 18 战列舰：三层炮甲板——黑船壳上三道开满炮门的金带，高大的艉楼，三桅四层横帆
  {
    len: 98,
    freeboard: 22,
    below: 4,
    sheer: [3, 4],
    bow: [18, 0.2, 0.2],
    stern: [14, 5],
    aft: [
      { len: 26, h: 5 },
      { len: 14, h: 4 },
    ],
    fore: [{ len: 16, h: 4 }],
    over: 4,
    sprit: [18, 8],
    jibs: 3,
    masts: [
      { at: 0.17, h: 72, rig: "square", tiers: 3, spread: 24, spanker: 20 },
      { at: 0.46, h: 92, rig: "square", tiers: 4, spread: 32 },
      { at: 0.74, h: 84, rig: "square", tiers: 4, spread: 28 },
    ],
    bands: [
      { d: 4, h: 4, ramp: GOLD },
      { d: 10, h: 4, ramp: GOLD },
      { d: 16, h: 4, ramp: GOLD },
    ],
    ports: [
      { d: 5, n: 13, w: 3, h: 2, from: 12, to: 20, lid: P.red[1] },
      { d: 11, n: 13, w: 3, h: 2, from: 12, to: 22, lid: P.red[1] },
      { d: 17, n: 12, w: 3, h: 2, from: 14, to: 26, lid: P.red[1] },
    ],
    topsides: BLACK5,
    topsidesTo: 22,
    paint: NAVY,
    ornate: true,
    portholes: 0,
    windows: 4,
    lantern: 3,
    figure: "maiden",
    flag: [12, 6],
  },
];

/** 越界的 typeIndex：按帆型取一种通用船（横帆 → 卡拉克（1），三角帆 → 双桅纵帆船（3））。 */
function specIndex(typeIndex: number, sail: "square" | "lateen"): number {
  if (Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < SPECS.length) return typeIndex;
  return sail === "lateen" ? 3 : 1;
}

/**
 * 经典世界 data/ships.toml 的船型 key，下标即 drawShip 的 typeIndex。
 * 寰宇·十六世纪（data/worlds/terra16/ships/01_classic_ordinary.toml）沿用这 19 个 key 与它们的画法。
 */
export const CLASSIC_SHIP_KEYS = [
  "swallow", "tradewind", "whale", "silvergull", "bastion", "beacon", "mistfalcon", "farstar",
  "cog", "sloop", "dhow", "brig", "pinnace", "settler", "frigate", "galleass", "junk", "clipper", "lineship",
] as const;

/** 寰宇·十六世纪新增的 16 种船型的 key（顺序同 data/worlds/terra16/ships/02、03 两张表）。 */
export const TERRA16_SHIP_KEYS: readonly string[] = T16_KEYS;

/** 全部画法：经典的 19 种在前（下标同 typeIndex），寰宇·十六世纪的 16 种接在后面，最后是布里甘廷桨帆船（只能按 key 取到）。 */
const ALL_SPECS: readonly Spec[] = [...SPECS, ...T16_SPECS, BRIGANTINE_SPEC];

/** 新画法的小图（下标减去经典小图的个数）：寰宇的 16 种、布里甘廷。 */
const EXTRA_GLYPHS: readonly GlyphSpec[] = [...T16_GLYPHS, BRIGANTINE_GLYPH];

/** 布里甘廷桨帆船的画法下标。 */
const BRIGANTINE_INDEX = SPECS.length + T16_SPECS.length;

/** key → 画法下标。 */
const KEY_INDEX: ReadonlyMap<string, number> = new Map<string, number>([
  ...CLASSIC_SHIP_KEYS.map((k, i) => [k, i] as const),
  ...T16_KEYS.map((k, i) => [k, SPECS.length + i] as const),
]);

/**
 * 按 key 取画法下标；未知的 key 按帆型退回通用船（与越界的 typeIndex 相同）。
 * 唯一按帆型分开的 key 是 brig：经典世界是双桅横帆船，寰宇·十六世纪的同名船型标三角帆，是布里甘廷桨帆船。
 */
function keyIndex(key: string, sail: "square" | "lateen"): number {
  if (key === "brig" && sail === "lateen") return BRIGANTINE_INDEX;
  return KEY_INDEX.get(key) ?? specIndex(-1, sail);
}

// ───────────────────────── 配色 ─────────────────────────

interface SailTones {
  edge: string;
  lo: string;
  mid: string;
  hi: string;
}

const SAIL_CREAM: SailTones = { edge: P.parchmentDark, lo: P.parchment, mid: P.paper, hi: P.white };
const SAIL_BLACK: SailTones = { edge: P.cloth.black[0], lo: ink.deep, mid: P.cloth.black[1], hi: P.cloth.black[2] };
const SAIL_RED: SailTones = { edge: P.red[0], lo: P.cloth.crimson[0], mid: P.red[1], hi: P.cloth.crimson[1] };
/** 东方硬帆的赭色篾帆 */
const SAIL_JUNK: SailTones = { edge: P.wood[0], lo: P.sand[1], mid: P.sand[2], hi: P.sand[3] };
/** 草黄的编席帆（藤、棕榈叶、露兜树叶或稻草编的席） */
const SAIL_MAT: SailTones = { edge: P.straw[0], lo: P.straw[1], mid: P.straw[2], hi: P.straw[3] };

interface Look {
  wood: Ramp5;
  bottom: readonly [string, string];
  boot: string;
  sail: SailTones;
  /** 破洞边缘的焦色 */
  torn: string;
  flag: string | null;
  pirate: boolean;
}

function lookOf(opts: ShipArtOpts, lateen: boolean, sailTone?: "junk" | "mat", bottom?: readonly [string, string]): Look {
  const pirate = !!opts.pirate;
  return {
    wood: pirate ? [ink.brown, P.wood[0], P.wood[1], P.wood[2], P.wood[3]] : [P.wood[0], P.wood[1], P.wood[2], P.wood[3], P.wood[4]],
    bottom: pirate ? [P.iron[0], P.iron[1]] : (bottom ?? [P.brick[0], P.brick[1]]),
    boot: pirate ? P.red[1] : P.plaster[3],
    sail: pirate ? (lateen ? SAIL_RED : SAIL_BLACK) : sailTone === "junk" ? SAIL_JUNK : sailTone === "mat" ? SAIL_MAT : SAIL_CREAM,
    torn: pirate ? P.cloth.black[0] : P.wood[1],
    flag: cleanColor(opts.flag),
    pirate,
  };
}

// ───────────────────────── 几何 ─────────────────────────

/** 最高处（桅顶或横桁顶角）上方留给旗的空间。 */
const TOP = 4;

interface Geo {
  W: number;
  H: number;
  /** 船中舷缘的 y */
  D0: number;
  /** 水线 */
  WL: number;
  /** 画出的最低一行船底 */
  K: number;
  sternX: number;
  bowX: number;
  len: number;
  sheer: (x: number) => number;
  /** 每列船体（含艏艉楼、货物）最高点；画完船体后填写，未占用为 9999 */
  top: Int32Array;
  hull: Mask;
}

function mastX(g: Geo, m: MastSpec): number {
  return g.sternX + Math.round(m.at * g.len);
}

/** 后倾桅杆在高度 y 处的 x。 */
function mastAt(g: Geo, m: MastSpec, y: number): number {
  return mastX(g, m) - Math.round((g.D0 - y) * (m.rake ?? 0));
}

/** 某列船体最高点（没有船体时取舷弧）。 */
function topAt(g: Geo, x: number): number {
  const t = g.top[Math.max(0, Math.min(g.W - 1, Math.round(x)))];
  return t < 9999 ? t : g.sheer(x);
}

function buildGeo(s: Spec): Geo {
  // 船尾左侧需要的留白：艉楼外伸、纵帆顶角、帆杠、舵
  let left = s.over + 3;
  for (const m of s.masts) {
    const xm = Math.round(m.at * s.len);
    if (m.rig === "lateen") left = Math.max(left, (m.reach ?? 0) + Math.round((m.rake ?? 0) * m.h) - xm + 3);
    if (m.rig === "gaff") left = Math.max(left, (m.spread ?? 0) - xm + 4);
    if (m.spanker) left = Math.max(left, m.spanker - xm + 4);
    if (m.rig === "junk") left = Math.max(left, junkAft(m) + Math.max(0, Math.round((m.rake ?? 0) * m.h)) - xm + 3);
    if (m.rig === "rect") left = Math.max(left, Math.ceil((m.spread ?? 16) / 2) - (m.lead ?? 0) - xm + 4);
    if (m.rig === "tanja") left = Math.max(left, (m.spread ?? 16) - (m.lead ?? 4) + (m.lean ?? 2) - xm + 4);
    if (m.rig === "crab") left = Math.max(left, (m.spread ?? 16) - (m.lead ?? 6) - xm + 4);
  }
  if (s.posts?.aft) left = Math.max(left, s.posts.aft.reach + 3);
  if (s.rudder === "oar") left = Math.max(left, 10);
  if (s.rudder === "quarter") left = Math.max(left, 6);
  if (s.twin) left = Math.max(left, (s.posts?.aft?.reach ?? 0) - s.twin.dx + 3);
  const sternX = 1 + left;
  const bowX = sternX + s.len;
  const W = bowX + Math.max(s.sprit[0], s.ram ?? 0, s.posts?.fore?.reach ?? 0) + 3;
  const maxH = Math.max(...s.masts.map((m) => m.h));
  const D0 = TOP + maxH;
  const WL = D0 + s.freeboard;
  const K = WL + s.below;
  const H = K + 2;
  const sheer = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - sternX) / s.len));
    const r = t < 0.5 ? s.sheer[0] * ((0.5 - t) * 2) ** 2 : s.sheer[1] * ((t - 0.5) * 2) ** 2;
    return Math.round(D0 - r);
  };
  // 船体轮廓：舷弧 → 艏柱弧线 → 龙骨 → 艉部弧线 → 艉板
  const pts: Pt[] = [];
  for (let x = sternX; x <= bowX; x++) pts.push([x, sheer(x)]);
  const tipY = sheer(bowX);
  const [run, bx, by] = s.bow;
  // 圆木排筏只有薄薄一层（底下画出的几行留给伸进水里的中插板）
  const keel = s.skin === "logs" ? WL + 1 : K;
  const p0: Pt = [bowX + 1, tipY];
  const p2: Pt = [bowX - run, keel + 1];
  const p1: Pt = [p0[0] - run * bx, p2[1] - (p2[1] - tipY) * by];
  pts.push(...quad(p0, p1, p2, 14).slice(1));
  const [srun, srake] = s.stern;
  const knuckle: Pt = [sternX + srake, WL - Math.round(s.freeboard * 0.3)];
  pts.push(...quad([sternX + srun, keel + 1], [sternX + srake, keel + 1], knuckle, 10));
  pts.push([sternX, sheer(sternX)]);
  const hull = maskOf(pts);
  return { W, H, D0, WL, K, sternX, bowX, len: s.len, sheer, top: new Int32Array(W).fill(9999), hull };
}

// ───────────────────────── 船体 ─────────────────────────

const FIGURES: Record<Figure, readonly string[]> = {
  // 展翅的鸟
  bird: ["c...", "bc.c", ".bcb", "..a."],
  // 鬃毛兽首
  beast: [".cc.", "bccb", "abcc", ".ba."],
  // 手捧灯的女神像
  maiden: [".c..", "bcc.", ".bcc", ".bb.", "..a."],
  // 鹰隼：钩喙向前
  falcon: [".cc..", "bbcca", ".bb..", "..a.."],
  // 涡卷
  scroll: [".cb", "c.b", ".ba"],
  // 没有艏像
  none: [],
};

const ANCHOR = [".aaa.", "..a..", "..a..", "..a..", "a.a.a", ".aaa."];

function paintHull(cv: Canvas, g: Geo, s: Spec, look: Look): void {
  const wood = look.wood;
  const bw = s.freeboard >= 10 ? 3 : 2;
  const { hull } = g;
  // 每列底边，用于底部转折处的阴影
  const bot = new Int32Array(g.W).fill(-1);
  for (let y = hull.y0; y < hull.y0 + hull.h; y++) {
    for (let x = hull.x0; x < hull.x0 + hull.w; x++) if (maskHas(hull, x, y) && y > bot[x]) bot[x] = y;
  }
  const paint = look.pirate ? ([P.cloth.black[0], P.cloth.black[1], P.cloth.black[2]] as Ramp3) : s.paint;
  const topsides = look.pirate ? undefined : s.topsides;
  // 双体船：先画远侧的船体（暗一阶，只露出近侧船体上方与两端的部分）
  if (s.twin) paintTwinHull(cv, g, s, look);
  for (let y = hull.y0; y < hull.y0 + hull.h; y++) {
    for (let x = hull.x0; x < hull.x0 + hull.w; x++) {
      if (!maskHas(hull, x, y)) continue;
      const d = y - g.sheer(x);
      let c: string;
      if (y > g.WL) c = y === g.WL + 1 ? look.bottom[1] : look.bottom[0];
      else if (y === g.WL && !s.skin) c = look.boot;
      else if (s.skin === "logs") c = raftColor(g, x, y, d, wood);
      else {
        const ramp = topsides && d <= (s.topsidesTo ?? 0) ? topsides : wood;
        if (d <= 0) c = ramp[4];
        else if (d < bw) c = ramp[3];
        else if (d === bw) c = wood[1];
        else {
          // 船板：每 3 行一道断续的板缝，缝的空档处是对接缝；靠近水线与船底转折处变暗
          const k = d - bw - 1;
          const strake = Math.floor(k / 3);
          const row = k % 3;
          const ph = (x + strake * 6) % 16;
          let t = strake === 0 ? 3 : 2;
          if (s.clinker) {
            // 搭接船板：每道板上缘受光，下缘压着下一道板投下一道连续的暗线
            t = row === 0 ? 3 : row === 1 ? 2 : 1;
          } else if (s.skin === "sewn") {
            // 缝合船板：板缝是一道暗线，每隔三列一个浅色的椰棕绳针脚（没有对接缝）
            if (row === 2) t = (x + strake) % 3 === 0 ? 4 : t - 1;
          } else if (s.skin === "dugout") {
            // 刳木独木舟：整段木头，没有板缝，只有几道顺着木纹的细线
            if (row === 2 && strake > 0 && (x * 7 + strake * 5) % 23 < 9) t -= 1;
          } else if (row === 2 && ph < 13) t -= 1;
          else if (row < 2 && ph === 14) t -= 1;
          if (g.WL - y <= 1) t = Math.min(t, 1);
          if (bot[x] - y <= 1 && y >= g.WL - 3) t = 1;
          c = ramp[t];
        }
      }
      cv.dot(x, y, c, M_HULL);
    }
  }
  // 色带
  for (const b of s.bands) {
    const ramp = look.pirate && b.ramp !== TAR ? ([P.red[0], P.red[1], P.red[2]] as Ramp3) : b.ramp;
    for (let x = hull.x0; x < hull.x0 + hull.w; x++) {
      for (let r = 0; r < b.h; r++) {
        const y = g.sheer(x) + b.d + r;
        if (!maskHas(hull, x, y) || y >= g.WL) continue;
        const c = b.h === 1 ? ramp[1] : r === 0 ? ramp[2] : r === b.h - 1 ? ramp[0] : ramp[1];
        cv.dot(x, y, c, M_HULL);
      }
    }
  }
  // 艉楼与艏楼
  paintCastle(cv, g, s, look, paint, "aft");
  paintCastle(cv, g, s, look, paint, "fore");
  // 炮门：黑洞洞的门里露出炮口，门盖向上翻开（内侧漆红）
  for (const row of s.ports) {
    const x0 = g.sternX + row.from;
    const x1 = g.bowX - row.to - row.w;
    for (let i = 0; i < row.n; i++) {
      const px = Math.round(row.n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (row.n - 1));
      const py = g.sheer(px + 1) + row.d;
      if (!maskHas(hull, px, py + row.h) || !maskHas(hull, px + row.w, py + row.h)) continue;
      for (let xx = 0; xx < row.w; xx++) cv.dot(px + xx, py - 1, look.pirate ? P.red[0] : row.lid, M_HULL);
      for (let yy = 0; yy < row.h; yy++) for (let xx = 0; xx < row.w; xx++) cv.dot(px + xx, py + yy, ink.deep, M_HULL);
      const mx = px + Math.floor((row.w - 1) / 2);
      cv.dot(mx, py, P.iron[3], M_HULL);
      if (row.h > 1) cv.dot(mx, py + 1, P.iron[1], M_HULL);
    }
  }
  // 圆舷窗
  for (let i = 0; i < s.portholes; i++) {
    const px = Math.round(g.sternX + g.len * (0.3 + (0.42 * (i + 0.5)) / s.portholes));
    const py = g.sheer(px) + bw + 2;
    cv.dot(px, py, P.teal[3], M_HULL);
    cv.dot(px + 1, py, P.teal[1], M_HULL);
    cv.dot(px, py + 1, P.teal[1], M_HULL);
    cv.dot(px + 1, py + 1, ink.blue, M_HULL);
  }
  // 吃水标志
  if (s.marks) {
    for (let y = g.WL - 1; y > g.WL - 8; y -= 2) {
      let edge = -1;
      for (let x = g.W - 1; x >= 0; x--) {
        if (maskHas(hull, x, y)) {
          edge = x;
          break;
        }
      }
      if (edge > 0) {
        cv.dot(edge - 3, y, P.plaster[3], M_HULL);
        cv.dot(edge - 4, y, P.plaster[3], M_HULL);
      }
    }
  }
  // 舵：挂在艉柱上，水下略宽（寰宇·十六世纪的船另有几种舵，见 paintJunkRudder 与 paintFront）
  if (!s.rudder) {
    const rx = g.sternX + s.stern[1];
    const rTop = g.WL - Math.round(s.freeboard * 0.3) - 1;
    for (let y = rTop; y <= g.K; y++) {
      const x0 = y > g.WL ? rx - 2 : rx - 1;
      for (let x = x0; x <= rx; x++) {
        const c = y > g.WL ? look.bottom[0] : x === x0 ? wood[2] : wood[1];
        cv.dot(x, y, c, M_HULL);
      }
    }
    cv.dot(rx, rTop + 2, P.iron[3], M_HULL);
  } else if (s.rudder === "junk" || s.rudder === "hung") paintJunkRudder(cv, g, s, look, s.rudder === "junk");
  // 锚
  const ax = g.bowX - Math.round(s.bow[0] * 0.55) - 3;
  const ay = g.sheer(ax) + 1;
  if (!s.anchor) {
    cv.stamp(ANCHOR, { a: P.iron[1] }, ax - 2, ay, M_HULL);
    cv.dot(ax - 1, ay, P.iron[3], M_HULL);
    cv.dot(ax, ay + 1, P.iron[3], M_HULL);
    cv.dot(ax, ay + 2, P.iron[2], M_HULL);
  } else if (s.anchor === "wood") cv.stamp(WOOD_ANCHOR, { a: wood[1], b: wood[3], c: wood[2], i: P.iron[2] }, ax - 2, ay, M_HULL);
  // 艏像与艏部金饰线
  const fig = FIGURES[s.figure];
  const tipY = g.sheer(g.bowX);
  const figKey = { a: P.gold[0], b: P.gold[1], c: P.gold[3] };
  cv.stamp(fig, figKey, g.bowX, tipY + 1, M_HULL);
  if (!s.plainBow) for (let i = 1; i <= 4; i++) cv.dot(g.bowX - i, g.sheer(g.bowX - i) + 2 + (i > 2 ? 1 : 0), P.gold[2], M_HULL);
  // 撞角：自艏柱伸出的尖喙，木身镀金尖
  if (s.ram) {
    const ry = tipY + 3;
    for (let i = 0; i <= s.ram; i++) {
      const x = g.bowX - 2 + i;
      const half = Math.max(0, Math.round(1.6 * (1 - i / s.ram)));
      for (let dy = -half; dy <= half; dy++) {
        const c = i > s.ram - 4 ? (dy < 0 ? P.gold[3] : P.gold[1]) : dy < 0 ? wood[4] : dy === 0 ? wood[3] : wood[1];
        cv.dot(x, ry + dy, c, M_HULL);
      }
    }
    cv.dot(g.bowX + s.ram - 3, ry, P.gold[2], M_HULL);
  }
  // 方头船的艏面漆色
  if (s.bowFace) paintBowFace(cv, g, s.bowFace);
  // 龙目：船艏两侧画的眼睛（白眼、黑瞳、红眼眶）
  if (s.eye) {
    const ex = g.bowX - 8;
    const ey = g.sheer(ex) + 2;
    cv.stamp([".rrr.", "rwxxr", ".rrr."], { r: P.red[2], w: P.white, x: ink.deep }, ex - 2, ey, M_HULL);
    // 鸟船的“绿眉毛”：眼睛上方一道向前挑起的眉
    if (s.brow) cv.stamp(["...bb", ".bbb.", "bb..."], { b: s.brow }, ex - 3, ey - 3, M_HULL);
  }
  // 寰宇·十六世纪的部件：翘起的艏艉柱、甲板上的墙、篷、楼阁、小屋、中插板、双体船的平台
  paintWorks(cv, g, s, look);
  // 记录每列最高点
  g.top.fill(9999);
  for (let x = 0; x < g.W; x++) {
    for (let y = 0; y < g.H; y++) {
      if (cv.m(x, y) === M_HULL) {
        g.top[x] = y;
        break;
      }
    }
  }
  if (s.cargo) paintCargo(cv, g, s, look);
}

function paintCastle(cv: Canvas, g: Geo, s: Spec, look: Look, paint: Ramp3, side: "aft" | "fore"): void {
  const tiers = side === "aft" ? s.aft : s.fore;
  if (tiers.length === 0) return;
  const wood = look.wood;
  const molding = s.ornate && !look.pirate ? P.gold[2] : wood[4];
  const cum: number[] = [];
  tiers.reduce((a, t) => {
    cum.push(a + t.h);
    return a + t.h;
  }, 0);
  const over = side === "aft" ? s.over : 0;
  const xa = side === "aft" ? g.sternX - over : g.bowX - tiers[0].len + 1;
  const xb = side === "aft" ? g.sternX + tiers[0].len - 1 : g.bowX;
  for (let x = xa; x <= xb; x++) {
    const xs = Math.max(g.sternX, Math.min(g.bowX, x));
    const base = g.sheer(xs);
    // 该列最高的一层
    let k = 0;
    for (let i = 0; i < tiers.length; i++) {
      const inTier = side === "aft" ? x <= g.sternX + tiers[i].len - 1 : x >= g.bowX - tiers[i].len + 1;
      if (inTier) k = i;
    }
    const kick = side === "aft" && x < g.sternX ? 1 : 0;
    const topY = base - cum[k] - kick;
    const bottomY = x < g.sternX ? base + 2 - Math.round(((g.sternX - x) * 3) / Math.max(1, over)) : base - 1;
    for (let y = topY; y <= bottomY; y++) {
      // 该像素属于哪一层
      let j = 0;
      while (j < k && y < base - cum[j]) j++;
      const tierTop = j === k ? topY : base - cum[j];
      const tierBot = j === 0 ? base - 1 : base - cum[j - 1] - 1;
      const r = y - tierTop;
      const hTier = tierBot - tierTop + 1;
      let c: string;
      if (r === 0) c = j === k ? wood[4] : molding;
      else if (r === hTier - 1 && y < base - 1) c = wood[1];
      else if (j === k && r === 1 && hTier >= 4) c = x % 2 === 0 ? wood[3] : wood[1];
      else c = r === 1 ? paint[2] : paint[1];
      if (x < g.sternX && y > base - 1) c = paint[0];
      cv.dot(x, y, c, M_HULL);
    }
    // 城垛：顶上每隔两格挖掉两格，垛口里是暗影
    if (s.crenel && x > xa + 1 && x < xb - 1 && (x - xa) % 4 >= 2) {
      cv.dot(x, topY, null, 0);
      cv.dot(x, topY + 1, wood[1], M_HULL);
    }
    // 艉部外伸处的金色饰边（受光的一侧）
    if (side === "aft" && x === xa) {
      for (let y = topY + 1; y <= bottomY; y++) cv.dot(x, y, y % 3 === 0 ? P.gold[3] : P.gold[2], M_HULL);
    }
    if (side === "fore" && x === xb) {
      for (let y = topY + 1; y < base; y++) cv.dot(x, y, wood[1], M_HULL);
    }
  }
  // 艉楼侧窗：每层足够高时开一排，深色玻璃带一点反光
  if (side === "aft" && s.windows > 0) {
    for (let j = 0; j < tiers.length; j++) {
      if (tiers[j].h < 4) continue;
      const n = j === 0 ? s.windows : Math.max(1, s.windows - 2);
      for (let i = 0; i < n; i++) {
        const wx = g.sternX + 1 + i * 4;
        if (wx + 2 > g.sternX + tiers[j].len - 2) break;
        const base = g.sheer(wx);
        const wy = base - (j === 0 ? 0 : cum[j - 1]) - tiers[j].h + 2;
        const hWin = Math.max(1, Math.min(3, tiers[j].h - 3));
        for (let yy = 0; yy < hWin; yy++) {
          cv.dot(wx, wy + yy, yy === 0 ? P.teal[3] : ink.blue, M_HULL);
          cv.dot(wx + 1, wy + yy, ink.blue, M_HULL);
        }
      }
    }
  }
}

function paintCargo(cv: Canvas, g: Geo, s: Spec, look: Look): void {
  const main = s.masts[1];
  const fore = s.masts[2];
  if (!main || !fore) return;
  const x0 = mastX(g, main) + 3;
  const x1 = mastX(g, fore) - 3;
  const wood = look.wood;
  let x = x0;
  let i = 0;
  while (x + 4 <= x1) {
    const deck = g.sheer(x + 2);
    if (i % 3 === 2) {
      // 木桶：两道铁箍
      for (let yy = 0; yy < 4; yy++) {
        for (let xx = 0; xx < 3; xx++) {
          const c = yy === 1 || yy === 2 ? (xx === 0 ? wood[3] : wood[2]) : P.iron[2];
          cv.dot(x + xx, deck - 4 + yy, c, M_HULL);
        }
      }
      x += 4;
    } else {
      // 货箱：亮面在左上，一道横板
      const tall = i % 3 === 1 ? 5 : 4;
      for (let yy = 0; yy < tall; yy++) {
        for (let xx = 0; xx < 4; xx++) {
          const edge = yy === 0 || xx === 0;
          const c = edge ? wood[4] : xx === 3 || yy === tall - 1 ? wood[2] : wood[3];
          cv.dot(x + xx, deck - tall + yy, c, M_HULL);
        }
      }
      cv.dot(x + 1, deck - tall + 2, wood[1], M_HULL);
      cv.dot(x + 2, deck - tall + 2, wood[1], M_HULL);
      x += 5;
    }
    i++;
  }
  for (let xx = x0; xx < x; xx++) g.top[xx] = Math.min(g.top[xx], g.sheer(xx) - 5);
}

// ───────────────────────── 寰宇·十六世纪的船体部件 ─────────────────────────

/** 东方船的木碇：一根横杆、碇身与两只包铁的爪。 */
const WOOD_ANCHOR = ["bbbbb", "..c..", "..c..", "a.c.a", "ic.ci", ".ccc."];

/** 圆木排筏：上面两行是苇编的甲板，其下是一根粗圆木（上亮下暗），每隔九列一道绳捆。 */
function raftColor(g: Geo, x: number, y: number, d: number, wood: Ramp5): string {
  if (d <= 0) return x % 2 === 0 ? P.straw[3] : P.straw[2];
  if (d === 1) return x % 3 === 0 ? P.straw[1] : P.straw[2];
  const top = g.sheer(x) + 2;
  const t = (y - top) / Math.max(1, g.WL + 1 - top);
  if ((x - g.sternX) % 9 === 4) return (y - top) % 2 === 0 ? P.straw[1] : P.straw[0];
  return t < 0.2 ? wood[4] : t < 0.5 ? wood[3] : t < 0.8 ? wood[2] : wood[1];
}

/** 双体船远侧的船体：同样的轮廓向左上错开，暗一阶；艏艉柱也暗一阶。 */
function paintTwinHull(cv: Canvas, g: Geo, s: Spec, look: Look): void {
  const t = s.twin;
  if (!t) return;
  const wood = look.wood;
  const { hull } = g;
  for (let y = hull.y0; y < hull.y0 + hull.h; y++) {
    for (let x = hull.x0; x < hull.x0 + hull.w; x++) {
      if (!maskHas(hull, x, y) || y > g.WL) continue;
      const d = y - g.sheer(x);
      cv.dot(x + t.dx, y + t.dy, d <= 0 ? wood[2] : d === 1 ? wood[1] : wood[0], M_HULL);
    }
  }
  if (s.posts?.aft) paintPost(cv, g, s.posts.aft, "aft", wood, t.dx, t.dy, true);
  if (s.posts?.fore) paintPost(cv, g, s.posts.fore, "fore", wood, t.dx, t.dy, true);
}

/**
 * 翘起的艏柱或艉柱：自船端沿一条二次曲线伸出、由粗变细；按“到柱边的方向”着色（左上受光、右下背光）。
 * dx、dy、far 用于双体船远侧的那条船（错开、暗两阶）。
 */
function paintPost(cv: Canvas, g: Geo, p: PostSpec, side: "aft" | "fore", wood: Ramp5, dx = 0, dy = 0, far = false): void {
  const dir = side === "fore" ? 1 : -1;
  const end = side === "fore" ? g.bowX : g.sternX;
  const bx = end + dx;
  const by = g.sheer(end) + dy;
  const tip: Pt = [bx + dir * p.reach, by - p.h];
  const ctrl: Pt = [bx + dir * p.reach * p.bend, by - p.h * (1 - p.bend)];
  const n = Math.max(10, Math.round((p.h + p.reach) * 2));
  const cells = new Set<number>();
  const add = (x: number, y: number) => {
    if (cv.has(x, y)) cells.add(y * cv.w + x);
  };
  quad([bx - dir, by + 2], ctrl, tip, n).forEach(([px, py], k) => {
    const r = ((p.w - 1) * (1 - k / n)) / 2;
    const ri = Math.ceil(r);
    for (let yy = -ri; yy <= ri; yy++) for (let xx = -ri; xx <= ri; xx++) if (xx * xx + yy * yy <= r * r + 0.6) add(Math.round(px + xx), Math.round(py + yy));
  });
  const tx = Math.round(tip[0]);
  const ty = Math.round(tip[1]);
  if (p.tip === "curl") for (const [cx, cy] of [[tx, ty - 1], [tx - dir, ty - 2], [tx - dir * 2, ty - 2], [tx - dir * 2, ty - 1]] as const) add(cx, cy);
  if (p.tip === "knob") for (const [cx, cy] of [[tx, ty - 1], [tx + dir, ty - 1], [tx, ty - 2], [tx + dir, ty - 2]] as const) add(cx, cy);
  const ramp: readonly string[] = p.paint ? [p.paint[0], p.paint[0], p.paint[1], p.paint[2], p.paint[2]] : wood;
  const has = (x: number, y: number) => cells.has(y * cv.w + x);
  for (const key of cells) {
    const x = key % cv.w;
    const y = Math.floor(key / cv.w);
    let t = 3;
    if (!has(x, y - 1) || !has(x - 1, y)) t = 4;
    else if (!has(x, y + 1) || !has(x + 1, y)) t = 1;
    if (far) t = Math.max(0, t - 2);
    cv.dot(x, y, ramp[t], M_HULL);
  }
}

/** 东方船的大舵：吊在艉下，舵叶比船底还深（中国船的舵叶开着一排菱形的孔），舵杆伸到艉楼上。 */
function paintJunkRudder(cv: Canvas, g: Geo, s: Spec, look: Look, holes: boolean): void {
  const wood = look.wood;
  const rx = g.sternX + s.stern[1] + 1;
  for (let y = topAt(g, g.sternX) - 2; y <= g.K; y++) cv.dot(rx, y, wood[1], M_HULL);
  const y0 = g.WL - Math.round(s.freeboard * 0.45);
  for (let y = y0; y <= g.K + 1; y++) {
    const t = (y - y0) / Math.max(1, g.K + 1 - y0);
    const wb = 2 + Math.round(4 * t);
    for (let x = rx - wb; x < rx; x++) {
      const under = y > g.WL;
      let c = under ? (x === rx - wb ? look.bottom[1] : look.bottom[0]) : x === rx - wb ? wood[3] : wood[2];
      if (holes && (x + y) % 4 === 0 && x > rx - wb && y > y0 + 1 && y < g.K) c = ink.deep;
      cv.dot(x, y, c, M_HULL);
    }
  }
}

/** 方头船的艏面：艏柱一侧的三列涂漆（前缘最亮）。 */
function paintBowFace(cv: Canvas, g: Geo, ramp: Ramp3): void {
  for (let y = g.sheer(g.bowX); y < g.WL; y++) {
    let edge = -1;
    for (let x = g.W - 1; x >= 0 && edge < 0; x--) if (maskHas(g.hull, x, y)) edge = x;
    if (edge < 0) continue;
    cv.dot(edge, y, ramp[2], M_HULL);
    cv.dot(edge - 1, y, ramp[1], M_HULL);
    cv.dot(edge - 2, y, ramp[0], M_HULL);
  }
}

/** 甲板上的部件（画在船体之后、记录每列最高点之前，帆脚会让开它们）。经典船型一样也不画。 */
function paintWorks(cv: Canvas, g: Geo, s: Spec, look: Look): void {
  const wood = look.wood;
  if (s.posts?.aft) paintPost(cv, g, s.posts.aft, "aft", wood);
  if (s.posts?.fore) paintPost(cv, g, s.posts.fore, "fore", wood);
  if (s.twin) paintPlatform(cv, g, s.twin, wood);
  if (s.wall) paintWall(cv, g, s.wall, look);
  if (s.awning) paintAwning(cv, g, s.awning, look);
  if (s.tower) paintTower(cv, g, s.tower, s.wall, look);
  if (s.hut) paintHut(cv, g, s, s.hut, wood);
  if (s.skin === "logs") paintLogEnds(cv, g, wood);
  for (const b of s.boards ?? []) {
    // 中插板：自甲板的缝里插下去，顶端露出甲板，下端伸到筏底下的水里
    const x = g.sternX + Math.round(b * g.len);
    for (let y = g.sheer(x) - 3; y <= g.K + 1; y++) {
      const above = y < g.sheer(x);
      cv.dot(x, y, above ? wood[4] : y > g.WL ? wood[2] : wood[3], M_HULL);
      cv.dot(x + 1, y, above ? wood[2] : wood[1], M_HULL);
    }
  }
}

/** 双体船两船之间的平台：苇席铺面，每隔八列露出一根横梁的梁头。 */
function paintPlatform(cv: Canvas, g: Geo, t: TwinSpec, wood: Ramp5): void {
  for (let x = g.sternX + t.from; x <= g.bowX - t.to; x++) {
    const base = g.sheer(x);
    for (let y = base + t.dy; y < base; y++) {
      const r = y - (base + t.dy);
      const beam = (x - g.sternX - t.from) % 8 === 0;
      cv.dot(x, y, beam ? (r === 0 ? wood[4] : wood[1]) : r === 0 ? P.straw[3] : r === 1 ? P.straw[2] : wood[2], M_HULL);
    }
  }
}

/** 甲板上的一道墙（楯板、板屋、护板），墙顶是水平的；一两排枪眼。 */
function paintWall(cv: Canvas, g: Geo, w: WallSpec, look: Look): void {
  const wood = look.wood;
  const ramp = look.pirate ? ([P.cloth.black[0], P.cloth.black[1], P.cloth.black[2]] as Ramp3) : w.ramp;
  const x0 = g.sternX + w.from;
  const x1 = g.bowX - w.to;
  const top = g.D0 - w.h;
  const deckAt = (x: number) => g.sheer(Math.max(g.sternX, Math.min(g.bowX, x)));
  for (let x = x0; x <= x1; x++) {
    const base = deckAt(x);
    const k = x - x0;
    for (let y = top; y < base; y++) {
      const r = y - top;
      let c: string;
      if (r === 0) c = wood[4];
      else if (y === base - 1) c = ramp[0];
      else if (w.style === "panok") c = r % 3 === 1 ? ramp[2] : r % 3 === 0 ? ramp[0] : ramp[1];
      else if (r === 1) c = w.style === "tate" ? wood[1] : ramp[0];
      else c = k % 3 === 2 ? ramp[0] : k % 3 === 0 ? ramp[2] : ramp[1];
      cv.dot(x, y, c, M_HULL);
    }
    // 板屋的女墙：墙顶隔三列空一列
    if (w.style === "panok" && k % 4 === 3 && x > x0 && x < x1) {
      cv.dot(x, top, null, 0);
      cv.dot(x, top + 1, ramp[0], M_HULL);
    }
  }
  // 枪眼：楯板是竖长的狭间，板屋是方形的炮眼（上沿一道亮边），护板是小方窗
  const step = w.style === "panok" ? 7 : w.style === "hu" ? 4 : 5;
  for (let l = 0; l < w.loops; l++) {
    const ly = top + 3 + l * 4;
    for (let x = x0 + 3 + (l % 2) * 2; x <= x1 - 3; x += step) {
      if (ly + 2 >= deckAt(x)) continue;
      if (w.style === "tate") {
        cv.dot(x, ly, ink.deep, M_HULL);
        cv.dot(x, ly + 1, ink.deep, M_HULL);
      } else if (w.style === "panok") {
        cv.rect(x, ly, 2, 2, ink.deep, M_HULL);
        cv.dot(x, ly - 1, ramp[2], M_HULL);
        cv.dot(x + 1, ly - 1, ramp[2], M_HULL);
      } else {
        cv.dot(x, ly, ink.deep, M_HULL);
        cv.dot(x + 1, ly, P.gold[1], M_HULL);
      }
    }
  }
}

/** 加莱船船尾的条纹篷：拱起的布篷两端垂下，下缘一排流苏，篷下是艉台的暗影与栏杆，两端立柱。 */
function paintAwning(cv: Canvas, g: Geo, a: AwningSpec, look: Look): void {
  const wood = look.wood;
  const x0 = g.sternX + a.from;
  const x1 = g.sternX + a.to;
  const mid = (x0 + x1) / 2;
  const half = Math.max(1, (x1 - x0) / 2);
  for (let x = x0; x <= x1; x++) {
    const base = g.sheer(x);
    const u = (x - mid) / half;
    const top = base - a.h + Math.round(2 * u * u);
    const ramp = look.pirate ? [P.cloth.black[0], P.cloth.black[1], P.cloth.black[2]] : a.stripes[Math.floor((x - x0) / 3) % 2];
    for (let y = top; y < base; y++) {
      const r = y - top;
      let c: string;
      if (r === 0) c = ramp[2];
      else if (r === 1) c = ramp[1];
      else if (r === 2 || (r === 3 && x % 2 === 0)) c = ramp[0];
      else c = y === base - 2 ? wood[3] : wood[0];
      cv.dot(x, y, c, M_HULL);
    }
  }
  for (const x of [x0, x1]) for (let y = g.sheer(x) - a.h + 3; y < g.sheer(x); y++) cv.dot(x, y, wood[3], M_HULL);
}

/** 楼阁：每层白墙黑框（或敞开的红柱与栏杆），其上一层瓦顶，檐口宽出墙、檐角上翘，顶层屋脊两端一点金饰。 */
function paintTower(cv: Canvas, g: Geo, t: TowerSpec, wall: WallSpec | undefined, look: Look): void {
  const wood = look.wood;
  const cx = g.sternX + Math.round(t.at * g.len);
  let base = wall ? g.D0 - wall.h : g.sheer(cx);
  const frame = look.pirate ? P.iron[0] : wood[1];
  t.floors.forEach((f, k) => {
    const last = k === t.floors.length - 1;
    const x0 = cx - Math.floor(f.w / 2);
    const x1 = x0 + f.w - 1;
    const wallTop = base - f.h;
    for (let y = wallTop; y < base; y++) {
      const r = y - wallTop;
      for (let x = x0; x <= x1; x++) {
        let c: string;
        if (t.open) {
          const pillar = x === x0 || x === x1 || (x - x0) % 4 === 0;
          c = pillar ? (x === x0 ? P.red[2] : P.red[1]) : y === base - 2 ? wood[4] : y === base - 1 ? wood[2] : wood[0];
        } else {
          const post = x === x0 || x === x1 || (x - x0) % 5 === 0;
          if (r === 0 || y === base - 1 || post) c = frame;
          else if (r === Math.floor(f.h / 2) && (x - x0) % 5 >= 2 && (x - x0) % 5 <= 3) c = ink.deep;
          else c = (x - x0) % 5 === 1 ? P.plaster[3] : P.plaster[2];
        }
        cv.dot(x, y, c, M_HULL);
      }
    }
    // 瓦顶：檐口一行最宽（受光的瓦口），往上逐行内收，最上一行屋脊
    const ext = last ? 3 : 2;
    const rh = last ? 4 : 3;
    for (let r = 0; r < rh; r++) {
      const y = wallTop - 1 - r;
      const inset = r === 0 ? 0 : r * (last ? 2 : 1);
      for (let x = x0 - ext + inset; x <= x1 + ext - inset; x++) {
        const c = r === 0 ? P.slate[3] : r === rh - 1 ? P.slate[0] : (x + r) % 2 === 0 ? P.slate[1] : P.slate[2];
        cv.dot(x, y, c, M_HULL);
      }
    }
    cv.dot(x0 - ext - 1, wallTop - 2, P.slate[3], M_HULL);
    cv.dot(x1 + ext + 1, wallTop - 2, P.slate[3], M_HULL);
    if (last && !t.open) {
      const ry = wallTop - rh;
      cv.dot(x0 - ext + (rh - 1) * 2, ry, P.gold[3], M_HULL);
      cv.dot(x1 + ext - (rh - 1) * 2, ry, P.gold[3], M_HULL);
    }
    base = wallTop - rh + 2;
  });
}

/** 篷与小屋：叶片斜铺的篷顶、参差的檐；篷下敞开（暗影里的货包与陶罐）或竹苇编的墙。 */
function paintHut(cv: Canvas, g: Geo, s: Spec, h: HutSpec, wood: Ramp5): void {
  const x0 = g.sternX + h.from;
  const x1 = g.sternX + h.to;
  const lift = s.twin ? Math.round(s.twin.dy / 2) : 0;
  const leaf = h.leaf === "palm" ? [P.leaf[1], P.leaf[2], P.leaf[3]] : [P.straw[1], P.straw[2], P.straw[3]];
  const mid = (x0 + x1) / 2;
  const half = Math.max(1, (x1 - x0) / 2);
  for (let x = x0; x <= x1; x++) {
    const base = g.sheer(x) + lift;
    const u = Math.abs(x - mid) / half;
    const top = h.roof === "arch" ? base - h.h + Math.round(2.5 * u * u) : base - h.h + (u > 0.8 ? 1 : 0);
    for (let y = top; y < base; y++) {
      const r = y - top;
      let c: string;
      if (r < 3 || (r === 3 && (x * 3 + 1) % 4 < 2)) {
        const k = (x * 2 + y * 3) % 5;
        c = r === 0 ? leaf[2] : k === 0 ? leaf[0] : k < 3 ? leaf[1] : leaf[2];
      } else if (h.under === "cane") c = x === x0 || x === x1 ? wood[2] : x % 2 === 0 ? P.straw[2] : P.straw[1];
      else c = x === x0 || x === x1 ? wood[3] : wood[0];
      cv.dot(x, y, c, M_HULL);
    }
  }
  if (h.under === "open") {
    // 篷下的货：棉布包与陶罐
    for (let x = x0 + 2, i = 0; x + 3 < x1; x += 4, i++) {
      const base = g.sheer(x) + lift;
      if (i % 2 === 0) {
        cv.rect(x, base - 2, 3, 2, P.cloth.cream[1], M_HULL);
        cv.dot(x, base - 2, P.cloth.cream[2], M_HULL);
        cv.dot(x + 1, base - 1, P.cloth.cream[0], M_HULL);
      } else {
        cv.rect(x, base - 2, 2, 2, P.brick[2], M_HULL);
        cv.dot(x, base - 2, P.brick[3], M_HULL);
      }
    }
  } else {
    const base = g.sheer(x1 - 3) + lift;
    cv.rect(x1 - 3, base - 3, 2, 3, wood[0], M_HULL);
  }
}

/** 排筏的船头：中间的圆木最长，露出两层圆木的截面（外圈树皮、里面的年轮）。 */
function paintLogEnds(cv: Canvas, g: Geo, wood: Ramp5): void {
  const top = g.sheer(g.bowX) + 2;
  const r = Math.max(1, Math.floor((g.WL + 1 - top) / 2));
  const cy = top + r;
  for (const [cx, dim] of [
    [g.bowX - r - 3, true],
    [g.bowX - r, false],
  ] as const) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const q = (x - cx) ** 2 + (y - cy) ** 2;
        if (q > r * r + r) continue;
        const ring = q > (r - 1) * (r - 1);
        let c = ring ? wood[1] : q <= 1 ? wood[2] : (x + y) % 3 === 0 ? wood[3] : wood[4];
        if (dim && !ring) c = wood[3];
        cv.dot(x, y, c, M_HULL);
      }
    }
  }
}

/** 日本船的幟：旗杆顶上一根横竿，竖长的旗挂在杆与竿上，向船尾一侧垂下，自由的一边随帧起伏。 */
function paintBanners(cv: Canvas, g: Geo, b: BannerSpec, look: Look, frame: number): void {
  const wood = look.wood;
  b.at.forEach((a, i) => {
    const x = g.sternX + Math.round(a * g.len);
    const base = topAt(g, x);
    const top = base - b.h;
    for (let y = top; y < base; y++) cv.dot(x, y, wood[2], M_SPAR);
    for (let k = 0; k <= 3; k++) cv.dot(x - k, top + 1, wood[1], M_SPAR);
    const [field, band] = look.pirate ? [P.cloth.black[1], P.cloth.black[2]] : b.colors[i % b.colors.length];
    const bh = Math.round(b.h * 0.72);
    for (let yy = 0; yy < bh; yy++) {
      const ripple = (yy + frame + i) % 4 === 0 ? 1 : 0;
      for (let xx = 1; xx <= 3 - ripple; xx++) cv.dot(x - xx, top + 2 + yy, yy < 2 ? band : field, M_FLAG);
    }
  });
}

/** 画在船体前面的部件：舷外支架、桨手、披水板、舷侧舵、操舵桨。 */
function paintFront(cv: Canvas, g: Geo, s: Spec, look: Look, frame: number): void {
  const wood = look.wood;
  if (s.outrigger) {
    // 舷外支架：离观者更近的浮木浮在水线上（比船身低一点），两头上翘；几根撑木自舷边的横杆斜下来连着它
    const o = s.outrigger;
    const x0 = g.sternX + o.from;
    const x1 = g.bowX - o.to;
    const fy = g.WL - 1;
    for (let x = x0 + 1; x <= x1 - 1; x++) cv.dot(x, g.sheer(x) + 2, wood[4], M_HULL);
    for (let k = 0; k < o.struts; k++) {
      const x = Math.round(x0 + 3 + ((x1 - x0 - 6) * k) / Math.max(1, o.struts - 1));
      cv.line(x, g.sheer(x) + 3, x - 2, fy - 1, wood[4], M_HULL);
    }
    for (let x = x0; x <= x1; x++) {
      const e = Math.min(x - x0, x1 - x);
      if (e < 2) cv.dot(x, fy - (2 - e), wood[4], M_HULL);
      else {
        cv.dot(x, fy, wood[4], M_HULL);
        cv.dot(x, fy + 1, wood[2], M_HULL);
      }
    }
  }
  for (const p of s.paddlers ?? []) {
    // 桨手的剪影：跪坐着、面朝船头，深色的身子与头（不画五官）；短桨随帧前探入水、后拉、提起
    const x0 = g.sternX + p.from;
    const x1 = g.bowX - p.to;
    const reach = [4, 2, -1, 1][frame];
    const lean = frame === 0 ? 1 : 0;
    const skin = look.pirate ? [P.cloth.black[1], P.cloth.black[2]] : [P.skinDark[1], P.skinDark[2]];
    for (let i = 0; i < p.n; i++) {
      const x = Math.round(p.n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (p.n - 1));
      const sy = g.sheer(x) + p.seat;
      // 短桨：握把在头前，桨叶在水里
      cv.line(x + 3 + lean, sy - 5, x + 3 + reach, g.WL, wood[1], M_SPAR);
      cv.dot(x + 3 + reach, g.WL + 1, wood[0], M_SPAR);
      cv.dot(x + 2 + reach, g.WL + 1, wood[0], M_SPAR);
      // 身子：腿、躯干、伸向桨的手臂
      cv.dot(x, sy - 1, skin[0], M_HULL);
      cv.dot(x + 1, sy - 1, skin[0], M_HULL);
      cv.dot(x + 2, sy - 1, skin[0], M_HULL);
      for (const yy of [2, 3]) {
        cv.dot(x + lean, sy - yy, skin[1], M_HULL);
        cv.dot(x + 1 + lean, sy - yy, skin[0], M_HULL);
      }
      cv.dot(x + 2 + lean, sy - 3, skin[1], M_HULL);
      for (const [hx, hy] of [[0, 4], [1, 4], [0, 5], [1, 5]] as const) cv.dot(x + hx + lean, sy - hy, hy === 5 && hx === 0 ? P.hair.black[2] : P.hair.black[1], M_HULL);
    }
  }
  if (s.leeboard) {
    // 披水板：吊在舷边，上窄下宽、向船尾斜着伸到水线下（深色的板、受光的前缘）
    const lb = s.leeboard;
    const x = g.sternX + Math.round(lb.at * g.len);
    const y0 = g.sheer(x) - 1;
    const y1 = Math.min(g.K, y0 + lb.len);
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      const half = 1 + Math.round(2.5 * t);
      const cx = x - Math.round(4 * t);
      for (let xx = cx - half; xx <= cx + half; xx++) cv.dot(xx, y, xx === cx + half || y === y1 ? wood[3] : xx === cx - half ? wood[0] : wood[1], M_HULL);
    }
    cv.dot(x, y0 + 1, P.iron[3], M_HULL);
  }
  if (s.rudder === "quarter") {
    // 舷侧舵：一支宽叶的大桨斜挂在船尾的舷侧，舵杆高出舷缘，舵叶在水下
    const xa = g.sternX + 8;
    const ya = g.sheer(xa) - 3;
    const xb = g.sternX - 3;
    const yb = g.K + 1;
    for (let y = ya; y <= yb; y++) {
      const t = (y - ya) / Math.max(1, yb - ya);
      const x = Math.round(xa + (xb - xa) * t);
      const blade = y >= g.WL - 2 ? Math.min(3, 1 + Math.floor((y - g.WL + 2) / 2)) : 0;
      cv.dot(x, y, wood[3], M_HULL);
      cv.dot(x + 1, y, wood[1], M_HULL);
      for (let k = 1; k <= blade; k++) cv.dot(x - k, y, k === blade ? wood[4] : wood[2], M_HULL);
    }
  }
  if (s.rudder === "oar") {
    // 操舵桨：自艉部斜伸到船尾后面的水里
    const xa = g.sternX + 4;
    const ya = topAt(g, xa) - 3;
    const xb = g.sternX - 8;
    const yb = g.WL + 1;
    cv.line(xa, ya, xb, yb - 1, wood[3], M_SPAR);
    cv.line(xa + 1, ya, xb + 1, yb - 1, wood[1], M_SPAR);
    cv.rect(xb - 2, yb - 1, 3, 2, wood[2], M_SPAR);
    cv.dot(xb - 2, yb - 1, wood[4], M_SPAR);
  }
}

/** 矩形帆（rect）：上缘挂在横桁上，帆脚离甲板（与甲板上的楼、墙）留一点空。 */
function rectLayout(g: Geo, m: MastSpec): { hl: Pt; hr: Pt; fr: Pt; fl: Pt } {
  const spread = m.spread ?? 16;
  const cx = mastX(g, m) + (m.lead ?? 0) + 0.5;
  const yHead = g.D0 - m.h + 2 + (m.topmast ?? 0);
  let hullTop = g.D0;
  for (let x = Math.floor(cx - spread / 2) - 1; x <= Math.ceil(cx + spread / 2) + 1; x++) hullTop = Math.min(hullTop, topAt(g, x));
  const yFoot = Math.min(g.D0 - Math.max(3, Math.round(m.h * 0.1)), hullTop - 3);
  return { hl: [cx - spread / 2, yHead], hr: [cx + spread / 2, yHead], fr: [cx + spread / 2, yFoot], fl: [cx - spread / 2, yFoot] };
}

/**
 * 东南亚倾斜的矩形硬帆（tanja）：上下两根平行的桁，前低后高；帆前角 T 低低地系在桅前，帆脚桁向后上方抬起到 C，
 * 上桁自 H 斜到最高处的 K。整面帆像一块向前倾倒的平行四边形。
 */
function tanjaLayout(g: Geo, m: MastSpec): { T: Pt; C: Pt; K: Pt; H: Pt } {
  const lead = m.lead ?? 4;
  const spread = m.spread ?? 16;
  const rise = m.rise ?? Math.round(spread * 0.3);
  const lean = m.lean ?? 2;
  const tx = mastX(g, m) + lead;
  let hullTop = g.D0;
  for (let x = tx - spread - 1; x <= tx + 1; x++) hullTop = Math.min(hullTop, topAt(g, x));
  const T: Pt = [tx, Math.min(g.D0 - 3, hullTop - 3)];
  const C: Pt = [tx - spread, T[1] - rise];
  const top = g.D0 - m.h + 2;
  return { T, C, K: [tx - lean - spread, top], H: [tx - lean, top + rise] };
}

/**
 * 蟹爪帆（crab）：两根桁自帆前角 A 张开——上桁斜指向上方的 U，下桁平平地伸向船尾的 L；帆的上缘自 L 到 U 向里凹成弧，
 * 两根桁梢像蟹的两只钳。桅杆斜撑在上桁的中段 P。
 */
function crabLayout(g: Geo, m: MastSpec): { A: Pt; U: Pt; L: Pt; P: Pt; top: number } {
  const tx = mastX(g, m) + (m.lead ?? 6);
  const A: Pt = [tx, Math.min(g.sheer(tx), topAt(g, tx)) - 2];
  const U: Pt = [tx - (m.reach ?? 8), g.D0 - m.h + 1];
  const L: Pt = [tx - (m.spread ?? 18), A[1] - (m.rise ?? 8)];
  const Pm = lerp(A, U, 0.62);
  return { A, U, L, P: Pm, top: Math.round(Pm[1]) };
}

/** 折桅：蒙版上 cutY 以上的部分撕掉，断口参差。 */
function cutAbove(mask: Mask, cutY: number): void {
  for (let y = mask.y0; y <= cutY + 1; y++) {
    for (let x = mask.x0; x < mask.x0 + mask.w; x++) if (y < cutY + (x % 3 === 0 ? 1 : 0) + (x % 5 === 1 ? 1 : 0)) maskSet(mask, x, y, 0);
  }
}

const LANTERN_SMALL = [".g.", "gLg", "glg", ".g."];
const LANTERN_BIG = ["..g..", ".ggg.", "gLLlg", "gLlLg", "gLLlg", ".ggg.", "..g.."];

function paintLanterns(cv: Canvas, g: Geo, s: Spec): void {
  if (s.lantern === 0) return;
  const key = { g: P.gold[1], L: P.lamp[2], l: P.lamp[1] };
  const xs = g.sternX - s.over;
  const topY = topAt(g, xs);
  if (s.lantern === 3) {
    cv.line(xs + 2, topY - 1, xs + 2, topY - 2, P.iron[1], M_HULL);
    cv.stamp(LANTERN_BIG, key, xs, topY - 9, M_HULL);
    return;
  }
  cv.dot(xs + 1, topY - 1, P.iron[1], M_HULL);
  cv.stamp(LANTERN_SMALL, key, xs, topY - 5, M_HULL);
  if (s.lantern === 2) {
    const x2 = g.sternX + (s.aft[0]?.len ?? 8) - 3;
    const t2 = topAt(g, x2);
    cv.dot(x2 + 1, t2 - 1, P.iron[1], M_HULL);
    cv.stamp(LANTERN_SMALL, key, x2, t2 - 5, M_HULL);
  }
}

// ───────────────────────── 帆 ─────────────────────────

interface SailDraw {
  tones: SailTones;
  /** 帆顶下的一行横桁阴影（横帆） */
  yardShadow: boolean;
  /** 受损：破洞与撕裂 */
  dmg: Rng | null;
  torn: string;
  /** 东方硬帆的一片：竹骨下一行压暗，帆腹偏左受光，篾编的竖纹代替布缝 */
  junk?: boolean;
  /** 编席帆：一道道横向的席缝与错开的编结代替布缝 */
  mat?: boolean;
}

/** 按蒙版着色一面帆：估计鼓起的曲面朝向，光在左上。 */
function shadeSail(cv: Canvas, mask: Mask, d: SailDraw): void {
  const { x0, y0, w, h } = mask;
  const whole = d.dmg ? mask.on.slice() : null;
  if (d.dmg) tearSail(mask, d.dmg);
  const at = (x: number, y: number) => maskHas(mask, x, y);
  const wasSail = (x: number, y: number) => {
    const lx = x - x0;
    const ly = y - y0;
    return !!whole && lx >= 0 && ly >= 0 && lx < w && ly < h && whole[ly * w + lx] === 1;
  };
  // 每个像素到左右、上下边缘的距离
  const dl = new Int16Array(w * h);
  const dr = new Int16Array(w * h);
  const dt = new Int16Array(w * h);
  const db = new Int16Array(w * h);
  for (let ly = 0; ly < h; ly++) {
    let run = 0;
    for (let lx = 0; lx < w; lx++) {
      run = mask.on[ly * w + lx] ? run + 1 : 0;
      dl[ly * w + lx] = run - 1;
    }
    run = 0;
    for (let lx = w - 1; lx >= 0; lx--) {
      run = mask.on[ly * w + lx] ? run + 1 : 0;
      dr[ly * w + lx] = run - 1;
    }
  }
  for (let lx = 0; lx < w; lx++) {
    let run = 0;
    for (let ly = 0; ly < h; ly++) {
      run = mask.on[ly * w + lx] ? run + 1 : 0;
      dt[ly * w + lx] = run - 1;
    }
    run = 0;
    for (let ly = h - 1; ly >= 0; ly--) {
      run = mask.on[ly * w + lx] ? run + 1 : 0;
      db[ly * w + lx] = run - 1;
    }
  }
  const seams = Math.max(2, Math.round(w / 5));
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const i = ly * w + lx;
      if (!mask.on[i]) continue;
      const x = x0 + lx;
      const y = y0 + ly;
      const nb = [
        [x - 1, y],
        [x + 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const;
      if (nb.some(([nx, ny]) => !at(nx, ny))) {
        // 帆边；撕开的破口用焦色
        const tornEdge = nb.some(([nx, ny]) => !at(nx, ny) && wasSail(nx, ny));
        cv.dot(x, y, tornEdge ? d.torn : d.tones.edge, M_SAIL);
        continue;
      }
      const span = dl[i] + dr[i] + 1;
      const u = (dl[i] + 0.5) / span;
      const v = (dt[i] + 0.5) / (dt[i] + db[i] + 1);
      if (d.junk) {
        // 每片帆在两根竹骨之间微微鼓起：上缘在竹骨的阴影里，中部偏后受光，前缘背光
        let tone = 2;
        if (dt[i] <= 0) tone = 1;
        else if (u < 0.2 + 0.35 * Math.sin(Math.PI * v) && db[i] >= 1) tone = 3;
        else if (u > 0.86) tone = 1;
        // 篾编的竖纹
        if (tone === 2 && x % 4 === 0 && db[i] >= 1) tone = 1;
        cv.dot(x, y, tone === 3 ? d.tones.hi : tone === 2 ? d.tones.mid : d.tones.lo, M_SAIL);
        continue;
      }
      // 左侧迎光，右侧背光；明暗交界在帆腹处外凸成月牙形，显出帆的鼓起
      const belly = Math.sin(Math.PI * Math.min(1, v * 1.15)) ** 0.8;
      let tone = 2;
      if (u < 0.12 + 0.3 * belly) tone = 3;
      else if (u > 0.9 - 0.24 * belly - 0.08 * v) tone = 1;
      if (db[i] <= 1) tone = 1;
      else if (db[i] === 2 && tone === 3) tone = 2;
      if (d.yardShadow && dt[i] <= 1) tone = 1;
      // 布缝：横帆按每行宽度等分（帆鼓起时缝线跟着弯），纵帆是平行于后缘的竖缝
      if (tone >= 2 && dt[i] >= 2 && db[i] >= 2 && dl[i] >= 1 && dr[i] >= 1) {
        const seam = d.mat
          ? y % 3 === 0 || (y % 3 === 1 && (x + Math.floor(y / 3) * 2) % 5 === 0)
          : d.yardShadow
            ? Math.floor(u * seams) !== Math.floor(((dl[i] + 1.5) / span) * seams)
            : (x - x0) % 5 === 3 && dl[i] >= 2;
        if (seam) tone -= 1;
      }
      cv.dot(x, y, tone === 3 ? d.tones.hi : tone === 2 ? d.tones.mid : d.tones.lo, M_SAIL);
    }
  }
}

/**
 * 受损：一个不规则的破洞、锯齿状的帆脚、偶尔一道自帆脚向上的 V 形裂口。
 * 每面帆固定取同样多的随机数，并按帆的比例定位，所以各帧的破口位置一致。
 */
function tearSail(mask: Mask, r: Rng): void {
  const roll = r.next();
  const fx = r.next();
  const fy = r.next();
  const rag = r.next();
  const notch = r.next();
  const nx = r.next();
  const area = maskArea(mask);
  if (area < 16) return;
  if (roll < 0.6) {
    const cx = Math.round(mask.x0 + mask.w * (0.3 + 0.4 * fx));
    const cy = Math.round(mask.y0 + mask.h * (0.3 + 0.35 * fy));
    if (maskHas(mask, cx, cy)) {
      const rad = area > 180 ? 2 : 1;
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad + 1; x++) {
          const q = ((x - cx - 0.5) / (rad + 0.6)) ** 2 + ((y - cy) / (rad + 0.4)) ** 2;
          if (q <= 1) maskSet(mask, x, y, 0);
        }
      }
      maskSet(mask, cx + rad + 1, cy - rad, 0);
      maskSet(mask, cx - rad, cy + rad + 1, 0);
    }
  }
  if (rag < 0.7) {
    const phase = Math.floor(rag * 20);
    for (let lx = 0; lx < mask.w; lx++) {
      let low = -1;
      for (let ly = mask.h - 1; ly >= 0; ly--) {
        if (mask.on[ly * mask.w + lx]) {
          low = ly;
          break;
        }
      }
      if (low < 0) continue;
      const k = (lx + phase) % 5;
      const cut = k < 2 ? 2 : k === 2 ? 1 : 0;
      for (let c = 0; c < cut; c++) if (low - c >= 0) mask.on[(low - c) * mask.w + lx] = 0;
    }
  }
  if (notch < 0.35 && area > 60) {
    const x = Math.round(mask.x0 + mask.w * (0.35 + 0.3 * nx));
    let low = -1;
    for (let y = mask.y0 + mask.h - 1; y >= mask.y0; y--) {
      if (maskHas(mask, x, y)) {
        low = y;
        break;
      }
    }
    const depth = Math.round(mask.h * 0.4);
    for (let dy = 0; dy <= depth && low >= 0; dy++) {
      const half = Math.round((depth - dy) * 0.3);
      for (let xx = x - half; xx <= x + half; xx++) maskSet(mask, xx, low - dy, 0);
    }
  }
}

/** 一面横帆的几何：自下而上第 k 层。 */
interface SquareSail {
  xc: number;
  yHead: number;
  yFoot: number;
  wHead: number;
  wFoot: number;
}

function squareLayout(g: Geo, m: MastSpec): { sails: SquareSail[]; top: number; platform: number } {
  const xm = mastX(g, m);
  const tiers = m.tiers ?? 2;
  const spread = m.spread ?? 20;
  const top = g.D0 - m.h;
  const yTop = top + 3 + (m.topmast ?? 0);
  let hullTop = g.D0;
  for (let x = xm - (spread >> 1) - 1; x <= xm + (spread >> 1) + 1; x++) hullTop = Math.min(hullTop, topAt(g, x));
  const clear = Math.max(4, Math.round(m.h * 0.12));
  const yFoot = Math.min(g.D0 - clear, hullTop - 4);
  const weights = [1.3, 1.0, 0.8, 0.62].slice(0, tiers);
  const sum = weights.reduce((a, b) => a + b, 0);
  const span = yFoot - yTop;
  const sails: SquareSail[] = [];
  let foot = yFoot;
  for (let k = 0; k < tiers; k++) {
    const hk = k === tiers - 1 ? foot - yTop : Math.round((span * weights[k]) / sum);
    const wFoot = Math.round(spread * (1 - 0.17 * k));
    const wHead = Math.round(wFoot * (k === 0 ? 0.86 : 0.78));
    // 后倾的桅：每层帆的中线跟着桅杆走
    const xc = mastAt(g, m, Math.round(foot - hk / 2)) + 0.5;
    sails.push({ xc, yHead: foot - hk, yFoot: foot, wHead: wHead | 1, wFoot: wFoot | 1 });
    foot -= hk;
  }
  return { sails, top, platform: sails[0].yHead - 2 };
}

function lateenLayout(g: Geo, m: MastSpec): { T: Pt; K: Pt; C: Pt; top: number } {
  const xm = mastX(g, m);
  const rake = m.rake ?? 0;
  const tackX = xm + (m.lead ?? 8);
  const T: Pt = [tackX, Math.min(g.sheer(tackX), topAt(g, tackX)) - 3];
  const K: Pt = [xm - (m.reach ?? 10) - Math.round(rake * m.h), g.D0 - m.h];
  // 横桁与桅杆相交处，桅顶略高出一点
  const tCross = (tackX - mastAt(g, m, g.D0 - m.h * 0.7)) / Math.max(1, tackX - K[0]);
  const cross = Math.round(T[1] + (K[1] - T[1]) * tCross);
  const clewX = K[0] + Math.max(2, Math.round((T[0] - K[0]) * 0.12));
  const C: Pt = [clewX, Math.min(T[1] - 1, topAt(g, clewX) - 3)];
  return { T, K, C, top: cross - 3 };
}

/** 东方硬帆的帆后缘最多外凸几像素。 */
const JUNK_FAN = 4;

/** 东方硬帆伸到桅后多远（含后缘外凸）。 */
function junkAft(m: MastSpec): number {
  const spread = m.spread ?? 24;
  return spread - (m.lead ?? Math.round(spread * 0.2)) + JUNK_FAN;
}

/**
 * 东方硬帆：一根根竹骨（battens）把帆分成若干片。前缘（luff）在桅前 lead 处，几乎竖直；
 * 帆顶的斜桁向后上方挑起，竹骨越往下越平，后缘呈外凸的扇形。
 * 返回自上而下每根竹骨的前端 L 与后端 A（含最上的斜桁与最下的帆脚竹）。
 */
function junkLayout(g: Geo, m: MastSpec): { L: Pt[]; A: Pt[]; top: number } {
  const xm = mastX(g, m);
  const spread = m.spread ?? 24;
  const lead = m.lead ?? Math.round(spread * 0.2);
  const n = m.tiers ?? 6;
  const top = g.D0 - m.h;
  const yPeak = top + 3;
  let hullTop = g.D0;
  for (let x = xm - spread + lead - JUNK_FAN - 1; x <= xm + lead + 1; x++) hullTop = Math.min(hullTop, topAt(g, x));
  const yFoot = Math.min(g.D0 - Math.max(4, Math.round(m.h * 0.08)), hullTop - 3);
  // 斜桁前端比后端低 drop
  const drop = Math.round(spread * 0.42);
  const yLuffTop = yPeak + drop;
  const L: Pt[] = [];
  const A: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const yl = Math.round(yLuffTop + (yFoot - yLuffTop) * t);
    // 竹骨向后微微上挑，越往下越平
    const ya = Math.round(yl - drop * (1 - t) ** 1.3);
    const fan = Math.round(JUNK_FAN * Math.sin(Math.PI * (0.2 + 0.7 * t)));
    L.push([mastAt(g, m, yl) + lead, yl]);
    // 帆脚比斜桁短：后缘自上而下向前收
    A.push([mastAt(g, m, ya) - Math.round((spread - lead) * (1 - 0.2 * t)) - fan, ya]);
  }
  return { L, A, top };
}

// ───────────────────────── 旗 ─────────────────────────

/** 鱼骨旗纹样（原创的海盗旗）：w 骨白，r 红眼。 */
const FISHBONE_FLAG = ["w.w.w.ww", ".wwwwwrw", "w.w.w.ww"];
const FISHBONE_SAIL = ["w...w.w.ww.", ".w..w.w.www", "..wwwwwwwrw", ".w..w.w.www", "w...w.w.ww."];

/** 旗面第 i 列的上下起伏：靠旗杆处不动，越往外摆得越大。 */
function waveAt(i: number, n: number, frame: number): number {
  const amp = Math.min(1, (i + 1) / (n * 0.5));
  return Math.round(Math.sin((i / n) * Math.PI * 2.2 - (frame * Math.PI) / 2) * 1.1 * amp);
}

function drawFlag(cv: Canvas, x: number, y: number, fw: number, fh: number, frame: number, look: Look, color: string): void {
  const dark = look.pirate ? P.cloth.black[0] : mix(color, ink.deep, 0.35);
  const light = look.pirate ? P.cloth.black[2] : mix(color, P.white, 0.28);
  const field = look.pirate ? P.cloth.black[1] : color;
  const ox = Math.floor((fw - FISHBONE_FLAG[0].length) / 2);
  const oy = Math.floor((fh - FISHBONE_FLAG.length) / 2);
  for (let i = 0; i < fw; i++) {
    const o = waveAt(i, fw, frame);
    const slope = waveAt(i + 1, fw, frame) - waveAt(i - 1, fw, frame);
    for (let j = 0; j < fh; j++) {
      // 旗尾两角收圆
      if (i === fw - 1 && (j === 0 || j === fh - 1)) continue;
      let c = slope > 0 ? dark : slope < 0 && j < fh - 1 ? light : field;
      if (j === fh - 1 && c === field) c = dark;
      cv.dot(x + i, y + j + o, c, M_FLAG);
    }
    if (look.pirate) {
      for (let j = 0; j < FISHBONE_FLAG.length; j++) {
        const ch = FISHBONE_FLAG[j][i - ox];
        if (ch === "w") cv.dot(x + i, y + oy + j + o, P.plaster[3], M_FLAG);
        if (ch === "r") cv.dot(x + i, y + oy + j + o, P.red[3], M_FLAG);
      }
    }
  }
}

/** 三角长旗（不描边，细细一条）；fork 为燕尾。 */
function drawPennant(cv: Canvas, x: number, y: number, n: number, frame: number, color: string, dark: string, fork = false): void {
  // 长旗在前面桅的帆后面飘时被帆（连同帆上的竹骨）挡住
  const put = (px: number, py: number, c: string) => {
    const m = cv.m(px, py);
    if (m === M_SAIL || (m === M_SPAR && (cv.m(px, py - 1) === M_SAIL || cv.m(px, py + 1) === M_SAIL))) return;
    cv.dot(px, py, c, M_PEN);
  };
  for (let i = 0; i < n; i++) {
    const o = waveAt(i, n, frame + 1);
    if (fork && i >= n - 2) {
      put(x + i, y + o - (i - n + 3), color);
      put(x + i, y + o + 1 + (i - n + 3), dark);
      continue;
    }
    put(x + i, y + o, color);
    if (i < n * 0.5) put(x + i, y + o + 1, dark);
  }
}

// ───────────────────────── 受损效果 ─────────────────────────

function paintBurns(cv: Canvas, g: Geo, s: Spec, frame: number): void {
  const r = rng(`ship-burn-${s.len}-${s.freeboard}`);
  const n = 2 + (s.len > 70 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const cx = g.sternX + Math.round(g.len * (0.2 + (0.6 * (k + r.next() * 0.6)) / n));
    const cy = g.sheer(cx) + r.int(2, Math.max(3, s.freeboard - 3));
    const rx = r.int(2, 4);
    const ry = r.int(1, 2);
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        if (cv.m(x, y) !== M_HULL || y >= g.WL) continue;
        const q = ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2;
        if (q <= 0.45) cv.dot(x, y, ink.brown, M_HULL);
        else if (q <= 1) cv.dot(x, y, P.wood[0], M_HULL);
      }
    }
    if (k === 0) {
      cv.dot(cx, cy, frame % 2 === 0 ? P.red[3] : P.lamp[1], M_HULL);
      cv.dot(cx + 1, cy, P.red[2], M_HULL);
    }
  }
  // 船舷破口：黑洞与翻起的木茬
  const bx = g.sternX + Math.round(g.len * 0.62);
  const by = g.sheer(bx) + Math.max(2, Math.round(s.freeboard * 0.45));
  cv.rect(bx, by, 3, 2, ink.deep, M_HULL);
  cv.dot(bx + 3, by, ink.deep, M_HULL);
  cv.dot(bx - 1, by, P.wood[4], M_HULL);
  cv.dot(bx + 3, by + 1, P.wood[4], M_HULL);
  cv.dot(bx + 1, by - 1, P.wood[4], M_HULL);
}

/** 一团烟：光在左上，右下是暗边。fade 时外圈抖动变淡；dark 为刚冒出来的浓烟。 */
function puff(cv: Canvas, cx: number, cy: number, r: number, fade: boolean, dark: boolean): void {
  const tones = dark ? [P.stone[0], P.stone[1], P.stone[2]] : [P.stone[1], P.stone[2], P.stone[3]];
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const nx = (x + 0.5 - cx) / (r + 0.35);
      const ny = (y + 0.5 - cy) / (r + 0.35);
      const q = nx * nx + ny * ny;
      if (q > 1) continue;
      if (fade && q > 0.4 && (x + y) % 2 === 0) continue;
      const side = nx + ny;
      const c = side < -0.35 && q > 0.12 ? tones[2] : side > 0.45 && q > 0.45 ? tones[0] : tones[1];
      cv.dot(x, y, c, M_FX);
    }
  }
}

/** 一柱烟：几团烟自下而上变大、左右摆着向右上飘；按帧上升，第 4 帧接回第 0 帧。 */
function paintSmoke(cv: Canvas, bx: number, by: number, frame: number, big: boolean): void {
  const n = big ? 4 : 3;
  const step = big ? 8 : 6;
  const phase = frame / SHIP_FRAMES;
  for (let i = n - 1; i >= 0; i--) {
    const t = i + phase;
    const r = (big ? 2.2 : 1.6) + t * (big ? 0.95 : 0.65);
    const cx = bx + t * 3 + Math.sin(t * 2.4) * 1.4;
    const cy = by - 4 - t * step;
    const fade = t > n - 1;
    // 主团与旁边的一小团，让轮廓像云而不是圆球
    puff(cv, cx + r * 0.7, cy + r * 0.35, r * 0.6, fade, t < 1);
    puff(cv, cx, cy, r, fade, t < 1);
  }
  const flame = [
    [".y.", "yry", "rRr"],
    ["y..", "yry", "rRr"],
    [".y.", "ryy", "rRr"],
    ["..y", "yry", "rRr"],
  ][frame];
  cv.stamp(flame, { y: P.lamp[2], r: P.lamp[1], R: P.red[3] }, bx - 1, by - 2, M_FX);
}

// ───────────────────────── 大图 ─────────────────────────

/** 斜桁帆（纵帆）：斜桁自桅上的 throat 向后上方挑到 peak，帆杠自桅脚伸向船尾。 */
function gaffSail(cv: Canvas, g: Geo, xm: number, top: number, spread: number, billow: number, draw: SailDraw, wood: Ramp5): Mask {
  const deck = Math.min(topAt(g, xm - spread), topAt(g, xm)) - 3;
  const peak: Pt = [xm - spread + 1, top + 1];
  const throat: Pt = [xm - 0.5, top + 2 + Math.round(spread * 0.5)];
  const tack: Pt = [xm - 0.5, deck];
  const clew: Pt = [xm - spread - 1, deck - 1];
  const mask = maskOf([peak, throat, tack, ...bulge(tack, clew, 1 + (billow >> 1)), ...bulge(clew, peak, 1 + billow)]);
  shadeSail(cv, mask, draw);
  cv.line(throat[0], throat[1], peak[0] - 1, peak[1] - 1, wood[1], M_SPAR);
  cv.line(tack[0], tack[1] + 1, clew[0] - 2, clew[1] + 1, wood[1], M_SPAR);
  return mask;
}

/** 桨：自桨门斜插入水，按帧前后划动；桨杆用亮木色，压在船壳上看得清。 */
function paintOars(cv: Canvas, g: Geo, s: Spec, look: Look, frame: number): void {
  const o = s.oars;
  if (!o) return;
  const sweep = [4, 2, 0, 2][frame];
  const x0 = g.sternX + o.from;
  const x1 = g.bowX - o.to;
  for (let i = 0; i < o.n; i++) {
    const px = Math.round(o.n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (o.n - 1));
    const py = g.sheer(px) + o.d;
    const bx = px - sweep - 1 - (o.rake ?? 0);
    const by = g.WL + 1;
    cv.line(px, py + 1, bx, by - 1, look.wood[4], M_SPAR);
    cv.dot(bx, by, look.wood[3], M_SPAR);
    cv.dot(bx - 1, by, look.wood[2], M_SPAR);
    cv.dot(px, py, ink.deep, M_HULL);
  }
}

function drawLarge(idx: number, opts: ShipArtOpts): Px {
  const s = ALL_SPECS[idx];
  const frame = frameOf(opts.frame);
  const billow = [0, 1, 2, 1][frame];
  const lateenShip = s.pirateSail ? s.pirateSail === "red" : s.masts.every((m) => m.rig !== "square");
  const look = lookOf(opts, lateenShip, s.sailTone, s.bottom);
  const g = buildGeo(s);
  const cv = new Canvas(g.W, g.H);
  const wood = look.wood;
  const damaged = !!opts.damaged;
  // 受损花纹的种子按画法下标取；经典表之后的画法沿用撤下两种独有船型以前的下标（+2），画面不变
  const dmg = damaged ? rng(`ship-dmg-${idx < SPECS.length ? idx : idx + 2}`) : null;

  // 先在临时画布上画一遍船体，得到每列最高点（帆的下缘要让开艏艉楼与货物）
  paintHull(new Canvas(g.W, g.H), g, s, look);

  const order = s.masts.map((m, i) => ({ m, i })).sort((a, b) => a.m.at - b.m.at);
  const tallest = s.masts.reduce((b, m, i) => (m.h > s.masts[b].h ? i : b), 0);
  // 受损时折断最靠船尾的一根桅。寰宇·十六世纪的新船型里，它若是挂旗的最高桅（加莱船、鸟船这样主桅靠后的船），
  // 改折下一根，免得旗悬在半空（经典船型照旧，画面不变）
  const keepFlagMast = idx >= SPECS.length && s.masts.length > 1 && order[0].i === tallest;
  const snapped = damaged && s.masts.length > 1 ? (keepFlagMast ? order[1].i : order[0].i) : -1;
  const layouts = s.masts.map((m) => (m.rig === "square" ? squareLayout(g, m) : null));
  const lateens = s.masts.map((m) => (m.rig === "lateen" ? lateenLayout(g, m) : null));
  const junks = s.masts.map((m) => (m.rig === "junk" ? junkLayout(g, m) : null));
  const rects = s.masts.map((m) => (m.rig === "rect" ? rectLayout(g, m) : null));
  const tanjas = s.masts.map((m) => (m.rig === "tanja" ? tanjaLayout(g, m) : null));
  const crabs = s.masts.map((m) => (m.rig === "crab" ? crabLayout(g, m) : null));
  const mastTop = s.masts.map((m, i) => layouts[i]?.top ?? lateens[i]?.top ?? crabs[i]?.top ?? g.D0 - m.h);
  const snapY = s.masts.map((m, i) => (i === snapped ? Math.round(g.D0 - m.h * 0.55) : -1));

  // 1. 桅杆：下段 2 像素（左亮右暗、每隔几像素一道铁箍），上段 1 像素
  s.masts.forEach((m, i) => {
    const xm = mastX(g, m);
    const top = snapY[i] >= 0 ? snapY[i] : mastTop[i];
    const cb = crabs[i];
    if (m.rig === "pole" || cb) {
      // 旗杆（1 像素）；蟹爪帆的桅斜撑在上桁的中段
      const tx = cb ? Math.round(cb.P[0]) : mastAt(g, m, top);
      cv.line(tx, top, xm, g.sheer(xm) + 1, cb ? wood[3] : wood[2], M_SPAR);
      if (cb) cv.line(tx + 1, top + 1, xm + 1, g.sheer(xm) + 1, wood[1], M_SPAR);
      if (snapY[i] < 0 && !cb) cv.dot(tx, top - 1, P.gold[2], M_SPAR);
      return;
    }
    // 两脚桅、三脚桅：另一条桅脚自桅顶下方斜撑到甲板
    if (m.legs) cv.line(mastAt(g, m, top + 2), top + 2, xm + m.legs, g.sheer(xm + m.legs) + 1, wood[1], M_SPAR);
    const lowerTop = layouts[i]?.platform ?? Math.round(g.D0 - m.h * 0.45);
    for (let y = top; y <= g.sheer(xm) + 1; y++) {
      const x = mastAt(g, m, y);
      if (y > lowerTop) {
        const hoop = (g.D0 - y) % 9 === 4;
        cv.dot(x, y, hoop ? P.iron[2] : wood[3], M_SPAR);
        cv.dot(x + 1, y, hoop ? P.iron[1] : wood[1], M_SPAR);
      } else cv.dot(x, y, wood[2], M_SPAR);
    }
    if (snapY[i] >= 0) {
      // 折断的桅头：参差的木茬
      const x = mastAt(g, m, top);
      cv.dot(x, top - 1, wood[4], M_SPAR);
      cv.dot(x + 1, top, wood[4], M_SPAR);
    } else {
      cv.dot(mastAt(g, m, top), top - 1, P.gold[2], M_SPAR);
    }
    // 桅楼平台
    const sq = layouts[i];
    if (sq && snapY[i] < 0) {
      const py = sq.platform;
      const px = mastAt(g, m, py);
      cv.rect(px - 2, py, 6, 1, wood[1], M_SPAR);
      cv.rect(px - 1, py - 1, 4, 1, wood[2], M_SPAR);
      if (i === tallest && sq.sails.length > 2) {
        const cy = sq.sails[1].yHead - 2;
        cv.rect(mastAt(g, m, cy) - 1, cy, 4, 1, wood[1], M_SPAR);
      }
    }
    // 瞭望斗：桅顶下挂一只木桶，桶沿亮、桶身两道箍
    if (m.nest && snapY[i] < 0) {
      const ny = top + 7;
      const nx = mastAt(g, m, ny);
      cv.rect(nx - 2, ny, 6, 1, wood[4], M_SPAR);
      cv.rect(nx - 2, ny + 1, 6, 2, wood[2], M_SPAR);
      cv.rect(nx - 2, ny + 1, 1, 2, wood[3], M_SPAR);
      cv.rect(nx - 1, ny + 3, 4, 1, wood[1], M_SPAR);
      cv.dot(nx + 3, ny + 1, P.iron[1], M_SPAR);
    }
  });

  // 2. 船体与桨（寰宇·十六世纪的船另有舷外支架、桨手、披水板、舷侧舵与幟）
  paintHull(cv, g, s, look);
  paintOars(cv, g, s, look, frame);
  paintFront(cv, g, s, look, frame);
  if (s.banners) paintBanners(cv, g, s.banners, look, frame);

  const sailDraw = (yardShadow: boolean, junk = false): SailDraw => ({ tones: look.sail, yardShadow, dmg, torn: look.torn, junk });
  const mat = s.sailTone === "mat";

  // 3. 艏三角帆（画在横帆后面）与艏斜桅（没有艏斜桅的船，前支索系在艏柱顶）
  const tipY = g.sheer(g.bowX);
  const root: Pt = [g.bowX - 6, tipY - 1];
  const hasSprit = s.sprit[0] >= 6;
  const tip: Pt = hasSprit ? [g.bowX + s.sprit[0], tipY - 1 - s.sprit[1]] : [g.bowX, tipY - 2];
  const foremast = order[order.length - 1];
  const fTop = mastTop[foremast.i];
  for (let j = s.jibs - 1; j >= 0; j--) {
    const Tj = lerp(root, tip, 0.97 - j * 0.26);
    const headY = fTop + Math.round(foremast.m.h * (0.12 + 0.17 * j));
    const H: Pt = [mastAt(g, foremast.m, headY) + 2, headY];
    const clewX = Math.round(H[0] + (Tj[0] - H[0]) * (0.28 + 0.06 * j));
    const C: Pt = [clewX, Math.min(topAt(g, clewX), g.sheer(clewX)) - 4 - j * 2];
    const pts: Pt[] = [H, Tj, ...bulge(Tj, C, 1 + (billow >> 1)), ...bulge(C, H, 1 + billow)];
    shadeSail(cv, maskOf(pts), sailDraw(false));
  }
  if (hasSprit) {
    const mid = lerp(root, tip, 0.62);
    cv.line(root[0], root[1], mid[0], mid[1], wood[3], M_SPAR);
    cv.line(root[0], root[1] + 1, mid[0], mid[1] + 1, wood[1], M_SPAR);
    cv.line(mid[0], mid[1], tip[0], tip[1], wood[2], M_SPAR);
  }

  // 4. 各桅的帆：自后向前
  let biggest: Mask | null = null;
  let biggestArea = 0;
  const keep = (mask: Mask) => {
    const a = maskArea(mask);
    if (a > biggestArea) {
      biggestArea = a;
      biggest = mask;
    }
  };
  for (const { m, i } of order) {
    const sq = layouts[i];
    const lt = lateens[i];
    const jk = junks[i];
    if (sq) {
      // 后桅纵帆挂在横帆后面，只露出桅后的一截
      if (m.spanker && snapY[i] < 0) gaffSail(cv, g, mastX(g, m), sq.platform + 3, m.spanker, billow, sailDraw(false), wood);
      const sails = snapY[i] >= 0 ? sq.sails.filter((sl) => sl.yHead > snapY[i] + 1) : sq.sails;
      // 先画上层，下层的横桁压住上层帆脚
      for (let k = sails.length - 1; k >= 0; k--) {
        const sl = sails[k];
        const tall = sl.yFoot - sl.yHead;
        const sag = k === 0 ? 1 + billow : 1 + (billow >> 1);
        const side = tall > 8 ? 1 + (billow >> 1) : billow > 0 ? 1 : 0;
        const hl: Pt = [sl.xc - sl.wHead / 2, sl.yHead];
        const hr: Pt = [sl.xc + sl.wHead / 2, sl.yHead];
        const fr: Pt = [sl.xc + sl.wFoot / 2, sl.yFoot];
        const fl: Pt = [sl.xc - sl.wFoot / 2, sl.yFoot];
        const mask = maskOf([hl, hr, ...bulge(hr, fr, side), ...bulge(fr, fl, sag), ...bulge(fl, hl, side)]);
        shadeSail(cv, mask, sailDraw(true));
        if (k === 0) keep(mask);
      }
      sails.forEach((sl) => {
        const y = sl.yHead;
        const half = Math.ceil(sl.wHead / 2) + 1;
        const x = mastAt(g, m, y);
        cv.line(x - half + 1, y, x + half, y, wood[1], M_SPAR);
      });
    } else if (lt) {
      const { T, K, C } = lt;
      const mask = maskOf([K, T, ...bulge(T, C, 1 + billow), ...bulge(C, K, 1 + (billow >> 1))]);
      const broken = snapY[i] >= 0;
      const cutY = Math.round(K[1] + (T[1] - K[1]) * 0.45);
      if (broken) {
        // 折桅：帆的上半截撕掉，断口参差
        for (let y = mask.y0; y <= cutY + 1; y++) {
          for (let x = mask.x0; x < mask.x0 + mask.w; x++) if (y < cutY + (x % 3 === 0 ? 1 : 0) + (x % 5 === 1 ? 1 : 0)) maskSet(mask, x, y, 0);
        }
      }
      shadeSail(cv, mask, sailDraw(false));
      keep(mask);
      // 横桁：略长出帆角；折断时只剩下半截
      const k2 = broken ? lerp(T, K, (T[1] - cutY) / Math.max(1, T[1] - K[1])) : lerp(T, K, 1.06);
      const t2 = lerp(K, T, 1.08);
      cv.line(k2[0], k2[1], t2[0], t2[1], wood[1], M_SPAR);
    } else if (jk) {
      // 东方硬帆：一片片画，每片的后缘在两根竹骨之间向外鼓出；折桅时只剩断口以下的几片
      const { L, A } = jk;
      const alive = (k: number) => snapY[i] < 0 || Math.min(L[k][1], A[k][1]) > snapY[i] + 1;
      for (let k = 0; k + 1 < L.length; k++) {
        if (!alive(k)) continue;
        const puff = 1 + (((k + frame) % 2) & (billow > 0 ? 1 : 0));
        const mask = maskOf([A[k], L[k], L[k + 1], A[k + 1], ...bulge(A[k + 1], A[k], puff, 4)]);
        shadeSail(cv, mask, sailDraw(false, true));
        keep(mask);
      }
      // 竹骨：伸出后缘一点；最上的斜桁与最下的帆脚竹更粗
      for (let k = 0; k < L.length; k++) {
        if (!alive(k)) continue;
        const [lx, ly] = L[k];
        const [ax, ay] = A[k];
        cv.line(lx + 1, ly, ax - 1, ay, wood[1], M_SPAR);
        if (k === 0 || k === L.length - 1) cv.line(lx + 1, ly - 1, ax - 1, ay - 1, wood[2], M_SPAR);
      }
    } else if (rects[i]) {
      // 矩形帆：挂在横桁上，帆脚与两侧随风鼓起；编席帆有一道道横的席缝
      const { hl, hr, fr, fl } = rects[i] as ReturnType<typeof rectLayout>;
      const side = billow > 0 ? 1 : 0;
      const sag = m.boom ? 1 : 1 + billow;
      const mask = maskOf([hl, hr, ...bulge(hr, fr, side), ...bulge(fr, fl, sag), ...bulge(fl, hl, side)]);
      if (snapY[i] >= 0) cutAbove(mask, Math.round(hl[1] + (fl[1] - hl[1]) * 0.45));
      shadeSail(cv, mask, { ...sailDraw(true), mat });
      keep(mask);
      if (snapY[i] < 0) cv.line(hl[0] - 1, hl[1], hr[0] + 1, hr[1], wood[1], M_SPAR);
      if (m.boom) cv.line(fl[0] - 1, fl[1] + 1, fr[0] + 1, fr[1] + 1, wood[1], M_SPAR);
    } else if (tanjas[i]) {
      // 倾斜的矩形硬帆：上下两根平行的桁夹着帆，前缘与后缘微微鼓出
      const { T, C, K, H } = tanjas[i] as ReturnType<typeof tanjaLayout>;
      const mask = maskOf([K, H, ...bulge(H, T, billow > 0 ? 1 : 0), ...bulge(T, C, 1), ...bulge(C, K, 1 + (billow >> 1))]);
      const broken = snapY[i] >= 0;
      if (broken) cutAbove(mask, Math.round((H[1] + T[1]) / 2));
      shadeSail(cv, mask, { ...sailDraw(false), mat });
      keep(mask);
      if (!broken) {
        const k2 = lerp(H, K, 1.08);
        cv.line(k2[0], k2[1], H[0] + 1, H[1], wood[1], M_SPAR);
      }
      const c2 = lerp(T, C, 1.06);
      cv.line(T[0] + 1, T[1] + 1, c2[0], c2[1] + 1, wood[1], M_SPAR);
    } else if (crabs[i]) {
      // 蟹爪帆：两根桁之间的帆面，上缘内凹；桁梢伸出帆角，像蟹的两只钳
      const { A, U, L } = crabs[i] as ReturnType<typeof crabLayout>;
      // 上缘凹进去约两桁梢距离的三成，两只“钳”才分得开
      const depth = Math.round(Math.hypot(U[0] - L[0], U[1] - L[1]) * 0.3) + billow;
      const mask = maskOf([U, A, L, ...bulge(L, U, -depth, 12)]);
      if (snapY[i] >= 0) cutAbove(mask, Math.round((U[1] + A[1]) / 2));
      shadeSail(cv, mask, { ...sailDraw(false), mat });
      keep(mask);
      const u2 = lerp(A, U, 1.12);
      const l2 = lerp(A, L, 1.1);
      cv.line(A[0], A[1], u2[0], u2[1], wood[1], M_SPAR);
      cv.line(A[0], A[1] + 1, l2[0], l2[1] + 1, wood[1], M_SPAR);
    } else if (m.rig === "pole") {
      // 旗杆：不挂帆
    } else {
      // 斜桁帆：斜桁向后上方挑起，帆杠伸出船尾
      if (snapY[i] < 0) keep(gaffSail(cv, g, mastX(g, m), g.D0 - m.h, m.spread ?? 12, billow, sailDraw(false), wood));
      else {
        // 折桅：斜桁落下，只剩半截帆
        const spread = m.spread ?? 12;
        keep(gaffSail(cv, g, mastX(g, m), snapY[i] + 1, Math.round(spread * 0.7), billow, sailDraw(false), wood));
      }
    }
  }

  // 艉灯挂在艉楼顶，画在后桅帆的前面
  paintLanterns(cv, g, s);

  // 5. 海盗纹样：画在最大的一面帆上
  const big = biggest as Mask | null;
  if (look.pirate && big) {
    // 放在帆面的重心（三角帆的重心在宽的下半部，纹样不会被帆边截掉）
    const rows = FISHBONE_SAIL;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let ly = 0; ly < big.h; ly++) {
      for (let lx = 0; lx < big.w; lx++) {
        if (big.on[ly * big.w + lx]) {
          sx += lx;
          sy += ly;
          n++;
        }
      }
    }
    const cx = big.x0 + Math.round(sx / Math.max(1, n) - rows[0].length / 2);
    const cy = big.y0 + Math.round(sy / Math.max(1, n) - rows.length / 2);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        const x = cx + c;
        const y = cy + r;
        if (ch === "." || cv.m(x, y) !== M_SAIL) continue;
        cv.dot(x, y, ch === "r" ? P.red[3] : P.plaster[3], M_SAIL);
      }
    }
  }

  // 6. 旗：最高的桅（三角帆船挂在最高横桁的顶角）挂势力旗，其余桅挂长旗
  const flagColor = look.pirate ? P.cloth.black[1] : look.flag;
  if (flagColor) {
    const [fw, fh] = s.flag;
    const lt = lateens[tallest];
    // 蟹爪帆的旗挂在上桁梢
    const cb = crabs[tallest];
    const fx = lt ? Math.round(lt.K[0]) + 1 : cb ? Math.round(cb.U[0]) + 1 : mastAt(g, s.masts[tallest], mastTop[tallest]) + 1;
    const fy = lt ? Math.round(lt.K[1]) : cb ? Math.round(cb.U[1]) : mastTop[tallest];
    cv.dot(fx - 1, fy - 1, P.gold[2], M_SPAR);
    drawFlag(cv, fx, fy, fw, fh, frame, look, flagColor);
    const pc = look.pirate ? P.cloth.black[2] : flagColor;
    const pd = look.pirate ? P.cloth.black[1] : mix(flagColor, ink.deep, 0.35);
    s.masts.forEach((mm, i) => {
      if (i === tallest || i === snapped) return;
      const lti = lateens[i];
      if (lti) drawPennant(cv, Math.round(lti.K[0]) + 1, Math.round(lti.K[1]), idx === 0 ? 9 : 8, frame, pc, pd, idx === 0);
      else drawPennant(cv, mastAt(g, mm, mastTop[i]) + 1, mastTop[i], 7, frame, pc, pd);
    });
  }

  // 7. 受损：船体焦痕与破口
  if (damaged) paintBurns(cv, g, s, frame);

  // 8. 描边：船体用暖色墨线，旗用深紫墨线
  cv.outline((m) => (m === M_HULL ? ink.brown : m === M_FLAG ? ink.deep : null));

  // 9. 缆绳：只画在空白处
  const rope = wood[1];
  if (!s.unstayed) {
    for (const { m, i } of order) {
      if (i === snapped) continue;
      const xm = mastX(g, m);
      const sq = layouts[i];
      const top = mastTop[i];
      const hold = sq ? sq.platform : Math.round(g.D0 - m.h * 0.5);
      const hx = mastAt(g, m, hold);
      // 护桅索与绳梯
      const feet = [xm - 2, xm - 5, xm - 8].map((x) => [x, topAt(g, x) - 1] as const);
      for (const [x, y] of feet) cv.line(hx, hold, x, y, rope, M_ROPE, true);
      const [ax, ay] = feet[0];
      const [bx, by] = feet[2];
      for (let y = hold + 3; y < Math.min(ay, by) - 1; y += 3) {
        const t0 = (y - hold) / (ay - hold);
        const t1 = (y - hold) / (by - hold);
        cv.line(hx + (ax - hx) * t0, y, hx + (bx - hx) * t1, y, rope, M_ROPE, true);
      }
      // 后支索
      const bxs = xm - 14;
      cv.line(mastAt(g, m, top + 1), top + 1, bxs, topAt(g, bxs) - 1, rope, M_ROPE, true);
    }
    // 前支索：各桅顶连向前一根桅的脚，前桅连到艏斜桅梢
    for (let k = 0; k < order.length; k++) {
      const { m, i } = order[k];
      if (i === snapped) continue;
      const top = mastTop[i] + 1;
      const x = mastAt(g, m, top);
      if (k === order.length - 1) cv.line(x, top, tip[0], tip[1], rope, M_ROPE, true);
      else {
        const nx = mastX(g, order[k + 1].m);
        cv.line(x, top, nx, g.sheer(nx) - 6, rope, M_ROPE, true);
      }
    }
    // 艏斜桅下的拉索
    if (hasSprit) cv.line(tip[0], tip[1], g.bowX, g.WL - 3, rope, M_ROPE, true);
  }
  // 纵帆的帆脚索
  for (const lt of lateens) if (lt) cv.line(lt.C[0], lt.C[1], lt.C[0] + 2, topAt(g, lt.C[0] + 2) - 1, rope, M_ROPE, true);
  // 东方硬帆的帆脚索：自每根竹骨的后端收成一束，扇形地拉到桅后的甲板上
  junks.forEach((jk, i) => {
    if (!jk || i === snapped) return;
    const bx = jk.A[jk.A.length - 1][0] - 2;
    const by = jk.A[jk.A.length - 1][1] + 3;
    const deckX = bx + 3;
    jk.A.forEach(([ax, ay], k) => {
      if (k === 0 || k % 2 === 1) cv.line(ax - 1, ay + 1, bx, by, rope, M_ROPE, true);
    });
    cv.line(bx, by, deckX, topAt(g, deckX) - 1, rope, M_ROPE, true);
  });
  // 倾斜硬帆与蟹爪帆的帆脚索：自帆脚桁梢拉到后面的甲板
  tanjas.forEach((tj, i) => {
    if (tj && i !== snapped) cv.line(tj.C[0], tj.C[1] + 1, tj.C[0] - 2, topAt(g, tj.C[0] - 2) - 1, rope, M_ROPE, true);
  });
  for (const cb of crabs) if (cb) cv.line(cb.L[0], cb.L[1] + 1, cb.L[0] + 3, topAt(g, cb.L[0] + 3) - 1, rope, M_ROPE, true);

  // 10. 烟与火
  if (damaged) {
    const sx = mastX(g, s.masts[tallest]) + 5;
    const smoke = (bx: number, by: number, f: number, big: boolean) => paintSmoke(cv, bx, by, f, big);
    smoke(sx, topAt(g, sx), frame, true);
    if (s.masts.length > 2) {
      const sx2 = g.sternX + Math.round(g.len * 0.3);
      smoke(sx2, topAt(g, sx2), (frame + 2) % SHIP_FRAMES, false);
    }
  }

  return cv.px;
}

// ───────────────────────── 小图（地图） ─────────────────────────

/** 小图的帆：sq 横帆（矩形）；tri 三角帆（左边竖直的直角三角形，斜边自左上到右下）；gaff 斜桁帆（斜边只到 cut 行）。 */
export interface SmallSail {
  /**
   * jk：东方硬帆（顶边左高右低，一道道竹骨把帆分成横条）；寰宇·十六世纪新增：
   * tj 倾斜的矩形硬帆（每列比左边一列低，最右一列共低 cut 行）、mat 编席的矩形帆（一行行席缝）
   */
  k: "sq" | "tri" | "gaff" | "jk" | "tj" | "mat";
  x: number;
  y: number;
  w: number;
  h: number;
  cut?: number;
}

interface SmallSpec {
  /** 描边前的宽度 */
  w: number;
  /** 舷缘所在行 */
  deck: number;
  len: number;
  /** 水线以上船体行数（不含舷缘） */
  fb: number;
  aft: readonly [number, number];
  fore: readonly [number, number];
  /** 艏柱每行后退的像素 */
  rake: number;
  band?: string;
  /** 色带下一行（或色带上）开炮门 */
  ports?: boolean;
  topsides?: string;
  /** 艏斜桅；没有时不画 */
  sprit?: readonly [number, number, number, number];
  sails: readonly SmallSail[];
  /** 旗杆的列与顶行 */
  flag: readonly [number, number];
  /** 受损时冒烟的位置 */
  smoke: readonly [number, number];
  /** 主帆（海盗纹样与破洞画在这里）的序号 */
  main: number;
  /** 涂漆船壳：船身与最下一行的颜色 */
  hull?: readonly [string, string];
  /** 按行（距舷缘）涂的色带 */
  stripes?: readonly (readonly [number, string])[];
  /** 这些行开炮门 */
  portRows?: readonly number[];
  /** 这一行点亮一排舷窗（住人的船舱） */
  lights?: number;
  /** 一排桨 */
  oars?: boolean;
  /** 艏斜桅画成镀金撞角 */
  ram?: boolean;
  /** 船艏的龙目 */
  eye?: boolean;
  /** 艏艉楼顶的城垛 */
  crenel?: boolean;
  /** 桅顶瞭望斗的位置 */
  nest?: readonly [number, number];
  /** 船底颜色 */
  bottom?: string;
  sailTone?: "junk";
  /** 艏艉楼壁板的漆色 */
  castle?: string;
}

function sq(x: number, y: number, w: number, h: number): SmallSail {
  return { k: "sq", x, y, w, h };
}
function tri(x: number, y: number, w: number, h: number): SmallSail {
  return { k: "tri", x, y, w, h };
}
function gaff(x: number, y: number, w: number, h: number, cut = 2): SmallSail {
  return { k: "gaff", x, y, w, h, cut };
}
function jk(x: number, y: number, w: number, h: number, cut = 2): SmallSail {
  return { k: "jk", x, y, w, h, cut };
}

const SMALL: readonly SmallSpec[] = [
  // 0 卡拉维尔：一面大三角帆 + 艏三角帆
  {
    w: 12,
    deck: 11,
    len: 10,
    fb: 2,
    aft: [3, 1],
    fore: [0, 0],
    rake: 1,
    band: P.teal[2],
    sprit: [8, 10, 11, 9],
    sails: [tri(2, 3, 6, 7), tri(9, 5, 3, 5)],
    flag: [2, 0],
    smoke: [6, 2],
    main: 0,
  },
  // 1 卡拉克：后桅三角帆 + 两桅横帆
  {
    w: 16,
    deck: 14,
    len: 13,
    fb: 3,
    aft: [4, 1],
    fore: [2, 0],
    rake: 1,
    band: P.cloth.blue[1],
    sprit: [12, 13, 15, 11],
    sails: [tri(0, 6, 3, 6), sq(5, 3, 3, 2), sq(5, 6, 3, 2), sq(4, 9, 5, 3), sq(10, 6, 3, 2), sq(10, 9, 3, 3), tri(14, 8, 2, 4)],
    flag: [6, 0],
    smoke: [1, 1],
    main: 3,
  },
  // 2 福禄特：胖船身，矮桅，斜桁后帆
  {
    w: 17,
    deck: 11,
    len: 15,
    fb: 4,
    aft: [3, 1],
    fore: [0, 0],
    rake: 0,
    band: P.iron[1],
    sprit: [14, 10, 16, 9],
    sails: [{ k: "gaff", x: 0, y: 4, w: 3, h: 6, cut: 2 }, sq(5, 3, 5, 2), sq(4, 6, 7, 4), sq(12, 3, 3, 2), sq(12, 6, 3, 4)],
    flag: [7, 0],
    smoke: [1, 0],
    main: 2,
  },
  // 3 双桅纵帆船：修长低矮，两面三角帆 + 艏三角帆
  {
    w: 17,
    deck: 13,
    len: 13,
    fb: 2,
    aft: [3, 0],
    fore: [0, 0],
    rake: 2,
    topsides: P.stone[4],
    ports: true,
    sprit: [12, 12, 16, 10],
    sails: [tri(1, 4, 5, 8), tri(7, 3, 5, 9), tri(13, 6, 3, 6)],
    flag: [7, 0],
    smoke: [2, 1],
    main: 1,
  },
  // 4 大盖伦：高耸的艏艉楼
  {
    w: 18,
    deck: 14,
    len: 15,
    fb: 3,
    aft: [5, 3],
    fore: [3, 2],
    rake: 1,
    band: P.cloth.crimson[1],
    sprit: [14, 12, 17, 10],
    sails: [tri(0, 4, 4, 6), sq(6, 3, 3, 2), sq(6, 6, 3, 3), sq(5, 10, 5, 3), sq(11, 6, 3, 2), sq(11, 9, 3, 2), tri(15, 6, 2, 5)],
    flag: [7, 0],
    smoke: [1, 0],
    main: 3,
  },
  // 5 武装商船：全横帆，黄色炮带
  {
    w: 18,
    deck: 14,
    len: 15,
    fb: 3,
    aft: [4, 1],
    fore: [2, 1],
    rake: 1,
    band: P.gold[2],
    ports: true,
    sprit: [14, 13, 17, 11],
    sails: [
      sq(1, 6, 3, 2),
      sq(1, 9, 3, 3),
      sq(6, 3, 3, 2),
      sq(6, 6, 3, 3),
      sq(5, 10, 5, 3),
      sq(11, 4, 3, 1),
      sq(11, 6, 3, 2),
      sq(11, 9, 3, 3),
      tri(15, 7, 2, 5),
    ],
    flag: [7, 0],
    smoke: [2, 1],
    main: 4,
  },
  // 6 谢贝克：低矮修长，三面三角帆，青灰船身与炮门
  {
    w: 19,
    deck: 13,
    len: 16,
    fb: 2,
    aft: [3, 1],
    fore: [0, 0],
    rake: 2,
    topsides: P.slate[3],
    ports: true,
    sprit: [15, 12, 18, 11],
    sails: [tri(0, 5, 4, 6), tri(5, 3, 6, 9), tri(12, 5, 4, 7), tri(17, 8, 2, 4)],
    flag: [5, 0],
    smoke: [1, 1],
    main: 1,
  },
  // 7 远洋大帆船：四桅多层帆，两道金色炮带
  {
    w: 20,
    deck: 15,
    len: 17,
    fb: 3,
    aft: [4, 1],
    fore: [3, 1],
    rake: 1,
    band: P.gold[2],
    ports: true,
    sprit: [16, 14, 19, 12],
    sails: [
      { k: "gaff", x: 0, y: 7, w: 3, h: 6, cut: 2 },
      sq(4, 4, 3, 2),
      sq(4, 7, 3, 2),
      sq(4, 10, 3, 3),
      sq(9, 3, 3, 2),
      sq(9, 6, 3, 3),
      sq(8, 10, 5, 4),
      sq(14, 4, 3, 2),
      sq(14, 7, 3, 2),
      sq(14, 10, 3, 3),
      tri(18, 7, 2, 6),
    ],
    flag: [10, 0],
    smoke: [1, 1],
    main: 6,
  },
  // 8 柯克船：一面大方帆，艏艉两座带城垛的木楼
  {
    w: 13,
    deck: 11,
    len: 12,
    fb: 3,
    aft: [3, 2],
    fore: [3, 2],
    rake: 1,
    band: P.iron[1],
    crenel: true,
    sprit: [11, 9, 12, 8],
    sails: [sq(3, 2, 7, 7)],
    flag: [6, 0],
    smoke: [2, 1],
    main: 0,
  },
  // 9 单桅快船：一面大斜桁帆 + 艏三角帆
  {
    w: 13,
    deck: 11,
    len: 11,
    fb: 2,
    aft: [2, 1],
    fore: [0, 0],
    rake: 1,
    band: P.gold[2],
    hull: [P.cloth.green[1], P.cloth.green[0]],
    sprit: [9, 10, 12, 8],
    sails: [gaff(1, 1, 6, 9, 3), tri(8, 3, 3, 6)],
    flag: [7, 0],
    smoke: [1, 1],
    main: 0,
  },
  // 10 三角帆商船：前倾的大三角帆 + 小后帆，白船底
  {
    w: 14,
    deck: 11,
    len: 13,
    fb: 2,
    aft: [3, 1],
    fore: [0, 0],
    rake: 2,
    band: P.teal[2],
    bottom: P.plaster[2],
    sprit: [12, 10, 13, 9],
    sails: [tri(0, 6, 3, 4), tri(4, 1, 9, 9)],
    flag: [4, 0],
    smoke: [1, 2],
    main: 1,
  },
  // 11 双桅横帆船：两桅三层横帆，主桅后一面斜桁帆
  {
    w: 17,
    deck: 13,
    len: 14,
    fb: 2,
    aft: [3, 1],
    fore: [0, 0],
    rake: 1,
    band: P.cloth.green[1],
    ports: true,
    sprit: [13, 12, 16, 10],
    sails: [gaff(0, 5, 3, 6, 2), sq(4, 2, 3, 2), sq(4, 5, 3, 2), sq(3, 8, 5, 3), sq(10, 3, 3, 2), sq(10, 6, 3, 2), sq(9, 9, 5, 2), tri(15, 6, 2, 5)],
    flag: [5, 0],
    smoke: [1, 1],
    main: 3,
  },
  // 12 探险快船：两面斜桁帆 + 艏三角帆，桅顶瞭望斗，深蓝船身
  {
    w: 14,
    deck: 12,
    len: 12,
    fb: 2,
    aft: [3, 1],
    fore: [0, 0],
    rake: 1,
    band: P.gold[2],
    hull: [P.cloth.navy[2], P.cloth.navy[1]],
    ports: false,
    nest: [6, 2],
    sprit: [11, 11, 13, 9],
    sails: [gaff(1, 3, 5, 8, 2), gaff(7, 5, 4, 6, 2), tri(12, 5, 2, 5)],
    flag: [6, 0],
    smoke: [2, 1],
    main: 0,
  },
  // 13 移民船：宽胖高舷，三桅横帆，一排亮着灯的舷窗
  {
    w: 18,
    deck: 12,
    len: 16,
    fb: 4,
    aft: [3, 2],
    fore: [2, 1],
    rake: 0,
    band: P.cloth.ochre[1],
    lights: 3,
    sprit: [15, 11, 17, 9],
    sails: [sq(1, 5, 3, 2), sq(1, 8, 3, 2), sq(6, 1, 3, 2), sq(6, 4, 3, 2), sq(5, 7, 5, 3), sq(12, 4, 3, 2), sq(11, 7, 4, 3), tri(16, 5, 2, 4)],
    flag: [7, 0],
    smoke: [2, 2],
    main: 4,
  },
  // 14 巡防舰：黑船身、一道开满炮门的黄带，三桅横帆
  {
    w: 19,
    deck: 14,
    len: 16,
    fb: 3,
    aft: [4, 1],
    fore: [2, 0],
    rake: 1,
    band: P.cloth.ochre[2],
    ports: true,
    hull: [P.iron[1], P.iron[0]],
    sprit: [15, 13, 18, 11],
    sails: [gaff(0, 7, 2, 5, 2), sq(2, 5, 3, 2), sq(2, 8, 3, 3), sq(7, 1, 3, 2), sq(7, 4, 3, 2), sq(6, 7, 5, 4), sq(12, 3, 3, 2), sq(12, 6, 3, 2), sq(11, 9, 4, 3), tri(16, 7, 2, 5)],
    flag: [8, 0],
    smoke: [2, 1],
    main: 5,
  },
  // 15 加莱赛战船：低长的暗红船身、一排桨、三面三角帆、镀金撞角
  {
    w: 20,
    deck: 12,
    len: 17,
    fb: 3,
    aft: [4, 2],
    fore: [3, 1],
    rake: 1,
    band: P.gold[2],
    hull: [P.cloth.crimson[0], P.red[0]],
    oars: true,
    ram: true,
    sprit: [16, 13, 19, 13],
    sails: [tri(1, 4, 4, 6), tri(6, 1, 6, 9), tri(12, 3, 4, 7)],
    flag: [6, 0],
    smoke: [2, 1],
    main: 1,
  },
  // 16 瑶华宝船：三面东方硬帆，两头高翘的船身与高艉楼，船艏龙目
  {
    w: 19,
    deck: 13,
    len: 17,
    fb: 3,
    aft: [5, 3],
    fore: [2, 1],
    rake: 1,
    band: P.cloth.crimson[1],
    stripes: [[2, P.cloth.green[1]]],
    castle: P.cloth.crimson[1],
    eye: true,
    sailTone: "junk",
    sails: [jk(1, 5, 3, 6, 1), jk(6, 1, 5, 10, 2), jk(13, 4, 3, 7, 1)],
    flag: [9, 0],
    smoke: [2, 1],
    main: 1,
  },
  // 17 飞剪船：狭长低矮的黑船身，三根高桅挂满窄横帆，长艏斜桅
  {
    w: 19,
    deck: 14,
    len: 15,
    fb: 2,
    aft: [2, 1],
    fore: [0, 0],
    rake: 2,
    band: P.gold[2],
    hull: [P.iron[1], P.iron[0]],
    sprit: [14, 13, 18, 10],
    sails: [
      sq(2, 3, 3, 2),
      sq(2, 6, 3, 2),
      sq(2, 9, 3, 3),
      sq(7, 0, 3, 2),
      sq(7, 3, 3, 2),
      sq(7, 6, 3, 2),
      sq(6, 9, 5, 3),
      sq(12, 2, 3, 2),
      sq(12, 5, 3, 2),
      sq(12, 8, 3, 3),
      tri(16, 5, 2, 7),
    ],
    flag: [8, 0],
    smoke: [2, 1],
    main: 6,
  },
  // 18 战列舰：高大的黑船身上三道开满炮门的金带，三桅横帆
  {
    w: 20,
    deck: 13,
    len: 17,
    fb: 6,
    aft: [4, 2],
    fore: [3, 1],
    rake: 1,
    band: P.gold[2],
    hull: [P.iron[1], P.iron[0]],
    stripes: [
      [3, P.gold[2]],
      [5, P.gold[2]],
    ],
    portRows: [1, 3, 5],
    sprit: [16, 12, 19, 10],
    sails: [sq(1, 4, 3, 2), sq(1, 7, 3, 3), sq(7, 0, 3, 2), sq(7, 3, 3, 2), sq(6, 6, 5, 4), sq(12, 2, 3, 2), sq(12, 5, 3, 2), sq(11, 8, 5, 3), tri(17, 6, 2, 5)],
    flag: [8, 0],
    smoke: [2, 1],
    main: 4,
  },
];

/** 小图的一面帆。 */
function paintSmallSail(p: Px, sl: SmallSail, sail: SailTones, billow: boolean): void {
  if (sl.k === "sq") {
    for (let yy = 0; yy < sl.h; yy++) {
      for (let xx = 0; xx < sl.w; xx++) {
        const c = xx === 0 ? sail.hi : xx === sl.w - 1 && sl.w > 2 ? sail.lo : yy === 0 && sl.h > 2 ? sail.lo : sail.mid;
        p.put(sl.x + xx, sl.y + yy, c);
      }
    }
    // 帆脚鼓起
    if (billow && sl.h >= 3 && sl.w >= 3) for (let xx = 1; xx < sl.w - 1; xx++) p.put(sl.x + xx, sl.y + sl.h, sail.lo);
  } else if (sl.k === "jk") {
    // 东方硬帆：顶边左高右低；自帆脚起每两行一道竹骨，竹骨伸出后缘一格；帆片左亮右暗
    const cut = sl.cut ?? 2;
    for (let yy = 0; yy < sl.h; yy++) {
      const batten = (sl.h - 1 - yy) % 2 === 0;
      for (let xx = 0; xx < sl.w; xx++) {
        if (yy < Math.round((cut * xx) / Math.max(1, sl.w - 1))) continue;
        const c = batten ? sail.lo : xx === sl.w - 1 ? sail.mid : xx <= 1 || (billow && xx === 2) ? sail.hi : sail.mid;
        p.put(sl.x + xx, sl.y + yy, c);
      }
      if (batten && yy > 0 && yy < sl.h - 1) p.put(sl.x - 1, sl.y + yy, sail.lo);
    }
  } else if (sl.k === "tj") {
    // 倾斜的矩形硬帆：每一列比左边一列低一点（整面帆向前倾倒），一行行编席的缝；鼓起时帆脚下露出几点
    const cut = sl.cut ?? 2;
    for (let xx = 0; xx < sl.w; xx++) {
      const top = sl.y + Math.round((cut * xx) / Math.max(1, sl.w - 1));
      for (let yy = 0; yy < sl.h; yy++) {
        const c = xx === 0 ? sail.hi : xx === sl.w - 1 || yy % 2 === 1 ? sail.lo : sail.mid;
        p.put(sl.x + xx, top + yy, c);
      }
      if (billow && xx > 0 && xx < sl.w - 1 && xx % 2 === 1) p.put(sl.x + xx, top + sl.h, sail.lo);
    }
  } else if (sl.k === "mat") {
    // 编席的矩形帆：一行行席缝，左亮右暗；鼓起时帆脚下垂一行
    for (let yy = 0; yy < sl.h; yy++) {
      for (let xx = 0; xx < sl.w; xx++) {
        const c = xx === 0 ? sail.hi : xx === sl.w - 1 || yy % 2 === 1 ? sail.lo : sail.mid;
        p.put(sl.x + xx, sl.y + yy, c);
      }
    }
    if (billow) for (let xx = 1; xx < sl.w - 1; xx++) p.put(sl.x + xx, sl.y + sl.h, sail.lo);
  } else {
    const cut = sl.k === "gaff" ? (sl.cut ?? 2) : sl.h - 1;
    for (let yy = 0; yy < sl.h; yy++) {
      const right = sl.x + Math.min(sl.w - 1, Math.round(((sl.w - 1) * yy) / Math.max(1, cut)));
      for (let x = sl.x; x <= right; x++) {
        const c = x === sl.x ? sail.hi : x === right && right > sl.x + 1 ? sail.lo : sail.mid;
        p.put(x, sl.y + yy, c);
      }
    }
    if (billow && sl.h >= 5) p.put(sl.x - 1, sl.y + sl.h - 2, sail.hi);
  }
}

/** 小图的水线（描边后的行号）：船底一行在水线以下。 */
function smallWaterline(s: SmallSpec): number {
  return s.deck + s.fb + 2;
}

/**
 * 寰宇·十六世纪新船型的小图：逐像素画好的字符网格（描边前的坐标），画时按图例换成颜色。
 * 图例：a–e 木色五阶（海盗船整体暗一阶）、z 船底；S 帆的中间色、s 暗面与席缝、H 受光的一边、E 帆边
 * （帆色随帆的底色与海盗配色）；q 只在第 1、2 帧出现的帆脚鼓起；o / O 桨（与桨手的短桨）在第 0、3 帧 / 第 1、2 帧的位置；
 * 其余字母是调色板里的固定颜色（见 GLYPH_KEY）；“.” 透明。over 是叠在 rows 上面的一层（桨、桨手），同样的图例。
 */
export interface GlyphSpec {
  rows: readonly string[];
  over?: readonly string[];
  /** 先画的帆（与经典小图同样的帆型图元，rows 画在帆上面） */
  sails?: readonly SmallSail[];
  /** 舷缘所在行（受损时甲板上的火） */
  deck: number;
  /** 船底那一行；描边后的水线（waterlineOf）比它低一行 */
  bottom: number;
  /** 旗杆所在列与旗的顶行（同 SmallSpec.flag） */
  flag: readonly [number, number];
  /** 受损时冒烟的位置 */
  smoke: readonly [number, number];
  /** 主帆的中心（受损的破洞、海盗的骨白点）；没有帆的船为 null */
  hole: readonly [number, number] | null;
  sailTone?: "junk" | "mat";
  /** 海盗帆色（缺省黑帆） */
  pirateSail?: "black" | "red";
  /** 船底（z）的颜色（缺省铜红；海盗船为铁色） */
  z?: string;
}

/** 小图字符网格里固定颜色的字母。 */
const GLYPH_KEY: Readonly<Record<string, string>> = {
  R: P.red[2],
  r: P.red[1],
  g: P.gold[2],
  G: P.gold[3],
  w: P.plaster[3],
  W: P.white,
  x: ink.deep,
  i: P.iron[1],
  I: P.iron[2],
  l: P.leaf[2],
  L: P.leaf[3],
  t: P.straw[2],
  T: P.straw[3],
  u: P.straw[1],
  n: P.cloth.navy[1],
  N: P.cloth.blue[1],
  v: P.slate[1],
  V: P.slate[3],
  p: P.plaster[2],
  m: P.cloth.crimson[1],
  j: P.jade[2],
  J: P.teal[2],
  K: P.teal[1],
  k: P.skinDark[1],
  h: P.hair.black[1],
  y: P.sand[2],
};

/** 小图的水线：按画法下标（经典的 21 种用 SMALL，寰宇·十六世纪的 16 种用 GLYPHS）。 */
function smallWaterlineOf(idx: number): number {
  return idx < SMALL.length ? smallWaterline(SMALL[idx]) : EXTRA_GLYPHS[idx - SMALL.length].bottom + 1;
}

/** 画一张新船型的小图：字符网格 → 颜色，然后与经典小图一样加旗、描边、旗杆、受损的破洞与烟火。 */
function drawGlyph(gs: GlyphSpec, opts: ShipArtOpts): Px {
  const frame = frameOf(opts.frame);
  const billow = frame === 1 || frame === 2;
  const look = lookOf(opts, gs.pirateSail === "red", gs.sailTone);
  const wood = look.wood;
  const sail: SailTones = look.sail === SAIL_BLACK ? { edge: ink.deep, lo: P.cloth.black[1], mid: P.cloth.black[2], hi: P.stone[1] } : look.sail;
  const dyn: Readonly<Record<string, string | null>> = {
    a: wood[0],
    b: wood[1],
    c: wood[2],
    d: wood[3],
    e: wood[4],
    z: look.pirate ? look.bottom[1] : (gs.z ?? look.bottom[1]),
    S: sail.mid,
    s: sail.lo,
    H: sail.hi,
    E: sail.edge,
    q: billow ? sail.lo : null,
    o: billow ? null : wood[4],
    O: billow ? wood[4] : null,
  };
  const w = Math.max(...gs.rows.map((r) => r.length));
  const p = new Px(w, gs.rows.length);
  for (const sl of gs.sails ?? []) paintSmallSail(p, sl, sail, billow);
  for (const layer of [gs.rows, gs.over ?? []]) {
    layer.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === ".") continue;
        const c = ch in dyn ? dyn[ch] : GLYPH_KEY[ch];
        if (c) p.put(x, y, c);
      }
    });
  }
  // 旗（描边前画，好让旗有黑边）
  const flag = look.pirate ? P.cloth.black[1] : look.flag;
  const [fx, fy] = gs.flag;
  if (flag) {
    const dark = look.pirate ? ink.deep : mix(flag, ink.deep, 0.35);
    const rows = [
      ["FFF", "FFf"],
      ["FFf", "FF."],
      ["FFF", "Fff"],
      ["FFf", "FFF"],
    ][frame];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) if (rows[r][c] !== ".") p.put(fx + 1 + c, fy + r, rows[r][c] === "F" ? flag : dark);
    if (look.pirate) p.put(fx + 2, fy, P.plaster[3]);
  }
  // 海盗：主帆上一点骨白
  if (look.pirate && gs.hole) p.put(gs.hole[0], gs.hole[1], P.plaster[3]);
  const out = p.outlined(ink.brown);
  // 旗杆（描边后画，保持 1 像素细）
  for (let y = fy; y <= fy + 2; y++) if (!out.isOpaque(fx + 1, y + 1)) out.put(fx + 1, y + 1, wood[1]);
  if (flag) out.put(fx + 1, fy + 1, wood[1]);
  if (opts.damaged) {
    // 主帆破洞、甲板起火、烟向右上飘
    if (gs.hole) out.put(gs.hole[0] + 1, gs.hole[1] + 1, ink.brown);
    const [smx, smy] = gs.smoke;
    out.put(smx + 1, gs.deck, frame % 2 ? P.lamp[1] : P.red[3]);
    const rise = frame % 2;
    const puffs: [number, number, string][] = [
      [smx + 1, smy + 5 - rise, P.stone[1]],
      [smx + 2, smy + 4 - rise, P.stone[2]],
      [smx + 2, smy + 3 - rise, P.stone[2]],
      [smx + 3, smy + 2 - rise, P.stone[3]],
      [smx + 3, smy + 1 - rise, P.stone[2]],
      [smx + 4, smy + 1 - rise, P.stone[3]],
    ];
    for (const [x, y, c] of puffs) if (y >= 0 && !out.isOpaque(x, y)) out.put(x, y, c);
  }
  return out;
}

function drawSmall(idx: number, opts: ShipArtOpts): Px {
  if (idx >= SMALL.length) return drawGlyph(EXTRA_GLYPHS[idx - SMALL.length], opts);
  const s = SMALL[idx];
  const frame = frameOf(opts.frame);
  const billow = frame === 1 || frame === 2;
  const lateenShip = s.sails.every((sl) => sl.k !== "sq");
  const look = lookOf(opts, lateenShip, s.sailTone);
  const wood = look.wood;
  // 小图的黑帆提亮一阶，否则和描边糊成一团
  const sail: SailTones =
    look.sail === SAIL_BLACK ? { edge: ink.deep, lo: P.cloth.black[1], mid: P.cloth.black[2], hi: P.stone[1] } : look.sail;
  const h = s.deck + s.fb + 2;
  const p = new Px(s.w, h);
  // 船体
  const bottomRow = s.deck + s.fb + 1;
  const stripe = new Map(s.stripes ?? []);
  for (let y = s.deck - Math.max(s.aft[1], s.fore[1]); y <= bottomRow; y++) {
    const r = y - s.deck;
    for (let i = 0; i < s.len; i++) {
      const aftC = i < s.aft[0] && -r <= s.aft[1];
      const foreC = i >= s.len - s.fore[0] && -r <= s.fore[1];
      if (r < 0 && !aftC && !foreC) continue;
      if (r > 0 && i > s.len - 1 - r * s.rake) continue;
      if (y === bottomRow && (i === 0 || (s.rake === 0 && i >= s.len - 2))) continue;
      if (s.rake === 0 && y === bottomRow - 1 && i === s.len - 1) continue;
      // 城垛：艏艉楼顶一行隔一格空一格
      if (s.crenel && r < 0 && -r === (aftC ? s.aft[1] : s.fore[1]) && i % 2 === 1) continue;
      let c: string;
      if (y === bottomRow) c = s.bottom && !look.pirate ? s.bottom : look.bottom[1];
      else if (r < 0) {
        const hc = aftC ? s.aft[1] : s.fore[1];
        c = -r === hc ? wood[4] : look.pirate ? P.cloth.black[2] : (s.castle ?? wood[3]);
      } else if (r === 0) c = wood[4];
      else if (r === 1 && s.band) c = look.pirate ? P.red[1] : s.band;
      else if (r === 1 && s.topsides) c = look.pirate ? wood[2] : s.topsides;
      else if (stripe.has(r)) c = look.pirate ? P.red[1] : (stripe.get(r) as string);
      else if (r === s.fb) c = s.hull && !look.pirate ? s.hull[1] : wood[1];
      else c = s.hull && !look.pirate ? s.hull[0] : wood[2];
      if (s.ports && r === 1 && i % 2 === 1 && i > 1 && i < s.len - 2) c = ink.deep;
      if (s.portRows?.includes(r) && i % 2 === 1 && i > 1 && i < s.len - 1 - r * s.rake) c = ink.deep;
      if (s.lights === r && i % 3 === 1 && i > 1 && i < s.len - 2) c = P.lamp[1];
      p.put(i, y, c);
    }
  }
  // 一排桨：浅色的桨杆自舷侧斜插入水，按帧前后划动
  if (s.oars) {
    const shift = billow ? 1 : 0;
    for (let i = 4; i < s.len - 4; i += 2) {
      p.put(i + shift, s.deck + 2, wood[4]);
      p.put(i - 1 + shift, s.deck + 3, wood[4]);
      p.put(i - 1 + shift, bottomRow, wood[3]);
    }
  }
  // 龙目
  if (s.eye) p.put(s.len - 3, s.deck + 1, P.white).put(s.len - 4, s.deck + 1, ink.deep);
  // 艏斜桅（加莱赛战船是镀金撞角）
  if (s.sprit) {
    const [sx0, sy0, sx1, sy1] = s.sprit;
    p.line(sx0, sy0, sx1, sy1, s.ram ? P.gold[2] : wood[2]);
    if (s.ram) p.put(sx1, sy1, P.gold[3]);
  }
  // 帆
  const holes: [number, number][] = [];
  s.sails.forEach((sl, n) => {
    paintSmallSail(p, sl, sail, billow);
    if (n === s.main) holes.push([sl.x + Math.floor(sl.w / 2), sl.y + Math.floor(sl.h / 2)]);
  });
  // 瞭望斗
  if (s.nest) {
    const [nx, ny] = s.nest;
    p.put(nx - 1, ny, wood[3]).put(nx, ny, wood[3]).put(nx + 1, ny, wood[2]);
  }
  // 旗（描边前画，好让旗有黑边）
  const flag = look.pirate ? P.cloth.black[1] : look.flag;
  const [fx, fy] = s.flag;
  if (flag) {
    const dark = look.pirate ? ink.deep : mix(flag, ink.deep, 0.35);
    const rows = [
      ["FFF", "FFf"],
      ["FFf", "FF."],
      ["FFF", "Fff"],
      ["FFf", "FFF"],
    ][frame];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const ch = rows[r][c];
        if (ch !== ".") p.put(fx + 1 + c, fy + r, ch === "F" ? flag : dark);
      }
    }
    if (look.pirate) p.put(fx + 2, fy, P.plaster[3]);
  }
  // 海盗：主帆上一点骨白
  if (look.pirate) {
    const ms = s.sails[s.main];
    p.put(ms.x + Math.floor(ms.w / 2), ms.y + Math.floor(ms.h / 2), P.plaster[3]);
  }
  const out = p.outlined(ink.brown);
  // 旗杆（描边后画，保持 1 像素细）
  for (let y = fy; y <= fy + 2; y++) if (!out.isOpaque(fx + 1, y + 1)) out.put(fx + 1, y + 1, wood[1]);
  if (flag) out.put(fx + 1, fy + 1, wood[1]);
  if (opts.damaged) {
    // 主帆破洞、甲板起火、烟向右上飘
    for (const [hx, hy] of holes) out.put(hx + 1, hy + 1, ink.brown);
    const [smx, smy] = s.smoke;
    out.put(smx + 1, s.deck, frame % 2 ? P.lamp[1] : P.red[3]);
    const rise = frame % 2;
    const puffs: [number, number, string][] = [
      [smx + 1, smy + 5 - rise, P.stone[1]],
      [smx + 2, smy + 4 - rise, P.stone[2]],
      [smx + 2, smy + 3 - rise, P.stone[2]],
      [smx + 3, smy + 2 - rise, P.stone[3]],
      [smx + 3, smy + 1 - rise, P.stone[2]],
      [smx + 4, smy + 1 - rise, P.stone[3]],
    ];
    for (const [x, y, c] of puffs) if (y >= 0 && !out.isOpaque(x, y)) out.put(x, y, c);
  }
  return out;
}

// ───────────────────────── 导出 ─────────────────────────

/**
 * 船型图。typeIndex 为 ships.toml 中的顺序：0 卡拉维尔（swallow）、1 卡拉克（tradewind）、2 福禄特（whale）、
 * 3 双桅纵帆船（silvergull）、4 大盖伦（bastion）、5 武装商船（beacon）、6 谢贝克（mistfalcon）、7 远洋大帆船（farstar）、
 * 8 柯克船、9 单桅快船、10 三角帆商船、11 双桅横帆船、12 探险快船、13 移民船、14 巡防舰、15 加莱赛战船、
 * 16 瑶华宝船、17 飞剪船、18 战列舰；
 * 超出范围时按 sail（横帆 / 三角帆）画通用船。large 宽约 64–128，small 宽约 14–22。
 * 同一船型、同一 size 下，旗色、海盗、帧、受损都不改变图的尺寸与水线位置（见 waterlineOf）。
 * 返回的是缓存图的副本，可以放心修改。
 */
export function drawShip(typeIndex: number, sail: "square" | "lateen", opts: ShipArtOpts): Px {
  return drawIndex(specIndex(typeIndex, sail), opts);
}

/**
 * 按船型 key 画船（第九批起界面用它）：经典世界的 19 个 key（CLASSIC_SHIP_KEYS，寰宇·十六世纪全部沿用）
 * 映射到原来的 typeIndex，画面与 drawShip 逐像素相同（例外：标三角帆的 brig 是寰宇的布里甘廷桨帆船）；
 * 寰宇·十六世纪新增的 16 个 key（TERRA16_SHIP_KEYS）用各自的画法；
 * 未知的 key 按 sail 退回通用船（横帆 → 卡拉克，三角帆 → 双桅纵帆船），与越界的 typeIndex 相同。
 * 尺寸、水线（waterlineByKey）与返回副本的约定同 drawShip。
 */
export function drawShipByKey(key: string, sail: "square" | "lateen", opts: ShipArtOpts): Px {
  return drawIndex(keyIndex(key, sail), opts);
}

/**
 * 船型表与船型 id → 画船用的 key：表里有这一项就用它的 key；没有船型表（或 id 不在表里）时按经典世界的顺序取 key
 * （CLASSIC_SHIP_KEYS[id]，与旧的 drawShip(id) 一致）；都没有时返回空串，drawShipByKey 会按帆型退回通用船。
 */
export function shipArtKey(ships: readonly { key: string }[] | null | undefined, id: number): string {
  const k = Number.isInteger(id) && id >= 0 ? ships?.[id]?.key : undefined;
  if (k) return k;
  return Number.isInteger(id) && id >= 0 && id < CLASSIC_SHIP_KEYS.length ? CLASSIC_SHIP_KEYS[id] : "";
}

/**
 * 只在需要时给出 key：船型表在这个 id 上的 key 与经典世界同一下标的 key 相同（或查不到）时返回 undefined——
 * 这时按下标画就是同一张图；寰宇·十六世纪的新船型（以及顺序不同的世界）才返回 key。给只带下标的场景参数用。
 */
export function shipKeyOverride(ships: readonly { key: string }[] | null | undefined, id: number): string | undefined {
  const k = shipArtKey(ships, id);
  return k === shipArtKey(null, id) ? undefined : k;
}

function drawIndex(idx: number, opts: ShipArtOpts): Px {
  const frame = frameOf(opts.frame);
  const flag = cleanColor(opts.flag) ?? "";
  const size = opts.size === "small" ? "small" : "large";
  const key = `ship:${idx}:${size}:${flag}:${opts.pirate ? 1 : 0}:${frame}:${opts.damaged ? 1 : 0}`;
  const o: ShipArtOpts = { ...opts, size, frame, flag: flag || undefined };
  return memo(key, () => (size === "small" ? drawSmall(idx, o) : drawLarge(idx, o))).clone();
}

/**
 * 水线距图顶的像素高度：调用方把船图的这一行对齐海面，在此处叠加海浪。
 * large 的水线以下还画了几行船底（与舵）；small 的水线以下有一行深色船底与一行描边。
 * sail 只在 typeIndex 越界时用来挑通用船，与 drawShip 一致。
 */
export function waterlineOf(typeIndex: number, size: "large" | "small", sail: "square" | "lateen" = "square"): number {
  return waterlineAt(specIndex(typeIndex, sail), size);
}

/** 按船型 key 取水线（与 drawShipByKey 一致；未知 key 按 sail 退回通用船）。 */
export function waterlineByKey(key: string, size: "large" | "small", sail: "square" | "lateen" = "square"): number {
  return waterlineAt(keyIndex(key, sail), size);
}

function waterlineAt(idx: number, size: "large" | "small"): number {
  if (size === "small") return smallWaterlineOf(idx);
  const s = ALL_SPECS[idx];
  const maxH = Math.max(...s.masts.map((m) => m.h));
  return TOP + maxH + s.freeboard;
}

// ───────────────────────── 小划艇 ─────────────────────────

/** 小划艇的尺寸与水线（距图顶）。 */
export const BOAT_SIZE = { w: 22, h: 11, waterline: 8 } as const;

/**
 * 码头边的小划艇（船头朝右）：收起的船桨、一只小木箱、系缆垂向右下方的码头；frame 让船身轻轻前后摇晃。
 * 图宽 22、高 11；第 8 行是水线（BOAT_SIZE.waterline），调用方在此处叠加水波。
 */
export function drawBoat(frame: number): Px {
  const f = frameOf(frame);
  return memo(`boat:${f}`, () => paintBoat(f)).clone();
}

/** 划艇侧影：自船尾（x=2）到船头（x=19）每列的舷缘与船底。 */
const BOAT_SHEER = [4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 3, 3, 2, 1];
const BOAT_BOTTOM = [8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6, 5, 4, 2];

function paintBoat(f: number): Px {
  const { w, h, waterline } = BOAT_SIZE;
  const cv = new Canvas(w, h);
  const wood = P.wood;
  // 摇晃：船头与船尾交替起伏 1 像素
  const tilt = [0, 1, 0, -1][f];
  const lift = (x: number) => Math.round(((x - 11) / 9) * tilt * 0.75);
  const x0 = 2;
  const sheerAt = (x: number) => BOAT_SHEER[Math.max(0, Math.min(BOAT_SHEER.length - 1, x - x0))] - lift(x);
  for (let i = 0; i < BOAT_SHEER.length; i++) {
    const x = x0 + i;
    const sheer = sheerAt(x);
    const bottom = BOAT_BOTTOM[i] - lift(x);
    for (let y = sheer; y <= bottom; y++) {
      const d = y - sheer;
      let c: string = d === 0 ? wood[4] : d === 1 ? P.teal[2] : d === 2 ? wood[3] : wood[2];
      if (i === 0 && d > 0) c = wood[3];
      if (y === bottom || y >= waterline + 1 - lift(x) * 0) c = y === bottom ? wood[1] : wood[2];
      if (i >= BOAT_SHEER.length - 2 && d > 0) c = wood[2];
      cv.dot(x, y, c, M_HULL);
    }
    // 从上方略看得见船舱：远侧舷缘、舱里的暗影与两道座板
    if (i >= 1 && i <= 13) {
      cv.dot(x, sheer - 1, i === 5 || i === 10 ? wood[3] : wood[0], M_HULL);
      cv.dot(x, sheer - 2, wood[3], M_HULL);
    }
  }
  // 舱里一只小木箱
  const bx = 8;
  const by = sheerAt(bx) - 4;
  cv.rect(bx, by, 3, 2, wood[3], M_HULL);
  cv.rect(bx, by, 3, 1, wood[4], M_HULL);
  cv.dot(bx + 2, by + 1, wood[2], M_HULL);
  cv.outline((m) => (m === M_HULL ? ink.brown : null));
  // 收起的船桨：桨柄搁在舷上，桨叶翘出船尾
  cv.line(14, sheerAt(14) - 3, 2, sheerAt(3) - 3, wood[3], M_SPAR);
  cv.dot(0, sheerAt(2) - 3, wood[4], M_SPAR);
  cv.dot(1, sheerAt(2) - 3, wood[4], M_SPAR);
  cv.dot(0, sheerAt(2) - 2, wood[3], M_SPAR);
  // 系缆：从船头垂向右下方的码头
  cv.line(x0 + BOAT_SHEER.length, sheerAt(19) + 1, w - 1, 7, P.wood[1], M_ROPE, true);
  return cv.px;
}

// ───────────────────────── 船台上的船骨架 ─────────────────────────

/** 船骨架图的尺寸：底边是船台地面。 */
export const SHIP_FRAME_SIZE = { w: 72, h: 50 } as const;

/**
 * 船台上建造中的船（船头朝右），progress 0..1：
 * 0 只有龙骨与墩木 → 立起艏柱艉柱 → 肋骨自船尾向船头逐根立起 → 船板自下而上铺满 → 舷墙与色带 → 1 立起下桅，完工。
 * 四周有脚手架与斜撑。图的底边是船台地面（调用方把它放在船台上）。
 */
export function drawShipFrame(progress: number): Px {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const step = Math.round(p * 40);
  return memo(`shipframe:${step}`, () => paintShipFrame(step / 40)).clone();
}

function paintShipFrame(p: number): Px {
  const { w, h } = SHIP_FRAME_SIZE;
  const cv = new Canvas(w, h);
  const wood = P.wood;
  const ground = h - 1;
  const keelY = ground - 5;
  const sternX = 9;
  const bowX = 60;
  const len = bowX - sternX;
  const deck = keelY - 20;
  const sheer = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - sternX) / len));
    const r = t < 0.5 ? 3 * ((0.5 - t) * 2) ** 2 : 4 * ((t - 0.5) * 2) ** 2;
    return Math.round(deck - r);
  };
  // 船体轮廓：与大船同样的画法
  const pts: Pt[] = [];
  for (let x = sternX; x <= bowX; x++) pts.push([x, sheer(x)]);
  pts.push(...quad([bowX + 1, sheer(bowX)], [bowX - 2, keelY + 1], [bowX - 14, keelY + 1], 12).slice(1));
  pts.push(...quad([sternX + 10, keelY + 1], [sternX + 3, keelY + 1], [sternX + 3, keelY - 6], 8));
  pts.push([sternX, sheer(sternX)]);
  const hull = maskOf(pts);
  const colTop = (x: number) => {
    for (let y = 0; y < h; y++) if (maskHas(hull, x, y)) return y;
    return -1;
  };
  const colBot = (x: number) => {
    for (let y = h - 1; y >= 0; y--) if (maskHas(hull, x, y)) return y;
    return -1;
  };

  const ribsDone = p < 0.12 ? 0 : Math.min(1, (p - 0.12) / 0.33);
  const plankLevel = p < 0.45 ? 0 : Math.min(1, (p - 0.45) / 0.33);
  const finished = p >= 0.8;

  // 滑道地面与墩木（叠起的方木）
  cv.rect(0, ground, w, 1, wood[1], M_HULL);
  for (let x = sternX + 4; x < bowX - 6; x += 10) {
    for (let yy = keelY + 2; yy < ground; yy++) {
      const layer = (yy - keelY - 2) % 2;
      cv.rect(x, yy, 5, 1, layer === 0 ? wood[3] : wood[2], M_HULL);
      cv.dot(x + 4, yy, wood[1], M_HULL);
    }
  }

  // 船板（自下而上）
  const plankTop = (x: number) => {
    const t = colTop(x);
    const b = colBot(x);
    return Math.round(b - (b - t) * (finished ? 1 : plankLevel));
  };
  if (plankLevel > 0) {
    for (let x = hull.x0; x < hull.x0 + hull.w; x++) {
      const t = colTop(x);
      if (t < 0) continue;
      const pt = plankTop(x);
      const b = colBot(x);
      for (let y = Math.max(pt, t); y <= b; y++) {
        const d = y - sheer(x);
        const strake = Math.floor(d / 3);
        const ph = (x + strake * 6) % 16;
        let c: string = d < 6 ? wood[3] : wood[2];
        if (d % 3 === 2 && ph < 13) c = wood[1];
        if (b - y <= 1) c = wood[1];
        if (finished && d <= 0) c = wood[4];
        else if (finished && d >= 3 && d <= 4) c = d === 3 ? P.teal[3] : P.teal[2];
        cv.dot(x, y, c, M_HULL);
      }
      // 未铺满时，船板上沿是新木料的亮边
      if (!finished && pt > t) cv.dot(x, pt, wood[4], M_HULL);
    }
  }

  // 龙骨、艏柱、艉柱
  cv.rect(sternX + 4, keelY, len - 12, 2, wood[2], M_HULL);
  cv.rect(sternX + 4, keelY, len - 12, 1, wood[3], M_HULL);
  if (p >= 0.08) {
    for (let x = bowX - 14; x <= bowX; x++) {
      for (let y = 0; y < h; y++) {
        if (!maskHas(hull, x, y)) continue;
        if (!maskHas(hull, x + 1, y) || !maskHas(hull, x, y + 1)) cv.dot(x, y, wood[2], M_HULL);
      }
    }
    for (let y = sheer(sternX); y <= keelY - 5; y++) cv.dot(sternX + Math.round((y - sheer(sternX)) * 0.2), y, wood[2], M_HULL);
    for (let x = sternX + 1; x <= sternX + 10; x++) {
      const b = colBot(x);
      if (b > 0) cv.dot(x, b, wood[2], M_HULL);
    }
  }
  cv.outline((m) => (m === M_HULL ? ink.brown : null));

  // 肋骨：自船尾向船头逐根立起（不描边，保持骨架的通透）；已被船板盖住的部分不再画
  const ribXs: number[] = [];
  for (let x = sternX + 4; x <= bowX - 3; x += 5) ribXs.push(x);
  const ribN = Math.round(ribXs.length * ribsDone);
  if (!finished) {
    for (let k = 0; k < ribN; k++) {
      const x = ribXs[k];
      const t = colTop(x);
      const b = colBot(x);
      const pt = plankLevel > 0 ? plankTop(x) - 1 : b;
      for (let y = t; y <= Math.min(pt, b - 1); y++) {
        cv.dot(x, y, y === t ? wood[4] : wood[3], M_SPAR);
        cv.dot(x + 1, y, wood[1], M_SPAR);
      }
    }
    // 舷缘纵梁与一道腰梁把肋骨连起来
    if (ribN > 1) {
      const xe = ribXs[ribN - 1] + 1;
      for (let x = ribXs[0]; x <= xe; x++) {
        cv.dot(x, colTop(x), wood[2], M_SPAR);
        if (plankLevel === 0 || plankTop(x) > colTop(x) + 8) cv.dot(x, colTop(x) + 7, wood[2], M_SPAR);
      }
    }
  }

  // 下桅（完工阶段）
  if (p >= 0.92) {
    for (const [mx, mh] of [
      [sternX + 13, 12],
      [sternX + 27, 17],
      [sternX + 41, 14],
    ] as const) {
      const top = sheer(mx) - mh;
      for (let y = top; y < sheer(mx) - 1; y++) {
        cv.back(mx, y, wood[3], M_SPAR);
        cv.back(mx + 1, y, wood[1], M_SPAR);
      }
      cv.rect(mx - 2, top + 2, 6, 1, wood[1], M_SPAR);
    }
    cv.line(bowX - 3, sheer(bowX) - 2, bowX + 9, sheer(bowX) - 7, wood[2], M_SPAR, true);
  }

  // 脚手架与斜撑（在船后）
  if (p > 0.08 && p < 1) {
    for (const x of [sternX + 2, sternX + 21, sternX + 40, bowX + 5]) cv.line(x, ground - 1, x, deck - 6, wood[1], M_SPAR, true);
    for (const y of [deck + 1, deck + 10]) cv.line(sternX, y, bowX + 7, y, wood[2], M_SPAR, true);
  }
  if (p > 0.3) {
    for (const x of [sternX + 12, sternX + 30, bowX - 12]) cv.line(x - 7, ground - 1, x, sheer(x) + 9, wood[2], M_SPAR, true);
  }
  return cv.px;
}
