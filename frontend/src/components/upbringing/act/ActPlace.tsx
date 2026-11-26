// 进了一个地点：那张会动的场景图铺开做主角（只在左上角压一枚小小的“回地图”与地名），下面三块——
//   1. 对话条：在这里刚发生的事（寒暄的一句话、做事的结果），最新的在最前；不弹框、不遮图；
//   2. 这里能做的事（≤ 5 项，视图给的顺序）：每项写花费、预计所得、成的机会；有几个对象的（哪份工、找谁、看哪件事）在卡里逐个列出，点下去当场出结果；
//   3. 在这里的人（寒暄免费，每人每周一次）与货架（买不起写明差多少）。
// 行动点用完了照样能进来看；做不了的事灰着并写原因。
import { tz } from "../../../i18n/zhOnly";
import { useState } from "react";
import { publicImage } from "../../../art/imageUrl";
import type { ActActionInput, ActPlaceAction, ActPlaceView, ActionRecordView } from "../../../ipc/actTypes";
import { ITEM_ICON_KEYS } from "../../items/itemIcons";
import { SceneImg } from "../../scene/SceneImg";
import { ShellIcon } from "../../shell/ShellIcon";
import { placeIcon } from "../townKit";
import { useGame } from "../../../store/game";
import { OWNER, type ActCtx } from "./actCtx";
import { activityScene, actEffects, actionName, markerLabel, markerOpen, markersAt, placeScene, resultChips, sceneKindOf, tenths, isInlandVoyage, isRiverVoyage } from "./actKit";
import { reasonOf, reasonText, ta } from "./actText";
import { MiniFace } from "./ActFace";
import { useK3Names } from "./useK3Names";
import { closedNodes, jobGoodRows, jobGoodText, levelName, perListen } from "./k3Kit";

const ICONS: ReadonlySet<string> = new Set(ITEM_ICON_KEYS);


/** “去看看”记录的对象：有章标题用章标题；标记看完后就从 act.markers 里消失了，找不到时写“一件事”，不把故事线的键露出来。 */
function markerTitle(ctx: ActCtx, track: string | null): string {
  return markerLabel(track ? ctx.act.markers.find((m) => m.track === track) : null, ctx.names.person);
}

/** 一条记录的标题：“打工·帆别钱”“深谈·阿濑”。 */
function recordTitle(ctx: ActCtx, d: ActionRecordView): string {
  const target =
    d.kind === "job"
      ? ctx.names.activity(d.target)
      : d.kind === "marker"
        ? markerTitle(ctx, d.target)
        : d.kind === "self_study" && d.target
          ? ctx.names.line(d.target.split(":")[0])
          : d.kind === "gift" && d.item
            ? `${ctx.names.person(d.target)} · ${ctx.names.item(d.item)}`
            : d.kind === "excursion"
              ? ctx.names.excursion(d.target) // U06F9：远足点名（没去过 / 取不到时不写，不露 outing_* 的键）
              : d.target
                ? ctx.names.person(d.target)
                : "";
  return target ? `${actionName(d.kind)} · ${target}` : actionName(d.kind);
}

