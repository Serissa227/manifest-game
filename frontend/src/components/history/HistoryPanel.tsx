// 历史的天平（FRAMEWORK §11.4，docs/UI-CONTRACT.md I7）：三页——
// 时间线：进行中与将来的事件卡片：双方、天平（按掌握的情报画一个区间，消息越旧越宽）、倒计时、各个杠杆（进度、你的份额、风险与说明、怎么做）、
//   "为什么难"（还缺几类杠杆、对手会加码、反噬、朝廷那一关）；揭晓以后写本世界线的结果与史实对照。
// 战役链：各根源变量的当前区间与史实轨迹的折线、门槛事件过没过、惯性的说明、按现在的变量估计的"胜负 × 走向"。
// 编年史：本世界线与史实的对照。
// 改变历史是可能的，但不容易——界面把难处写明白，而不替玩家算最优解。
// 配乐：窗口开着时，一件事揭晓（改写了历史、没能改变、照着史实）或你出过力的事件期限迫近，奏一句时间线的短乐句（audio/stings.ts）。
// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 9 组）只在 v2 下多画这些（v1 的 DOM 不变）：
//   时间线顶上一句引导、事件按“进行中 / 将要发生 / 已揭晓”分组；天平下写明偏向哪一方（色带按契约画在占优的一方那边）；
//   杠杆的操作都在行里——送货的表单直接摊开、“全部 n”一键填满，出钱有一排快捷金额，做不了与没办成都就地写原因，办成在提示条回一句；
//   “去某处”的杠杆写明要亲自去办，地点在航海图上时一键“在航海图上看某地”（关掉窗口、换到航海图、选中那里）；
//   时间线与编年史是空的时候给“下一步”；战役链与编年史加小标题与图例。
import { useEffect, useMemo, useRef, useState } from "react";
import { requestSting, timelineSting } from "../../audio/stings";
import { useView } from "../../hooks/useView";
import { money, num, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { ContributePayload, LeverView, TimelineEvent, TimelineView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, InlineError, Loading } from "../feedback";
import LoreImage from "../LoreImage";
import { closeWindow } from "../shell/shellState";
import { balanceSpan, balanceLean, driftPath, leverShare, sortEvents } from "./historyKit";
import { tz } from "../../i18n/zhOnly";
import { scrubKeys, shownName, shownSources, type KeyNames } from "../shownText";

type Page = "timeline" | "campaign" | "chronicle";

/** 没办成的那一个杠杆（v2 就地写原因）。 */
interface LeverFailure {
  event: string;
  lever: string;
  msg: string;
}

/** 出钱的快捷金额（v2）：比现金多的不可点。 */
const QUICK_AMOUNTS = [1000, 5000, 10000] as const;

/** 在航海图上看某个地点（v2，“去某处”的杠杆）：先选中（窗口开着，不会因此再打开），再关掉窗口、换到航海图。 */
function showOnChart(loc: number) {
  const g = useGame.getState();
  g.selectLoc(loc);
  closeWindow();
  g.setStage("chart");
}

function Balance({ e }: { e: TimelineEvent }) {
  const v2 = useIsV2();
  if (e.sides.length < 2) return null;
  // v2：揭晓过、又没有天平数据的事件不画一根“情报不足”的空槽（结果写在下面）
  if (v2 && e.status === "resolved" && !e.balance) return null;
  const b = e.balance;
  const span = b ? balanceSpan(b.lo, b.hi) : null;
  // v2 按契约画（“正数偏向第一方、第一方在左”）：色带落在占优的一方那边（区间太窄时加宽到 1.5%，以区间为中心）。
  // v1 照旧（见 docs/DECISIONS.md）
  const width = span ? Math.max(1.5, span.to - span.from) : 0;
  const left = span ? (v2 ? 100 - span.to - (width - (span.to - span.from)) / 2 : span.from) : 0;
  const lean = v2 && b ? balanceLean(b, e.sides[0].name, e.sides[1].name) : null;
  return (
    <div className="hs-balance" data-testid={`balance-${e.key}`}>
      <span className="hs-side hs-side-a" style={e.sides[0].color ? { borderColor: e.sides[0].color } : undefined}>
        {e.sides[0].name}
      </span>
      <span className="hs-scale" role="meter" aria-label={t("hs.balance")} aria-valuemin={-60} aria-valuemax={60} aria-valuenow={b ? Math.round((b.lo + b.hi) / 2) : 0} aria-valuetext={b ? tk(`hs.known.${b.known}`) : t("hs.unknownBalance")}>
        <span className="hs-scale-mid" />
        {span && b?.known !== "unknown" ? (
          <span className={`hs-scale-range hs-known-${b!.known}`} style={{ left: `${left}%`, width: `${width}%` }} />
        ) : (
          <span className="hs-scale-fog">{t("hs.unknownBalance")}</span>
        )}
      </span>
      <span className="hs-side hs-side-b" style={e.sides[1].color ? { borderColor: e.sides[1].color } : undefined}>
        {e.sides[1].name}
      </span>
      {lean && b && (
        <span className="hs-lean">
          <b>{lean.side ? t("v2.history.lean", { side: lean.side }) : t("v2.history.even")}</b>
          <span>{tk(`hs.known.${b.known}`)}</span>
        </span>
      )}
    </div>
  );
}

interface LeverRowProps {
  ev: TimelineEvent;
  l: LeverView;
  busy: boolean;
  /** 上一次在这个杠杆上没办成的原因（v2 就地写出） */
  error?: string | null;
  onSubmit: (payload: Parameters<typeof contributeCmd>[2]) => void;
}

/** 一个杠杆：v1 维持原样；v2 的操作都在行里（见文件开头的说明）。 */
function LeverRow(props: LeverRowProps) {
  return useIsV2() ? <LeverRowV2 {...props} /> : <LeverRowV1 {...props} />;
}

function LeverRowV1({ ev, l, busy, onSubmit }: LeverRowProps) {
  const fleets = useGame((s) => s.overview?.fleets ?? []);
  const [open, setOpen] = useState(false);
  const [fleet, setFleet] = useState<number | null>(fleets[0]?.id ?? null);
  const [good, setGood] = useState<number | null>(l.goods[0]?.good ?? null);
  const [qty, setQty] = useState(10);
  const [donate, setDonate] = useState(false);
  const [amount, setAmount] = useState(1000);
  const share = leverShare(l);
  const side = ev.sides.find((s) => s.key === l.side)?.name ?? l.side;
  return (
    <li className={`hs-lever${l.enabled ? "" : " is-blocked"}`} data-testid={`lever-${l.key}`}>
      <div className="hs-lever-head">
        <span className="hs-lever-side">{side}</span>
        <span className="hs-lever-label">{l.label}</span>
        {l.where && <span className="hs-lever-where">{l.where}</span>}
      </div>
      <span className="hs-lever-bar" aria-label={t("hs.leverProgress", { n: l.progress.points, max: l.progress.max, yours: l.yours })}>
        <span className="hs-lever-all" style={{ width: `${share.done * 100}%` }} />
        <span className="hs-lever-yours" style={{ width: `${share.yours * 100}%` }} />
      </span>
      <p className="hs-lever-meta">
        <span>{t("hs.points", { n: l.progress.points, max: l.progress.max })}</span>
        {l.yours > 0 && <span className="is-good">{t("hs.yours", { n: l.yours })}</span>}
        {l.risk && <span className="is-cost">{l.risk}</span>}
        {l.note && <span>{l.note}</span>}
        {!l.enabled && l.blocked_reason && <span className="is-cost">{l.blocked_reason}</span>}
      </p>
      {l.enabled && l.action && l.action !== "goto" && (
        <div className="hs-lever-do">
          {l.action === "commit" && (
            <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={() => onSubmit({ Commit: {} })}>
              {t("hs.commit")}
            </button>
          )}
          {l.action === "money" && (
            <>
              <input type="number" min={100} step={100} value={amount} aria-label={t("hs.amount")} onChange={(e) => setAmount(Number(e.target.value))} />
              <button type="button" className="ts-btn ts-btn-small" disabled={busy || amount <= 0} onClick={() => onSubmit({ Money: { amount } })}>
                {t("hs.give", { v: money(amount) })}
              </button>
            </>
          )}
          {l.action === "deliver" &&
            (open ? (
              <>
                <select aria-label={t("hs.fleet")} value={fleet ?? ""} onChange={(e) => setFleet(Number(e.target.value))}>
                  {fleets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {t("holder.fleet", { id: f.id })}
                    </option>
                  ))}
                </select>
                <select aria-label={t("hs.goods")} value={good ?? ""} onChange={(e) => setGood(Number(e.target.value))}>
                  {l.goods.map((g) => (
                    <option key={g.good} value={g.good}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <input type="number" min={1} value={qty} aria-label={t("hs.qty")} onChange={(e) => setQty(Number(e.target.value))} />
                <label className="hs-donate">
                  <input type="checkbox" checked={donate} onChange={(e) => setDonate(e.target.checked)} />
                  {t("hs.donate")}
                </label>
                <button type="button" className="ts-btn ts-btn-small" disabled={busy || fleet === null || good === null || qty <= 0} onClick={() => fleet !== null && good !== null && onSubmit({ Deliver: { fleet, goods: [[good, qty]], donate } })}>
                  {t("hs.deliver")}
                </button>
              </>
            ) : (
              <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={() => setOpen(true)}>
                {t("hs.deliverOpen")}
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

/**
 * 新界面的杠杆：左边是名目、进度与说明，右边（手机上在下面）是这一行的操作——
 * 去做：一个按钮；出钱：金额 + 一排快捷金额 + “出 n 金币”；送货：表单直接摊开（只有一支舰队、一种货时不出下拉），
 * “全部 n”按所选舰队舱里的数量一键填满，一支舰队都没有时就地写“先要有一支舰队”（养成开局不带船）；
 * 去某处（goto）：不在这里点，说明里写明要亲自去办，地名对得上地点时右边是“在航海图上看某地”，对不上时右边不放东西
 * （不放一个看着像按钮的小签，说明已经写了去哪里）。做不了的原因与没办成的原因都写在行里（触屏看不到悬停提示）。
 */
function LeverRowV2({ ev, l, busy, error, onSubmit }: LeverRowProps) {
  const fleets = useGame((s) => s.overview?.fleets ?? []);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const [picked, setPicked] = useState<number | null>(fleets[0]?.id ?? null);
  // 窗口开着时舰队会变（卖掉、沉了、刚买到第一条船）：选过的那支不在了就退回第一支，一支都没有时为 null
  const fleet = fleets.some((f) => f.id === picked) ? picked : (fleets[0]?.id ?? null);
  const noFleet = fleets.length === 0;
  const [good, setGood] = useState<number | null>(l.goods[0]?.good ?? null);
  const [qty, setQty] = useState(10);
  const [donate, setDonate] = useState(false);
  const [amount, setAmount] = useState(1000);
  const share = leverShare(l);
  const sideOf = ev.sides.find((s) => s.key === l.side);
  const act = l.enabled && l.action && l.action !== "goto" ? l.action : null;
  const goto = l.enabled && l.action === "goto";
  // 去某处：地名对得上航海图上的地点（且看见过：隐藏未知港口的世界里不借此泄露）时，可以一键去看
  const gotoLoc = useGame((s) => {
    if (!goto || !l.where) return null;
    const sighted = s.overview?.sighted;
    return s.statics?.locations.find((x) => x.name === l.where && (!sighted || sighted.includes(x.id))) ?? null;
  });
  // 所选舰队舱里有多少这种货（“全部 n”）
  const have = fleets.find((f) => f.id === fleet)?.cargo.find((c) => c.good === good)?.qty ?? 0;
  const shortCash = act === "money" && amount > cash;
  const whyId = `hs-why-${ev.key}-${l.key}`;
  return (
    <li className={`hs-lever${l.enabled ? "" : " is-blocked"}${act === "deliver" ? " is-wide" : ""}`} data-testid={`lever-${l.key}`}>
      <div className="hs-lever-main">
        <div className="hs-lever-head">
          <span className="hs-lever-side" style={sideOf?.color ? { borderColor: sideOf.color } : undefined}>
            {sideOf?.name ?? l.side}
          </span>
          <span className="hs-lever-label">{l.label}</span>
          {l.where && <span className="hs-lever-where">{l.where}</span>}
        </div>
        <div className="hs-lever-prog">
          <span
            className="hs-lever-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={l.progress.max}
            aria-valuenow={l.progress.points}
            aria-label={t("hs.leverProgress", { n: l.progress.points, max: l.progress.max, yours: l.yours })}
          >
            <span className="hs-lever-all" style={{ width: `${share.done * 100}%` }} />
            <span className="hs-lever-yours" style={{ width: `${share.yours * 100}%` }} />
          </span>
          <span className="hs-lever-pts">{t("hs.points", { n: l.progress.points, max: l.progress.max })}</span>
          {l.yours > 0 && <span className="hs-lever-mine">{t("hs.yours", { n: l.yours })}</span>}
        </div>
        {(l.risk || l.note) && (
          <p className="hs-lever-meta">
            {l.risk && <span className="is-cost">{l.risk}</span>}
            {l.note && <span>{l.note}</span>}
          </p>
        )}
        {goto && <p className="hs-lever-goto">{l.where ? t("v2.history.gotoHint", { where: l.where }) : t("v2.history.gotoHintAny")}</p>}
      </div>
      {gotoLoc && (
        <div className="hs-lever-do">
          <button type="button" className="btn small hs-act" onClick={() => showOnChart(gotoLoc.id)}>
            {t("v2.history.seeOnChart", { where: gotoLoc.name })}
          </button>
        </div>
      )}
      {act && (
        <div className="hs-lever-do">
          {act === "commit" && (
            <button type="button" className="btn small hs-act" disabled={busy} onClick={() => onSubmit({ Commit: {} })}>
              {t("hs.commit")}
            </button>
          )}
          {act === "money" && (
            <>
              <input className="hs-amount" type="number" min={100} step={100} value={amount} aria-label={t("hs.amount")} onChange={(e) => setAmount(Number(e.target.value))} />
              <span className="hs-chips" role="group" aria-label={t("v2.history.quickAmount")}>
                {QUICK_AMOUNTS.map((v) => (
                  <button key={v} type="button" className={amount === v ? "hs-chip is-on" : "hs-chip"} aria-pressed={amount === v} disabled={busy || v > cash} onClick={() => setAmount(v)}>
                    {num(v)}
                  </button>
                ))}
              </span>
              <button type="button" className="btn small hs-act" disabled={busy || amount <= 0 || shortCash} aria-describedby={shortCash ? whyId : undefined} onClick={() => onSubmit({ Money: { amount } })}>
                {t("hs.give", { v: money(amount) })}
              </button>
            </>
          )}
          {act === "deliver" && (
            <>
              {fleets.length > 1 && (
                <select aria-label={t("hs.fleet")} value={fleet ?? ""} onChange={(e) => setPicked(Number(e.target.value))}>
                  {fleets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {t("holder.fleet", { id: f.id })}
                    </option>
                  ))}
                </select>
              )}
              {l.goods.length > 1 ? (
                <select aria-label={t("hs.goods")} value={good ?? ""} onChange={(e) => setGood(Number(e.target.value))}>
                  {l.goods.map((g) => (
                    <option key={g.good} value={g.good}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="hs-good">{l.goods[0]?.name}</span>
              )}
              <input className="hs-qty" type="number" min={1} value={qty} aria-label={t("hs.qty")} onChange={(e) => setQty(Number(e.target.value))} />
              {have > 0 ? (
                <button type="button" className={qty === have ? "hs-chip is-on" : "hs-chip"} aria-pressed={qty === have} disabled={busy} onClick={() => setQty(have)}>
                  {t("v2.history.all", { n: num(have) })}
                </button>
              ) : (
                !noFleet && <span className="hs-nocargo">{t("v2.history.noCargo")}</span>
              )}
              <label className="hs-donate">
                <input type="checkbox" checked={donate} onChange={(e) => setDonate(e.target.checked)} />
                {t("hs.donate")}
              </label>
              <button
                type="button"
                className="btn small hs-act"
                disabled={busy || fleet === null || good === null || qty <= 0}
                aria-describedby={noFleet ? whyId : undefined}
                onClick={() => fleet !== null && good !== null && onSubmit({ Deliver: { fleet, goods: [[good, qty]], donate } })}
              >
                {t("hs.deliver")}
              </button>
            </>
          )}
        </div>
      )}
      {!l.enabled && l.blocked_reason && <InlineError tone="blocked" compact className="hs-lever-why" reason={l.blocked_reason} />}
      {shortCash && <InlineError tone="blocked" compact id={whyId} className="hs-lever-why" reason={t("v2.history.shortCash", { v: money(cash) })} />}
      {act === "deliver" && noFleet && <InlineError tone="blocked" compact id={whyId} className="hs-lever-why" reason={t("v2.history.noFleet")} fix={t("v2.history.noFleetFix")} />}
      {error && <InlineError compact className="hs-lever-why" reason={error} fix={t("v2.history.retry")} />}
    </li>
  );
}

/** 提交贡献的命令（这里只为了给 LeverRow 的 payload 一个类型）。 */
function contributeCmd(event: string, lever: string, payload: ContributePayload) {
  return { Contribute: { owner: "player" as const, event, lever, payload } };
}

function EventCard({
  e,
  busy,
  onContribute,
  readOnly,
  failure = null,
}: {
  e: TimelineEvent;
  busy: boolean;
  onContribute: (lever: LeverView, payload: ContributePayload) => void;
  readOnly: boolean;
  /** 上一次没办成的杠杆（v2 就地写原因） */
  failure?: LeverFailure | null;
}) {
  const v2 = useIsV2();
  return (
    <li className={`hs-event hs-event--${e.status}`} data-testid={`event-${e.key}`}>
      {/* 寰宇的历史事件插画（art/lore.ts 的 event_<事件 key>；没有图的世界什么也不画） */}
      <LoreImage art={`event_${e.key}`} size="medium" className="hs-art" testId={`event-art-${e.key}`} plain />
      <header className="hs-event-head">
        <h4>{e.title}</h4>
        <span className="hs-when">
          {e.date ? t("ub.dateYmd", { y: e.date[0], m: e.date[1], d: e.date[2] }) : t("hs.triggered")}
          {e.days_left !== null && e.status !== "resolved" && <b>{t("hs.daysLeft", { n: e.days_left })}</b>}
        </span>
        {shownName(e.region) && <span className="hs-region">{shownName(e.region)}</span>}
      </header>
      <p className="hs-summary">{e.summary}</p>
      <Balance e={e} />
      {e.outcome && (
        <p className={e.outcome.historical ? "hs-outcome" : "hs-outcome is-changed"}>
          <b>{e.outcome.historical ? t("hs.asHistory") : t("hs.changed")}</b> {scrubKeys(e.outcome.text)}
          {(!e.outcome.history || scrubKeys(e.outcome.history)) && <span className="hs-history">{t("hs.history", { text: scrubKeys(e.outcome.history) })}</span>}
        </p>
      )}
      {e.narration && (e.narration.opening || e.narration.progress || e.narration.ending) && (
        <div className="hs-narration" aria-label={t("hs.narration")}>
          {[e.narration.opening, e.narration.progress, e.narration.ending].filter((x): x is string => !!x).map((x, i) => (
            <p key={i}>{x}</p>
          ))}
        </div>
      )}
      {v2 && e.status !== "resolved" && e.levers.length > 0 && <h5 className="hs-mini-head">{readOnly ? t("hs.levers") : t("v2.history.leversHead")}</h5>}
      {e.status !== "resolved" && e.levers.length > 0 && (
        <ul className="hs-levers" aria-label={t("hs.levers")}>
          {e.levers.map((l) => (
            <LeverRow
              key={l.key}
              ev={e}
              // 只读时什么都做不了：v2 也不写“做不了的原因”（写了像是补上条件就能做）；v1 照旧
              l={readOnly ? { ...l, enabled: false, action: null, ...(v2 ? { blocked_reason: undefined } : {}) } : l}
              busy={busy}
              error={failure?.event === e.key && failure.lever === l.key ? failure.msg : null}
              onSubmit={(p) => onContribute(l, p)}
            />
          ))}
        </ul>
      )}
      {v2 && e.status !== "resolved" && e.why_hard.length > 0 && <h5 className="hs-mini-head">{t("hs.whyHard")}</h5>}
      {e.status !== "resolved" && e.why_hard.length > 0 && (
        <ul className="hs-why" aria-label={t("hs.whyHard")}>
          {e.why_hard.map((w, i) => (
            <li key={i}>{scrubKeys(w)}</li>
          ))}
        </ul>
      )}
      {shownSources(e.sources).length > 0 && (
        <p className="it-source">
          {e.basis && <span className="it-basis">{tk(`it.basis.${e.basis}`)}</span>}
          {shownSources(e.sources).join("；")}
        </p>
      )}
    </li>
  );
}

function CampaignPage({ keyName }: { keyName: string }) {
  const v2 = useIsV2();
  const { data: c } = useView(`campaign:${keyName}`, () => api.campaign(keyName), { quiet: true });
  if (!c) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  const years = c.vars.flatMap((v) => v.drift.map(([y]) => y));
  // FIX4F：后端偶尔把变量、事件的键原样带出来（ming_court）：认得的换成这一页里的显示名，认不得的不显示
  const names: KeyNames = (k) => c.vars.find((v) => v.key === k)?.name ?? c.events.find((e) => e.key === k)?.title;
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  return (
    <section className="hs-campaign" aria-label={c.name} data-testid="campaign">
      <p className="hs-summary">{c.summary}</p>
      <p className="hs-inertia">{t("hs.inertia", { n: c.inertia })}</p>
      {c.outlook && <p className="hs-outlook">{t("hs.outlook", { text: c.outlook })}</p>}
      {v2 && (
        <div className="hs-vars-head">
          <h5 className="hs-mini-head">{t("v2.history.varsHead")}</h5>
          <span className="hs-legend" aria-hidden="true">
            <span className="hs-legend-drift">{t("v2.history.legendDrift")}</span>
            <span className="hs-legend-now">{t("v2.history.legendNow")}</span>
          </span>
        </div>
      )}
      <ul className="hs-vars">
        {c.vars.map((v) => {
          const span = { from: Math.min(v.value.lo, v.value.hi), to: Math.max(v.value.lo, v.value.hi) };
          return (
            <li key={v.key} className={`hs-var hs-var--${v.kind}`} data-testid={`var-${v.key}`}>
              <p className="hs-var-head">
                <b>{v.name}</b>
                {shownName(v.court, names, true) && <span>{shownName(v.court, names, true)}</span>}
                <span>{v.value.known === "unknown" ? t("hs.unknownBalance") : t("hs.varValue", { lo: span.from, hi: span.to, base: v.baseline })}</span>
                {v.cap !== null && <span className="is-cost">{t("hs.cap", { n: v.cap })}</span>}
              </p>
              <svg className="hs-spark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden>
                <path d={driftPath(v.drift, 240, 48, y0, y1)} className="hs-drift" />
                {v.value.known !== "unknown" && <rect x={0} width={240} y={48 - (span.to / 100) * 48} height={Math.max(2, ((span.to - span.from) / 100) * 48)} className="hs-now" />}
              </svg>
              {v.gates.length > 0 && (
                <p className="hs-gates">
                  {v.gates.map((g) => (
                    <span key={g.event} className={g.passed === true ? "is-good" : g.passed === false ? "is-cost" : undefined}>
                      {g.passed === true ? "✓" : g.passed === false ? "✗" : "○"} {shownName(g.name, names) ?? ""}
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {v2 && c.events.length > 0 && <h5 className="hs-mini-head">{t("v2.history.chainHead")}</h5>}
      <ol className="hs-chain">
        {c.events.map((e) => (
          <li key={e.key} className={`hs-chain-${e.status}`}>
            <span>{shownName(e.title, names) ?? ""}</span>
            {e.date && <small>{t("ub.dateYmd", { y: e.date[0], m: e.date[1], d: e.date[2] })}</small>}
            {e.outcome && scrubKeys(e.outcome, names) && <small className="hs-chain-out">{scrubKeys(e.outcome, names)}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function HistoryPanel() {
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const [page, setPage] = useState<Page>("timeline");
  const [camp, setCamp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LeverFailure | null>(null);

  const { data: tl } = useView("timeline", () => api.timeline(), { quiet: true });
  const { data: chron } = useView(page === "chronicle" ? "chronicle" : null, () => api.chronicle(), { quiet: true });

  // 配乐：时间线每换一份，就与上一份比较（刚打开窗口时早就揭晓的事不算，期限每件事只奏一次；见 timelineSting）
  const prevTl = useRef<TimelineView | null>(null);
  const warned = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tl) return;
    const r = timelineSting(prevTl.current, tl, warned.current);
    for (const k of r.warn) warned.current.add(k);
    prevTl.current = tl;
    if (r.sting) requestSting(r.sting);
  }, [tl]);

  const events = useMemo(() => (tl ? sortEvents(tl.events) : []), [tl]);
  const campaigns = useMemo(() => [...new Set(events.map((e) => e.campaign).filter((c): c is string => !!c))], [events]);
  if (!tl) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;

  const contribute = (event: string, lever: LeverView, payload: ContributePayload) => {
    setBusy(true);
    if (v2) setFailure(null);
    void submit(contributeCmd(event, lever.key, payload))
      .then((r) => {
        // v2：办成在提示条回一句；没办成（错误已由提示条报过）同时写在那个杠杆的行里
        if (!v2) return;
        if (r) useGame.getState().notify(t("v2.history.contributed", { label: lever.label }));
        else setFailure({ event, lever: lever.key, msg: useGame.getState().error ?? "" });
      })
      .finally(() => setBusy(false));
  };
  const card = (e: TimelineEvent) => (
    <EventCard key={e.key} e={e} busy={busy} readOnly={!tl.history_on} failure={failure} onContribute={(lever, payload) => contribute(e.key, lever, payload)} />
  );
  // v2 的时间线按状态分组（sortEvents 已经排好：进行中、将来的、揭晓过的）
  const groups = (["active", "future", "resolved"] as const).map((st) => ({ st, list: events.filter((e) => e.status === st) })).filter((g) => g.list.length > 0);

  return (
    <div className="hs-panel" data-testid="history">
      <div className="ub-tabs" role="tablist" aria-label={t("hs.pages")}>
        {(["timeline", "campaign", "chronicle"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={page === p} className={page === p ? "ub-tab is-on" : "ub-tab"} onClick={() => setPage(p)} disabled={p === "campaign" && campaigns.length === 0}>
            {tk(`hs.page.${p}`)}
          </button>
        ))}
        <span className="hs-deviation">{t("hs.deviation", { n: tl.deviation })}</span>
      </div>
      {!tl.history_on && <p className="it-lead">{t("hs.readOnly")}</p>}
      {page === "timeline" &&
        (!v2 ? (
          <ul className="hs-events">{events.map(card)}</ul>
        ) : events.length === 0 ? (
          <EmptyState
            text={t("v2.history.emptyTimeline")}
            hint={t("v2.history.emptyTimelineHint")}
            action={{ label: t("v2.history.toChronicle"), onClick: () => setPage("chronicle") }}
          />
        ) : (
          <>
            {tl.history_on && <p className="hs-lead">{t("v2.history.lead")}</p>}
            {groups.map((g) => (
              <section key={g.st} className={`hs-group hs-group--${g.st}`} aria-labelledby={`hs-group-${g.st}`}>
                <h3 className="hs-group-head" id={`hs-group-${g.st}`}>
                  {tk(`v2.history.group.${g.st}`)}{" "}
                  <span className="hs-group-n">{g.list.length}</span>
                </h3>
                <ul className="hs-events">{g.list.map(card)}</ul>
              </section>
            ))}
          </>
        ))}
      {page === "campaign" && campaigns.length > 0 && (
        <>
          {campaigns.length > 1 && (
            <select aria-label={t("hs.page.campaign")} value={camp ?? campaigns[0]} onChange={(e) => setCamp(e.target.value)}>
              {/* FIX4F：时间线只带战役链的键（liaodong），没有名字：是键时写“第几条”，等后端带名字 */}
              {campaigns.map((c, i) => (
                <option key={c} value={c}>
                  {shownName(c, undefined, true) ?? tz("hs.campaignN", { n: i + 1 })}
                </option>
              ))}
            </select>
          )}
          <CampaignPage keyName={camp ?? campaigns[0]} />
        </>
      )}
      {page === "chronicle" &&
        (chron ? (
          v2 && chron.entries.length === 0 ? (
            <EmptyState
              text={t("v2.history.emptyChronicle")}
              hint={t("v2.history.emptyChronicleHint")}
              action={{ label: t("v2.history.toTimeline"), onClick: () => setPage("timeline") }}
            />
          ) : (
            <>
              {v2 && chron.entries.some((x) => x.deviates) && (
                <p className="hs-legend hs-chron-legend" aria-hidden="true">
                  <span className="hs-legend-dev">{t("v2.history.deviates")}</span>
                </p>
              )}
              <ol className="hs-chronicle">
                {chron.entries.map((x, i) =>
                  // 年度回顾：正文已把当年各事的结局与史书的出入写进去，不再另挂一行史实
                  x.annual ? (
                    <li key={i} className="hs-annual">
                      <small>
                        {t("hs.annual", { y: x.date[0] })}
                        {x.ai && <span className="ub-ai-mark" title={t("ub.aiWritten")} aria-label={t("ub.aiWritten")} />}
                      </small>
                      <span>{x.text}</span>
                    </li>
                  ) : (
                    <li key={i} className={x.deviates ? "is-changed" : undefined}>
                      <small>
                        {t("ub.dateYmd", { y: x.date[0], m: x.date[1], d: x.date[2] })}
                        {v2 && x.deviates && <span className="v2-sr">{t("v2.history.deviates")}</span>}
                      </small>
                      <span>{x.text}</span>
                      {x.history && <span className="hs-history">{t("hs.history", { text: x.history })}</span>}
                    </li>
                  ),
                )}
              </ol>
            </>
          )
        ) : (
          <Loading v1={<p className="ts-empty">{t("loading")}</p>} />
        ))}
    </div>
  );
}
