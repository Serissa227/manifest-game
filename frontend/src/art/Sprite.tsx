// 在界面中显示像素图：静态的 <Sprite>，以及按帧重绘、按整数倍缩放铺满容器的 <PixelStage>。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Px } from "./px";
import { paint } from "./render";
import { useFrames } from "./useFrames";

/** 静态像素图。有 label 时作为图片暴露给辅助技术，否则对辅助技术隐藏。 */
export function Sprite({
  px,
  scale = 2,
  label,
  className,
  style,
}: {
  px: Px;
  scale?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paint(ref.current, px);
  }, [px]);
  return (
    <canvas
      ref={ref}
      width={px.w}
      height={px.h}
      className={className ? `sprite ${className}` : "sprite"}
      style={{ width: px.w * scale, height: px.h * scale, ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export interface StageLayout {
  /** 整数放大倍数 */
  scale: number;
  /** 逻辑宽度（像素）：高度固定时随容器变宽 */
  width: number;
  height: number;
}

/**
 * 铺满父容器的像素舞台：逻辑高度固定为 height，按容器高度选整数倍 scale（至少 minScale），
 * 逻辑宽度 = ceil(容器宽 / scale)（不小于 minWidth），画面居中、多余部分裁掉。
 * fill 为 true 时逻辑高度随容器增高（≥ height），多出来的高度由 draw 负责画满（例如向上延伸天空），不留空带。
 * draw(frame, layout) 返回这一帧的整张图；children(layout) 可叠加按逻辑坐标 × scale 定位的 DOM（如可点击的热点）。
 */
export function PixelStage({
  height,
  minWidth = 1,
  minScale = 1,
  fps = 10,
  animate = true,
  fill = false,
  draw,
  children,
  className,
  label,
}: {
  height: number;
  fill?: boolean;
  minWidth?: number;
  minScale?: number;
  fps?: number;
  animate?: boolean;
  draw: (frame: number, layout: StageLayout) => Px;
  children?: (layout: StageLayout) => ReactNode;
  className?: string;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<StageLayout>({ scale: minScale, width: minWidth, height });
  const frame = useRef(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W <= 0 || H <= 0) return;
      const scale = Math.max(minScale, Math.floor(H / height));
      const width = Math.max(minWidth, Math.ceil(W / scale));
      const h = fill ? Math.max(height, Math.ceil(H / scale)) : height;
      setLayout((l) => (l.scale === scale && l.width === width && l.height === h ? l : { scale, width, height: h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height, minWidth, minScale, fill]);

  const redraw = (f: number) => {
    if (canvas.current) paint(canvas.current, draw(f, layout));
  };
  useEffect(() => {
    redraw(frame.current);
    // 布局或画法变化时立即重画一帧
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, draw]);
  useFrames(
    fps,
    (f) => {
      frame.current = f;
      redraw(f);
    },
    animate,
  );

  const w = layout.width * layout.scale;
  const h = layout.height * layout.scale;
  return (
    <div ref={host} className={className ? `pixel-stage ${className}` : "pixel-stage"}>
      <div className="pixel-stage-inner" style={{ width: w, height: h }}>
        <canvas
          ref={canvas}
          width={layout.width}
          height={layout.height}
          style={{ width: w, height: h }}
          role={label ? "img" : undefined}
          aria-label={label}
          aria-hidden={label ? undefined : true}
        />
        {children?.(layout)}
      </div>
    </div>
  );
}
