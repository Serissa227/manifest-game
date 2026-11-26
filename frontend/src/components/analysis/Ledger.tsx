// 行情窗口的另外三页：对照旧账试算（回测）、预测簿、复盘（成绩、原因、调整）。
// 新界面（v2）的小改动（旧界面不变）：试算表的格子带 data-label（手机上一行变成一张小卡，每个数前写着是什么）；
// 空的预测簿与没有奇才时的试算给“下一步”；删除预测簿里的一条先问一句（收不回来）。
import { useRef, useState } from "react";
import { dayDate, t, type StringKey } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { BookView, ForecastEntryView, SeriesView, StaticView } from "../../ipc/types";
import { compareRevision } from "../../forecast/adjust";
import { backtestAll } from "../../forecast/backtest";
import { driverText, findingText, markText, methodFull, methodName, suggestionText, verdictLabel } from "../../forecast/labels";
import { GENIUS_METHODS, type MethodKey } from "../../forecast/methods";
import { evaluate } from "../../forecast/monitor";
import { reviewEntry } from "../../forecast/review";
import { isMethod, seriesInput } from "../../forecast/spec";
import { useForecast } from "../../store/forecast";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton } from "../common";
import { EmptyState, useConfirm } from "../feedback";
import ForecastChart from "./ForecastChart";
import { NoCloseYet } from "./NoCloseYet";

const known = (series: SeriesView | BookView): MethodKey[] => series.methods.filter(isMethod);
const isAdvanced = (methods: readonly string[]) => GENIUS_METHODS.some((m) => methods.includes(m));
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
const fix = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

// ───────────────────────────── 对照旧账试算 ─────────────────────────────

