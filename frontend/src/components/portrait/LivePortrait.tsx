// 会动的头像。
//
// LiveFigure 是通用的一层：一张底图 + 眨眼补丁，带骨架（LiveArt.rig）的在新界面里另做网格形变。
// - 眨眼：按不规则间隔把闭眼补丁盖在眼睛上 100–140 ms，偶尔连眨两下（补丁由 tools/portraits/build.py 从睁眼图与闭眼图的差异算出）；
// - 呼吸：没有骨架时以画面底边为轴极轻地伸缩，头顶的起伏不超过 2 像素，一个来回约 4 秒；
// - 有骨架时（新界面、浏览器有 WebGL）：改由一块画布按形变权重图画——胸口以上随呼吸抬一点、头微微转动与点头、
//   发梢与衣摆随风轻摆、鼠标靠近时头朝它偏一点（liveMotion.ts、liveWarp.ts）。背景不动，底图的像素一个不改。
//   画布建不起来（没有 WebGL、图片跨域被拒、上下文丢失、同屏太多）就照旧用 <img> 与 CSS。
// - 眼镜：偶尔有一道反光斜着扫过两片镜片。
// 页面不可见时暂停一切计时与动画；系统设置“减少动态效果”时只显示静止的一帧。
// 图片加载失败时回退到手画的像素版。
//
// 寰宇九位主角的专属头像会动（PortraitArt 的 live）：用的是 LiveFigure。
import { portraitFile } from "../../art/imageUrl";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { LiveArt } from "../../art/portraitAssets";
import type { Px } from "../../art/px";
import { Sprite } from "../../art/Sprite";
import { useIsV2 } from "../../ui/uiMode";
import { blinkStep, liveMotion, PointerFollow } from "./liveMotion";
import { createWarp, warpSupported, type Warp } from "./liveWarp";
import { useBlink, useGlint, usePageHidden, usePrefersReducedMotion } from "./motion";

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** 形变画布的帧间隔下限（毫秒）：约 30 帧。 */
const FRAME_MS = 30;

/**
 * 网格形变：art 带骨架、条件允许时，在 canvas 上逐帧画；返回画布是否已经接管了画面。
 * 用到的 <img>（底图、眨眼补丁）由调用方渲染并传进来，画布直接拿它们作纹理，不另下一份。
 */
function useWarp(
  art: LiveArt,
  want: boolean,
  closed: boolean,
  paused: boolean,
  els: { root: RefObject<HTMLDivElement | null>; canvas: RefObject<HTMLCanvasElement | null>; base: RefObject<HTMLImageElement | null>; blink: RefObject<HTMLImageElement | null> },
  onGiveUp: () => void,
): boolean {
  const [on, setOn] = useState(false);
  const closedRef = useRef(closed);
  const pausedRef = useRef(paused);
  closedRef.current = closed;
  pausedRef.current = paused;
  const giveUp = useRef(onGiveUp);
  giveUp.current = onGiveUp;
  const { root, canvas, base, blink } = els;

  useEffect(() => {
    const rig = art.rig;
    const cv = canvas.current;
    const baseImg = base.current;
    const blinkImg = blink.current;
    const host = root.current;
    if (!want || !rig || !cv || !baseImg || !blinkImg || !host) return;
    let warp: Warp | null = null;
    let raf = 0;
    let dead = false;
    let visible = true;
    let last = 0;
    let t = 0;
    let gain = 0;
    let amount = 0;
    let mouse: { x: number; y: number } | null = null;
    const follow = new PointerFollow();
    const rigImg = new Image();
    rigImg.crossOrigin = "anonymous";
    rigImg.decoding = "async";
    const loaded = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0;

    const frame = (now: number) => {
      if (dead || !warp) return;
      raf = requestAnimationFrame(frame);
      if (pausedRef.current || !visible) {
        last = 0;
        return;
      }
      if (last && now - last < FRAME_MS) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      gain = Math.min(1, gain + dt / 0.8);
      if (mouse) {
        const r = host.getBoundingClientRect();
        follow.aim(mouse.x, mouse.y, r.left + r.width / 2, r.top + r.height * 0.35, Math.max(window.innerWidth, window.innerHeight) * 0.4);
        mouse = null;
      }
      follow.step(dt);
      amount = blinkStep(amount, closedRef.current, dt);
      warp.draw(liveMotion(t, follow.x, follow.y, art.height, gain), amount);
    };
    const start = () => {
      if (dead || warp || !loaded(baseImg) || !loaded(blinkImg) || !loaded(rigImg)) return;
      warp = createWarp(cv, { base: baseImg, rig: rigImg, blink: blinkImg }, art);
      if (!warp) {
        giveUp.current();
        return;
      }
      // 先画好一帧再让画布露出来，免得闪一下空白
      warp.draw(liveMotion(0, 0, 0, art.height, 0), 0);
      setOn(true);
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") mouse = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      mouse = null;
      follow.release();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      giveUp.current();
    };
    const onRigError = () => giveUp.current();
    baseImg.addEventListener("load", start);
    blinkImg.addEventListener("load", start);
    rigImg.addEventListener("load", start);
    rigImg.addEventListener("error", onRigError);
    cv.addEventListener("webglcontextlost", onLost);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
          });
    io?.observe(host);
    rigImg.src = portraitFile(rig.file);
    start();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      baseImg.removeEventListener("load", start);
      blinkImg.removeEventListener("load", start);
      rigImg.removeEventListener("load", start);
      rigImg.removeEventListener("error", onRigError);
      cv.removeEventListener("webglcontextlost", onLost);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      io?.disconnect();
      warp?.dispose();
      setOn(false);
    };
  }, [want, art, root, canvas, base, blink]);

  return want && on;
}

