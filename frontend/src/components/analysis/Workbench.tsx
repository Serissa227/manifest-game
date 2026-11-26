// 推算工作台：选方法与参数、看拟合与预测区间、记下预测（修订草稿时记为修订版，须写明依据）。
// 手调参数与拟合窗口要主角的算学达到门槛（captain.toml 的 manual_numeracy；没有主角档案的旧存档不受限）。
// 月线满两年后可以切到月线看长期走势、季节与“猪周期”（只供参考，不记进预测簿）；图下写着本地生产者的状况。
// 新界面（v2）：“记下这个预测”从右栏底部挪到整页下沿一条贴底的条上（滚到哪儿都看得见，手机上在拇指区），
// 条上写明记下的是哪个法子、往后几天；旧界面（v1）的结构不变。
import { useEffect, useRef, useState } from "react";
import { money, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { BookView, SeriesView } from "../../ipc/types";
import { MONTHLY_HORIZONS, MONTHLY_METHODS, MONTHLY_MIN, runMonthly, type MonthlyResult } from "../../forecast/monthly";
import { REASONS_ALL } from "../../forecast/adjust";
import { roundPath, runForecast, seasonalIndices, type ForecastResult, type ForecastSpec } from "../../forecast/engine";
import { methodFull, methodName } from "../../forecast/labels";
import { COMMON_METHODS, GENIUS_METHODS, MONTHLY_ONLY, type MethodKey, type MethodParams } from "../../forecast/methods";
import { seriesInput, specToView } from "../../forecast/spec";
import { MAX_LIVE_HORIZON, useForecast } from "../../store/forecast";
import { manualTuning } from "../start/wizard";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton, Select } from "../common";
import { EmptyState, type FeedbackAction } from "../feedback";
import ForecastChart from "./ForecastChart";
import { NoCloseYet } from "./NoCloseYet";

/** 各方法可以手调的参数与取值范围。 */
const PARAMS: Partial<Record<MethodKey, { key: keyof MethodParams; min: number; max: number; step: number }[]>> = {
  ma: [{ key: "k", min: 2, max: 60, step: 1 }],
  fair: [{ key: "halfLife", min: 1, max: 90, step: 1 }],
  ses: [{ key: "alpha", min: 0.01, max: 0.99, step: 0.01 }],
  holt: [
    { key: "alpha", min: 0.01, max: 0.99, step: 0.01 },
    { key: "beta", min: 0.01, max: 0.99, step: 0.01 },
  ],
  damped: [
    { key: "alpha", min: 0.01, max: 0.99, step: 0.01 },
    { key: "beta", min: 0.01, max: 0.99, step: 0.01 },
    { key: "phi", min: 0.8, max: 0.98, step: 0.01 },
  ],
  ar1: [{ key: "arPhi", min: 0, max: 0.99, step: 0.01 }],
};

const WINDOWS = [20, 30, 45, 60, 90, 120];
const HORIZONS = [5, 10, 15, 30, 45, 60];

/** 记下预测时保存的参数：实际用到的（自动估计的也写进去），只留这个方法有的参数。 */
function usedParams(r: ForecastResult): MethodParams {
  const p: MethodParams = {};
  const keys = [
    ...(PARAMS[r.spec.method] ?? []).map((x) => x.key),
    ...(r.spec.method === "ar1" || r.spec.method === "fair" ? (["mu"] as const) : []),
  ];
  for (const k of keys) {
    const v = r.fit.params[k];
    if (v !== undefined && Number.isFinite(v)) p[k] = v;
  }
  return p;
}

/** 把结果排成图表的几条线：拟合窗口 + 预测期。 */
function chartData(r: ForecastResult) {
  const n = r.days.length;
  const days = [...r.days, ...r.path.map((p) => p.day)];
  const pad = <T,>(k: number) => new Array<T | null>(k).fill(null);
  const last = r.values[n - 1];
  // 预测线与区间从起点那天的实际价格画起
  const fromOrigin = (f: (p: (typeof r.path)[number]) => number) => [...pad<number>(n - 1), last, ...r.path.map(f)];
  return {
    days,
    actual: [...r.values, ...pad<number>(r.path.length)],
    fitted: [...r.fitted, ...pad<number>(r.path.length)],
    forecast: fromOrigin((p) => p.mean),
    band80: { lo: fromOrigin((p) => p.lo80), hi: fromOrigin((p) => p.hi80) },
    band95: { lo: fromOrigin((p) => p.lo95), hi: fromOrigin((p) => p.hi95) },
  };
}

