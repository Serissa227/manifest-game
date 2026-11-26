// U06F3：行动制内核二（K2）接上界面的几块，都塞进已有的位置，不另起常驻面板：
// - MomentBar：课上停在关键时刻时的底栏（稳 / 险 / 巧三张卡，一次点击发 AnswerMoment）；
// - K2Chips：顶栏里一行“主命 1/2 · 身份 1 级 12/60 · 病中”，点开一张小卡看主命目标、奖励、评定与本季；
// - Ladder：课表里“各档对照”（每门各档的期望长进、学费、器具费、缺什么，能拜师的给按钮）；
// - ScoreBook：手账抽屉顶上的总评（事迹分、五档、结业时带走的清单）；跳过养成的确认框里也用它的简版；
// - SummaryK2：小结里的一行（主命成败、评定、病、关键时刻）。
// 视图字段见 ipc/actTypes.ts 的 K2 一节；字在 i18n/zhOnly.ts（ub.act.*）。
import { useEffect, useState } from "react";
import { tz, type ZhOnlyKey } from "../../../i18n/zhOnly";
import type { ActView, CapitalPreview, LineView, MomentOption } from "../../../ipc/actTypes";
import type { UpbringingView } from "../../../ipc/types";
import { useGame } from "../../../store/game";
import { isTyping, layerOpen } from "../../shell/hotkeys";
import { OWNER, type ActCtx } from "./actCtx";
import {
  bandName,
  BANDS,
  canMaster,
  capitalRowName,
  capitalSource,
  goalText,
  missionProgress,
  missionText,
  pickName,
  rankName,
  rewardText,
  tierFacts,
  tierNeeds,
  tierOpen,
} from "./k2Kit";
import { signed, stageLines, type ActNames } from "./actKit";
import { useK3Names } from "./useK3Names";

/** 结业清单用不到潮名（潮名要所在城市），给一个空的城市 */
const NO_TOWN = { town: null } as unknown as UpbringingView;

function useTexts(): Readonly<Record<string, string>> {
  return useGame((s) => s.statics?.upbringing_act_texts) ?? {};
}

// ───────────── 关键时刻 ─────────────

function optionHint(o: MomentOption, line: LineView | undefined, names: ActNames): string {
  const attr = o.attr ? names.attr(o.attr) : "";
  if (o.pick === "steady") return tz("ub.act.moment.steady.hint", { win: o.win_pct });
  if (o.pick === "risky") return tz("ub.act.moment.risky.hint", { attr, win: o.win_pct, lose: o.lose_pct ?? "?" });
  return o.convert === "cash"
    ? tz("ub.act.moment.clever.hint.cash", { attr })
    : tz("ub.act.moment.clever.hint.side", { attr, side: line?.side ? names.attr(line.side) : "" });
}