/** 对话条：在这里本周发生的事，最新的在前。寒暄是一句话（人物的头像 + 她说的话），做事是结果。 */
function Dialogue({ ctx, place }: { ctx: ActCtx; place: string }) {
  const k3 = useK3Names(ctx);
  // U06F4：这次拿到的见闻卡（听消息、1 级好处的寒暄）写成一句“听到：堺缺谷物”
  const heard = (d: ActionRecordView) =>
    d.rumors && d.rumors.length > 0 ? (
      <span className="ua-line-heard">{tz("ub.act.rumor.heard", { what: d.rumors.map((r) => k3.rumorKey(r)).join("；") })}</span>
    ) : null;
  // 最新的在前，只留最近四条（一周在一个地方至多十来条，老的不必占地方）
  const here = ctx.act.free.done.filter((d) => d.place === place).reverse().slice(0, 4);
  if (here.length === 0) return <p className="ua-dlg ua-dlg--empty">{ta("pl.logEmpty")}</p>;
  return (
    <ol className="ua-dlg" aria-live="polite" aria-label={ta("pl.log")}>
      {here.map((d, i) =>
        d.kind === "greet" && d.target ? (
          <li key={`${here.length - i}`} className={`ua-line ua-line--say${i === 0 ? " is-new" : ""}`}>
            <MiniFace ctx={ctx} person={d.target} size={40} />
            <span className="ua-line-who">{ctx.names.person(d.target)}</span>
            <q className="ua-line-say">{ctx.names.greet(d.greet)}</q>
            {heard(d)}
          </li>
        ) : (
          <li key={`${here.length - i}`} className={`ua-line ua-line--act${i === 0 ? " is-new" : ""}${d.result.success === false ? " is-fail" : ""}`}>
            <span className="ua-line-what">{recordTitle(ctx, d)}</span>
            {d.result.success !== null && <b className="ua-line-grade">{d.result.success ? ta("pl.result.ok") : ta("pl.result.fail")}</b>}
            <span className="ua-chips">
              {resultChips(ctx.names, d.result).map((c) => (
                <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                  {c.text}
                </span>
              ))}
              {resultChips(ctx.names, d.result).length === 0 &&
                (d.kind === "rumor" ? !d.rumors?.length && <span className="ua-quiet">{tz("ub.act.rumor.heardNone")}</span> : <span className="ua-quiet">{ta("pl.result.none")}</span>)}
            </span>
            {heard(d)}
          </li>
        ),
      )}
    </ol>
  );
}

/** 打工钱数里已含的加成：潮那一份与合伙那一份各写一枚。 */
function bonusNotes(tidePct: number, totalPct: number): string[] {
  const out: string[] = [];
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  if (tidePct) out.push(tz("ub.act.job.tide", { pct: sign(tidePct) }));
  const partner = totalPct - tidePct;
  if (partner) out.push(tz("ub.act.job.partner", { pct: sign(partner) }));
  return out;
}

/** 一个对象的按钮（哪份工、找谁……）：标题、几枚说明、点了就做。 */
function Target({
  title,
  notes,
  enabled,
  busy,
  onGo,
  testId,
  flag,
}: {
  title: string;
  notes: string[];
  enabled: boolean;
  busy: boolean;
  onGo: () => void;
  testId?: string;
  flag?: string;
}) {
  return (
    <button type="button" className="ua-target" data-testid={testId} disabled={!enabled || busy} onClick={onGo}>
      <span className="ua-target-title">
        {title}
        {flag && <span className="ua-target-flag">{flag}</span>}
      </span>
      <span className="ua-target-notes">
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </button>
  );
}