/** 月线结果排成图表的几条线：各月的月均价 + 往后各月。 */
function monthlyChartData(r: MonthlyResult) {
  const n = r.months.length;
  const days = [...r.months, ...r.path.map((p) => p.day)];
  const pad = <T,>(k: number) => new Array<T | null>(k).fill(null);
  const last = r.values[n - 1];
  const fromOrigin = (f: (p: (typeof r.path)[number]) => number) => [...pad<number>(n - 1), last, ...r.path.map(f)];
  return {
    days,
    actual: [...r.values, ...pad<number>(r.path.length)],
    fitted: [...r.fitted, ...pad<number>(r.path.length)],
    forecast: fromOrigin((p) => p.mean),
    band80: { lo: fromOrigin((p) => p.lo80), hi: fromOrigin((p) => p.hi80) },
    band95: { lo: fromOrigin((p) => p.lo95), hi: fromOrigin((p) => p.hi95) },
  };
}

export default function Workbench({ series, book, onPinned }: { series: SeriesView; book: BookView; onPinned: (b: BookView) => void }) {
  const statics = useGame((s) => s.statics);
  const profile = useGame((s) => s.overview?.profile);
  const tuning = manualTuning(statics, profile);
  const { spec, horizon, draft, mode, monthlyHorizon, setSpec, setHorizon, setMode, setMonthlyHorizon, setDraft, clearDraft } = useForecast();
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const v2 = useIsV2();
  const known = new Set(series.methods);
  const advanced = GENIUS_METHODS.some((m) => known.has(m));
  const input = seriesInput(series);
  // 信息时效（ECONOMY.md 第 7 节）：远方港口的行情是随船传来的快照——期限可以多出过时的天数，
  // 换了市场或行情的日期时自动取“过时的天数 + 航程”，终点就是抵达的那天
  const seen = series.seen ?? null;
  const maxHorizon = MAX_LIVE_HORIZON + (seen ? seen.age : 0);
  const arrival = seen ? Math.min(maxHorizon, Math.max(1, seen.age + Math.max(0, series.voyage_days ?? 0))) : null;
  const arrivalKey = seen ? `${series.loc}:${series.good}:${seen.day}` : null;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (arrivalKey !== null && arrival !== null && applied.current !== arrivalKey) {
      applied.current = arrivalKey;
      setHorizon(arrival);
    }
  }, [arrivalKey, arrival, setHorizon]);
  const h = Math.min(horizon, maxHorizon);
  const horizons = [...new Set([...HORIZONS, ...(arrival !== null ? [arrival] : []), h])]
    .filter((x) => x <= maxHorizon)
    .sort((a, b) => a - b);
  const seasonalOk = seasonalIndices(series.monthly, series.monthly_last) !== null;
  // 月线满两年才能切过去；修订草稿总按日线
  const monthlyOk = series.monthly.length >= MONTHLY_MIN && series.monthly_last !== null;
  const monthly = mode === "monthly" && monthlyOk && !draft;
  // 新界面：日线算不出来时的补充一句与“下一步”——缺收盘价、记录太短 → 下一天；这个法子只用于月线 → 切到月线（月线够长、不在改预测时）
  const dailyNext = (reason: string): { hint?: string; action?: FeedbackAction } =>
    reason === "monthly_only"
      ? monthlyOk && !draft
        ? { action: { label: t("v2.analysis.fc.toMonthly"), onClick: () => setMode("monthly") } }
        : {}
      : reason === "no_data" || reason === "too_short"
        ? { hint: t("v2.analysis.fc.shortHint"), action: { label: t("stepDay"), onClick: () => void useGame.getState().step(1) } }
        : {};
  /** 这个法子在当前的线上用不用得了（会、并且不是另一条线专用的）。 */
  const usable = (m: MethodKey) => known.has(m) && (monthly ? MONTHLY_METHODS.includes(m) : !MONTHLY_ONLY.includes(m));
  // 不会的方法退回“公道价”（月线退回“照旧”）；奇才的技巧（按以往误差的区间、干预、季节修正）没有奇才时不用
  const eff: ForecastSpec = {
    ...spec,
    method: usable(spec.method) ? spec.method : monthly ? "naive" : "fair",
    interval: advanced ? spec.interval : "formula",
    intervention: advanced ? spec.intervention : null,
    seasonal: advanced && seasonalOk ? spec.seasonal : false,
    window: Math.min(spec.window, Math.max(2, series.daily.length)),
  };
  // 只在换了市场、来了新的收盘价、改了方法或参数时重算（高倍速下行情每天刷新，不必每次渲染都重算）
  const key = `${series.loc}:${series.good}:${series.last_close}:${series.daily.length}:${JSON.stringify(eff)}:${h}`;
  const cache = useRef<{ key: string; result: ReturnType<typeof runForecast> | null } | null>(null);
  if (cache.current?.key !== key) cache.current = { key, result: input ? runForecast(input, eff, h) : null };
  const result = cache.current.result;
  const mkey = `${series.loc}:${series.good}:${series.monthly_last}:${series.monthly.length}:${eff.method}:${monthlyHorizon}`;
  const mcache = useRef<{ key: string; result: ReturnType<typeof runMonthly> } | null>(null);
  if (monthly && mcache.current?.key !== mkey) {
    mcache.current = {
      key: mkey,
      result: runMonthly(series.monthly, series.monthly_last ?? 0, eff.method, monthlyHorizon, series.floor, series.cap),
    };
  }
  const mresult = monthly ? (mcache.current?.result ?? null) : null;
  if (!statics) return null;
  if (!input) return <NoCloseYet />;

  const pin = async () => {
    if (!result?.ok) return;
    const req = {
      loc: series.loc,
      good: series.good,
      origin: result.origin,
      horizon: h,
      spec: specToView({ ...result.spec, params: usedParams(result) }),
      fitted_on: result.values.map((v) => Math.round(v)),
      path: roundPath(result.path),
      revises: draft?.revises ?? null,
      basis: draft ? { kind: draft.kind, reason: draft.reason, note: draft.note } : null,
    };
    try {
      const next = await api.pinForecast(req);
      onPinned(next);
      const id = Math.max(0, ...next.entries.map((e) => e.id));
      setBusyMsg(t("fc.pinned", { id }));
      useGame.getState().notify(t("fc.pinned", { id }));
      clearDraft();
    } catch (e) {
      useGame.getState().fail(e);
    }
  };

  const methodRow = (m: MethodKey) => {
    const ok = usable(m);
    const genius = GENIUS_METHODS.includes(m);
    // 会、但只用于另一条线：写明用于哪条线
    const otherLine = known.has(m) && !ok ? t(monthly ? "fc.dailyOnly" : "fc.monthlyOnly") : null;
    return (
      <label key={m} className={ok ? "fc-method" : "fc-method locked"} title={ok ? tk(`fc.md.${m}`) : (otherLine ?? t("fc.locked"))}>
        <input
          type="radio"
          name="fc-method"
          value={m}
          checked={eff.method === m}
          disabled={!ok}
          onChange={() => setSpec({ method: m, params: {} })}
        />
        <span className="fc-method-name">{genius ? methodFull(m) : methodName(m)}</span>
        {!ok && <small className="fc-method-lock">{otherLine ?? t("fc.lockedShort")}</small>}
      </label>
    );
  };

  const params = PARAMS[eff.method] ?? [];
  const full = book.active >= book.max_active;
  // 记下预测（月线只供参考：换成一句说明）。v1 放在右栏底部；v2 放在贴底的条上（见文件开头）
  const pinBlock = monthly ? (
    <p className="fc-note" data-testid="fc-monthly-note">
      {t("fc.monthlyNote")}
    </p>
  ) : (
    <div className="fc-pin">
      {v2 && (
        <span className="fc-pin-what" data-testid="fc-pin-what">
          {t("v2.analysis.fc.pinWhat", { method: methodName(eff.method), days: h })}
        </span>
      )}
      <ActionButton
        kind="primary"
        disabled={!result?.ok || full}
        onClick={pin}
        title={full ? t("fc.full", { n: book.active, max: book.max_active }) : undefined}
      >
        {draft ? t("fc.pinRevision") : t("fc.pin")}
      </ActionButton>
      <small>
        {full ? t("fc.full", { n: book.active, max: book.max_active }) : t("fc.tracking", { n: book.active, max: book.max_active })}
      </small>
      {busyMsg && <small role="status">{busyMsg}</small>}
    </div>
  );
  return (
    <div className="fc-work" data-testid="fc-work">
      {draft && (
        <div className="fc-draft" role="status" data-testid="fc-draft">
          <strong>{t("fc.rv.draft", { id: draft.revises, kind: tk(`fc.kind.${draft.kind}`) })}</strong>
          <Select
            label={t("fc.rv.reason")}
            value={draft.reason}
            options={REASONS_ALL.map((r) => ({ value: r, label: tk(`fc.r.${r}`) }))}
            onChange={(reason) => setDraft({ reason })}
          />
          <label className="field">
            <span>{t("fc.rv.note")}</span>
            <input aria-label={t("fc.rv.note")} maxLength={60} value={draft.note} onChange={(e) => setDraft({ note: e.target.value })} />
          </label>
          <button type="button" className="btn" onClick={clearDraft}>
            {t("fc.rv.cancelDraft")}
          </button>
        </div>
      )}
      <div className="fc-work-grid">
        <div className="fc-work-chart">
          {monthly ? (
            mresult?.ok ? (
              <>
                <ForecastChart {...monthlyChartData(mresult)} origin={series.monthly_last ?? 0} height={260} />
                <MonthlySummary r={mresult} />
              </>
            ) : (
              // 新界面：月线太短时说明“每满一个月才多一个点”，“下一步”回日线；旧界面照旧一行字
              <EmptyState
                text={tk(`fc.err.${mresult?.reason === "unsupported" ? "monthly_only" : "too_short"}`)}
                hint={mresult?.reason === "unsupported" ? undefined : t("v2.analysis.fc.monthShortHint")}
                action={{ label: t("v2.analysis.fc.toDaily"), onClick: () => setMode("daily") }}
              />
            )
          ) : (
            <>
              {result?.ok ? (
                <ForecastChart {...chartData(result)} origin={result.origin} height={260} />
              ) : (
                <EmptyState text={tk(`fc.err.${result?.reason ?? "no_data"}`)} {...dailyNext(result?.reason ?? "no_data")} />
              )}
              {result?.ok && <Summary r={result} horizon={h} price={series.price} />}
            </>
          )}
          {seen && (
            <p className="fc-note fc-stale" data-testid="fc-stale">
              <span>
                {series.voyage_days != null && arrival !== null
                  ? t("fc.stale", { age: seen.age, source: tk(`info.src.${seen.source}`), voyage: series.voyage_days, h: arrival })
                  : t("fc.staleNoVoyage", { age: seen.age, source: tk(`info.src.${seen.source}`) })}
              </span>
              {arrival !== null && h !== arrival && (
                <button type="button" className="btn small" onClick={() => setHorizon(arrival)}>
                  {t("fc.staleArrive")}
                </button>
              )}
            </p>
          )}
          <ProducerNote series={series} />
          <MerchantsNote series={series} />
        </div>
        <div className="fc-work-side">
          <fieldset className="fc-mode" aria-label={t("fc.mode")}>
            <legend>{t("fc.mode")}</legend>
            <label>
              <input type="radio" name="fc-mode" checked={!monthly} onChange={() => setMode("daily")} />
              {t("fc.mode.daily")}
            </label>
            <label title={monthlyOk ? undefined : t("fc.mode.monthlyNeed", { n: MONTHLY_MIN, have: series.monthly.length })}>
              <input type="radio" name="fc-mode" checked={monthly} disabled={!monthlyOk || !!draft} onChange={() => setMode("monthly")} />
              {t("fc.mode.monthly")}
            </label>
            {!monthlyOk && <small className="fc-mode-need">{t("fc.mode.monthlyNeed", { n: MONTHLY_MIN, have: series.monthly.length })}</small>}
          </fieldset>
          <fieldset className="fc-methods" aria-label={t("fc.tier.common")}>
            <legend>{t("fc.tier.common")}</legend>
            {COMMON_METHODS.map(methodRow)}
          </fieldset>
          <fieldset className="fc-methods" aria-label={t("fc.tier.genius")}>
            <legend>{t("fc.tier.genius")}</legend>
            {GENIUS_METHODS.map(methodRow)}
          </fieldset>
          <p className="fc-method-card" data-testid="fc-method-card">
            <strong>{methodFull(eff.method)}</strong>
            <br />
            {tk(`fc.md.${eff.method}`)}
          </p>
          {monthly ? (
            <div className="row fc-knobs">
              <Select
                label={t("fc.monthlyHorizon")}
                value={monthlyHorizon}
                options={MONTHLY_HORIZONS.map((h) => ({ value: h, label: t("fc.unitMonths", { v: h }) }))}
                onChange={setMonthlyHorizon}
              />
            </div>
          ) : (
            <div className="row fc-knobs">
              <Select
                label={t("fc.window")}
                disabled={!tuning.ok}
                value={eff.window}
                options={WINDOWS.filter((w) => w <= Math.max(20, series.daily.length)).map((w) => ({ value: w, label: tk("unitDays", { v: w }) }))}
                onChange={(window) => setSpec({ window })}
              />
              <Select
                label={t("fc.horizon")}
                value={h}
                options={horizons.map((x) => ({ value: x, label: tk("unitDays", { v: x }) }))}
                onChange={setHorizon}
              />
            </div>
          )}
          {!tuning.ok && !monthly && (
            <p className="fc-note" data-testid="fc-manual-locked">
              {t("fc.manualLocked", { n: tuning.need })}
            </p>
          )}
          {params.length > 0 && !monthly && (
            <fieldset className="fc-params" disabled={!tuning.ok}>
              <legend>{t("fc.params")}</legend>
              {params.map((p) => {
                const manual = spec.params[p.key] !== undefined;
                const value = manual ? (spec.params[p.key] as number) : result?.ok ? (result.fit.params[p.key] ?? p.min) : p.min;
                return (
                  <div key={p.key} className="fc-param">
                    <label className="field">
                      <span>{tk(`fc.p.${p.key}`)}</span>
                      <input
                        type="number"
                        aria-label={tk(`fc.p.${p.key}`)}
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        disabled={!manual}
                        value={Number(value.toFixed(p.step < 1 ? 2 : 0))}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) setSpec({ params: { ...spec.params, [p.key]: Math.min(p.max, Math.max(p.min, v)) } });
                        }}
                      />
                    </label>
                    <label className="fc-auto">
                      <input
                        type="checkbox"
                        checked={!manual}
                        onChange={(e) => {
                          const next = { ...spec.params };
                          if (e.target.checked) delete next[p.key];
                          else next[p.key] = value;
                          setSpec({ params: next });
                        }}
                      />
                      {t("fc.auto")}
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}
          {!monthly && (
            <div className="fc-options">
              <label>
                <input type="checkbox" checked={eff.log} onChange={(e) => setSpec({ log: e.target.checked })} />
                {t("fc.opt.log")}
              </label>
              {advanced && (
                <label title={seasonalOk ? undefined : t("fc.opt.seasonalNeed")}>
                  <input
                    type="checkbox"
                    checked={eff.seasonal}
                    disabled={!seasonalOk || eff.method === "seasonal"}
                    onChange={(e) => setSpec({ seasonal: e.target.checked })}
                  />
                  {seasonalOk ? t("fc.opt.seasonal") : t("fc.opt.seasonalNeed")}
                </label>
              )}
              {advanced && (
                <Select
                  label={t("fc.opt.interval")}
                  value={eff.interval}
                  options={[
                    { value: "formula", label: t("fc.interval.formula") },
                    { value: "empirical", label: t("fc.interval.empirical") },
                  ]}
                  onChange={(interval) => setSpec({ interval })}
                />
              )}
              {eff.excluded.length > 0 && (
                <p className="fc-note">
                  {t("fc.excluded", { n: eff.excluded.length })}{" "}
                  <button type="button" className="btn small" onClick={() => setSpec({ excluded: [] })}>
                    {t("fc.clearExcluded")}
                  </button>
                </p>
              )}
              {eff.intervention && (
                <p className="fc-note">
                  {t("fc.intervention", {
                    day: eff.intervention.day,
                    kind: t(eff.intervention.kind === "pulse" ? "fc.iv.pulse" : "fc.iv.step"),
                    size:
                      ` ${eff.intervention.size >= 0 ? "+" : "−"}${Math.abs(eff.intervention.size * 100).toFixed(0)}%` +
                      (eff.intervention.end !== null ? t("fc.iv.until", { end: eff.intervention.end }) : ""),
                  })}{" "}
                  <button type="button" className="btn small" onClick={() => setSpec({ intervention: null })}>
                    {t("fc.clearIntervention")}
                  </button>
                </p>
              )}
              {eff.sigmaScale !== 1 && <p className="fc-note">{t("fc.sigmaScale", { x: eff.sigmaScale.toFixed(2) })}</p>}
            </div>
          )}
          {!v2 && pinBlock}
        </div>
      </div>
      {v2 && (
        <div className="fc-pin-bar" role="group" aria-label={t("v2.analysis.fc.pinBar")} data-testid="fc-pin-bar">
          {pinBlock}
        </div>
      )}
    </div>
  );
}

/** 月线的结论：往后几个月的月均价与区间、与最近一个月比、误差；周期推算给出一轮的月数，四季平滑给出季节起伏。 */
function MonthlySummary({ r }: { r: MonthlyResult }) {
  const end = r.path[r.path.length - 1];
  const latest = r.values[r.values.length - 1];
  const change = latest > 0 ? (100 * (end.mean - latest)) / latest : 0;
  const dir = Math.abs(change) < 0.5 ? "same" : change > 0 ? "up" : "down";
  const lines: string[] = [
    t("fc.sum.monthsAt", {
      months: r.path.length,
      mean: money(Math.round(end.mean)),
      lo80: Math.round(end.lo80),
      hi80: Math.round(end.hi80),
      lo95: Math.round(end.lo95),
      hi95: Math.round(end.hi95),
    }),
    dir === "same"
      ? t("fc.sum.same")
      : t("fc.sum.monthsChange", { dir: t(dir === "up" ? "fc.sum.up" : "fc.sum.down"), pct: Math.abs(change).toFixed(1) }),
  ];
  if (Number.isFinite(r.rmse)) lines.push(t("fc.sum.rmse", { v: r.rmse.toFixed(1) }));
  const { period, seasonAmp } = r.fit.info;
  if (r.method === "ar2" && period !== undefined && Number.isFinite(period)) lines.push(t("fc.sum.period", { v: Math.round(period) }));
  if (r.method === "hw" && seasonAmp !== undefined && Number.isFinite(seasonAmp)) lines.push(t("fc.sum.season", { v: Math.round(seasonAmp) }));
  return (
    <ul className="fc-summary" data-testid="fc-monthly-summary">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

/** 图下的一行：本地生产者的状况（这里不产、头一年观望、产能与预期、作物的计划产能）。 */
function ProducerNote({ series }: { series: SeriesView }) {
  const p = series.producer;
  let text: string | null = null;
  if (series.produces === false) text = t("fc.producer.none");
  else if (p?.learning) text = t("fc.producer.learning");
  else if (p) {
    const gap = (p.expect_bp - 10000) / 100;
    const act = gap > 2 ? "fc.producer.expand" : gap < -2 ? "fc.producer.shrink" : "fc.producer.hold";
    text =
      t("fc.producer.line", {
        cap: Math.round(p.capacity_bp / 100),
        dir: t(gap >= 0 ? "fc.producer.up" : "fc.producer.down"),
        gap: Math.abs(gap).toFixed(1),
        act: t(act),
      }) + (p.planned_bp !== null ? t("fc.producer.plan", { plan: Math.round(p.planned_bp / 100) }) : "");
  }
  if (!text) return null;
  return (
    <p className="fc-producer" data-testid="fc-producer">
      {text}
    </p>
  );
}

/** 本地商人（ECONOMY.md 6.6）的四派占比与各自对下一个收盘价的预测、主流预期、存货与传闻。 */
function MerchantsNote({ series }: { series: SeriesView }) {
  const m = series.merchants;
  if (!m) return null;
  const pctOf = (bp: number, base: number) => (base > 0 ? ((bp - base) * 100) / base : 0);
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
  const lean = pctOf(m.expect_bp, m.price_bp);
  const hoardDir = m.hoard > m.hoard_base * 1.1 ? "fc.mer.hoarding" : m.hoard < m.hoard_base * 0.9 ? "fc.mer.selling" : "fc.mer.usual";
  return (
    <div className="fc-merchants" data-testid="fc-merchants">
      <h4>{t("fc.mer.title")}</h4>
      <ul>
        {(["ada", "wtr", "str", "laa"] as const).map((k, i) => (
          <li key={k} title={tk(`fc.mer.hint.${k}`)}>
            <span className="fc-mer-name">{tk(`fc.mer.${k}`)}</span>
            <span className="fc-mer-bar" aria-hidden>
              <span style={{ width: `${m.shares_bp[i] / 100}%` }} />
            </span>
            <span className="num">{Math.round(m.shares_bp[i] / 100)}%</span>
            <span className="num fc-mer-fc">{signed(pctOf(m.forecast_bp[i], m.price_bp))}%</span>
          </li>
        ))}
      </ul>
      <p className="sub">
        {t("fc.mer.line", { dir: t(lean >= 0 ? "fc.mer.up" : "fc.mer.down"), pct: Math.abs(lean).toFixed(1) })}
        {t(hoardDir, { hoard: m.hoard, base: m.hoard_base })}
        {m.rumor_bp !== 0 && t("fc.mer.rumor", { dir: t(m.rumor_bp > 0 ? "fc.mer.up" : "fc.mer.down"), pct: (Math.abs(m.rumor_bp) / 100).toFixed(1) })}
      </p>
    </div>
  );
}

/** 预测结论：期末的点预测与区间、涨跌、误差与解释量。 */
function Summary({ r, horizon, price }: { r: ForecastResult; horizon: number; price: number }) {
  const end = r.path[r.path.length - 1];
  const change = price > 0 ? (100 * (end.mean - price)) / price : 0;
  const dir = Math.abs(change) < 0.5 ? "same" : change > 0 ? "up" : "down";
  const lines: string[] = [
    t("fc.sum.at", {
      days: horizon,
      mean: money(Math.round(end.mean)),
      lo80: Math.round(end.lo80),
      hi80: Math.round(end.hi80),
      lo95: Math.round(end.lo95),
      hi95: Math.round(end.hi95),
    }),
    dir === "same" ? t("fc.sum.same") : t("fc.sum.change", { dir: t(dir === "up" ? "fc.sum.up" : "fc.sum.down"), pct: Math.abs(change).toFixed(1) }),
  ];
  if (Number.isFinite(r.rmse)) lines.push(t("fc.sum.rmse", { v: r.rmse.toFixed(1) }));
  const info = r.fit.info;
  if (info.randomWalk) lines.push(t("fc.sum.randomWalk"));
  else if (info.halfLife !== undefined && Number.isFinite(info.halfLife) && r.spec.method === "ar1")
    lines.push(t("fc.sum.halfLife", { v: Math.max(1, Math.round(info.halfLife)) }));
  if ((r.spec.method === "ar1" || r.spec.method === "fair") && info.mu !== undefined && Number.isFinite(info.mu)) {
    lines.push(t("fc.sum.fair", { v: Math.round(r.spec.log ? Math.exp(info.mu) : info.mu) }));
  }
  if (r.ljungBox && r.ljungBox.p < 0.05) lines.push(t("fc.sum.lb", { p: r.ljungBox.p.toFixed(3) }));
  if (r.spec.interval === "empirical") lines.push(t(r.interval === "empirical" ? "fc.sum.empirical" : "fc.sum.formulaFallback"));
  return (
    <ul className="fc-summary" data-testid="fc-summary">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}