export function LiveFigure({
  art,
  width,
  label,
  className,
  style,
  fallback,
  testId,
  asset,
  fill,
  children,
}: {
  art: LiveArt;
  /** 显示宽度（CSS 像素）；高度按原图比例 */
  width: number;
  /** 铺满外面的框（宽 100%，高按原图比例）：外框自己带边、衬纸与响应式尺寸时用，width 只用来定画布的分辨率 */
  fill?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** 图片加载失败时的像素版 */
  fallback: () => Px;
  testId?: string;
  /** 素材 id（写到 data-portrait 上，便于测试与排查） */
  asset?: string;
  /** 叠在画面上的东西；静止时不渲染 */
  children?: ReactNode;
}) {
  const height = Math.round((width * art.height) / art.width);
  const still = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const live = !still && !hidden;
  const closed = useBlink(live);
  const lenses = art.lenses ?? [];
  const glint = useGlint(live && lenses.length > 0);
  const [failed, setFailed] = useState(false);
  // 形变只在新界面做（经典像素的 DOM 保持原样）；建不起来就记下，不再尝试
  const v2 = useIsV2();
  const [gaveUp, setGaveUp] = useState(false);
  const wantWarp = !!art.rig && v2 && !still && !gaveUp && !failed && warpSupported();
  const root = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const base = useRef<HTMLImageElement | null>(null);
  const blink = useRef<HTMLImageElement | null>(null);
  const warping = useWarp(art, wantWarp, closed, hidden, { root, canvas, base, blink }, () => setGaveUp(true));

  const cls = ["live-portrait", still ? "is-still" : "", hidden ? "is-paused" : "", warping ? "is-warp" : "", className ?? ""].filter(Boolean).join(" ");
  const a11y = { role: label ? "img" : undefined, "aria-label": label, "aria-hidden": label ? undefined : true } as const;

  if (failed) {
    const px = fallback();
    return (
      <div className={`${cls} is-fallback`} style={{ width, ...style }} data-testid={testId} data-portrait={asset} {...a11y}>
        <Sprite px={px} scale={width / Math.max(1, px.w)} />
      </div>
    );
  }

  const W = art.width;
  const H = art.height;
  const b = art.blink;
  // 呼吸：头顶起伏不超过 2 像素（以底边为轴伸缩）
  const breath = 1 + Math.min(2, height * 0.008) / height;
  // 画布的后备分辨率：跟着屏幕的像素密度走，但不超过底图的两倍
  // 铺满外框时只定宽、高按比例跟：外框的高有时是 auto（靠 aspect-ratio 撑开），百分比的高在那里算不出来
  const box: CSSProperties = fill ? { width: "100%", aspectRatio: `${W} / ${H}` } : { width, height };
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.min(W * 2, Math.round(width * dpr)));
  const bh = Math.max(1, Math.round((bw * H) / W));
  // 画布要拿这两张图作纹理：跨域的图得带 CORS 许可才能进显卡，所以想做形变时按 anonymous 取；
  // 这样取被拒（资源域名没给许可）就放弃形变、改回普通取法再试一次，仍旧失败才算缺图
  const cors = wantWarp ? ("anonymous" as const) : undefined;
  const onBaseError = () => {
    if (wantWarp) setGaveUp(true);
    else setFailed(true);
  };
  return (
    <div
      ref={root}
      className={cls}
      style={{ ...box, "--lp-breath": breath, ...style } as CSSProperties}
      data-testid={testId}
      data-portrait={asset}
      data-blink={closed ? "closed" : "open"}
      data-warp={warping ? "on" : undefined}
      {...a11y}
    >
      <div className="lp-body">
        <img ref={base} className="lp-base" src={portraitFile(art.file)} alt="" draggable={false} decoding="async" crossOrigin={cors} onError={onBaseError} />
        <img
          ref={blink}
          className="lp-blink"
          src={portraitFile(b.file)}
          alt=""
          draggable={false}
          crossOrigin={cors}
          style={{ left: pct(b.x, W), top: pct(b.y, H), width: pct(b.w, W), height: pct(b.h, H), opacity: closed ? 1 : 0 }}
        />
        {wantWarp && <canvas ref={canvas} className="lp-canvas" width={bw} height={bh} aria-hidden="true" />}
        {lenses.map(([x, y, r], i) => (
          <span key={i} className="lp-lens" style={{ left: pct(x - r, W), top: pct(y - r, H), width: pct(2 * r, W), height: pct(2 * r, H) }}>
            {glint > 0 && <i key={glint} className="lp-glint" style={{ animationDelay: `${i * 110}ms` }} />}
          </span>
        ))}
      </div>
      {!still && children}
    </div>
  );
}