function ActionCard({ ctx, p, a }: { ctx: ActCtx; p: ActPlaceView; a: ActPlaceAction }) {
  const [giftTo, setGiftTo] = useState<string | null>(null);
  const { act, names, busy } = ctx;
  const go = (action: ActActionInput) => void ctx.send({ DoAction: { ...OWNER, place: p.key, action } });
  // 周末以外（周初、小结）也能进来看：做不了的原因统一写“周末才能做”
  const weekend = act.phase === "free";
  const on = a.enabled && weekend;
  const why = !weekend ? ta("pl.weekendOnly") : a.enabled ? null : reasonOf(a.reason_text, a.reason);
  const person = (k: string) => p.people.find((x) => x.key === k);
  // FIX7b：深谈会带出这人挂着的标记——点得开才写“会先说起那件事”与“!”；点不开时写原因（深谈照常能做）
  const markerOf = (k: string) => {
    const track = person(k)?.marker;
    return track ? (act.markers.find((m) => m.track === track) ?? { openable: true as const, reason: null, reason_text: null }) : null;
  };
  const personMarkerOpen = (k: string) => markerOpen(markerOf(k));
  const talkMarkerNote = (k: string): string[] => {
    const m = markerOf(k);
    if (!m) return [];
    return markerOpen(m) ? [ta("pl.talk.marker")] : [reasonOf(m.reason_text, m.reason) ?? reasonText("ub.act.marker") ?? ""].filter(Boolean);
  };
  const fx = actEffects(act);
  const k3 = useK3Names(ctx);
  let body: React.ReactNode = null;
  switch (a.kind) {
    case "job":
      body = a.targets.map((t) => {
        const j = p.jobs.find((x) => x.activity === t);
        const notes = j
          ? [
              ta("pl.job.level", { n: j.level }),
              j.income[0] === j.income[1] ? ta("pl.job.incomeOne", { n: j.income[0] }) : ta("pl.job.income", { lo: j.income[0], hi: j.income[1] }),
              ta("pl.job.fatigue", { n: tenths(j.fatigue_x10) }),
              ta("pl.success", { n: j.success_pct }),
              j.next_at === null ? ta("pl.job.top") : ta("pl.job.progress", { have: j.progress, need: j.next_at }),
              // U06F3：晋级还要交易 + 口才比开局多长多少（K2 规则 4.2；后端只给门槛，没给现在已长了多少）
              ...(j.next_at !== null && (j.next_gain ?? 0) > 0 ? [tz("ub.act.job.gain", { n: j.next_gain ?? 0 })] : []),
              // U06F4：钱数里已含的加成，拆成“潮 +20%”“合伙 +30%”（合伙 = 合计减去潮的那份）
              ...bonusNotes(act.tide?.jobs[j.group] ?? 0, j.bonus_pct ?? 0),
              ...(j.goods && j.goods.length > 0 ? [tz("ub.act.goods.job", { list: jobGoodRows(j, act.rumors).map((g) => jobGoodText(g, k3)).join("、") })] : []),
            ]
          : [];
        return <Target key={t} title={names.activity(t)} notes={notes} enabled={on} busy={busy} testId={`ua-job-${t}`} onGo={() => go({ job: { activity: t } })} />;
      });
      break;
    case "talk":
      body = a.targets.map((t) => (
        <Target
          key={t}
          title={names.person(t)}
          notes={[ta("pl.talk.effect", { aff: fx.talk.affinity, mood: fx.talk.mood }), ...talkMarkerNote(t)]}
          flag={personMarkerOpen(t) ? "!" : undefined}
          enabled={on}
          busy={busy}
          testId={`ua-talk-${t}`}
          onGo={() => go({ talk: { person: t } })}
        />
      ));
      break;
    case "gift":
      body =
        giftTo === null ? (
          a.targets.map((t) => (
            <Target key={t} title={names.person(t)} notes={[ta("pl.giftPick")]} enabled={on && act.gift_items.length > 0} busy={busy} onGo={() => setGiftTo(t)} />
          ))
        ) : (
          <div className="ua-gift-pick">
            <span className="ua-gift-to">{names.person(giftTo)}</span>
            {act.gift_items.map((it) => (
              <Target
                key={it.item}
                title={names.item(it.item)}
                notes={[ta("pl.have", { n: it.qty })]}
                enabled={on}
                busy={busy}
                onGo={() => {
                  go({ gift: { person: giftTo, item: it.item } });
                  setGiftTo(null);
                }}
              />
            ))}
            {act.gift_items.length === 0 && <span className="ua-quiet">{ta("pl.giftNone")}</span>}
            <button type="button" className="ua-link" onClick={() => setGiftTo(null)}>
              {ta("pl.giftBack")}
            </button>
          </div>
        );
      break;
    case "marker":
      body = a.targets.map((t) => {
        const m = act.markers.find((x) => x.track === t);
        const who = markerLabel(m, names.person);
        // FIX7b：点不开的标记照列，不带“!”，写后端给的原因、灰着（不发命令）
        const open = !m || markerOpen(m);
        const shut = open ? null : (reasonOf(m?.reason_text, m?.reason) ?? reasonText("ub.act.marker"));
        const notes = shut
          ? [shut]
          : [ta("pl.marker.effect"), m ? (m.weeks_left <= 1 ? ta("pl.markerLast") : ta("pl.markerLeft", { n: m.weeks_left })) : ""].filter(Boolean);
        return (
          <Target
            key={t}
            title={who}
            notes={notes}
            flag={!open ? undefined : m?.key ? ta("pl.markerKey") : "!"}
            enabled={on && open}
            busy={busy}
            testId={`ua-marker-${t}`}
            onGo={() => go({ marker: { track: t } })}
          />
        );
      });
      break;
    case "rest":
      body = <Target title={actionName("rest")} notes={[ta("pl.rest.effect", { n: fx.rest })]} enabled={on} busy={busy} testId="ua-rest" onGo={() => go("rest")} />;
      break;
    case "pray":
      body = (
        <Target
          title={actionName("pray")}
          notes={[ta("pl.pray.effect", { f: fx.pray.fatigue, m: fx.pray.mood, w: fx.pray.resolve })]}
          enabled={on}
          busy={busy}
          testId="ua-pray"
          onGo={() => go("pray")}
        />
      );
      break;
    case "self_study":
      body = a.targets.map((t) => {
        const [line, tier] = t.split(":");
        return (
          <Target
            key={t}
            title={names.activity(act.lines.find((l) => l.key === line)?.tiers[Number(tier)]?.activity) || names.line(line)}
            notes={[`${names.line(line)} ${ta("tt.tier", { n: Number(tier) + 1 })}`, ta("pl.study.effect")]}
            enabled={on}
            busy={busy}
            onGo={() => go({ self_study: { line, tier: Number(tier) } })}
          />
        );
      });
      break;
    case "excursion": {
      // U06F5：名字与副题相同时只写一次（“潮边松林 · 潮边松林”）
      const title = (ex: string, node: string | undefined) => {
        const map = ctx.view.excursions.find((e) => e.key === ex);
        const n = map?.nodes.find((x) => x.key === node);
        if (!n) return map?.name ?? actionName("excursion");
        return !map?.name || map.name === n.name ? n.name : `${map.name} · ${n.name}`;
      };
      // U06F5：这时节关掉的、去过的远足点照列，灰着写原因（后端从目标里拿掉了它们）；没去过的只合成一句
      const maps = new Set(a.targets.map((t) => t.split(":")[0]));
      const closed = closedNodes(ctx.view, (act.tide?.closed ?? []).filter((c) => maps.size === 0 || maps.has(c.split(":")[0])));
      const shut = reasonText("ub.act.tide_closed") ?? "";
      body = (
        <>
          {a.targets.map((t) => {
            const [ex, node] = t.split(":");
            return (
              <Target
                key={t}
                title={title(ex, node)}
                notes={[ta("pl.excursion.effect", { n: fx.excursionFatigue })]}
                enabled={on}
                busy={busy}
                onGo={() => go({ excursion: { excursion: ex, node: node ?? "" } })}
              />
            );
          })}
          {closed.known.map((c) => (
            <Target key={c.key} title={title(c.excursion, c.node)} notes={[shut]} enabled={false} busy={busy} onGo={() => undefined} testId={`ua-closed-${c.node}`} />
          ))}
          {closed.unknown > 0 && <p className="ua-quiet">{tz(closed.known.length > 0 ? "ub.act.tide.closedMore" : "ub.act.tide.closedUnknown", { n: closed.unknown })}</p>}
        </>
      );
      break;
    }
    case "rumor":
      // U06F4：每听一次几张（潮汐多给的加在上面）、手里已有几张
      body = (
        <Target
          title={actionName("rumor")}
          notes={[
            ta("pl.rumor.effect"),
            tz("ub.act.rumor.perListen", { n: perListen(act) }),
            ...(act.rumors ? [`${tz("ub.act.rumor.chip")} ${tz("ub.act.rumor.count", { n: act.rumors.cards.filter((c) => !c.expired).length })}`] : []),
          ]}
          enabled={on}
          busy={busy}
          testId="ua-rumor"
          onGo={() => go("rumor")}
        />
      );
      break;
    case "greet":
      body = null;
      break;
  }
  return (
    <li className={`ua-card${on ? "" : " is-off"}`} data-kind={a.kind} data-testid={`ua-act-${a.kind}`}>
      <header className="ua-card-head">
        <b>{actionName(a.kind)}</b>
        <span className="ua-cost" aria-label={ta("pl.cost", { n: a.cost })}>
          {Array.from({ length: a.cost }, (_, i) => (
            <span key={i} className="ua-dot is-on" aria-hidden />
          ))}
          <span className="ua-cost-n">{ta("pl.cost", { n: a.cost })}</span>
        </span>
      </header>
      <div className="ua-card-body">{body}</div>
      {why && <p className="ua-card-why">{why}</p>}
    </li>
  );
}

