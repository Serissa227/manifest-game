// 场景大图（活动场景、养成回忆、港口、传说之船、秘境、生物、历史事件的插画）。
//
// 有权重图（art/sceneLive.ts 的清单，tools/scenes/redraw.py 生成）的图，在新界面里会“动起来”：
// 水面起细浪、亮处的碎光一明一暗，云极慢地挪，树冠、旗帜、帆与篷布随风轻摆，灯火与亮着的窗明灭。
// 做法是在一块画布上用着色器按权重图逐帧取样（sceneWarp.ts），底图的像素一个不改；画布与 <img> 用同一个 class，
// 排版与边框完全一样，画好第一帧后才换上去。
// 经典像素界面、系统设置“减少动态效果”、没有 WebGL、没有权重图、同屏太多、上下文丢失时，就是原来那张 <img>。
// 页面不可见、或画面滚出视野时暂停。
import { useEffect, useRef, useState } from "react";
import { useIsV2 } from "../../ui/uiMode";
import { warpSupported } from "../portrait/liveWarp";
import { usePageHidden, usePrefersReducedMotion } from "../portrait/motion";
import { hasSceneRig, sceneRigSrc } from "./sceneKit";
import { sceneClock } from "./sceneMotion";
import { createSceneWarp, type SceneWarp } from "./sceneWarp";

/** 帧间隔下限（毫秒）：约 30 帧。 */
const FRAME_MS = 30;
/** 画布接管后，动作从 0 淡入到全幅的时间（秒）。 */
const FADE_IN = 1.2;

export interface SceneImgProps {
  /** 图片地址 */
  src: string;
  /** public/scenes/ 下的文件名主干（不带 .webp）；给了、且有权重图才会动 */
  file?: string | null;
  className: string;
  testId?: string;
  /** 原样带到 <img> 上的 data-variant（LoreImage 用） */
  variant?: string;
  /** 懒加载（缺省是） */
  lazy?: boolean;
}

export function SceneImg({ src, file, className, testId, variant, lazy = true }: SceneImgProps) {
  const v2 = useIsV2();
  const still = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  const want = v2 && !still && hasSceneRig(file) && gaveUp !== file && warpSupported();
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  const paused = useRef(hidden);
  paused.current = hidden;

  useEffect(() => {
    setOn(false);
    const base = img.current;
    const cv = canvas.current;
    if (!want || !file || !base || !cv) return;
    let warp: SceneWarp | null = null;
    let raf = 0;
    let dead = false;
    let visible = true;
    let last = 0;
    let t = 0;
    let gain = 0;
    const rig = new Image();
    rig.crossOrigin = "anonymous";
    rig.decoding = "async";
    const loaded = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0;
    const giveUp = () => {
      if (dead) return;
      cancelAnimationFrame(raf);
      warp?.dispose();
      warp = null;
      setOn(false);
      setGaveUp(file);
    };
    const frame = (now: number) => {
      if (dead || !warp) return;
      raf = requestAnimationFrame(frame);
      if (paused.current || !visible) {
        last = 0;
        return;
      }
      if (last && now - last < FRAME_MS) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      gain = Math.min(1, gain + dt / FADE_IN);
      warp.draw(sceneClock(t), gain);
    };
    const start = () => {
      if (dead || warp || !loaded(base) || !loaded(rig)) return;
      cv.width = base.naturalWidth;
      cv.height = base.naturalHeight;
      warp = createSceneWarp(cv, { base, rig });
      if (!warp) {
        giveUp();
        return;
      }
      // 先画好一帧（此时与底图一模一样）再让画布露出来，免得闪一下空白
      warp.draw(0, 0);
      setOn(true);
      raf = requestAnimationFrame(frame);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      giveUp();
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const e of entries) visible = e.isIntersecting;
          })
        : null;
    io?.observe(cv);
    cv.addEventListener("webglcontextlost", onLost);
    base.addEventListener("load", start);
    rig.addEventListener("load", start);
    rig.addEventListener("error", giveUp);
    rig.src = sceneRigSrc(file);
    start();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      cv.removeEventListener("webglcontextlost", onLost);
      base.removeEventListener("load", start);
      rig.removeEventListener("load", start);
      rig.removeEventListener("error", giveUp);
      warp?.dispose();
    };
  }, [want, file, src]);

  return (
    <>
      <img
        ref={img}
        className={className}
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        loading={lazy ? "lazy" : undefined}
        draggable={false}
        crossOrigin={want ? "anonymous" : undefined}
        style={on ? { display: "none" } : undefined}
        data-testid={testId}
        data-variant={variant}
        data-live={want ? (on ? "on" : "wait") : undefined}
      />
      {want && <canvas ref={canvas} className={`${className} scene-live`} aria-hidden style={on ? undefined : { display: "none" }} data-scene-live={file ?? undefined} />}
    </>
  );
}
