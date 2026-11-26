// 交易所的小预测图：用行情窗口里上次选的方法（不会的方法退回“公道价”），画走势、预测线与区间，下面一句结论。
// 还没有收盘价时与行情窗口同一个空状态（v1 照旧一句话）；抽屉里不带“下一天”——那里已有成交的主按钮，只留说明“过一天就有了”。
import { useRef } from "react";
import { money, t } from "../../i18n";
import { api } from "../../ipc/api";
import { useView } from "../../hooks/useView";
import { runForecast } from "../../forecast/engine";
import { methodName } from "../../forecast/labels";
import { seriesInput } from "../../forecast/spec";
import { useForecast } from "../../store/forecast";
import ForecastChart from "./ForecastChart";
import { NoCloseYet } from "./NoCloseYet";

export default function MarketForecast({ loc, good }: { loc: number; good: number }) {
  const { spec, horizon } = useForecast();
  const { data: series } = useView(`mkseries:${loc}:${good}`, () => api.marketSeries(loc, good));
  const cache = useRef<{ key: string; r: ReturnType<typeof runForecast> | null } | null>(null);
  if (!series) return null;
  const method = series.methods.includes(spec.method) ? spec.method : "fair";
  const eff = { ...spec, method, interval: "formula" as const, intervention: null, seasonal: false };
  const key = `${loc}:${good}:${series.last_close}:${JSON.stringify(eff)}:${horizon}`;
  if (cache.current?.key !== key) {
    const input = seriesInput(series);
    cache.current = { key, r: input ? runForecast(input, eff, horizon) : null };
  }
  const r = cache.current.r;
  if (!r?.ok) return <NoCloseYet className="mk-forecast-empty" stepDay={false} />;
  const n = r.days.length;
  const pad = (k: number) => new Array<number | null>(k).fill(null);
  const last = r.values[n - 1];
  const from = (xs: number[]) => [...pad(n - 1), last, ...xs];
  const end = r.path[r.path.length - 1];
  return (
    <div className="mk-forecast" data-testid="mk-forecast">
      <ForecastChart
        days={[...r.days, ...r.path.map((p) => p.day)]}
        actual={[...r.values, ...pad(r.path.length)]}
        forecast={from(r.path.map((p) => p.mean))}
        band80={{ lo: from(r.path.map((p) => p.lo80)), hi: from(r.path.map((p) => p.hi80)) }}
        band95={{ lo: from(r.path.map((p) => p.lo95)), hi: from(r.path.map((p) => p.hi95)) }}
        origin={r.origin}
        height={170}
        testId="mk-forecast-chart"
      />
      <p className="hint" data-testid="mk-forecast-line">
        {methodName(method)} ·{" "}
        {t("fc.sum.at", {
          days: horizon,
          mean: money(Math.round(end.mean)),
          lo80: Math.round(end.lo80),
          hi80: Math.round(end.hi80),
          lo95: Math.round(end.lo95),
          hi95: Math.round(end.hi95),
        })}
      </p>
    </div>
  );
}
