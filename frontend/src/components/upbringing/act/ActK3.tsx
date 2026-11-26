// U06F4：行动制内核三前半（K3a）接上界面——都放进已有的位置，不另起一屏、不弹事件：
// - K3Row：周初与周末底栏的第一行——这周的潮（名字 + 实际效果：哪份工这周能挣多少、谁在哪儿、听消息多几张、哪儿去不了、家业会不会失手），
//   后面三枚小签“见闻 2 张”“识货 1/3 样”“人：汐再 13：在同一处打工多挣 30%”，点开一张往上翻的小卡看全；
// - CalTide：日历条每一周一枚“潮”签（换潮的周写名字，不变的周写“潮不变”）；
// - K3Book：手账抽屉里总评下面的三节（见闻卡、识货簿、人物与好处），同小卡的内容；
// - SummaryK3：小结里 K2 那一行下面再一行（家业挣了多少 / 失手、到了里程、听到的消息、认熟的货、升降级的人）。
// 视图字段见 ipc/actTypes.ts 的 K3a 一节；纯逻辑在 k3Kit.ts；字在 i18n/zhOnly.ts（ub.act.tide / rumor / goods / people / perk …）。
import { useState } from "react";
import { tz } from "../../../i18n/zhOnly";
import type { ActView, PersonLevelView } from "../../../ipc/actTypes";
import { useK3Names } from "./useK3Names";
import { useGame } from "../../../store/game";
import { VoyageBook, VoyageLine } from "./ActK3b";
import type { ActCtx } from "./actCtx";
import { MiniFace } from "./ActFace";
import { reasonOf, ta } from "./actText";
import { isInlandVoyage, weekOrdinal } from "./actKit";
import {
  dutyRisk,
  knownPeople,
  levelName,
  nearestPerkHint,
  personNext,
  perListen,
  gapTo,
  jobGoodRows,
  rumorSpots,
  rumorValidShort,
  voyageWeeks,
  rumorValue,
  summaryK3Chips,
  tideEffects,
  tideWeeks,
  voyageChipText,
  type Chip,
  type K3Names,
} from "./k3Kit";

function Chips({ list }: { list: Chip[] }) {
  return (
    <span className="ua-chips">
      {list.map((c) => (
        <span key={c.key} className={c.tone === "up" ? "ua-up" : c.tone === "down" ? "ua-down" : undefined} title={c.title}>
          {c.text}
        </span>
      ))}
    </span>
  );
}

// ───────────── 潮 ─────────────

function TideLine({ ctx, k3, onOpen, open }: { ctx: ActCtx; k3: K3Names; onOpen: () => void; open: boolean }) {
  const t = ctx.act.tide;
  // 海上那几周潮只管家乡港口的打工，不写（日历条里照样看得到）
  if (!t || t.this_week.length === 0 || ctx.act.voyage) return null;
  const fx = tideEffects(ctx.act, ctx.view, t, ctx.names);
  const name = t.this_week.map((k) => k3.tide(k, true)).join("、");
  const desc = t.this_week.map((k) => k3.tideDesc(k)).filter(Boolean).join(" ");
  return (
    <div className="ua-k3-tide" data-testid="ua-tide" title={[desc, tz("ub.act.tide.tip")].filter(Boolean).join("\n")}>
      <span className="ua-k3-lead">{tz("ub.act.tide.lead")}</span>
      {/* 潮名可点：小卡里是潮的说明（数据 act:tide:*:desc）与往后几周；说明不放进这一行，免得周初那一行变长 */}
      <button type="button" className="ua-k3-tide-name" data-testid="ua-tide-name" aria-expanded={open} onClick={onOpen}>
        {name}
      </button>
      {fx.length > 0 ? <Chips list={fx} /> : <span className="ua-quiet">{tz("ub.act.tide.calm")}</span>}
    </div>
  );
}

/**
 * 日历条一周的潮签（offset 同 calendarWeeks）。日历一栏很窄：本周（底栏第一行已写全）与“潮不变”的周只画一枚“潮”字，
 * 名字放在悬停提示里；换了潮的那一周才写出名字。
 */
