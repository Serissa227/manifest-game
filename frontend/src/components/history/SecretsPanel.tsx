// 秘闻（FRAMEWORK §12，docs/UI-CONTRACT.md I8）：世界背面的五页——
// 结社：听说过与往来过的团体、等级与每级的条件和奖励、当前的试炼、盟友与敌对、据点、史实的存续年代与出处；各势力对你的嫌疑。
// 秘术：会的流派与等级、法术（代价、冷却、对象），施放；对象是一件事的（占卜）从时间线上进行中与将来的事里选（B12）。
// 信仰与思想：所在港口的构成与一年来的变化、能做的传播方式（只靠说服、书、学校、医院与交情）、当地的敌意。
// 传说之船：听说过的船、特性、怎么得到、能不能在这里造。
// 秘境：帷幕、钥匙物品与彼界的规矩。
// 传说之船与已知的秘境有插画时在卡片顶上显示题图（art/lore.ts；还不知道的秘境不显示，免得泄底）。
// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 9 组）只在 v2 下多画这些（v1 的 DOM 不变）：
//   各页的小标题；每张卡的操作放在卡底一行（入会、施放、开工），做不了的原因写在按钮旁（原来只在悬停提示里，
//   或者干脆没写——没选舰队、没选港口、冷却中）；没选舰队 / 港口时就地写怎么办并给一键补救（选旗舰队、选舰队所在或驶向的港口）；
//   没办成就地写原因，办成在提示条回一句；
//   信仰与思想没有选中港口时给“下一步”：一键看舰队所在 / 驶向的港口，或从下拉里选。
import { useMemo, useState } from "react";
import { loreVariants } from "../../art/lore";
import LoreImage from "../LoreImage";
import LoreGallery from "./LoreGallery";
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { ArcanaView, IdeasView, LegendShipsView, RealmsView, SocietiesView, SpellTarget, SpellTargetInput, TimelineEvent } from "../../ipc/types";
import { flagship, useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, InlineError, Loading } from "../feedback";
import { shownSource, shownSources } from "../shownText";
import { sortEvents } from "./historyKit";

type Page = "societies" | "arcana" | "ideas" | "ships" | "realms";
const PAGES: readonly Page[] = ["societies", "arcana", "ideas", "ships", "realms"];

/** 办一件事（busy 期间按钮不可点）。v2 下给了 opts 时：办成在提示条回一句 done，没办成把原因记在 key 那一项上。 */
type Run = (f: () => Promise<unknown>, opts?: { key: string; done: string }) => void;

/** 没办成的那一项（v2 就地写原因）。 */
type Failure = { key: string; msg: string } | null;

/** v2：没办成的原因（只在出错的那一项下面）。 */
function Failed({ failure, k }: { failure: Failure; k: string }) {
  return failure?.key === k ? <InlineError compact reason={failure.msg} /> : null;
}

/** 这一页的数据（只在打开这一页时查询）。data 为 null 时看 status：loading 是“载入中”，error 是没取到（给重试）。 */
function useQuery<T>(key: string | null, fetch: () => Promise<T>) {
  return useView(key, fetch, { quiet: true });
}

/** 出处（FIX4F：仓库文档的路径“docs/…”不显示——后端也在改，前端先挡住）。 */
function Source({ basis, sources }: { basis: string | null; sources: string[] }) {
  const shown = shownSources(sources);
  if (!basis && shown.length === 0) return null;
  return (
    <p className="it-source">
      {basis && <span className="it-basis">{tk(`it.basis.${basis}`)}</span>}
      {shown.join("；")}
    </p>
  );
}

/** 这一页还空着（FIX4F）：一句话说明为什么是空的，不让整页白着像没载入。 */
function Empty({ page }: { page: "societies" | "arcana" | "ships" | "realms" }) {
  const text = { societies: tz("sc.emptySocieties"), arcana: tz("sc.emptyArcana"), ships: tz("sc.emptyShips"), realms: tz("sc.emptyRealms") }[page];
  const hint = { societies: tz("sc.emptySocietiesHint"), arcana: tz("sc.emptyArcanaHint"), ships: tz("sc.emptyShipsHint"), realms: tz("sc.emptyRealmsHint") }[page];
  return (
    <div data-testid={`secrets-empty-${page}`}>
      <EmptyState text={text} hint={hint} v1={<p className="ts-empty">{text}</p>} />
    </div>
  );
}

