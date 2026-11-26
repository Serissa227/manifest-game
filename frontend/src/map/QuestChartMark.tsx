// 世界海图上置顶任务的去处（R10-Q02）：盖在 PixiJS 画布上的一个小 DOM 标记——港口上一枚图钉；去处在画面外时，画面边缘一枚指向它的箭头。
// 位置每帧向渲染器问一次（renderer.cellToScreen，只读），变了才挪；没有去处、海图看不见时不画。样式在 styles/quests.css。
import { memo, useEffect, useRef } from "react";
import { tz } from "../i18n/zhOnly";
import type { MapRenderer } from "./renderer";
import { CHART_INSETS, markSpot, questMarkTarget } from "./questMark";

export default memo(QuestChartMark);

function QuestChartMark({ renderer, ready }: { renderer: { current: MapRenderer | null }; ready: boolean }) {
  const el = useRef<HTMLDivElement | null>(null);
  const label = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;
    let shown = "";
    let recheck = 0;
    let cover = 0;
    const tick = () => {
      const node = el.current;
      const host = node?.parentElement;
      const r = renderer.current;
      const target = questMarkTarget();
      // 没有去处、或海图整个看不见（港口街景、航行画面盖着）时不必每帧问：隔一会儿再看
      if (!node || !host || !r?.cellToScreen || !target || host.offsetParent === null) {
        if (shown !== "none" && node) {
          node.hidden = true;
          shown = "none";
        }
        idle = setTimeout(tick, 400);
        return;
      }
      raf = requestAnimationFrame(tick);
      // 右边被功能窗口盖住的宽度（外壳写在 --stage-cover-right 上）：隔一会儿量一次，箭头不躲到窗口底下
      if (--recheck <= 0) {
        recheck = 30;
        cover = parseFloat(getComputedStyle(host).getPropertyValue("--stage-cover-right")) || 0;
      }
      const p = r.cellToScreen(target.x + 0.5, target.y + 0.5);
      const s = markSpot(p.x, p.y, host.clientWidth, host.clientHeight, { ...CHART_INSETS, right: CHART_INSETS.right + cover });
      const key = `${Math.round(s.x)},${Math.round(s.y)},${s.inside ? 1 : 0},${s.angle.toFixed(2)},${target.name}`;
      if (key === shown) return;
      shown = key;
      node.hidden = false;
      node.className = s.inside ? "quest-chart-mark is-on" : "quest-chart-mark is-edge";
      node.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      node.style.setProperty("--angle", `${s.angle}rad`);
      node.setAttribute("aria-label", tz("quest.mark.label", { place: target.name }));
      // 边缘箭头的地名写在朝画面里的一侧
      node.dataset.side = Math.cos(s.angle) > 0.3 ? "left" : Math.cos(s.angle) < -0.3 ? "right" : Math.sin(s.angle) > 0 ? "up" : "down";
      if (label.current) label.current.textContent = target.name;
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      if (idle !== null) clearTimeout(idle);
    };
  }, [ready, renderer]);
  return (
    <div ref={el} className="quest-chart-mark" role="img" hidden data-testid="quest-chart-mark">
      <span className="quest-chart-pin" aria-hidden="true" />
      <span className="quest-chart-arrow" aria-hidden="true" />
      <span ref={label} className="quest-chart-name" aria-hidden="true" />
    </div>
  );
}