function People({ ctx, p }: { ctx: ActCtx; p: ActPlaceView }) {
  const greetOk = ctx.act.phase === "free" || ctx.act.phase === "plan";
  return (
    <section className="ua-people" aria-label={ta("pl.people")}>
      <h3 className="ua-h">{ta("pl.people")}</h3>
      {p.people.length === 0 ? (
        <p className="ua-quiet">{ta("pl.nobody")}</p>
      ) : (
        <ul>
          {p.people.map((x) => (
            <li key={x.key} className="ua-person" data-testid={`ua-person-${x.key}`}>
              <MiniFace ctx={ctx} person={x.key} size={44} />
              <span className="ua-person-name">
                {ctx.names.person(x.key)}
                {x.marker && markerOpen(ctx.act.markers.find((m) => m.track === x.marker) ?? { openable: true }) && <span className="ua-person-flag">!</span>}
                {x.rank !== null && <span className="ua-person-lv">{levelName(x.rank)}</span>}
              </span>
              {x.greeted ? (
                <span className="ua-quiet">{ta("pl.greeted")}</span>
              ) : (
                <button
                  type="button"
                  className="ua-btn ua-btn--ghost"
                  disabled={ctx.busy || !greetOk}
                  title={ta("pl.greetFree")}
                  onClick={() => void ctx.send({ DoAction: { ...OWNER, place: p.key, action: { greet: { person: x.key } } } })}
                >
                  {ta("pl.greet")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Shelf({ ctx, p }: { ctx: ActCtx; p: ActPlaceView }) {
  if (p.shop.length === 0) return null;
  const cash = ctx.act.money.cash;
  return (
    <section className="ua-shelf" aria-label={ta("pl.shop")}>
      <h3 className="ua-h">{ta("pl.shop")}</h3>
      <ul>
        {p.shop.map((s) => {
          const short = s.price - cash;
          return (
            <li key={s.item} className="ua-ware" data-testid={`ua-ware-${s.item}`}>
              {ICONS.has(s.item) ? (
                <img className="ua-ware-icon" src={publicImage(`items/${s.item}.webp`)} alt="" aria-hidden loading="lazy" />
              ) : (
                <span className="ua-ware-icon" aria-hidden />
              )}
              <span className="ua-ware-name">{ctx.names.item(s.item)}</span>
              <span className="ua-ware-price">{ta("pl.price", { n: s.price })}</span>
              {s.have > 0 && <span className="ua-quiet">{ta("pl.have", { n: s.have })}</span>}
              {short > 0 ? (
                <span className="ua-short">{ta("pl.short", { n: short })}</span>
              ) : (
                <button
                  type="button"
                  className="ua-btn ua-btn--ghost"
                  disabled={ctx.busy || ctx.loc === null}
                  title={ctx.loc === null ? ta("pl.noLoc") : undefined}
                  onClick={() => ctx.loc !== null && void ctx.send({ BuyItem: { ...OWNER, loc: ctx.loc, item: s.item, qty: 1, max_total: s.price } })}
                >
                  {ta("pl.buy")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ActPlace({ ctx: outer, place, onBack }: { ctx: ActCtx; place: string; onBack: () => void }) {
  // U06F7：在这里做的事被后端拒了（标记还没到能看的时候、病中、行动点不够……），原因写在“这里能做的事”上面——离点的地方近；
  // 顶上的全局提示条照旧也出。下一次成功、或换了地点就收掉
  const [reject, setReject] = useState<{ place: string; text: string } | null>(null);
  const ctx: ActCtx = {
    ...outer,
    send: (cmd) =>
      outer.send(cmd).then((ok) => {
        setReject(ok ? null : { place, text: useGame.getState().error ?? reasonText("ub.act.action") ?? "" });
        return ok;
      }),
  };
  const p = ctx.act.places.find((x) => x.key === place);
  if (!p) return null;
  const culture = ctx.view.town?.culture ?? ctx.view.culture;
  // U06F5：出海中按这一程停靠的港挑场景（浦户、堺有自己的码头），甲板用小早的甲板
  // U06F9：周末在这里刚做过的打工 / 自修，若那件活计自己写了场景键（守夜的望楼、操练场……），图换成它；没有照地点
  const last = [...ctx.act.free.done].reverse().find((d) => d.place === p.key && (d.kind === "job" || d.kind === "self_study"));
  const lastAct =
    last?.kind === "job"
      ? last.target
      : last?.kind === "self_study" && last.target
        ? (ctx.act.lines.find((l) => l.key === last.target!.split(":")[0])?.tiers[Number(last.target.split(":")[1] ?? 0)]?.activity ?? null)
        : null;
  const own = ctx.act.voyage ? null : activityScene(lastAct, [...(ctx.view.lessons ?? []), ...(ctx.view.activities ?? [])], ctx.view.today[1]);
  const art = own ?? placeScene(sceneKindOf(p, isInlandVoyage(ctx.act, ctx.act.voyage?.key), isRiverVoyage(ctx.act.voyage?.key)), culture, ctx.view.today[1], ctx.act.voyage?.port ?? ctx.town);
  const acts = p.actions.filter((a) => a.kind !== "greet").slice(0, 5);
  const ms = markersAt(ctx.act, p.key);
  const src = art ? publicImage(art.src) : null;
  return (
    <section className="ua-place" data-testid="ua-place" data-place={p.key} aria-label={ctx.names.place(p.key)}>
      <div className="ua-fit" style={src ? ({ "--ua-art": `url("${src}")` } as React.CSSProperties) : undefined}>
        <div className="ua-scene">
          {art && src ? <SceneImg className="ua-scene-img" src={src} file={art.file} testId="ua-scene-img" lazy={false} /> : <span className="ua-scene-plain" aria-hidden />}
        </div>
        <div className="ua-scene-plate">
          <button type="button" className="ua-back" data-testid="ua-back" onClick={onBack} title={`${ta("pl.back")}（${ta("pl.backKey")}）`}>
            ‹ {ta("pl.back")}
          </button>
          <span className="ua-scene-name">
            <ShellIcon name={placeIcon(p.kind)} scale={1} />
            {ctx.names.place(p.key)}
          </span>
          {ms.length > 0 && <span className="ua-scene-flag">! {ms.length}</span>}
        </div>
      </div>
      <div className="ua-under">
        <div className="ua-under-main">
          <Dialogue ctx={ctx} place={p.key} />
          {reject && reject.place === p.key && reject.text && (
            <p className="ua-reject" role="alert" data-testid="ua-reject">
              <span>{reject.text}</span>
              <button type="button" className="ua-link" onClick={() => setReject(null)}>
                {ta("unlocked.close")}
              </button>
            </p>
          )}
          <h3 className="ua-h">
            {ta("pl.todo")}
            <span className="ua-h-aside">
              {ctx.act.points.left > 0 ? ta("pl.left", { n: ctx.act.points.left }) : ta("map.noPoints")}
            </span>
          </h3>
          {acts.length === 0 ? (
            <p className="ua-quiet">{ta("pl.nothing")}</p>
          ) : (
            <ul className="ua-cards" data-n={acts.length}>
              {acts.map((a) => (
                <ActionCard key={a.kind} ctx={ctx} p={p} a={a} />
              ))}
            </ul>
          )}
        </div>
        <aside className="ua-under-side">
          <People ctx={ctx} p={p} />
          <Shelf ctx={ctx} p={p} />
        </aside>
      </div>
    </section>
  );
}