export function CalTide({ ctx, offset }: { ctx: ActCtx; offset: number }) {
  const k3 = useK3Names(ctx);
  // U06F7：在海上（报了名 / 正在走的航次所占）的那几周人不在家乡，不画潮签；“换没换潮”也跳过这几周比
  const base = weekOrdinal(ctx.act.week.from);
  const away = new Set(voyageWeeks(ctx.act).map((v) => v.ordinal - base));
  const w = tideWeeks(ctx.act, 5, away).find((x) => x.offset === offset);
  if (!w || w.kinds.length === 0) return null;
  const now = ctx.act.tide?.this_week ?? [];
  const name = w.kinds.map((k) => k3.tide(k, now.includes(k))).join("、");
  const same = offset > 0 && !w.changed;
  const tip = same ? `${tz("ub.act.tide.calSame")}：${name}` : tz("ub.act.tide.calTip", { name });
  return (
    <span className={`ua-mark ua-cal-tide${same ? " is-same" : ""}${w.changed ? " is-new" : ""}`} data-kind="tide" title={tip} aria-label={tip}>
      <i aria-hidden>{ta("cal.kind.tide")}</i>
      {w.changed && <span className="ua-mark-name">{name}</span>}
    </span>
  );
}

/** 潮的小卡：这周的潮名与说明、实际效果、往后四周。 */
function TideBook({ ctx, k3 }: { ctx: ActCtx; k3: K3Names }) {
  const t = ctx.act.tide;
  if (!t) return null;
  const fx = tideEffects(ctx.act, ctx.view, t, ctx.names);
  const weeks = tideWeeks(ctx.act).filter((w) => w.offset > 0);
  return (
    <section className="ua-k3-sec" data-testid="ua-tide-book" aria-label={tz("ub.act.tide.title")}>
      <header>
        <b>{tz("ub.act.tide.title")}</b>
      </header>
      {t.this_week.length === 0 ? (
        <p className="ua-quiet">{tz("ub.act.tide.calm")}</p>
      ) : (
        t.this_week.map((k) => (
          <p key={k} className="ua-k3-tide-desc">
            <b>{k3.tide(k, true)}</b> {k3.tideDesc(k) ?? ""}
          </p>
        ))
      )}
      {fx.length > 0 && (
        <p className="ua-k3-fx">
          {fx.map((c) => (
            <span key={c.key} className={c.tone === "up" ? "ua-up" : c.tone === "down" ? "ua-down" : undefined}>
              {c.text}
            </span>
          ))}
        </p>
      )}
      {weeks.length > 0 && (
        <p className="ua-k3-where">
          <span className="ua-quiet">{tz("ub.act.tide.next")}</span>
          {weeks.map((w) => (
            <span key={w.offset}>
              {tz("ub.act.tide.after", { n: w.offset })} {w.kinds.length === 0 ? "—" : w.kinds.map((k) => k3.tide(k, (t.this_week ?? []).includes(k))).join("、")}
            </span>
          ))}
        </p>
      )}
      <p className="ua-quiet">{tz("ub.act.tide.tip")}</p>
    </section>
  );
}

// ───────────── 见闻卡 ─────────────