function Societies({ v, busy, run, failure = null }: { v: SocietiesView; busy: boolean; run: Run; failure?: Failure }) {
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  return (
    <div className="sc-societies">
      {v2 && v.suspicion.length > 0 && <h5 className="hs-mini-head">{t("sc.suspicion")}</h5>}
      {v.suspicion.length > 0 && (
        <ul className="sc-suspicion" aria-label={t("sc.suspicion")}>
          {v.suspicion.map((x) => (
            <li key={x.faction}>
              {x.name} <b>{x.level}</b>
              <span className="sc-meter">
                <span style={{ width: `${Math.min(100, x.value)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="sc-list">
        {v.societies.map((s) => (
          <li key={s.key} className={`sc-card sc-card--${s.known}`} data-testid={`society-${s.key}`}>
            <p className="sc-head">
              <b>{s.name}</b>
              <span className="sc-known">{tk(`sc.known.${s.known}`)}</span>
              {s.rank_name && <span className="ub-rank">{s.rank_name}</span>}
              {s.seat && <span className="sc-seat">{t("sc.seat", { place: s.seat })}</span>}
              {s.active && <span className="sc-active">{s.active}</span>}
            </p>
            {s.known !== "rumor" && (
              <ol className="sc-ranks">
                {s.ranks.map((r) => (
                  <li key={r.n} className={r.done ? "is-done" : s.rank === r.n ? "is-current" : undefined}>
                    <span className="sc-rank-name">{r.name}</span>
                    <span className="sc-rank-req">{r.requirement}</span>
                    <span className="sc-rank-reward">{r.reward}</span>
                  </li>
                ))}
              </ol>
            )}
            {s.trial && <p className="sc-trial">{t("sc.trial", { text: s.trial.text })}</p>}
            {(s.allies.length > 0 || s.enemies.length > 0) && (
              <p className="sc-rel">
                {s.allies.length > 0 && <span>{t("sc.allies", { list: s.allies.join("、") })}</span>}
                {s.enemies.length > 0 && <span className="is-cost">{t("sc.enemies", { list: s.enemies.join("、") })}</span>}
              </p>
            )}
            {!v2 && s.known !== "member" && (
              <button type="button" className="ts-btn ts-btn-small" disabled={busy || !s.can_join} title={s.blocked_reason} onClick={() => run(() => submit({ JoinSociety: { owner: "player", society: s.key } }))}>
                {t("sc.join")}
              </button>
            )}
            {!v2 && !s.can_join && s.blocked_reason && s.known !== "member" && <span className="it-why">{s.blocked_reason}</span>}
            <Source basis={s.basis} sources={s.sources} />
            {v2 && s.known !== "member" && (
              <div className="sc-actions">
                {!s.can_join && s.blocked_reason && <InlineError tone="blocked" compact id={`sc-why-join-${s.key}`} reason={s.blocked_reason} />}
                <button
                  type="button"
                  className="btn small hs-act"
                  disabled={busy || !s.can_join}
                  aria-describedby={!s.can_join && s.blocked_reason ? `sc-why-join-${s.key}` : undefined}
                  onClick={() => run(() => submit({ JoinSociety: { owner: "player", society: s.key } }), { key: `join:${s.key}`, done: t("v2.history.joined", { name: s.name }) })}
                >
                  {t("sc.join")}
                </button>
              </div>
            )}
            {v2 && <Failed failure={failure} k={`join:${s.key}`} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function targetInput(kind: SpellTarget, fleet: number | null, loc: number | null, event: string | null = null): SpellTargetInput | null {
  switch (kind) {
    case "self":
      return "Self";
    case "fleet":
      return fleet === null ? null : { Fleet: fleet };
    case "port":
      return loc === null ? null : { Port: loc };
    case "event":
      return event === null ? null : { Event: event };
    default:
      return null;
  }
}

/**
 * 占卜（对象是一件事）可以选的事：时间线上进行中与将来的（时间线只列玩家知道的事，与后端的候选同一个范围；
 * 揭晓过的事已经过了窗口，占卜不了），按时间线的顺序（进行中的、期限近的在前）。不需要时不查询。
 */
function useEventTargets(need: boolean): TimelineEvent[] {
  const { data } = useView(need ? "timeline" : null, () => api.timeline(), { quiet: true });
  return useMemo(() => (data ? sortEvents(data.events).filter((e) => e.status !== "resolved") : []), [data]);
}

/**
 * v2：法术现在施放不了的原因（数据给的原因、冷却、没选对象）；能施放时为 null。need：缺的是舰队还是港口（就地给补救）；
 * cooling：原因就是冷却（卡头那行“冷却 n 天”的小字这时不再画，免得一张卡上写两遍）。
 */
function spellWhy(sp: ArcanaView["spells"][number], target: SpellTargetInput | null): { reason: string; need?: "fleet" | "port"; cooling?: true } | null {
  if (!sp.enabled) return sp.blocked_reason ? { reason: sp.blocked_reason } : null;
  if (sp.cooldown_left > 0) return { reason: t("v2.history.cooling", { n: sp.cooldown_left }), cooling: true };
  if (target !== null) return null;
  if (sp.targets.includes("fleet")) return { reason: t("v2.history.needFleet"), need: "fleet" };
  if (sp.targets.includes("port")) return { reason: t("v2.history.needPort"), need: "port" };
  if (sp.targets.includes("event")) return { reason: t("sc.noEvent") };
  return { reason: t("v2.history.castElsewhere") };
}

/**
 * v2：看得见的港口与城市（按名字排），以及舰队停着或正驶向的第一个（“下一步”与补救按钮用）。
 * 信仰与思想没有选中港口时、法术或开工缺一个港口时共用。
 */
function usePorts() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：看见过的地点，与各舰队停着或驶往的港口（拼成字符串：内容不变时不重渲染）
  const sighted = useGame((s) => s.overview?.sighted);
  const nearKey = useGame((s) => (s.overview?.fleets ?? []).map((f) => f.docked ?? f.dest).filter((x): x is number => x !== null).join(","));
  const places = (statics?.locations ?? []).filter((l) => (l.kind === "port" || l.kind === "city") && (!sighted || sighted.includes(l.id))).sort((a, b) => a.name.localeCompare(b.name));
  const near = nearKey === "" ? [] : nearKey.split(",").map(Number);
  const first = near.map((id) => places.find((p) => p.id === id)).find((p) => p !== undefined);
  return { places, first };
}

/** v2：缺一个港口时的“怎么办”与补救（一键选舰队所在或驶向的港口；没有时只说在航海图上点一个）。 */
function useNeedPort(): { fix: string; action?: { label: string; onClick: () => void } } {
  const selectLoc = useGame((s) => s.selectLoc);
  const { first } = usePorts();
  if (!first) return { fix: t("v2.history.pickOnChart") };
  return { fix: t("v2.history.noPortHint"), action: { label: t("v2.history.pick", { name: first.name }), onClick: () => selectLoc(first.id) } };
}

/** v2：缺一支舰队时的“怎么办”与补救（一键选旗舰队）。 */
function useNeedFleet(): { fix: string; action?: { label: string; onClick: () => void } } {
  const selectFleet = useGame((s) => s.selectFleet);
  const fleet = useGame((s) => flagship(s.overview));
  return {
    fix: t("v2.history.needFleetFix"),
    action: fleet ? { label: t("v2.history.pick", { name: t("holder.fleet", { id: fleet.id }) }), onClick: () => selectFleet(fleet.id) } : undefined,
  };
}

function Arcana({ v, busy, run, failure = null }: { v: ArcanaView; busy: boolean; run: Run; failure?: Failure }) {
  const submit = useGame((s) => s.submit);
  const fleet = useGame((s) => s.selectedFleet);
  const loc = useGame((s) => s.selectedLoc);
  const v2 = useIsV2();
  const needPort = useNeedPort();
  const needFleet = useNeedFleet();
  const events = useEventTargets(v.spells.some((sp) => sp.targets.includes("event")));
  // 每个占卜法术选的那件事（没选过、或选的那件已经不在候选里时用第一件）
  const [picked, setPicked] = useState<Record<string, string>>({});
  const eventOf = (spell: string) => {
    const k = picked[spell];
    return events.some((e) => e.key === k) ? k : (events[0]?.key ?? null);
  };
  return (
    <div className="sc-arcana">
      {v2 && v.schools.length > 0 && <h5 className="hs-mini-head">{t("v2.history.schoolsHead")}</h5>}
      <ul className="sc-schools">
        {v.schools.map((s) => (
          <li key={s.key}>
            <b>{s.name}</b> {t("ub.skillLv", { n: s.level })}
            <Source basis={s.basis} sources={s.sources} />
          </li>
        ))}
      </ul>
      {v2 && v.spells.length > 0 && <h5 className="hs-mini-head">{t("v2.history.spellsHead")}</h5>}
      <ul className="sc-spells">
        {v.spells.map((sp) => {
          const onEvent = sp.targets.includes("event");
          const event = onEvent ? eventOf(sp.key) : null;
          const target = sp.targets.map((k) => targetInput(k, fleet, loc, event)).find((x) => x !== null) ?? null;
          const why = v2 ? spellWhy(sp, target) : null;
          const remedy = why?.need === "fleet" ? needFleet : why?.need === "port" ? needPort : null;
          return (
            <li key={sp.key} className={sp.enabled ? "sc-spell" : "sc-spell is-blocked"} data-testid={`spell-${sp.key}`}>
              <p className="sc-head">
                <b>{sp.name}</b>
                <span>{t("sc.rank", { n: sp.rank })}</span>
                <span className="sc-cost">{sp.cost}</span>
                {sp.cooldown_left > 0 && !why?.cooling && <span className="is-cost">{t("sc.cooldown", { n: sp.cooldown_left })}</span>}
              </p>
              <p className="sc-desc">{sp.desc}</p>
              {shownSource(sp.source) && <p className="it-source">{shownSource(sp.source)}</p>}
              {onEvent && events.length > 0 && (
                <label className="sc-pick sc-event-pick">
                  <span>{t("sc.eventTarget")}</span>
                  <select value={event ?? ""} onChange={(e) => setPicked({ ...picked, [sp.key]: e.target.value })} data-testid={`spell-event-${sp.key}`}>
                    {events.map((e) => (
                      <option key={e.key} value={e.key}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!v2 && onEvent && events.length === 0 && <span className="it-why">{t("sc.noEvent")}</span>}
              {!v2 && (
                <button type="button" className="ts-btn ts-btn-small" disabled={busy || !sp.enabled || sp.cooldown_left > 0 || target === null} title={sp.blocked_reason} onClick={() => target !== null && run(() => submit({ CastSpell: { owner: "player", spell: sp.key, target } }))}>
                  {t("sc.cast")}
                </button>
              )}
              {!v2 && !sp.enabled && sp.blocked_reason && <span className="it-why">{sp.blocked_reason}</span>}
              {v2 && (
                <div className="sc-actions">
                  {why && <InlineError tone="blocked" compact id={`sc-why-cast-${sp.key}`} reason={why.reason} fix={remedy?.fix} action={remedy?.action} />}
                  <button
                    type="button"
                    className="btn small hs-act"
                    disabled={busy || !sp.enabled || sp.cooldown_left > 0 || target === null}
                    aria-describedby={why ? `sc-why-cast-${sp.key}` : undefined}
                    onClick={() => target !== null && run(() => submit({ CastSpell: { owner: "player", spell: sp.key, target } }), { key: `cast:${sp.key}`, done: t("v2.history.casted", { name: sp.name }) })}
                  >
                    {t("sc.cast")}
                  </button>
                </div>
              )}
              {v2 && <Failed failure={failure} k={`cast:${sp.key}`} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 人不在这座港（FIX5F）：后端给 away: true；旧后端没有这个字段时，“不是 none、比例与传播方式都空”也当作这一种（1113c 实测：停在平户看堺只剩一个标题）。
 */
function ideasAway(v: IdeasView): boolean {
  if (v.away !== undefined) return v.away;
  return !v.none && v.shares.length === 0 && v.modes.length === 0;
}

/** 人不在这座港时：一句说明、“看别的港”（舰队所在或驶往的那座一键看，其余在下拉里），能远程做的传播方式照常列在下面。 */
function IdeasAway({ v, busy, run, failure }: { v: IdeasView; busy: boolean; run: Run; failure: Failure }) {
  const selectLoc = useGame((s) => s.selectLoc);
  const { places, first } = usePorts();
  const near = first && first.id !== v.loc ? first : undefined;
  const others = places.filter((p) => p.id !== v.loc);
  const text = v.name ? tz("sc.ideasAway", { name: v.name }) : tz("sc.ideasAwayBare");
  return (
    <div className="sc-ideas sc-ideas-away" data-testid="ideas-away">
      {v.name && <p className="it-lead">{t("sc.ideasAt", { name: v.name })}</p>}
      <div className="sc-noport">
        <EmptyState
          text={text}
          action={near ? { label: t("v2.history.seePort", { name: near.name }), onClick: () => selectLoc(near.id) } : undefined}
          v1={<p className="ts-empty">{text}</p>}
        />
        {others.length > 0 && (
          <label className="sc-pick">
            <span>{t("v2.history.pickPort")}</span>
            <select value="" onChange={(e) => e.target.value !== "" && selectLoc(Number(e.target.value))} data-testid="ideas-away-pick">
              <option value="">{t("v2.history.pickPortHolder")}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {v.hostility && <p className="is-cost">{v.hostility}</p>}
      {v.modes.length > 0 && (
        <>
          <h5 className="hs-mini-head">{tz("sc.ideasAwayModes")}</h5>
          <IdeaModes v={v} busy={busy} run={run} failure={failure} />
        </>
      )}
    </div>
  );
}

function Ideas({ v, busy, run, failure = null }: { v: IdeasView; busy: boolean; run: Run; failure?: Failure }) {
  const v2 = useIsV2();
  const name = v.name ?? "";
  if (ideasAway(v)) return <IdeasAway v={v} busy={busy} run={run} failure={failure} />;
  return (
    <div className="sc-ideas">
      <p className="it-lead">{t("sc.ideasAt", { name })}</p>
      <ul className="sc-shares">
        {v.shares.map((x) => (
          <li key={x.idea}>
            <span className="sc-share-name">{x.name}</span>
            <span className="sc-meter">
              <span style={{ width: `${x.share}%` }} />
            </span>
            <span className="sc-share-n">{x.share}</span>
            {x.delta_year !== 0 &&
              (v2 ? (
                <span className={x.delta_year > 0 ? "sc-delta is-good" : "sc-delta is-cost"}>{t("v2.history.deltaYear", { n: x.delta_year > 0 ? `+${x.delta_year}` : x.delta_year })}</span>
              ) : (
                <span className={x.delta_year > 0 ? "is-good" : "is-cost"}>{x.delta_year > 0 ? `+${x.delta_year}` : x.delta_year}</span>
              ))}
          </li>
        ))}
      </ul>
      {v.hostility && <p className="is-cost">{v.hostility}</p>}
      {v2 && v.modes.length > 0 && <h5 className="hs-mini-head">{t("v2.history.spreadHead")}</h5>}
      <IdeaModes v={v} busy={busy} run={run} failure={failure} />
    </div>
  );
}

/** 能做的传播方式（在港时全部；人不在时是能远程做的那些）。 */
function IdeaModes({ v, busy, run, failure }: { v: IdeasView; busy: boolean; run: Run; failure: Failure }) {
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const name = v.name ?? "";
  return (
    <ul className="sc-modes">
      {v.modes.map((m) => (
        <li key={`${m.mode}-${m.idea}`} className={m.enabled ? undefined : "is-blocked"}>
          <span className="sc-mode-label">{m.label}</span>
          <span className="sc-mode-needs">{m.needs.join("、")}</span>
          <span>{t("hs.points", { n: m.points, max: m.cap })}</span>
          <button
            type="button"
            className={v2 ? "btn small hs-act" : "ts-btn ts-btn-small"}
            disabled={busy || !m.enabled}
            title={v2 ? undefined : m.blocked_reason}
            aria-describedby={v2 && !m.enabled && m.blocked_reason ? `sc-why-mode-${m.mode}-${m.idea}` : undefined}
            onClick={() =>
              run(() => submit({ Propagate: { owner: "player", idea: m.idea, loc: v.loc, mode: m.mode } }), {
                key: `mode:${m.mode}-${m.idea}`,
                done: t("v2.history.propagated", { place: name, label: m.label }),
              })
            }
          >
            {tk(`sc.mode.${m.mode}`)}
          </button>
          {!v2 && !m.enabled && m.blocked_reason && <span className="it-why">{m.blocked_reason}</span>}
          {v2 && !m.enabled && m.blocked_reason && <InlineError tone="blocked" compact id={`sc-why-mode-${m.mode}-${m.idea}`} reason={m.blocked_reason} />}
          {v2 && <Failed failure={failure} k={`mode:${m.mode}-${m.idea}`} />}
        </li>
      ))}
    </ul>
  );
}

/** 卡片顶上的题图（384×168 的中图，按打开时的时辰与天气挑一版、不叠天气）；没有这张图时什么也不画。 */
function LoreArt({ art }: { art: string }) {
  return <LoreImage art={art} size="medium" className="sc-art" testId={`lore-${art}`} noOverlay />;
}

/** 传说之船的 CG 画廊：知道下落以后才能看全部的版本（只是传闻时只有题图）；只有一版时不出按钮。 */
function ShipGallery({ art, name, open }: { art: string; name: string; open: boolean }) {
  const [shown, setShown] = useState(false);
  const n = loreVariants(art).length;
  if (!open || n < 2) return null;
  return (
    <>
      <button type="button" className="btn sc-gallery-btn" onClick={() => setShown(true)} data-testid={`gallery-${art}`}>
        {t("sc.gallery", { n })}
      </button>
      {shown && <LoreGallery art={art} name={name} onClose={() => setShown(false)} />}
    </>
  );
}

function Ships({ v, busy, run, failure = null }: { v: LegendShipsView; busy: boolean; run: Run; failure?: Failure }) {
  const submit = useGame((s) => s.submit);
  const loc = useGame((s) => s.selectedLoc);
  const v2 = useIsV2();
  return (
    <ul className="sc-ships">
      {v.ships.map((s) => {
        return (
          <li key={s.key} className={`sc-ship sc-ship--${s.state}`} data-testid={`ship-${s.key}`}>
            <LoreArt art={`ship_${s.key}`} />
            <p className="sc-head">
              <b>{s.name}</b>
              <span>{s.hull}</span>
              <span className="sc-known">{tk(`sc.ship.${s.state}`)}</span>
            </p>
            <ShipGallery art={`ship_${s.key}`} name={s.name} open={s.state !== "rumor"} />
            {s.traits.length > 0 && (
              <ul className="sc-traits">
                {s.traits.map((tr) => (
                  <li key={tr.key} title={tr.text}>
                    <b>{tr.name}</b> {tr.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="sc-desc">{s.lore}</p>
            {s.acquire && <p className="sc-trial">{s.acquire}</p>}
            {!v2 && s.state === "blueprint" && (
              <button type="button" className="ts-btn ts-btn-small" disabled={busy || !s.can_commission || loc === null} title={s.blocked_reason} onClick={() => loc !== null && run(() => submit({ CommissionShip: { owner: "player", ship: s.key, loc } }))}>
                {t("sc.commission")}
              </button>
            )}
            <Source basis={s.basis} sources={s.sources} />
            {v2 && s.state === "blueprint" && <CommissionRow ship={s} loc={loc} busy={busy} run={run} />}
            {v2 && <Failed failure={failure} k={`ship:${s.key}`} />}
          </li>
        );
      })}
    </ul>
  );
}

/** v2：照图纸开工的一行（做不了的原因写在按钮旁：数据给的原因，或者还没选港口——这时一键选舰队所在 / 驶向的港口）。 */
function CommissionRow({ ship, loc, busy, run }: { ship: LegendShipsView["ships"][number]; loc: number | null; busy: boolean; run: Run }) {
  const submit = useGame((s) => s.submit);
  const needPort = useNeedPort();
  const noPort = ship.can_commission && loc === null;
  const why = !ship.can_commission ? (ship.blocked_reason ?? null) : noPort ? t("v2.history.needPort") : null;
  const whyId = `sc-why-ship-${ship.key}`;
  return (
    <div className="sc-actions">
      {why && <InlineError tone="blocked" compact id={whyId} reason={why} fix={noPort ? needPort.fix : undefined} action={noPort ? needPort.action : undefined} />}
      <button
        type="button"
        className="btn small hs-act"
        disabled={busy || !ship.can_commission || loc === null}
        aria-describedby={why ? whyId : undefined}
        onClick={() => loc !== null && run(() => submit({ CommissionShip: { owner: "player", ship: ship.key, loc } }), { key: `ship:${ship.key}`, done: t("v2.history.commissioned", { name: ship.name }) })}
      >
        {t("sc.commission")}
      </button>
    </div>
  );
}

/** 一组任选钥匙的说明：物品名与“走完某条线”并列；线还没开始、或只有旗标条件时写“另一条门路”。 */
function keyGroupLabel(g: RealmsView["realms"][number]["key_any"][number]): string {
  const parts = [
    ...g.items.map((k) => k.name),
    ...g.tracks.map((tr) => (tr.name ? t("sc.keyTrack", { name: tr.name }) : t("sc.keyTrackUnknown"))),
  ];
  return parts.length > 0 ? parts.join(t("sc.keyAnd")) : t("sc.keyTrackUnknown");
}

function Realms({ v }: { v: RealmsView }) {
  const v2 = useIsV2();
  return (
    <ul className="sc-realms">
      {v.realms.map((r) => (
        <li key={r.key} className={`sc-realm sc-realm--${r.state}`}>
          {r.state !== "unknown" && <LoreArt art={`realm_${r.key}`} />}
          <p className="sc-head">
            <b>
              {r.state !== "unknown" ? (
                r.name
              ) : v2 ? (
                <>
                  <span aria-hidden="true">？</span>
                  <span className="v2-sr">{t("v2.history.unknownRealm")}</span>
                </>
              ) : (
                "？"
              )}
            </b>
            <span className="sc-known">{tk(`sc.realm.${r.state}`)}</span>
          </p>
          {r.hint && <p className="sc-desc">{r.hint}</p>}
          {v2 && (r.key_items.length > 0 || r.key_any.length > 0) && (
            <h5 className="hs-mini-head">{t("v2.history.keysHead")}</h5>
          )}
          {r.key_items.length > 0 && (
            <p className="sc-keys">
              {r.key_items.map((k) => (
                <span key={k.item} className={k.have ? "is-good" : undefined}>
                  {k.have ? "✓" : "○"} {k.name}
                </span>
              ))}
            </p>
          )}
          {r.key_any.length > 0 && (
            <p className="sc-keys sc-keys--any">
              {r.key_any.length > 1 && <small className="sc-keys-any">{t("sc.keyAny")}</small>}
              {r.key_any.map((g, i) => (
                <span key={i} className={g.met ? "is-good" : undefined}>
                  {g.met ? "✓" : "○"} {keyGroupLabel(g)}
                </span>
              ))}
            </p>
          )}
          {v2 && r.rules.length > 0 && <h5 className="hs-mini-head">{t("sc.rules")}</h5>}
          {r.rules.length > 0 && (
            <ul className="sc-rules" aria-label={t("sc.rules")}>
              {r.rules.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * v2：信仰与思想没有选中港口时的空状态。“下一步”是舰队停着或正驶向的第一个港口（一键看），
 * 下面还有一个下拉可以选别的港口（看得见的港口与城市）；选了就是选中地点，与在航海图上点一下一样。
 */
function NoPort() {
  const selectLoc = useGame((s) => s.selectLoc);
  const { places, first } = usePorts();
  return (
    <div className="sc-noport">
      <EmptyState
        text={t("v2.history.noPort")}
        hint={t("v2.history.noPortHint")}
        action={first ? { label: t("v2.history.seePort", { name: first.name }), onClick: () => selectLoc(first.id) } : undefined}
      />
      {places.length > 0 && (
        <label className="sc-pick">
          <span>{t("v2.history.pickPort")}</span>
          <select value="" onChange={(e) => e.target.value !== "" && selectLoc(Number(e.target.value))}>
            <option value="">{t("v2.history.pickPortHolder")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * 信仰与思想：这座港没有这一页可看——还没到过，或者这里没有记载。写明是哪一种，并指到到过的、有记载的港：
 * 第一个一键看，其余在下拉里。以前这时后端回空值，界面分不出“没有”和“还在取”，一直停在“载入中”。
 */
function NoIdeas({ v }: { v: Pick<IdeasView, "name" | "none" | "ports"> }) {
  const selectLoc = useGame((s) => s.selectLoc);
  const v2 = useIsV2();
  const ports = v.ports ?? [];
  const first = ports[0];
  const text = v.none === "unvisited" ? tz("sc.ideasUnvisited") : v.name ? tz("sc.ideasNone", { name: v.name }) : tz("sc.ideasNoneBare");
  return (
    <div className="sc-noport" data-testid="ideas-none">
      <EmptyState
        text={text}
        hint={first ? tz("sc.ideasNoneHint") : tz("sc.ideasNoneYet")}
        action={first ? { label: t("v2.history.seePort", { name: first.name }), onClick: () => selectLoc(first.id) } : undefined}
        v1={<p className="ts-empty">{text}</p>}
      />
      {v2 && ports.length > 1 && (
        <label className="sc-pick">
          <span>{t("v2.history.pickPort")}</span>
          <select value="" onChange={(e) => e.target.value !== "" && selectLoc(Number(e.target.value))}>
            <option value="">{t("v2.history.pickPortHolder")}</option>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export default function SecretsPanel() {
  const loc = useGame((s) => s.selectedLoc);
  const v2 = useIsV2();
  const [page, setPage] = useState<Page>("societies");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const run: Run = (f, opts) => {
    setBusy(true);
    if (v2) setFailure(null);
    void f()
      .then((r) => {
        // v2：办成在提示条回一句；没办成（错误已由提示条报过）同时写在那一项下面
        if (!v2 || !opts) return;
        if (r) useGame.getState().notify(opts.done);
        else setFailure({ key: opts.key, msg: useGame.getState().error ?? "" });
      })
      .finally(() => setBusy(false));
  };
  const societies = useQuery(page === "societies" ? "societies" : null, () => api.societies());
  const arcana = useQuery(page === "arcana" ? "arcana" : null, () => api.arcana());
  const ideas = useQuery(page === "ideas" && loc !== null ? `ideas:${loc}` : null, () => api.ideas(loc ?? 0));
  const ships = useQuery(page === "ships" ? "legendships" : null, () => api.legendShips());
  const realms = useQuery(page === "realms" ? "realms" : null, () => api.realms());
  const current = { societies, arcana, ideas, ships, realms }[page];
  const body = (() => {
    switch (page) {
      case "societies":
        if (societies.data && societies.data.societies.length === 0 && societies.data.suspicion.length === 0) return <Empty page="societies" />;
        return societies.data ? <Societies v={societies.data} busy={busy} run={run} failure={failure} /> : null;
      case "arcana":
        if (arcana.data && arcana.data.schools.length === 0 && arcana.data.spells.length === 0) return <Empty page="arcana" />;
        return arcana.data ? <Arcana v={arcana.data} busy={busy} run={run} failure={failure} /> : null;
      case "ideas":
        if (loc === null) return v2 ? <NoPort /> : <p className="ts-empty">{t("portSelect")}</p>;
        if (ideas.data?.none) return <NoIdeas v={ideas.data} />;
        // 取到了但是空的（旧后端在没有记载时回空值）：也当“没有”，不停在“载入中”
        if (ideas.status === "ok" && !ideas.data) return <NoIdeas v={{ name: null, ports: [] }} />;
        return ideas.data ? <Ideas v={ideas.data} busy={busy} run={run} failure={failure} /> : null;
      case "ships":
        if (ships.data && ships.data.ships.length === 0) return <Empty page="ships" />;
        return ships.data ? <Ships v={ships.data} busy={busy} run={run} failure={failure} /> : null;
      case "realms":
        if (realms.data && realms.data.realms.length === 0) return <Empty page="realms" />;
        return realms.data ? <Realms v={realms.data} /> : null;
    }
  })();
  return (
    <div className="sc-panel" data-testid="secrets">
      <div className="ub-tabs" role="tablist" aria-label={t("sc.pages")}>
        {PAGES.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={page === p} className={page === p ? "ub-tab is-on" : "ub-tab"} onClick={() => setPage(p)}>
            {tk(`sc.page.${p}`)}
          </button>
        ))}
      </div>
      {body ??
        (current.status === "error" ? (
          // 没取到：写明并给重试，不再一直停在“载入中”
          <InlineError reason={tz("sc.loadFailed")} action={{ label: t("layout.loadRetry"), onClick: current.reload }} v1={<p className="ts-empty">{tz("sc.loadFailed")}</p>} />
        ) : (
          <Loading v1={<p className="ts-empty">{t("loading")}</p>} />
        ))}
    </div>
  );
}
