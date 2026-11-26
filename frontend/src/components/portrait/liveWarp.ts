// 会动的头像的网格形变：一块铺满画布的矩形 + 一段片元着色器。
// 着色器对每个输出像素算“该去底图的哪里取样”——位移 = 运动量（liveMotion.ts）× 形变权重图（R 摆动、G 头部、B 呼吸）；
// 眨眼补丁也在着色器里按同一份位移贴上去，所以头在动的时候眼睛不会错位。
// 只在新界面里用；浏览器没有 WebGL、图片跨域取不到、上下文丢失时，调用方回退到原来的做法（<img> + CSS）。
import type { LiveArt } from "../../art/portraitAssets";
import type { LiveMotion } from "./liveMotion";

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const frag = (precision: string) => `
precision ${precision} float;
uniform sampler2D u_base;
uniform sampler2D u_rig;
uniform sampler2D u_blink;
uniform vec2 u_size;
uniform vec4 u_rect;
uniform float u_blinkAmt;
uniform vec3 u_face;
uniform vec2 u_neck;
uniform float u_lift;
uniform float u_rot;
uniform vec2 u_head;
uniform vec4 u_sway;
uniform vec2 u_turn;
varying vec2 v_uv;
const float TAU = 6.2831853;
void main() {
  vec2 p = v_uv * u_size;
  vec3 w = texture2D(u_rig, v_uv).rgb;
  // 波长拉长到比画面还高：发梢、缎带、衣摆整片同向轻摆，不再有一道波沿着身体往下爬（旧值 0.55 / 1.7 / 0.23）
  float sway = w.r * (
    u_sway.x * sin(u_sway.y - p.y * TAU / (1.6 * u_size.y) + p.x * TAU / (4.0 * u_size.x)) +
    u_sway.z * sin(u_sway.w - p.y * TAU / (0.8 * u_size.y)));
  float d = distance(p, u_face.xy) / max(1.0, u_face.z);
  float feat = clamp(1.0 - d * d, 0.0, 1.0);
  float theta = w.g * u_rot;
  vec2 q = p - u_neck;
  vec2 src = vec2(
    p.x + theta * q.y - sway - w.g * u_head.x - feat * u_turn.x,
    p.y - theta * q.x + w.b * u_lift - w.g * u_head.y - feat * u_turn.y);
  vec4 c = texture2D(u_base, src / u_size);
  if (u_blinkAmt > 0.0) {
    vec2 b = (src - u_rect.xy) / u_rect.zw;
    if (b.x >= 0.0 && b.x <= 1.0 && b.y >= 0.0 && b.y <= 1.0) {
      vec4 k = texture2D(u_blink, b);
      c.rgb = c.rgb * (1.0 - k.a * u_blinkAmt) + k.rgb * u_blinkAmt;
    }
  }
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

export interface WarpSources {
  base: TexImageSource;
  rig: TexImageSource;
  blink: TexImageSource;
}

export interface Warp {
  /** 画一帧：m 是这一刻的运动量，blink 是闭眼的程度（0–1）。 */
  draw(m: LiveMotion, blink: number): void;
  /** 释放显卡资源（纹理、程序），并主动放弃上下文。 */
  dispose(): void;
}

/** 同时开着的形变画布不超过这个数（浏览器对 WebGL 上下文有总数限制，多出来的头像回退到 CSS）。 */
export const MAX_WARPS = 6;
let active = 0;

/** 浏览器能不能做形变（有 WebGL）。结果缓存；jsdom 等环境里是 false。 */
let supported: boolean | null = null;
export function warpSupported(): boolean {
  if (supported !== null) return supported;
  supported = false;
  try {
    if (typeof document === "undefined") return false;
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl");
    supported = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function texture(gl: WebGLRenderingContext, unit: number, source: TexImageSource, premultiply: boolean): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // 图片不是 2 的幂：只能夹边、不做多级纹理
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

/**
 * 图片比画布大很多（超过 1.5 倍）时，先在 2D 画布上高质量缩到 w×h 再进显卡。
 * WebGL 1 的非 2 的幂纹理不能做多级纹理，直接线性取样缩小一半以上会起锯齿、动起来闪烁；
 * 2026-11-12 A02 起专属头像是 768、立绘 960×1440，小头像位上缩得很多。着色器按底图坐标取样，纹理分辨率换了不影响位置。
 * 取不到 2D 上下文（测试环境）时原样返回。
 */
function fitSource(source: TexImageSource, w: number, h: number): TexImageSource {
  const sw = "naturalWidth" in source ? source.naturalWidth : "width" in source ? Number(source.width) : 0;
  const sh = "naturalHeight" in source ? source.naturalHeight : "height" in source ? Number(source.height) : 0;
  if (!sw || !sh || w < 1 || h < 1 || sw <= w * 1.5) return source;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (!ctx) return source;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, c.width, c.height);
  return c;
}

/**
 * 在 canvas 上建立形变。任何一步失败（没有 WebGL、着色器编译不过、图片跨域被拒、名额用完）都返回 null，
 * 调用方照旧显示 <img>。
 */
export function createWarp(canvas: HTMLCanvasElement, src: WarpSources, art: LiveArt): Warp | null {
  const rig = art.rig;
  if (!rig || active >= MAX_WARPS) return null;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const g = gl;
  const lose = () => g.getExtension("WEBGL_lose_context")?.loseContext();
  const high = (g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT)?.precision ?? 0) > 0;
  const vs = compile(g, g.VERTEX_SHADER, VERT);
  const fs = compile(g, g.FRAGMENT_SHADER, frag(high ? "highp" : "mediump"));
  const prog = g.createProgram();
  if (!vs || !fs || !prog) {
    lose();
    return null;
  }
  g.attachShader(prog, vs);
  g.attachShader(prog, fs);
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
    lose();
    return null;
  }
  g.useProgram(prog);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, "a_pos");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

  let textures: (WebGLTexture | null)[];
  try {
    // 跨域取来、又没有 CORS 许可的图片在这里抛 SecurityError
    const k = canvas.width / Math.max(1, art.width);
    const base = fitSource(src.base, canvas.width, canvas.height);
    const blink = fitSource(src.blink, art.blink.w * k, art.blink.h * k);
    textures = [texture(g, 0, base, false), texture(g, 1, src.rig, false), texture(g, 2, blink, true)];
  } catch {
    lose();
    return null;
  }
  if (textures.some((t) => !t)) {
    lose();
    return null;
  }
  const u = (name: string) => g.getUniformLocation(prog, name);
  g.uniform1i(u("u_base"), 0);
  g.uniform1i(u("u_rig"), 1);
  g.uniform1i(u("u_blink"), 2);
  g.uniform2f(u("u_size"), art.width, art.height);
  g.uniform4f(u("u_rect"), art.blink.x, art.blink.y, art.blink.w, art.blink.h);
  g.uniform3f(u("u_face"), rig.face[0], rig.face[1], rig.face[2]);
  g.uniform2f(u("u_neck"), rig.neck[0], rig.neck[1]);
  const uBlink = u("u_blinkAmt");
  const uLift = u("u_lift");
  const uRot = u("u_rot");
  const uHead = u("u_head");
  const uSway = u("u_sway");
  const uTurn = u("u_turn");
  active += 1;
  let alive = true;
  return {
    draw(m, blink) {
      if (!alive || g.isContextLost()) return;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.uniform1f(uBlink, blink);
      g.uniform1f(uLift, m.lift);
      g.uniform1f(uRot, m.rot);
      g.uniform2f(uHead, m.shift, m.nod);
      g.uniform4f(uSway, m.sway1, m.phase1, m.sway2, m.phase2);
      g.uniform2f(uTurn, m.turnX, m.turnY);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      if (!alive) return;
      alive = false;
      active = Math.max(0, active - 1);
      for (const t of textures) g.deleteTexture(t);
      g.deleteBuffer(buf);
      g.deleteProgram(prog);
      g.deleteShader(vs);
      g.deleteShader(fs);
      lose();
    },
  };
}

/** 测试用：现在开着几块形变画布。 */
export function activeWarps(): number {
  return active;
}
