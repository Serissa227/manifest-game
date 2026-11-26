// 新手教程的向导：会动的像素小乌鸦。
// 帧在 GUIDE_CROW_ART 的条带里（待机、眨眼、说话、扬翅、歪头），由 tools/portraits/build.py 逐帧对齐生成。
// - 待机：不规则地眨眼（与会动的头像同一套时序），闲着时偶尔歪一歪头；身体随呼吸轻轻起伏（CSS）。
// - cue 变化时（教程换了一步）：蹦一下，张嘴“说”一阵（说话帧与待机帧交替），最后扬一扬翅膀。
// - enter="fly" 时，第一次出现是从右上方飞进来、落地时压一下。
// - facing：原图朝右，朝左时水平翻转（教程里它转向被圈出的地方）。
// 页面不可见时暂停一切计时与动画；系统设置“减少动态效果”时只显示静止的待机帧。纯装饰（有 label 时作为图片读出）。
// 这些动画用 Math.random 决定间隔（不进内核、不影响任何确定性的结果）。
import { portraitFile } from "../../art/imageUrl";
import { useEffect, useState, type CSSProperties } from "react";
import { GUIDE_CROW_ART } from "../../art/portraitAssets";
import { useBlink, usePageHidden, usePrefersReducedMotion } from "../portrait/motion";
import { TALK_BEATS, TALK_BEAT_MS, TILT_GAP_MS, TILT_MS, WING_MS, frameIndex, type GuideCrowFrame } from "./guideCrowFrames";

export function GuideCrow({
  height = 64,
  cue,
  facing = "right",
  enter,
  label,
  className,
  testId = "guide-crow",
}: {
  /** 显示高度（CSS 像素）；宽度按原图比例 */
  height?: number;
  /** 变化时蹦一下、说一阵话（教程的步骤号……） */
  cue?: number | string;
  facing?: "left" | "right";
  /** fly：第一次出现时飞进来 */
  enter?: "fly";
  label?: string;
  className?: string;
  testId?: string;
}) {
  const still = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const live = !still && !hidden;
  const blink = useBlink(live);
  // 一段动作里的帧（说话、扬翅、歪头）；null 表示待机
  const [pose, setPose] = useState<GuideCrowFrame | null>(null);
  // 蹦一下：计数作 key，重播 CSS 动画
  const [hop, setHop] = useState(0);

  // cue 变化：蹦一下、说一阵话、最后扬一下翅膀
  useEffect(() => {
    if (!live || cue === undefined) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    setHop((h) => h + 1);
    for (let i = 0; i < TALK_BEATS; i++) at(120 + i * TALK_BEAT_MS, () => setPose(i % 2 === 0 ? "caw" : null));
    const end = 120 + TALK_BEATS * TALK_BEAT_MS;
    at(end, () => setPose("wing"));
    at(end + WING_MS, () => setPose(null));
    return () => {
      timers.forEach(clearTimeout);
      setPose(null);
    };
  }, [cue, live]);

  // 闲着时偶尔歪头（正在说话或扬翅时不打断）
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      const [a, b] = TILT_GAP_MS;
      timer = setTimeout(() => {
        setPose((p) => p ?? "tilt");
        timer = setTimeout(() => {
          setPose((p) => (p === "tilt" ? null : p));
          next();
        }, TILT_MS);
      }, a + Math.random() * (b - a));
    };
    next();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live]);

  const frame: GuideCrowFrame = live ? (pose ?? (blink ? "blink" : "idle")) : "idle";
  const n = GUIDE_CROW_ART.frames.length;
  const width = Math.round((height * GUIDE_CROW_ART.width) / GUIDE_CROW_ART.height);
  // 显示得比 1 倍图大、或高分屏时用 2 倍图
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
  const big = height > GUIDE_CROW_ART.height || dpr > 1.25;
  const src = portraitFile(big ? GUIDE_CROW_ART.file2x : GUIDE_CROW_ART.file);
  const cls = [
    "guide-crow",
    enter === "fly" ? "is-flying-in" : "",
    still ? "is-still" : "",
    hidden ? "is-paused" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const a11y = { role: label ? "img" : undefined, "aria-label": label, "aria-hidden": label ? undefined : true } as const;
  const img: CSSProperties = {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${width * n}px ${height}px`,
    backgroundPosition: `${-frameIndex(frame) * width}px 0`,
  };
  return (
    <div className={cls} style={{ width, height }} data-testid={testId} data-frame={frame} data-facing={facing} {...a11y}>
      <div key={hop} className={hop > 0 ? "guide-crow-body is-hopping" : "guide-crow-body"}>
        <div className={facing === "left" ? "guide-crow-flip is-left" : "guide-crow-flip"}>
          <div className="guide-crow-img" style={img} />
        </div>
      </div>
    </div>
  );
}