function RumorBook({ ctx, k3 }: { ctx: ActCtx; k3: K3Names }) {
  const r = ctx.act.rumors;
  if (!r) return null;
  const spots = rumorSpots(ctx.act);
  const value = rumorValue(ctx.act);
  const per = perListen(ctx.act);
  const weekend = ctx.act.phase === "free";
  return (
    <section className="ua-k3-sec" data-testid="ua-rumors" aria-label={tz("ub.act.rumor.title")}>
      <header>
        <b>{tz("ub.act.rumor.title")}</b>
        <span className="ua-quiet">{tz("ub.act.rumor.count", { n: r.cards.filter((c) => !c.expired).length })}</span>
      </header>
      {r.cards.length === 0 ? (
        <p className="ua-quiet">{tz("ub.act.rumor.none")}</p>
      ) : (
        <ul className="ua-k3-cards">
          {r.cards.map((c) => (
            <li key={c.key} className={`ua-k3-card is-${c.kind}${c.expired ? " is-expired" : ""}`}>
              <span className="ua-k3-card-kind">{tz(`ub.act.rumor.kind.${c.kind}` as "ub.act.rumor.kind.demand")}</span>
              <span className="ua-k3-card-text">{k3.rumor(c)}</span>
              {/* U06F7：有效期盖住整个养成期的卡不写这一行（二十几张都写同一句、把正文挤成三四行）；还没到或快过期的才写，短写 */}
              {(c.expired || rumorValidShort(c, ctx.act.week.from)) && (
                <span className="ua-quiet ua-k3-card-valid">{c.expired ? tz("ub.act.rumor.expired") : rumorValidShort(c, ctx.act.week.from)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {spots.length > 0 && (
        <p className="ua-k3-where">
          <span className="ua-quiet">{tz("ub.act.rumor.where")}</span>
          {spots.map((s) => (
            <span key={s.place} className={s.enabled && weekend ? "ua-up" : undefined}>
              {s.enabled || !weekend
                ? tz("ub.act.rumor.can", { place: ctx.names.place(s.place), n: s.cost })
                : tz("ub.act.rumor.cant", { place: ctx.names.place(s.place), why: reasonOf(s.reason_text, s.reason) ?? "" })}
            </span>
          ))}
          <span className="ua-quiet">{tz("ub.act.rumor.perListen", { n: per })}</span>
          {!weekend && <span className="ua-quiet">{ta("pl.weekendOnly")}</span>}
        </p>
      )}
      <p className="ua-quiet">{value !== null ? tz("ub.act.rumor.use", { n: value }) : tz("ub.act.rumor.useBare")}</p>
    </section>
  );
}

// ───────────── 识货簿 ─────────────

/** 打哪份工能摸到哪样货（视图 places[].jobs[].goods，U06K3a3；没有时为空）。 */
function jobGoods(act: ActView): { job: string; goods: string[] }[] {
  const out: { job: string; goods: string[] }[] = [];
  for (const p of act.places)
    for (const j of p.jobs) {
      const rows = jobGoodRows(j, act.rumors);
      if (rows.length > 0) out.push({ job: j.activity, goods: rows.map((g) => g.good) });
    }
  return out;
}

function GoodsBook({ ctx, k3 }: { ctx: ActCtx; k3: K3Names }) {
  const r = ctx.act.rumors;
  if (!r) return null;
  const need = r.goods[0]?.need ?? 3;
  const byJob = jobGoods(ctx.act);
  return (
    <section className="ua-k3-sec" data-testid="ua-goods" aria-label={tz("ub.act.goods.title")}>
      <header>
        <b>{tz("ub.act.goods.title")}</b>
        <span className="ua-quiet">{tz("ub.act.goods.count", { k: r.goods.filter((g) => g.known).length, n: r.goods.length })}</span>
      </header>
      {r.goods.length === 0 ? (
        <p className="ua-quiet">{tz("ub.act.goods.none")}</p>
      ) : (
        <ul className="ua-k3-goods">
          {r.goods.map((g) => (
            <li key={g.good} className={g.known ? "is-known" : undefined}>
              <span className="ua-k3-good">{k3.good(g.good)}</span>
              <span className="ua-k3-pips" aria-label={`${g.seen}/${g.need}`}>
                {Array.from({ length: g.need }, (_, i) => (
                  <span key={i} className={i < g.seen ? "is-on" : undefined} />
                ))}
              </span>
              <span className={g.known ? "ua-up" : "ua-quiet"}>{g.known ? tz("ub.act.goods.known") : tz("ub.act.goods.left", { n: Math.max(0, g.need - g.seen) })}</span>
            </li>
          ))}
        </ul>
      )}
      {byJob.length > 0 ? (
        <p className="ua-k3-where">
          {byJob.map((x) => (
            <span key={x.job}>
              {ctx.names.activity(x.job)} → {x.goods.map((g) => k3.good(g)).join("、")}
            </span>
          ))}
        </p>
      ) : (
        r.goods.length > 0 && <p className="ua-quiet">{tz("ub.act.goods.whereHint")}</p>
      )}
      <p className="ua-quiet">{tz("ub.act.goods.use", { n: need })}</p>
    </section>
  );
}

// ───────────── 人物与好处 ─────────────

function PersonRow({ ctx, p, k3 }: { ctx: ActCtx; p: PersonLevelView; k3: K3Names }) {
  const nx = personNext(p);
  const pct = p.next_at ? Math.min(100, Math.round((p.affinity / p.next_at) * 100)) : 100;
  return (
    <li className="ua-k3-person" data-testid={`ua-level-${p.key}`}>
      <MiniFace ctx={ctx} person={p.key} size={30} />
      <span className="ua-k3-person-main">
        <span className="ua-k3-person-head">
          <b>{ctx.names.person(p.key)}</b>
          <span className="ua-k3-lv">{levelName(p.level)}</span>
          {p.class && <span className={`ua-k3-class is-${p.class}`}>{tz(`ub.act.people.class.${p.class}` as "ub.act.people.class.mate")}</span>}
        </span>
        <span className="ua-k3-person-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="ua-quiet">
          {nx.gap === null ? tz("ub.act.people.top") : tz("ub.act.people.next", { n: nx.gap, lv: p.level + 1 })}
        </span>
        {p.perks.length > 0 && (
          <span className="ua-k3-perks">
            {[...p.perks]
              .sort((a, b) => a.level - b.level)
              .map((k) => (
                <span key={`${k.level}:${k.kind}`} className={k.active ? "is-on" : k.level <= p.level ? "is-lost" : undefined}>
                  <i>{tz("ub.act.people.perkAt", { lv: k.level })}</i>
                  {k3.perk(k)}
                  {k.active && <small>{tz("ub.act.people.got")}</small>}
                  {!k.active && k.level > p.level + 1 && gapTo(p, k.level) !== null && <small>{tz("ub.act.people.gapLv", { n: gapTo(p, k.level) ?? 0 })}</small>}
                </span>
              ))}
          </span>
        )}
      </span>
    </li>
  );
}

function PeopleBook({ ctx, k3, limit }: { ctx: ActCtx; k3: K3Names; limit?: number }) {
  const all = ctx.act.people;
  if (!all) return null;
  const list = knownPeople(all, ctx.names);
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <section className="ua-k3-sec" data-testid="ua-people-levels" aria-label={tz("ub.act.people.title")}>
      <header>
        <b>{tz("ub.act.people.title")}</b>
      </header>
      {shown.length === 0 ? (
        <p className="ua-quiet">{tz("ub.act.people.none")}</p>
      ) : (
        <ul className="ua-k3-people">
          {shown.map((p) => (
            <PersonRow key={p.key} ctx={ctx} p={p} k3={k3} />
          ))}
        </ul>
      )}
      <p className="ua-quiet">{tz("ub.act.people.use")}</p>
    </section>
  );
}

// ───────────── 底栏的一行 ─────────────

const NO_TEXTS: Readonly<Record<string, string>> = {};
const POP_TITLE = {
  rumor: "ub.act.rumor.title",
  goods: "ub.act.goods.title",
  people: "ub.act.people.title",
  voyage: "ub.act.voyage.title",
  tide: "ub.act.tide.title",
} as const;

type Pop = "rumor" | "goods" | "people" | "voyage" | "tide";

/** 周初、周末底栏的第一行：潮 + 三枚小签（点开往上翻一张小卡）。 */
export function K3Row({ ctx }: { ctx: ActCtx }) {
  const k3 = useK3Names(ctx);
  const texts = useGame((s) => s.statics?.upbringing_act_texts) ?? NO_TEXTS;
  const [pop, setPop] = useState<Pop | null>(null);
  const { act, names } = ctx;
  const r = act.rumors;
  const people = act.people;
  const voyages = act.voyages ?? [];
  if (!act.tide && !r && !people && voyages.length === 0) return null;
  const toggle = (p: Pop) => setPop((v) => (v === p ? null : p));
  const cards = r?.cards.filter((c) => !c.expired).length ?? 0;
  const canListen = act.phase === "free" && rumorSpots(act).some((s) => s.enabled);
  const known = r?.goods.filter((g) => g.known).length ?? 0;
  const closest = r?.goods.filter((g) => !g.known).sort((a, b) => b.seen - a.seen)[0];
  const hint = people ? nearestPerkHint(people, names, k3) : null;
  return (
    <div className="ua-k3" data-testid="ua-k3">
      <VoyageLine ctx={ctx} k3={k3} texts={texts} />
      <TideLine ctx={ctx} k3={k3} onOpen={() => toggle("tide")} open={pop === "tide"} />
      <div className="ua-k3-chips">
        {voyages.length > 0 && (
          <button type="button" className="ua-k3-chip" data-testid="ua-k3-voyage" aria-expanded={pop === "voyage"} onClick={() => toggle("voyage")}>
            <i>{tz(isInlandVoyage(act, act.voyage?.key) ? "ub.act.voyage.chipInland" : "ub.act.voyage.chip")}</i>
            {voyageChipText(act)}
            {voyages.some((v) => v.status === "open") && !act.voyage && <span className="ua-k3-dot" aria-hidden />}
          </button>
        )}
        {r && (
          <button type="button" className="ua-k3-chip" data-testid="ua-k3-rumor" aria-expanded={pop === "rumor"} onClick={() => toggle("rumor")}>
            <i>{tz("ub.act.rumor.chip")}</i>
            {tz("ub.act.rumor.count", { n: cards })}
            {canListen && <span className="ua-k3-dot" aria-label={tz("ub.act.rumor.left")} />}
          </button>
        )}
        {r && r.goods.length > 0 && (
          <button type="button" className="ua-k3-chip" data-testid="ua-k3-goods" aria-expanded={pop === "goods"} onClick={() => toggle("goods")}>
            <i>{tz("ub.act.goods.chip")}</i>
            {tz("ub.act.goods.count", { k: known, n: r.goods.length })}
            {closest && closest.seen > 0 && <small>{`${k3.good(closest.good)} ${closest.seen}/${closest.need}`}</small>}
          </button>
        )}
        {people && (
          <button type="button" className="ua-k3-chip ua-k3-chip--people" data-testid="ua-k3-people" aria-expanded={pop === "people"} onClick={() => toggle("people")}>
            <i>{tz("ub.act.people.chip")}</i>
            <span className="ua-k3-chip-text">{hint ?? tz("ub.act.people.hintNone")}</span>
          </button>
        )}
      </div>
      {pop && (
        <div className="ua-k3-pop" data-testid="ua-k3-pop" role="dialog" aria-label={tz(POP_TITLE[pop])}>
          <button type="button" className="ua-k3-pop-close ua-link" onClick={() => setPop(null)}>
            {ta("tt.close")}
          </button>
          {pop === "rumor" && <RumorBook ctx={ctx} k3={k3} />}
          {pop === "goods" && <GoodsBook ctx={ctx} k3={k3} />}
          {pop === "people" && <PeopleBook ctx={ctx} k3={k3} limit={6} />}
          {pop === "voyage" && <VoyageBook ctx={ctx} texts={texts} />}
          {pop === "tide" && <TideBook ctx={ctx} k3={k3} />}
        </div>
      )}
    </div>
  );
}

/** 家业那一格上的失手签（风暴季）。 */
export function DutyRisk({ act, duty }: { act: ActView; duty: string }) {
  const n = dutyRisk(act, duty);
  if (n <= 0) return null;
  return (
    <span className="ua-duty-risk" title={tz("ub.act.duty.riskTip", { n })}>
      {tz("ub.act.duty.risk", { n })}
    </span>
  );
}

// ───────────── 手账抽屉 ─────────────

export function K3Book({ ctx }: { ctx: ActCtx }) {
  const k3 = useK3Names(ctx);
  const texts = useGame((s) => s.statics?.upbringing_act_texts) ?? NO_TEXTS;
  if (!ctx.act.rumors && !ctx.act.people && !(ctx.act.voyages ?? []).length) return null;
  return (
    <div className="ua-k3-book" data-testid="ua-k3-book">
      {ctx.act.tide && <TideBook ctx={ctx} k3={k3} />}
      {(ctx.act.voyages ?? []).length > 0 && <VoyageBook ctx={ctx} texts={texts} />}
      <PeopleBook ctx={ctx} k3={k3} />
      <RumorBook ctx={ctx} k3={k3} />
      <GoodsBook ctx={ctx} k3={k3} />
    </div>
  );
}

// ───────────── 小结 ─────────────

export function SummaryK3({ ctx }: { ctx: ActCtx }) {
  const k3 = useK3Names(ctx);
  const list = summaryK3Chips(ctx.act, ctx.act.summary_k3, ctx.names, k3);
  if (list.length === 0) return null;
  return (
    <p className="ua-sum-k2 ua-sum-k3" data-testid="ua-sum-k3">
      <span className="ua-quiet">{tz("ub.act.sum.k3")}</span>
      {list.map((c) => (
        <span key={c.key} className={c.tone === "up" ? "ua-up" : c.tone === "down" ? "ua-down" : undefined} title={c.title}>
          {c.text}
        </span>
      ))}
    </p>
  );
}