export function BacktestView({ series }: { series: SeriesView }) {
  const { spec, horizon, setSpec, setView } = useForecast();
  const v2 = useIsV2();
  /** v2：格子前的小标签（手机上表格变成卡片时显示，见 ui-v2/analysis.css）；v1 不加属性 */
  const cell = (key: StringKey) => (v2 ? { "data-label": t(key) } : {});
  const methods = known(series);
  const input = seriesInput(series);
  const key = `${series.loc}:${series.good}:${series.last_close}:${spec.window}:${spec.log}:${horizon}:${methods.join(",")}`;
  const cache = useRef<{ key: string; rows: ReturnType<typeof backtestAll> } | null>(null);
  if (!isAdvanced(series.methods))
    return <EmptyState text={t("fc.adv.locked")} hint={t("v2.analysis.fc.advHint")} action={{ label: t("v2.analysis.fc.toWork"), onClick: () => setView("work") }} />;
  if (!input) return <NoCloseYet />;
  if (cache.current?.key !== key) {
    const base = { ...spec, params: {}, intervention: null, interval: "formula" as const, excluded: [], sigmaScale: 1 };
    cache.current = { key, rows: backtestAll(input, base, Math.min(horizon, 30), 20, methods) };
  }
  const rows = cache.current.rows;
  const best = rows.find((r) => r.n > 0);
  return (
    <div className="fc-backtest" data-testid="fc-backtest">
      <p className="hint">{t("fc.bt.hint")}</p>
      <table className="grid">
        <thead>
          <tr>
            <th>{t("fc.bt.method")}</th>
            <th>{t("fc.bt.mase")}</th>
            <th>{t("fc.bt.mae")}</th>
            <th>{t("fc.bt.mape")}</th>
            <th>{t("fc.bt.cov80")}</th>
            <th>{t("fc.bt.cov95")}</th>
            <th>{t("fc.bt.n")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className={r === best ? "selected" : undefined} data-testid={`fc-bt-${r.method}`}>
              <td>
                {methodName(r.method)}
                {r === best && <em className="tag">{t("fc.bt.best")}</em>}
              </td>
              {r.n > 0 ? (
                <>
                  <td {...cell("fc.bt.mase")}>{fix(r.mase)}</td>
                  <td {...cell("fc.bt.mae")}>{fix(r.mae, 1)}</td>
                  <td {...cell("fc.bt.mape")}>{fix(r.mape, 1)}</td>
                  <td {...cell("fc.bt.cov80")}>{pct(r.cov80)}</td>
                  <td {...cell("fc.bt.cov95")}>{pct(r.cov95)}</td>
                  <td {...cell("fc.bt.n")}>{r.n}</td>
                </>
              ) : (
                <td colSpan={6}>{t("fc.bt.none")}</td>
              )}
              <td className={v2 ? "fc-bt-act" : undefined}>
                <button
                  type="button"
                  className="btn small"
                  disabled={r.n === 0}
                  onClick={() => {
                    setSpec({ method: r.method, params: {} });
                    setView("work");
                  }}
                >
                  {t("fc.bt.use")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────── 预测簿 ─────────────────────────────

function entryLabel(statics: StaticView, e: ForecastEntryView): string {
  return t("fc.book.entry", {
    id: e.id,
    port: locById(statics, e.loc)?.name ?? String(e.loc),
    good: statics.goods[e.good]?.name ?? String(e.good),
    method: methodName(e.spec.method),
  });
}

export function BookList({ book, onChange }: { book: BookView; onChange: (b: BookView) => void }) {
  const statics = useGame((s) => s.statics);
  const openReview = useForecast((s) => s.openReview);
  const setView = useForecast((s) => s.setView);
  const v2 = useIsV2();
  const confirm = useConfirm();
  if (!statics) return null;
  if (book.entries.length === 0)
    return <EmptyState text={t("fc.book.empty")} hint={t("v2.analysis.fc.bookEmptyHint")} action={{ label: t("v2.analysis.fc.toWork"), onClick: () => setView("work") }} />;
  const entries = [...book.entries].sort((a, b) => b.id - a.id);
  const remove = async (e: ForecastEntryView) => {
    try {
      onChange(await api.removeForecast(e.id));
    } catch (err) {
      useGame.getState().fail(err);
    }
  };
  // v2：删除收不回来，先问一句（v1 照旧直接删）
  const askRemove = (e: ForecastEntryView) =>
    confirm.run(
      {
        title: t("v2.analysis.fc.removeTitle", { id: e.id }),
        body: t("v2.analysis.fc.removeBody", { entry: entryLabel(statics, e) }),
        confirmLabel: t("v2.analysis.fc.removeConfirm"),
        done: t("v2.analysis.fc.removed", { id: e.id }),
      },
      async () => {
        onChange(await api.removeForecast(e.id));
      },
    );
  return (
    <>
      <ul className="fc-book" data-testid="fc-book">
        {entries.map((e) => {
          const ev = evaluate(e.baseline.price, e.path, e.track.map((d) => d.price));
          const done = e.track.length >= e.horizon;
          const waiting = !done && book.last_close !== null && e.origin + e.horizon <= book.last_close;
          const verdict = ev.verdict === "pending" || !done ? (ev.verdict === "failed" ? "failed" : "pending") : ev.verdict;
          return (
            <li key={e.id} className={`fc-entry fc-v-${verdict}`} data-testid={`fc-entry-${e.id}`}>
              <div className="fc-entry-head">
                <strong>{entryLabel(statics, e)}</strong>
                <em className={`tag fc-verdict fc-verdict-${verdict}`}>{verdictLabel(verdict)}</em>
              </div>
              <small>
                {t("fc.book.made", { date: dayDate(e.created), h: e.horizon })} · {t("fc.book.progress", { n: e.track.length, h: e.horizon })}
                {waiting ? ` · ${t("fc.book.waiting")}` : ""}
                {e.revises ? ` · ${t("fc.book.revises", { id: e.revises })}` : ""}
              </small>
              <div className="row">
                <button type="button" className="btn small" onClick={() => openReview(e.id)}>
                  {t("fc.book.open")}
                </button>
                {v2 ? (
                  // v2 用普通按钮：ActionButton 会在等确认框的整段时间里把自己禁用，确认框关掉时焦点就还不回来
                  // （落到 body 上，键盘用户丢了位置）；“正在办……”由确认框自己显示
                  <button type="button" className="btn danger" onClick={() => void askRemove(e)}>
                    {t("fc.book.remove")}
                  </button>
                ) : (
                  <ActionButton kind="danger" onClick={() => remove(e)}>
                    {t("fc.book.remove")}
                  </ActionButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {confirm.dialog}
    </>
  );
}

// ───────────────────────────── 复盘 ─────────────────────────────

/** 请账房点评（ECONOMY.md 8.6）：把复盘算出的诊断与驱动（界面语言）交给后端，AI 写（或离线模板拼）一段点评；不改世界。 */
function Comment({ entry, facts, place }: { entry: ForecastEntryView; facts: string[]; place: string }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (facts.length === 0) return null;
  const ask = async () => {
    setBusy(true);
    try {
      setText(await api.reviewComment(entry.id, place, facts));
    } catch (e) {
      useGame.getState().fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="fc-comment" data-testid="fc-comment">
      {text ? (
        <blockquote>{text}</blockquote>
      ) : (
        <button type="button" className="btn small" disabled={busy} onClick={() => void ask()}>
          {t(busy ? "fc.rv.commentBusy" : "fc.rv.comment")}
        </button>
      )}
    </section>
  );
}

export function Review({ entry, series, book }: { entry: ForecastEntryView; series: SeriesView | null; book: BookView }) {
  const statics = useGame((s) => s.statics);
  const { openReview, startDraft } = useForecast();
  const methods = known(book);
  const advanced = isAdvanced(book.methods);
  const key = `${entry.id}:${entry.track.length}:${series?.last_close}:${methods.join(",")}`;
  const cache = useRef<{ key: string; review: ReturnType<typeof reviewEntry> } | null>(null);
  if (!statics) return null;
  if (cache.current?.key !== key) cache.current = { key, review: reviewEntry(entry, series, methods, advanced) };
  const rv = cache.current.review;
  const ev = rv.evaluation;
  const done = entry.track.length >= entry.horizon;

  // 图：拟合窗口 + 预测期（预测与区间从起点价格画起，实际价格另画）
  const n = entry.fitted_on.length;
  const days = [...entry.fitted_on.map((_, i) => entry.origin - (n - 1 - i)), ...entry.path.map((_, i) => entry.origin + i + 1)];
  const pad = (k: number) => new Array<number | null>(k).fill(null);
  const from = (xs: number[]) => [...pad(n - 1), entry.fitted_on[n - 1], ...xs];
  const revisions = book.entries
    .filter((x) => x.revises === entry.id)
    .map((x) => ({
      name: `${t("fc.ch.revision")} #${x.id}`,
      data: days.map((d) => {
        const i = d - x.origin - 1;
        return i >= 0 && i < x.path.length ? x.path[i].mean : null;
      }),
    }));
  const after = [...pad(n - 1), entry.fitted_on[n - 1], ...entry.path.map((_, i) => entry.track[i]?.price ?? null)];

  const dirOf = (v: number) => t(v > 0 ? "fc.sum.up" : "fc.sum.down");
  const a = rv.attribution;
  return (
    <div className="fc-review" data-testid="fc-review">
      <button type="button" className="btn small" onClick={() => openReview(null)}>
        {t("fc.rv.back")}
      </button>
      <h4>
        {entryLabel(statics, entry)} <em className={`tag fc-verdict fc-verdict-${ev.verdict}`}>{verdictLabel(ev.verdict)}</em>
      </h4>
      <p className="sub">{methodFull(entry.spec.method)}</p>
      {!done && book.last_close !== null && entry.origin + entry.horizon <= book.last_close && (
        <p className="fc-note" data-testid="fc-waiting">
          {t("fc.rv.waiting")}
        </p>
      )}
      <ForecastChart
        days={days}
        actual={[...entry.fitted_on, ...pad(entry.path.length)]}
        forecast={from(entry.path.map((p) => p.mean))}
        band80={{ lo: from(entry.path.map((p) => p.lo80)), hi: from(entry.path.map((p) => p.hi80)) }}
        band95={{ lo: from(entry.path.map((p) => p.lo95)), hi: from(entry.path.map((p) => p.hi95)) }}
        after={after}
        revisions={revisions}
        origin={entry.origin}
        height={240}
        testId="fc-review-chart"
      />
      {ev.n === 0 ? (
        // 新界面：说明过几天才对照得出来，“下一步”是下一天；旧界面照旧一行字
        <EmptyState
          text={t("fc.rv.noMarket")}
          hint={t("v2.analysis.fc.rvWaitHint")}
          action={{ label: t("stepDay"), onClick: () => void useGame.getState().step(1) }}
        />
      ) : (
        <>
          <section className="fc-score" data-testid="fc-score">
            <h5>{t("fc.rv.score")}</h5>
            <ul>
              {rv.lastErrorPct !== null && (
                <li>{t("fc.rv.lastError", { dir: dirOf(rv.lastErrorPct), pct: Math.abs(rv.lastErrorPct).toFixed(1) })}</li>
              )}
              <li>{t("fc.rv.mae", { v: fix(ev.mae, 1) })}</li>
              <li>{t("fc.rv.mape", { v: fix(ev.mape, 1) })}</li>
              <li>{t("fc.rv.bias", { dir: t(ev.bias > 0 ? "fc.f.biasLow" : "fc.f.biasHigh"), v: fix(Math.abs(ev.bias), 1) })}</li>
              <li>{t("fc.rv.cov", { c80: Math.round(ev.cov80 * 100), c95: Math.round(ev.cov95 * 100) })}</li>
              <li>{t("fc.rv.ts", { v: fix(ev.ts, 1) })}</li>
              {Number.isFinite(ev.theilU) && <li>{t("fc.rv.theil", { v: fix(ev.theilU) })}</li>}
            </ul>
          </section>
          <section className="fc-causes" data-testid="fc-causes">
            <h5>{t("fc.rv.causes")}</h5>
            <ul>
              {rv.findings.length === 0 ? <li>{t("fc.f.none")}</li> : rv.findings.map((f, i) => <li key={i}>{findingText(f)}</li>)}
            </ul>
            <h5>{t("fc.rv.market")}</h5>
            {a ? (
              <>
                <p>
                  {t("fc.rv.marketTotal", { from: a.from, to: a.to, dir: t(a.total >= 0 ? "fc.rv.rose" : "fc.rv.fell"), pct: Math.abs(a.pct).toFixed(1) })}
                  {a.approximate && <small> {t("fc.rv.approx")}</small>}
                </p>
                <ul className="fc-drivers" data-testid="fc-drivers">
                  {a.drivers.slice(0, 6).map((d) => (
                    <li key={d.key} className={d.effect > 0 ? "up" : "down"}>
                      {driverText(d)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              // 新界面：行情归因要这处的行情序列——“下一步”调出这处的行情（复盘还开着，归因随即出现）；旧界面照旧一行字
              <EmptyState
                className="is-compact"
                text={t("fc.rv.noMarket")}
                hint={t("v2.analysis.fc.rvNoAttrHint")}
                action={{ label: t("v2.analysis.fc.rvLoadMarket"), onClick: () => useForecast.getState().select(entry.loc, entry.good) }}
              />
            )}
            {entry.marks.length > 0 && (
              <>
                <h5>{t("fc.rv.events")}</h5>
                <ul>
                  {entry.marks.map((m, i) => (
                    <li key={i}>{markText(m)}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <Comment
            key={entry.id}
            entry={entry}
            place={entryLabel(statics, entry)}
            facts={[...rv.findings.map(findingText), ...(a ? a.drivers.slice(0, 3).map(driverText) : [])]}
          />
          <section className="fc-adjust" data-testid="fc-adjust">
            <h5>{t("fc.rv.adjust")}</h5>
            <ul>
              {rv.suggestions.map((s, i) => (
                <li key={i}>
                  {suggestionText(s)}{" "}
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => startDraft({ revises: entry.id, kind: s.kind, reason: s.reason, note: "" }, s.spec, entry.loc, entry.good)}
                  >
                    {t("fc.s.try")}
                  </button>
                </li>
              ))}
            </ul>
            {book.entries
              .filter((x) => x.revises === entry.id)
              .map((x) => {
                const rep = compareRevision(entry, x);
                if (!rep) return null;
                return (
                  <p key={x.id} className="fc-note">
                    {t("fc.rv.revisionEval", { id: x.id, days: rep.days, dir: t(rep.improvement >= 0 ? "fc.rv.better" : "fc.rv.worse"), pct: Math.abs(rep.improvement).toFixed(0) })}
                  </p>
                );
              })}
          </section>
        </>
      )}
    </div>
  );
}

