// H10iF2 航行画面的镜头前视（纯计算）。
//
// X06：镜头原来沿“画出来的船头”前视 15% 屏宽、时间常数 0.25 秒，船头一变整张海图跟着平移 100–150 像素，
// 把船头的细颤和每一次正常转向都放大成整屏的晃。现在前视的方向取船头的慢平均（按真实时间，时间常数 LOOK_DIR_TAU_MS），
// 镜头朝前视点挪的速度再设上限 CAMERA_MAX_PX_PER_S：船头转 30° 时海图在两三秒里缓缓挪过去。
// 船真的停了才回到船上（H10iF3 起也限速；暂停、等后端结算不算停，由调用方给 look）；头一帧、读档 / 瞬移（snap）当场到位。
import { headingVector } from "../components/nav/navKit";

/** 前视方向的慢平均的时间常数（真实毫秒）。 */
export const LOOK_DIR_TAU_MS = 1800;
/** 走着时镜头平移的速度上限（屏幕像素 / 秒）。 */
export const CAMERA_MAX_PX_PER_S = 90;
/** 镜头朝目标缓动的时间常数（毫秒；再受 CAMERA_MAX_PX_PER_S 限速）。 */
export const CAMERA_TAU_MS = 250;

export interface LookState {
  /** 前视方向的慢平均（单位向量的平均，转弯时长度会短一点） */
  dir: { x: number; y: number };
  /** 镜头相对船的偏移（屏幕像素） */
  off: { x: number; y: number };
}

/**
 * 推进一帧。look：前视的距离（像素；停着、暂停时为 0）；maxY：纵向前视的上限（像素）；dtMs：两帧的实际间隔；
 * snap：头一帧、读档或瞬移，当场到位。
 */
export function stepLook(prev: LookState | null, heading: number, look: number, maxY: number, dtMs: number, snap = false): LookState {
  const hv = headingVector(heading);
  const dt = Math.max(0, Math.min(1000, dtMs));
  let dir: LookState["dir"];
  if (!prev || snap) dir = { x: hv.x, y: hv.y };
  else {
    const k = 1 - Math.exp(-dt / LOOK_DIR_TAU_MS);
    dir = { x: prev.dir.x + (hv.x - prev.dir.x) * k, y: prev.dir.y + (hv.y - prev.dir.y) * k };
    // 差到屏上不足半个像素就算跟上了（指数缓动的尾巴很长，不然要十几秒才“停稳”、一直按满帧重画）
    if (Math.hypot(hv.x - dir.x, hv.y - dir.y) * Math.max(look, 1) < 0.5) dir = { x: hv.x, y: hv.y };
  }
  const tx = dir.x * look;
  const ty = Math.max(-maxY, Math.min(maxY, dir.y * look));
  if (!prev || snap) return { dir, off: { x: tx, y: ty } };
  const k = 1 - Math.exp(-dt / CAMERA_TAU_MS);
  let mx = (tx - prev.off.x) * k;
  let my = (ty - prev.off.y) * k;
  // 任何时候都限速（H10iF3：回到船上也不例外，X07 量到回正时每秒 400–790 像素）
  const cap = (CAMERA_MAX_PX_PER_S * dt) / 1000;
  const len = Math.hypot(mx, my);
  if (len > cap && len > 0) {
    mx *= cap / len;
    my *= cap / len;
  }
  const off = { x: prev.off.x + mx, y: prev.off.y + my };
  if (Math.abs(tx - off.x) <= 0.3 && Math.abs(ty - off.y) <= 0.3) return { dir, off: { x: tx, y: ty } };
  return { dir, off };
}

/** 镜头停稳了没有：前视方向已跟上船头、偏移离目标不到 0.3 像素（没停稳时要接着画下一帧）。 */
export function lookSettled(s: LookState, heading: number, look: number, maxY: number): boolean {
  const hv = headingVector(heading);
  const tx = hv.x * look;
  const ty = Math.max(-maxY, Math.min(maxY, hv.y * look));
  return Math.abs(tx - s.off.x) <= 0.3 && Math.abs(ty - s.off.y) <= 0.3;
}
