// 罗经盘（FRAMEWORK §6.8）：32 个罗经点的刻度、四正的字、船的航向指针、调整中的草稿指针（虚线）、
// 风从哪里来（箭头指向盘心）、洋流（青色小箭头）与逆风禁区（风来向两侧 sail_limit 以内的红色扇形）；
// H03：当前帆型、当前风下最快的航向（风轴两侧各一个），在盘沿上画成两枚绿色的小三角——看得懂“往哪偏一点就快”。
// 拖动转舵：按下后指针跟着指针（鼠标、手指）转，onDraft 给出草稿航向（航行视图据此请求预测），松手 onCommit 提交。
// 键盘转舵（A/D、←/→ 按住连续转）由航行视图统一处理（useSteerKeys），这里只负责显示与拖动。
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { compassPoint, headingToward, headingVector, inIrons, noGoZone, normDeg, POINT_DEG, POINTS, sectorPath } from "./navKit";

export interface CompassDialProps {
  /** 已提交的航向 */
  heading: number;
  /** 调整中的草稿航向（没有为 null） */
  draft: number | null;
  /** 风从哪里来（0–359；没有风的数据时为 null） */
  windFrom: number | null;
  windForce?: number;
  /** 这艘船能逆风到的最小夹角（度） */
  sailLimit: number;
  /** 洋流的去向与流速 */
  current?: { dir: number; speed: number } | null;
  /** H03：最快的航向（0–359，风轴两侧各一个；没有时不画） */
  fast?: readonly number[];
  disabled?: boolean;
  /** 拖动中的草稿航向；null 表示放弃（指针移出又松开在盘外也算提交） */
  onDraft: (heading: number | null) => void;
  /** 松手：提交航向 */
  onCommit: (heading: number) => void;
}

const R = 50;
const C0 = 60;

/** 盘面上一点（角度 a、半径 r）的坐标。 */
function at(a: number, r: number): { x: number; y: number } {
  const v = headingVector(a);
  return { x: C0 + v.x * r, y: C0 + v.y * r };
}

export default function CompassDial({ heading, draft, windFrom, windForce = 0, sailLimit, current, fast, disabled, onDraft, onCommit }: CompassDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; last: number } | null>(null);
  const shown = draft ?? heading;
  const irons = windFrom !== null && inIrons(shown, windFrom, sailLimit);

  /** 指针位置 → 航向（相对盘心）。 */
  const headingAt = (e: { clientX: number; clientY: number }): number | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return headingToward(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.button !== undefined && e.button !== 0)) return;
    const h = headingAt(e);
    if (h === null) return;
    e.preventDefault();
    try {
      ref.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // 测试环境或旧浏览器不支持捕获：照样拖
    }
    drag.current = { id: e.pointerId, last: h };
    onDraft(h);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const h = headingAt(e);
    if (h === null || h === d.last) return;
    d.last = h;
    onDraft(h);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const h = headingAt(e) ?? d.last;
    onCommit(h);
  };
  const onCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    onDraft(null);
  };

  const zone = windFrom !== null && sailLimit > 0 ? noGoZone(windFrom, sailLimit) : null;
  const tip = at(shown, R - 6);
  const tail = at(shown + 180, R - 20);
  const draftTip = draft !== null ? at(draft, R - 4) : null;
  const windTail = windFrom !== null ? at(windFrom, R + 8) : null;
  const windHead = windFrom !== null ? at(windFrom, R - 10) : null;
  const curTail = current && current.speed > 0 ? at(current.dir + 180, 14) : null;
  const curHead = current && current.speed > 0 ? at(current.dir, 14) : null;
  const point = compassPoint(shown);
  const cardinals: [number, string][] = [
    [0, t("nav.cardinalN")],
    [90, t("nav.cardinalE")],
    [180, t("nav.cardinalS")],
    [270, t("nav.cardinalW")],
  ];
  return (
    <div
      ref={ref}
      className={["nav-compass", irons ? "irons" : "", draft !== null ? "dragging" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}
      role="slider"
      tabIndex={0}
      aria-label={t("nav.compass")}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(normDeg(shown))}
      aria-valuetext={t("nav.headingValue", { point, deg: Math.round(normDeg(shown)) })}
      aria-disabled={disabled || undefined}
      data-testid="nav-compass"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="nav-compass-face" cx={C0} cy={C0} r={R + 6} />
        <circle className="nav-compass-rim" cx={C0} cy={C0} r={R} />
        {zone && (
          <path className="nav-compass-nogo" d={sectorPath(C0, C0, R, zone[0], zone[1])} data-testid="nav-compass-nogo">
            <title>{t("nav.noGo")}</title>
          </path>
        )}
        {(fast ?? []).map((h) => {
          // 盘沿外侧一枚尖朝里的小三角
          const tipP = at(h, R - 1);
          const l = at(h - 11, R + 9);
          const r = at(h + 11, R + 9);
          return (
            <path key={`fast-${h}`} className="nav-compass-fast" d={`M${tipP.x},${tipP.y}L${l.x},${l.y}L${r.x},${r.y}Z`} data-testid="nav-compass-fast">
              <title>{tz("nav.fastHeading", { deg: Math.round(normDeg(h)) })}</title>
            </path>
          );
        })}
        {Array.from({ length: POINTS }, (_, i) => {
          const a = i * POINT_DEG;
          const major = i % 8 === 0;
          const mid = i % 4 === 0;
          const p0 = at(a, R);
          const p1 = at(a, R - (major ? 9 : mid ? 6 : 3));
          return <line key={i} className={major ? "tick major" : mid ? "tick mid" : "tick"} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />;
        })}
        {cardinals.map(([a, label]) => {
          const p = at(a, R - 16);
          return (
            <text key={a} className={a === 0 ? "nav-compass-label north" : "nav-compass-label"} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">
              {label}
            </text>
          );
        })}
        {windTail && windHead && (
          <g className="nav-compass-wind" data-force={windForce}>
            <line x1={windTail.x} y1={windTail.y} x2={windHead.x} y2={windHead.y} />
            <circle cx={windHead.x} cy={windHead.y} r={2.2} />
          </g>
        )}
        {curTail && curHead && <line className="nav-compass-current" x1={curTail.x} y1={curTail.y} x2={curHead.x} y2={curHead.y} />}
        <line className="nav-compass-needle-tail" x1={C0} y1={C0} x2={tail.x} y2={tail.y} />
        <line className="nav-compass-needle" x1={C0} y1={C0} x2={tip.x} y2={tip.y} data-testid="nav-compass-needle" />
        {draftTip && <line className="nav-compass-draft" x1={C0} y1={C0} x2={draftTip.x} y2={draftTip.y} />}
        <circle className="nav-compass-hub" cx={C0} cy={C0} r={3.5} />
      </svg>
      <span className="nav-compass-readout">
        <strong>{point}</strong>
        <span>{Math.round(normDeg(shown))}°</span>
      </span>
    </div>
  );
}
