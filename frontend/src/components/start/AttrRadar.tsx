// 属性雷达图（UI-CONTRACT I2：船长卡按组画）：一组属性一张。三项以上画多边形（四圈刻度、每项一根轴，
// 身世与星座的底子画成深色的小多边形，加上自由分配后的画成金色的大多边形）；不足三项的组画成横条。
// 圆心是 0（组的下限是负数时取下限），外圈是组的上限：取值 1–10 的组里 1 点也看得见。
// 轴端写属性名与读数。纯展示，读屏读整张图的 aria-label（“资质：悟性 3、耐力 2……”）。
import { t, tk } from "../../i18n";

export interface RadarAxis {
  key: string;
  name: string;
  value: number;
  /** 身世与星座的底子（开局向导里另画一层）；不给时只画读数 */
  base?: number;
}

/** 画布：留出两侧写轴名的地方（轴名较长时 svg 允许溢出，见 captain.css）。 */
const W = 200;
const H = 168;
const CX = W / 2;
const CY = H / 2 + 2;
const R = 60;
const RINGS = [0.25, 0.5, 0.75, 1];

/** 读数在轴上的比例：圆心是 min(0, 下限)，外圈是上限。 */
function frac(v: number, lo: number, hi: number): number {
  const base = Math.min(0, lo);
  if (hi <= base) return 0;
  return Math.max(0, Math.min(1, (v - base) / (hi - base)));
}

/** 第 i 根轴（共 n 根）上比例 f 处的点：第一根朝正上方，顺时针排。 */
function at(i: number, n: number, f: number): [number, number] {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [CX + R * f * Math.cos(a), CY + R * f * Math.sin(a)];
}

function poly(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** 读屏用的一句话：“资质：悟性 3、耐力 2、口才 4”。 */
function radarLabel(group: string, axes: readonly RadarAxis[]): string {
  const list = axes.map((a) => t("cap.card.attr", { name: a.name, value: a.value })).join(tk("start.listSep"));
  return group ? t("cap.cf.groupAttrs", { group, list }) : list;
}

export function AttrRadar({ group, axes, lo, hi, testId }: { group: string; axes: readonly RadarAxis[]; lo: number; hi: number; testId?: string }) {
  const n = axes.length;
  const label = radarLabel(group, axes);
  const value = axes.map((a, i) => at(i, n, frac(a.value, lo, hi)));
  const withBase = axes.some((a) => a.base !== undefined && a.base !== a.value);
  const base = axes.map((a, i) => at(i, n, frac(a.base ?? a.value, lo, hi)));
  return (
    <svg className="cw-radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid={testId}>
      {RINGS.map((f) => (
        <polygon key={f} className={f === 1 ? "cw-radar-rim" : "cw-radar-ring"} points={poly(axes.map((_, i) => at(i, n, f)))} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = at(i, n, 1);
        return <line key={a.key} className="cw-radar-axis" x1={CX} y1={CY} x2={x} y2={y} />;
      })}
      {withBase && <polygon className="cw-radar-base" points={poly(base)} />}
      <polygon className="cw-radar-value" points={poly(value)} />
      {value.map(([x, y], i) => (
        <rect key={axes[i].key} className="cw-radar-dot" x={x - 2} y={y - 2} width={4} height={4} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = at(i, n, 1.16);
        const dx = x - CX;
        const anchor = Math.abs(dx) < 6 ? "middle" : dx > 0 ? "start" : "end";
        const dy = y - CY;
        // 上方的轴名往上推、下方的往下推，免得压到图上
        const shift = Math.abs(dy) < 6 ? 4 : dy < 0 ? 0 : 9;
        return (
          <text key={a.key} className="cw-radar-label" x={x.toFixed(1)} y={(y + shift).toFixed(1)} textAnchor={anchor}>
            {a.name}
            <tspan className="cw-radar-num" dx={3}>
              {a.value}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** 不足三项的组：横条（名字、条、读数）。 */
export function AttrBars({ group, axes, lo, hi, testId }: { group: string; axes: readonly RadarAxis[]; lo: number; hi: number; testId?: string }) {
  return (
    <ul className="cw-card-bars" aria-label={radarLabel(group, axes)} data-testid={testId}>
      {axes.map((a) => (
        <li key={a.key} aria-label={t("cap.card.attr", { name: a.name, value: a.value })}>
          <span className="cw-attr-name" aria-hidden>
            {a.name}
          </span>
          <span className="cw-card-bar" aria-hidden>
            <i style={{ width: `${Math.round(frac(a.value, lo, hi) * 100)}%` }} />
          </span>
          <span className="cw-attr-value ts-num" aria-hidden>
            {a.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
