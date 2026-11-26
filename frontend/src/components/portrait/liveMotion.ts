// 会动的头像的“运动量”：每一帧由时间与指针位置算出的一组标量。
// 着色器（liveWarp.ts）按形变权重图把它们分到画面各处——呼吸抬肩、头微微转动与点头、发梢与衣摆随风摆、
// 指针靠近时头朝它偏一点。全部是很小的位移（384 像素高的图上最多两三个像素），底图本身一个像素都不改。
// 公式与离线预览（tools/portraits/ 的 live_rig.py 配套脚本）保持一致；纯函数，不读时钟、不碰 DOM，便于测试。

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export interface LiveMotion {
  /** 呼吸：胸口以上上抬的量（底图像素，≥ 0） */
  lift: number;
  /** 头绕颈根转动的弧度（正值：头顶朝右） */
  rot: number;
  /** 头的上下平移（底图像素，正值向下） */
  nod: number;
  /** 头的左右平移（底图像素，正值向右） */
  shift: number;
  /** 摆动的两组波：幅度（底图像素）与相位（弧度，已取模） */
  sway1: number;
  phase1: number;
  sway2: number;
  phase2: number;
  /** 转头的伪立体：五官在脸里的位移（底图像素） */
  turnX: number;
  turnY: number;
}

/** 各项运动的周期（秒）。互不成整数比，合起来看不出循环。 */
export const LIVE_PERIODS = { breath: 4.2, head: 7.3, headFine: 3.1, nod: 5.3, gust: 11, sway1: 3.4, sway2: 1.9 } as const;

/**
 * 各项幅度（相对底图高度的比例，或角度）。
 * 2026-11-11 收小：头部区域的支点在胸口一线，原来转 1–2 度时这条线上下被剪开错位，
 * 随风摆又是一道沿身体往下爬的波，边缘像在扭。现在只留呼吸、极轻的转头与点头、整片的轻摆；
 * 384 像素的头像上，最坏情况（指针压在一边）的位移从约 8.6 像素降到约 3 像素。旧值写在行尾。
 */
export const LIVE_AMPS = {
  lift: 0.0045, // 0.0062
  rot: 0.18 * DEG, // 0.55°
  rotFine: 0.06 * DEG, // 0.22°
  rotPointer: 0.35 * DEG, // 1.1°
  nod: 0.0008, // 0.0016
  nodPointer: 0.0015, // 0.004
  shiftPointer: 0.0015, // 0.004
  sway1: 0.0022, // 0.0048
  sway2: 0.0005, // 0.0018
  turnX: 0.0015, // 0.006
  turnY: 0.001, // 0.004
} as const;

const wrap = (x: number) => x - Math.floor(x / TAU) * TAU;

/**
 * 时刻 t（秒）的运动量。px、py 是指针相对头像的方向（各在 −1…1，没有指针时为 0），h 是底图高度（像素）。
 * gain（0…1）整体缩放：页面刚出现时从 0 缓缓放到 1，避免第一帧就跳一下。
 */
export function liveMotion(t: number, px: number, py: number, h: number, gain = 1): LiveMotion {
  const P = LIVE_PERIODS;
  const A = LIVE_AMPS;
  const breath = 0.5 - 0.5 * Math.cos((TAU * t) / P.breath);
  const gust = 0.62 + 0.38 * Math.sin((TAU * t) / P.gust + 0.4);
  return {
    lift: gain * A.lift * h * breath,
    rot: gain * (A.rot * Math.sin((TAU * t) / P.head) + A.rotFine * Math.sin((TAU * t) / P.headFine + 1.3) + A.rotPointer * px),
    nod: gain * (A.nod * h * Math.sin((TAU * t) / P.nod + 0.7) + A.nodPointer * h * py),
    shift: gain * A.shiftPointer * h * px,
    sway1: gain * A.sway1 * h * gust,
    phase1: wrap((TAU * t) / P.sway1),
    sway2: gain * A.sway2 * h,
    phase2: wrap((TAU * t) / P.sway2 + 1.1),
    turnX: gain * A.turnX * h * px,
    turnY: gain * A.turnY * h * py,
  };
}

/** 任何一处位移的上界（底图像素）：用来确认形变始终很小。 */
export function liveMotionBound(h: number, reach: number): number {
  const A = LIVE_AMPS;
  // 头部：转动（离颈根最远 reach 像素）+ 平移 + 伪立体；再加呼吸与摆动
  const head = (A.rot + A.rotFine + A.rotPointer) * reach + (A.nod + A.nodPointer + A.shiftPointer + A.turnX + A.turnY) * h;
  return head + A.lift * h + (A.sway1 + A.sway2) * h;
}

/** 指针的跟随：目标值与缓动后的当前值。没有鼠标（触屏）或鼠标久不动时回到正中。 */
export class PointerFollow {
  x = 0;
  y = 0;
  private tx = 0;
  private ty = 0;
  private idle = 0;

  /** 鼠标移到了视口坐标 (mx, my)；(cx, cy) 是头像中心，span 是归一化用的距离（像素）。 */
  aim(mx: number, my: number, cx: number, cy: number, span: number): void {
    let dx = (mx - cx) / Math.max(1, span);
    let dy = (my - cy) / Math.max(1, span);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.tx = dx;
    this.ty = dy;
    this.idle = 0;
  }

  /** 鼠标离开窗口。 */
  release(): void {
    this.tx = 0;
    this.ty = 0;
  }

  /** 过了 dt 秒：当前值朝目标缓动（时间常数约 0.22 秒）；鼠标 3 秒不动就慢慢回正。 */
  step(dt: number): void {
    this.idle += dt;
    if (this.idle > 3) {
      const back = Math.exp(-dt / 1.2);
      this.tx *= back;
      this.ty *= back;
    }
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.22);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
  }
}

/** 眨眼的缓动：amount 朝 target（闭眼 1、睁眼 0）靠拢，闭得快、睁得稍慢。 */
export function blinkStep(amount: number, closed: boolean, dt: number): number {
  const tau = closed ? 0.03 : 0.045;
  const next = amount + ((closed ? 1 : 0) - amount) * (1 - Math.exp(-Math.max(0, dt) / tau));
  return next < 0.004 ? 0 : next > 0.996 ? 1 : next;
}