export function MomentBar({ ctx, onAnswer }: { ctx: ActCtx; onAnswer: (pick: MomentOption["pick"]) => void }) {
  const { act, names, busy } = ctx;
  const m = act.moment;
  if (!m) return null;
  const line = act.lines.find((l) => l.key === m.line);
  const answered = m.picked !== null;
  return (
    <div className="ua-bar ua-bar--moment" data-testid="ua-moment" role="group" aria-label={tz("ub.act.moment.title")}>
      {!answered && !busy && <MomentKeys picks={m.options.map((o) => o.pick)} onAnswer={onAnswer} />}
      <div className="ua-bar-main">
        <p className="ua-moment-lead">
          <b>{tz("ub.act.moment.title")}</b>
          <span>{tz("ub.act.moment.lead", { d: m.date[2], line: names.line(m.line), t: m.tier + 1 })}</span>
        </p>
        <p className="ua-bar-note">{answered ? tz("ub.act.moment.result.plain", { pick: pickName(m.picked!) }) : tz("ub.act.moment.wait")}</p>
      </div>
      <div className="ua-moment-cards">
        {m.options.map((o, i) => (
          <button
            key={o.pick}
            type="button"
            className={`ua-moment-card is-${o.pick}${m.picked === o.pick ? " is-on" : ""}`}
            data-testid={`ua-moment-${o.pick}`}
            disabled={busy || answered}
            title={optionHint(o, line, names)}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            onClick={() => onAnswer(o.pick)}
          >
            {i < 9 && (
              <kbd className="ua-moment-key" aria-hidden="true">
                {i + 1}
              </kbd>
            )}
            <b className="ua-moment-pick">{pickName(o.pick)}</b>
            <span className="ua-moment-chance">{o.chance_pct === null ? tz("ub.act.moment.sure") : tz("ub.act.moment.chance", { n: o.chance_pct })}</span>
            <span className="ua-moment-nums">
              <span className="ua-up">{tz("ub.act.moment.win", { n: o.win_pct })}</span>
              {o.lose_pct !== null && <span className="ua-down">{tz("ub.act.moment.lose", { n: o.lose_pct })}</span>}
            </span>
            {o.attr && o.need_level !== null && (
              <span className="ua-moment-level">{tz("ub.act.moment.level", { attr: names.attr(o.attr), have: o.have_level ?? "?", need: o.need_level })}</span>
            )}
            {o.pick === "clever" && <span className="ua-moment-hint">{optionHint(o, line, names)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 关键时刻的键盘（FIX4F）：数字键 1 / 2 / 3 选对应的卡（卡的左上角标着数字）。回车照旧不选（有意的：免得一路回车误选）。
 * 在输入框里打字、按着 Ctrl / Alt / ⌘、按键自动重复、有挡住画面的对话框（剧情等）时不管。
 */
function MomentKeys({ picks, onAnswer }: { picks: MomentOption["pick"][]; onAnswer: (pick: MomentOption["pick"]) => void }) {
  const sig = picks.join(",");
  useEffect(() => {
    const list = sig.split(",") as MomentOption["pick"][];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target) || layerOpen()) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const pick = list[Number(e.key) - 1];
      if (!pick) return;
      e.preventDefault();
      onAnswer(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sig, onAnswer]);
  return null;
}

// ───────────── 顶栏：主命、身份、病 ─────────────

export function K2Chips({ ctx }: { ctx: ActCtx }) {
  const { act, names, view } = ctx;
  const texts = useTexts();
  const [open, setOpen] = useState(false);
  const m = act.mission;
  const r = act.rank;
  const ill = act.illness;
  if (!m && !r && !ill) return null;
  const prog = m ? missionProgress(m) : null;
  const contestName = (k: string) => view.contests?.find((c) => c.key === k)?.name ?? k;
  return (
    <div className="ua-k2">
      {ill && (
        <span className="ua-k2-ill" data-testid="ua-ill" title={tz("ub.act.illness.hint", { n: ill.weeks_left })}>
          {tz("ub.act.illness.tag", { n: ill.weeks_left })}
        </span>
      )}
      {(m || r) && (
        <button
          type="button"
          className="ua-k2-chip"
          data-testid="ua-k2"
          aria-expanded={open}
          title={[
            m ? `${tz("ub.act.mission.label")} · ${tz("ub.act.mission.left", { n: m.weeks_left })}` : "",
            r ? (r.next_at !== null ? tz("ub.act.rank.merit", { have: r.merit, need: r.next_at }) : tz("ub.act.rank.meritTop", { have: r.merit })) : "",
          ]
            .filter(Boolean)
            .join("\n")}
          onClick={() => setOpen((v) => !v)}
        >
          {m && prog && (
            <span className={`ua-k2-mission is-${m.status}`}>
              <i>{tz("ub.act.mission.label")}</i>
              {m.status === "active" ? `${prog.done}/${prog.total}` : tz(`ub.act.mission.status.${m.status}` as ZhOnlyKey)}
            </span>
          )}
          {r && (
            <span className={`ua-k2-rank${r.down_risk ? " is-risk" : ""}`}>
              <i>{tz("ub.act.rank.label")}</i>
              {rankName(texts, r.names_key, r.level)}
            </span>
          )}
        </button>
      )}
      {open && (
        <div className="ua-k2-pop" data-testid="ua-k2-pop" role="dialog" aria-label={tz("ub.act.mission.label")}>
          {m ? (
            <section>
              <header>
                <b>{tz("ub.act.mission.label")}</b>
                <span className={`ua-k2-status is-${m.status}`}>{tz(`ub.act.mission.status.${m.status}` as ZhOnlyKey)}</span>
                <span className="ua-quiet">
                  {tz("ub.act.mission.from", { who: names.person(m.giver) })} · {tz("ub.act.mission.due", { m: m.due[1], d: m.due[2] })}
                </span>
              </header>
              <p className="ua-k2-text">{missionText(texts, m.key)}</p>
              <ul className="ua-k2-goals">
                {m.goals.map((g, i) => (
                  <li key={i} className={g.done ? "is-done" : undefined}>
                    {g.done ? "✓ " : "· "}
                    {goalText(g, names, contestName)}
                  </li>
                ))}
              </ul>
              <p className="ua-quiet">
                {tz("ub.act.mission.merit", { n: m.merit })}
                {m.reward.length > 0 && ` · ${tz("ub.act.mission.reward")} ${rewardText(m, names)}`}
              </p>
            </section>
          ) : (
            <p className="ua-quiet">{tz("ub.act.mission.none")}</p>
          )}
          {r && (
            <section>
              <header>
                <b>{tz("ub.act.rank.label")}</b>
                <span>{rankName(texts, r.names_key, r.level)}</span>
                <span className="ua-quiet">
                  {r.next_at !== null ? tz("ub.act.rank.merit", { have: r.merit, need: r.next_at }) : tz("ub.act.rank.meritTop", { have: r.merit })}
                  {r.next_review && ` · ${tz("ub.act.rank.review", { m: r.next_review[1], d: r.next_review[2] })}`}
                </span>
              </header>
              {r.next_at !== null && (
                <span className="ua-k2-bar" aria-hidden>
                  <span style={{ width: `${Math.min(100, Math.round((r.merit / Math.max(1, r.next_at)) * 100))}%` }} />
                </span>
              )}
              <p className="ua-k2-quarter">
                <span className="ua-quiet">{tz("ub.act.rank.quarter")}</span>
                {r.quarter.map((q) => (
                  <span key={`${q.month[0]}-${q.month[1]}`} className={`ua-k2-status is-${q.status}`}>
                    {q.month[1]} 月 {tz(`ub.act.mission.status.${q.status}` as ZhOnlyKey)}
                  </span>
                ))}
              </p>
              {r.down_risk && <p className="ua-down">{tz("ub.act.rank.downRisk")}</p>}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────── 课表：各档对照 ─────────────

export function Ladder({ ctx }: { ctx: ActCtx }) {
  const { act, names, busy } = ctx;
  const lines = stageLines(act);
  const cash = act.money.cash;
  const canAct = (act.phase === "plan" || act.phase === "free") && !act.illness;
  return (
    <div className="ua-ladder" data-testid="ua-ladder">
      <p className="ua-quiet">{tz("ub.act.ladder.hint")}</p>
      <table>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <th scope="row">
                {names.line(l.key)}
                {l.attr && <small>{names.attr(l.attr)}</small>}
              </th>
              {l.tiers.map((t, i) => {
                const open = tierOpen(t);
                const needs = open ? [] : tierNeeds(l, t, names, act);
                const master = canMaster(t);
                const gift = t.gift ?? l.master_cost ?? 0;
                const short = gift - cash;
                return (
                  <td key={i} className={`ua-ladder-cell${open ? " is-open" : " is-locked"}${l.tier === i ? " is-on" : ""}`} data-testid={`ua-ladder-${l.key}-${i}`}>
                    <span className="ua-ladder-head">
                      <b>{i + 1}</b>
                      <span className="ua-quiet">{t.paid ? tz("ub.act.tier.paid") : open ? tz("ub.act.tier.open") : tz("ub.act.tier.locked")}</span>
                    </span>
                    {tierFacts(l, t, names).map((f) => (
                      <span key={f} className="ua-ladder-fact">
                        {f}
                      </span>
                    ))}
                    {needs.map((n) => (
                      <span key={n} className="ua-ladder-need">
                        {n}
                      </span>
                    ))}
                    {t.gate === "master_test" && t.master === true && <span className="ua-quiet">{tz("ub.act.master.done")}</span>}
                    {master && (
                      <span className="ua-ladder-master">
                        <button
                          type="button"
                          className="ua-btn ua-btn--ghost"
                          data-testid={`ua-master-${l.key}`}
                          disabled={busy || !canAct || short > 0}
                          title={tz("ub.act.master.hint")}
                          onClick={() => void ctx.send({ MasterTest: { ...OWNER, line: l.key, play: false } })}
                        >
                          {gift > 0 ? tz("ub.act.master.action", { n: gift }) : tz("ub.act.master.free")}
                        </button>
                        {short > 0 && <span className="ua-short">{tz("ub.act.master.short", { n: short })}</span>}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── 手账：总评与结业时带走的 ─────────────

function CapitalList({ cap, names, act }: { cap: CapitalPreview; names: ActNames; act: ActView }) {
  const ships = useGame((s) => s.statics?.ships);
  // U06F4：清单里的见闻卡、认熟的货要港名、货名
  const k3 = useK3Names({ act, view: NO_TOWN, names });
  const shipName = (k: string) => ships?.find((s) => s.key === k)?.name ?? tz("ub.act.capital.ship");
  const asp = cap.aspiration;
  // FIX5F：引号里只放后端给的显示名；没给（旧后端）就换不带名字的说法，不露 aspiration 的键（1113c 实测里露出过 mio_path_1）
  const aspName = cap.aspiration_name?.trim() || null;
  const pathText = !asp
    ? tz("ub.act.capital.pathNone")
    : aspName
      ? tz(cap.fulfilled ? "ub.act.capital.path" : "ub.act.capital.pathUnmet", { name: aspName })
      : tz(cap.fulfilled ? "ub.act.capital.pathBare" : "ub.act.capital.pathUnmetBare");
  return (
    <div className="ua-capital" data-testid="ua-capital">
      <p className="ua-capital-head">
        <b>{tz("ub.act.capital.title")}</b>
        <span className="ua-quiet">{tz("ub.act.capital.value", { n: cap.value })}</span>
      </p>
      <p className="ua-quiet" data-testid="ua-capital-path">{pathText}</p>
      <ul>
        {cap.rows.map((r, i) => (
          <li key={i}>
            <span>{capitalRowName(r, names, shipName, k3)}</span>
            <span className="ua-quiet">{capitalSource(r.source, names)}</span>
          </li>
        ))}
      </ul>
      {cap.savings.given > 0 && <p className="ua-quiet">{tz("ub.act.savings.given", { n: cap.savings.given, s: cap.savings.score })}</p>}
      {/* R10-FE4：家里在家乡的钱庄作的保（预览带 guarantee 时；手账的总评与“跳过养成”两处都用这一份清单） */}
      {cap.guarantee && (
        <p className="ua-capital-guarantee" data-testid="ua-capital-guarantee">
          {tz("ub.act.capital.guarantee", { amount: cap.guarantee.amount, pct: cap.guarantee.rate_pct })}
        </p>
      )}
    </div>
  );
}

export function ScoreBook({ ctx }: { ctx: ActCtx }) {
  const { act, names } = ctx;
  const sc = act.score;
  const cap = act.capital_preview;
  if (!sc && !cap) return null;
  const nextBand = sc ? BANDS[BANDS.indexOf(sc.band) + 1] : undefined;
  return (
    <section className="ua-score" data-testid="ua-score" aria-label={tz("ub.act.score.title")}>
      {sc && (
        <>
          <p className="ua-score-head">
            <b>{tz("ub.act.score.title")}</b>
            <span className="ua-score-band" data-band={sc.band} title={tz(`ub.act.band.${sc.band}.hint` as ZhOnlyKey)}>
              {bandName(sc.band)}
            </span>
            <span>{tz("ub.act.score.total", { n: sc.total })}</span>
            <span className="ua-quiet">
              {sc.next_band_at !== null && nextBand ? tz("ub.act.score.next", { n: sc.next_band_at - sc.total, band: bandName(nextBand) }) : tz("ub.act.score.top")}
            </span>
          </p>
          <ol className="ua-score-bands" aria-hidden>
            {BANDS.map((b) => (
              <li key={b} className={b === sc.band ? "is-on" : undefined} title={tz(`ub.act.band.${b}.hint` as ZhOnlyKey)}>
                {bandName(b)}
                {b !== "ding" && sc.bands[b] !== undefined && <small>{sc.bands[b]}</small>}
              </li>
            ))}
          </ol>
          <p className="ua-quiet">{tz(`ub.act.band.${sc.band}.hint` as ZhOnlyKey)}</p>
          <p className="ua-score-items">
            {Object.entries(sc.items).map(([k, v]) => (
              <span key={k}>
                {tz(`ub.act.score.${k}` as ZhOnlyKey)} <b>{v}</b>
              </span>
            ))}
          </p>
        </>
      )}
      {cap && <CapitalList cap={cap} names={names} act={act} />}
    </section>
  );
}

/** 跳过养成的确认框里的一段：照现在结业的总评与清单（确认框不在 .ua-screen 里，样式另起 ua-skipcap）。 */
export function SkipCapital({ act, names }: { act: ActView; names: ActNames }) {
  const cap = act.capital_preview;
  if (!cap) return null;
  return (
    <div className="ua-skipcap" data-testid="ua-skip-capital">
      <p>{cap.skip_band ? tz("ub.act.capital.skipBand", { band: bandName(cap.skip_band), hint: tz(`ub.act.band.${cap.skip_band}.hint` as ZhOnlyKey) }) : tz("ub.act.capital.skip")}</p>
      <CapitalList cap={cap} names={names} act={act} />
    </div>
  );
}

// ───────────── 小结里的一行 ─────────────

export function SummaryK2({ ctx }: { ctx: ActCtx }) {
  const { act } = ctx;
  const texts = useTexts();
  const k = act.summary_k2;
  const s = act.summary;
  if (!k && !s?.merit && !s?.score_delta) return null;
  const parts: { key: string; text: string; tone?: "ua-up" | "ua-down" }[] = [];
  if (k?.ill) parts.push({ key: "ill", text: tz("ub.act.sum.ill"), tone: "ua-down" });
  if (k?.mission && k.mission.status !== "active")
    parts.push({ key: "mission", text: tz(`ub.act.sum.mission.${k.mission.status}` as ZhOnlyKey), tone: k.mission.status === "done" ? "ua-up" : "ua-down" });
  if (k?.moment) {
    const pick = pickName(k.moment.pick);
    parts.push({
      key: "moment",
      text: k.moment.ok === true ? tz("ub.act.moment.result.win", { pick }) : k.moment.ok === false ? tz("ub.act.moment.result.lose", { pick }) : tz("ub.act.moment.result.plain", { pick }),
      tone: k.moment.ok === false ? "ua-down" : k.moment.ok ? "ua-up" : undefined,
    });
  }
  if (k?.review) {
    const kind = act.rank?.names_key ?? "home";
    const name = rankName(texts, kind, k.review.to);
    const key = k.review.to > k.review.from ? "up" : k.review.to < k.review.from ? "down" : "stay";
    parts.push({ key: "review", text: tz(`ub.act.review.${key}` as ZhOnlyKey, { name }), tone: key === "up" ? "ua-up" : key === "down" ? "ua-down" : undefined });
  }
  // 第三趟：病后主命没成，勋功是负的——带符号写（−5），不写“+-5”
  if (s?.merit) parts.push({ key: "merit", text: tz("ub.act.sum.merit", { n: signed(s.merit) }), tone: s.merit > 0 ? "ua-up" : "ua-down" });
  if (s?.score_delta) parts.push({ key: "score", text: tz("ub.act.sum.score", { n: s.score_delta > 0 ? `+${s.score_delta}` : s.score_delta }) });
  if (parts.length === 0) return null;
  return (
    <p className="ua-sum-k2" data-testid="ua-sum-k2">
      <span className="ua-quiet">{tz("ub.act.sum.k2")}</span>
      {parts.map((p) => (
        <span key={p.key} className={p.tone}>
          {p.text}
        </span>
      ))}
    </p>
  );
}
