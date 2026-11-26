// 会动的场景的着色器：一块铺满画布的矩形 + 一段片元着色器。
// 对每个输出像素算“该去底图的哪里取样”——位移 = 各类运动（sceneMotion.ts 的同一套式子）× 权重图
// （<文件>-rig.webp，上下两半：上半 R 水面、G 随风动的、B 天空；下半 R 光源）；灯火与水面的碎光另乘一个明暗系数。
// 底图的像素一个不改；没有 WebGL、图片跨域取不到、上下文丢失时调用方照旧显示 <img>。
import { SCENE_DESIGN, SCENE_MOTION } from "./sceneMotion";

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const { water: W, wind: G, sky: S, light: L } = SCENE_MOTION;

const frag = (precision: string) => `
precision ${precision} float;
uniform sampler2D u_base;
uniform sampler2D u_rig;
uniform float u_t;
uniform float u_gain;
varying vec2 v_uv;
const float TAU = 6.2831853;
const vec2 SIZE = vec2(${f(SCENE_DESIGN.w)}, ${f(SCENE_DESIGN.h)});
void main() {
  vec2 p = v_uv * SIZE;
  // 权重图上下两半各取一次；离中缝留半个像素，免得两半互相渗
  vec3 w = texture2D(u_rig, vec2(v_uv.x, clamp(v_uv.y * 0.5, 0.0, 0.4985))).rgb;
  float light = texture2D(u_rig, vec2(v_uv.x, clamp(0.5 + v_uv.y * 0.5, 0.5015, 1.0))).r;
  float wx = w.r * (${f(W.amp1)} * sin(TAU * (p.y / ${f(W.len1)} + u_t / ${f(W.period1)}) + ${f(W.bend)} * sin(TAU * p.x / ${f(W.bendLen)}))
    + ${f(W.amp2)} * sin(TAU * (p.y / ${f(W.len2)} - u_t / ${f(W.period2)}) + p.x * 0.11));
  float wy = w.r * ${f(W.lift)} * sin(TAU * (p.x / ${f(W.liftLen)} + u_t / ${f(W.liftPeriod)}));
  float gx = w.g * (${f(G.amp1)} * sin(TAU * u_t / ${f(G.period1)} + p.x / ${f(G.lenX)} + p.y / ${f(G.lenY)})
    + ${f(G.amp2)} * sin(TAU * u_t / ${f(G.period2)} + p.y / ${f(G.len2)}));
  float gy = w.g * ${f(G.lift)} * sin(TAU * u_t / ${f(G.liftPeriod)} + p.x / ${f(G.liftLen)});
  float sx = w.b * ${f(S.amp)} * sin(TAU * u_t / ${f(S.period)} + p.y / ${f(S.len)});
  vec2 src = (p - u_gain * vec2(wx + gx + sx, wy + gy)) / SIZE;
  vec3 c = texture2D(u_base, src).rgb;
  // 灯火：每个小块有自己的相位
  vec2 cell = floor(p / ${f(L.cell)});
  float ph = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * TAU;
  float gain = light * (${f(L.amp1)} * sin(TAU * u_t / ${f(L.period1)} + ph) + ${f(L.amp2)} * sin(TAU * u_t / ${f(L.period2)} + ph * 1.7));
  // 水面的碎光：亮处随时间一明一暗
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float glint = w.r * clamp((luma - 0.59) / 0.235, 0.0, 1.0) * ${f(W.glint)} * sin(TAU * (u_t / ${f(W.glintPeriod)} + p.x / 9.0 + p.y / 4.0));
  gl_FragColor = vec4(c * (1.0 + u_gain * (gain + glint)), 1.0);
}`;

/** 片元着色器的源码（测试用：核对里面的数与 sceneMotion.ts 是同一套）。 */
export function sceneFragmentSource(precision: "highp" | "mediump" = "highp"): string {
  return frag(precision);
}

export interface SceneWarp {
  /** 画一帧：t 是秒（已取模到一个循环里），gain 是淡入的程度（0–1）。 */
  draw(t: number, gain: number): void;
  /** 释放显卡资源，并主动放弃上下文。 */
  dispose(): void;
}

/** 同时开着的场景画布不超过这个数（浏览器对 WebGL 上下文有总数限制；头像另算）。 */
export const MAX_SCENE_WARPS = 4;
let active = 0;

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

function texture(gl: WebGLRenderingContext, unit: number, source: TexImageSource): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // 图片不是 2 的幂：只能夹边、不做多级纹理
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

/**
 * 在 canvas 上建立场景的着色器。任何一步失败（没有 WebGL、着色器编译不过、图片跨域被拒、名额用完）都返回 null，
 * 调用方照旧显示 <img>。
 */
export function createSceneWarp(canvas: HTMLCanvasElement, src: { base: TexImageSource; rig: TexImageSource }): SceneWarp | null {
  if (active >= MAX_SCENE_WARPS) return null;
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
    textures = [texture(g, 0, src.base), texture(g, 1, src.rig)];
  } catch {
    lose();
    return null;
  }
  if (textures.some((t) => !t)) {
    lose();
    return null;
  }
  g.uniform1i(g.getUniformLocation(prog, "u_base"), 0);
  g.uniform1i(g.getUniformLocation(prog, "u_rig"), 1);
  const uT = g.getUniformLocation(prog, "u_t");
  const uGain = g.getUniformLocation(prog, "u_gain");
  active += 1;
  let alive = true;
  return {
    draw(t, gain) {
      if (!alive || g.isContextLost()) return;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.uniform1f(uT, t);
      g.uniform1f(uGain, gain);
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

/** 测试用：现在开着几块场景画布。 */
export function activeSceneWarps(): number {
  return active;
}
