// U06F4 第二趟：见习出海（K3b，docs/tasks/R10-U06K3b.md）接上界面——仍不另开一屏：
// - VoyageBook：底栏小签“出海”点开的小卡——各趟的名字、出发日、周数、份子钱、状态、还差什么，能报的当场“报名（40 文）”；
// - CalVoyage：日历条上在海上的那几周一枚“船”签（出发那周后端另给一条 kind = voyage 的标记，写名字）；
// - VoyageLine：海上那几周，周初与周末底栏第一行写“第几程、停靠哪儿、还有几周、船上活计是哪门第几档、末周关口与把握”；
// - ActVoyage：海上那几周舞台不画下田的城镇图（船不在城里），改成这一程能去的地点列表（甲板、停靠港），点一处进去照常做事；
// - 小结里的归航成绩接在 SummaryK3 那一行（k3Kit.summaryK3Chips）。
// 出海的名字（act:voyage:<键>:name|desc）、关口成绩的说法（act:gate:<档>）、地点名与提示是内容：视图带出就用，还是“（待写）”时
// 写“第 n 趟出海”“甲板 / 码头”“出彩 / 过关 / 没过”这样的垫底。
import { tz, type ZhOnlyKey } from "../../../i18n/zhOnly";
import { publicImage } from "../../../art/imageUrl";
import type { VoyageOptionView } from "../../../ipc/actTypes";
import { ShellIcon } from "../../shell/ShellIcon";
import { placeIcon } from "../townKit";
import { OWNER, type ActCtx } from "./actCtx";
import { MiniFace } from "./ActFace";
import { actionName, isInlandVoyage, isRiverVoyage, markersAt, placeScene, weekOrdinal } from "./actKit";
import { ta } from "./actText";
import { gateName, registrationOpens, voyageWeeks, type K3Names } from "./k3Kit";

const PENDING = "（待写）";
const real = (s: string | null | undefined): s is string => !!s && s.trim() !== "" && s.trim() !== PENDING;

/** 出海的一句说明（act:voyage:<键>:desc）；没写时 null。 */
const voyageDesc = (texts: Readonly<Record<string, string>>, key: string): string | null => {
  const s = texts[`act:voyage:${key}:desc`];
  return real(s) ? s : null;
};

/** 报名还差的写成一句。 */
function missingText(v: VoyageOptionView): string | null {
  if (v.missing.length === 0) return v.status === "locked" ? tz("ub.act.voyage.excluded") : null;
  const what = v.missing
    .map((m) => (m === "rank" || m === "person" || m === "after" || m === "cash" ? tz(`ub.act.voyage.miss.${m}` as ZhOnlyKey) : tz("ub.act.voyage.miss.other")))
    .join("、");
  return tz("ub.act.voyage.missing", { what });
}

// ───────────── 报名的小卡 ─────────────

export function VoyageBook({ ctx, texts }: { ctx: ActCtx; texts: Readonly<Record<string, string>> }) {
  const { act, names, busy } = ctx;
  const list = act.voyages ?? [];
  const canAct = act.phase === "plan" || act.phase === "free";
  return (
    <section className="ua-k3-sec" data-testid="ua-voyages" aria-label={tz("ub.act.voyage.title")}>
      <header>
        <b>{tz("ub.act.voyage.title")}</b>
      </header>
      <p className="ua-quiet">{tz("ub.act.voyage.lead")}</p>
      {list.length === 0 ? (
        <p className="ua-quiet">{tz("ub.act.voyage.none")}</p>
      ) : (
        <ul className="ua-k3-voyages">
          {list.map((v) => {
            const desc = voyageDesc(texts, v.key);
            const miss = missingText(v);
            const short = v.fee - act.money.cash;
            return (
              <li key={v.key} className={`ua-k3-voyage is-${v.status}`} data-testid={`ua-voyage-${v.key}`}>
                <span className="ua-k3-voyage-head">
                  <b>{names.voyage(v.key)}</b>
                  {isInlandVoyage(act, v.key) && (
                    <span className="ua-k3-vstatus" title={tz("ub.act.voyage.inlandTip")}>
                      {tz("ub.act.voyage.inland")}
                    </span>
                  )}
                  <span className={`ua-k3-vstatus is-${v.status}`}>{tz(`ub.act.voyage.status.${v.status}` as ZhOnlyKey)}</span>
                  {v.grade && <span className={v.grade === "fail" ? "ua-down" : "ua-up"}>{tz("ub.act.voyage.result", { grade: gateName(texts, v.grade) })}</span>}
                </span>
                <span className="ua-quiet">
                  {tz("ub.act.voyage.when", { y: v.start[0], m: v.start[1], d: v.start[2], w: v.weeks })} · {tz("ub.act.voyage.fee", { n: v.fee })}
                </span>
                {desc && <span className="ua-k3-voyage-desc">{desc}</span>}
                {/* FIX7：报名期还没到的写从哪天起能报（出发前四周） */}
                {v.status === "future" && (
                  <span className="ua-quiet">
                    {(() => {
                      const [y, m, d] = registrationOpens(v.start);
                      return tz("ub.act.voyage.opens", { y, m, d });
                    })()}
                  </span>
                )}
                {v.status !== "done" && v.status !== "missed" && v.status !== "future" && miss && <span className="ua-down">{miss}</span>}
                {v.status === "open" && (
                  <span className="ua-k3-voyage-go">
                    <button
                      type="button"
                      className="ua-btn ua-btn--ghost"
                      data-testid={`ua-join-${v.key}`}
                      disabled={busy || !canAct || short > 0}
                      title={canAct ? undefined : ta("pl.weekendOnly")}
                      onClick={() => void ctx.send({ JoinVoyage: { ...OWNER, voyage: v.key } })}
                    >
                      {tz("ub.act.voyage.join", { n: v.fee })}
                    </button>
                    {short > 0 && <span className="ua-short">{ta("pl.short", { n: short })}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────────── 日历条 ─────────────

/** 在海上的那几周一枚“船”签（出发那一周后端已给 kind = voyage 的标记，就不再画）。 */
export function CalVoyage({ ctx, offset }: { ctx: ActCtx; offset: number }) {
  const base = weekOrdinal(ctx.act.week.from);
  const hit = voyageWeeks(ctx.act).find((w) => w.ordinal === base + offset);
  if (!hit) return null;
  const startMarked = hit.first && ctx.act.calendar.some((m) => m.kind === "voyage" && m.key === hit.key);
  if (startMarked) return null;
  const tip = tz("ub.act.voyage.calTip", { name: ctx.names.voyage(hit.key), n: hit.weeks });
  return (
    <span className="ua-mark ua-cal-voyage" data-kind="voyage" title={tip} aria-label={tip}>
      <i aria-hidden>{ta("cal.kind.voyage")}</i>
      {hit.first && <span className="ua-mark-name">{ctx.names.voyage(hit.key)}</span>}
    </span>
  );
}

// ───────────── 海上那几周：底栏第一行 ─────────────

export function VoyageLine({ ctx, k3, texts }: { ctx: ActCtx; k3: K3Names; texts: Readonly<Record<string, string>> }) {
  const v = ctx.act.voyage;
  if (!v) return null;
  const { names } = ctx;
  const desc = voyageDesc(texts, v.key);
  const inland = isInlandVoyage(ctx.act, v.key);
  return (
    <div className="ua-k3-voyline" data-testid="ua-voyage-line" title={desc ?? undefined}>
      <span className="ua-k3-lead ua-k3-lead--ship">{ta("cal.kind.voyage")}</span>
      <b>{names.voyage(v.key)}</b>
      <span className="ua-chips">
        <span>{tz("ub.act.voyage.leg", { i: v.leg + 1, n: v.legs })}</span>
        <span>{inland ? tz("ub.act.voyage.home", { port: k3.port(v.port) }) : tz("ub.act.voyage.port", { port: k3.port(v.port) })}</span>
        <span>{tz("ub.act.voyage.left", { n: v.weeks_left })}</span>
        <span>{tz("ub.act.voyage.tasks", { line: names.line(v.line), t: v.tier + 1 })}</span>
        <span className={v.gate.chance_pct < 50 ? "ua-down" : "ua-up"}>
          {tz("ub.act.voyage.gate", { game: tz(`ub.act.voyage.game.${v.gate.game}` as ZhOnlyKey), attr: names.attr(v.gate.attr) })} · {tz("ub.act.voyage.gateChance", { n: v.gate.chance_pct })}
        </span>
      </span>
    </div>
  );
}

// ───────────── 海上那几周：舞台 ─────────────

/**
 * 船不在城里：舞台不画下田的城镇图，改成这一程能去的地点列表（甲板、停靠港），底下压一张停靠港的码头场景当底（虚化）。
 * 点一处进去照常是 ActPlace（场景按地点种类挑）。
 */
export function ActVoyage({ ctx, k3, onOpen }: { ctx: ActCtx; k3: K3Names; onOpen: (place: string) => void }) {
  const v = ctx.act.voyage;
  if (!v) return null;
  const { act, names, view } = ctx;
  // U06F5：这一程有停靠港的码头就用那座港的码头图（浦户、堺各有一张），只在船上的那一程用小早的甲板
  const ashore = act.places.some((p) => p.venue !== "deck");
  // U06F6 / U06F8：不出海的那两趟不用海上的甲板图——6a 溯川用四万十川上的小早，6b 用家乡的栈桥
  const inland = isInlandVoyage(ctx.act, v.key);
  const art = placeScene(isRiverVoyage(v.key) ? "river" : ashore || inland ? "dock" : "deck", view.town?.culture ?? view.culture, view.today[1], v.port);
  const src = art ? publicImage(art.src) : null;
  return (
    <section className="ua-voyage-stage" data-testid="ua-voyage-stage" aria-label={tz("ub.act.voyage.places")}>
      {src && <img className="ua-voyage-art" src={src} alt="" aria-hidden />}
      <div className="ua-voyage-panel">
        <h2 className="ua-voyage-title">
          <span>{names.voyage(v.key)}</span>
          <small>
            {tz("ub.act.voyage.leg", { i: v.leg + 1, n: v.legs })} · {inland ? tz("ub.act.voyage.home", { port: k3.port(v.port) }) : tz("ub.act.voyage.port", { port: k3.port(v.port) })}
          </small>
        </h2>
        <p className="ua-quiet">{tz("ub.act.voyage.placesHint")}</p>
        <ul className="ua-voyage-places">
          {act.places.map((p) => {
            const hint = real(p.hint) ? p.hint : null;
            const acts = p.actions.filter((a) => a.kind !== "greet");
            const flags = markersAt(act, p.key).length;
            return (
              <li key={p.key}>
                <button type="button" className="ua-voyage-place" data-testid={`spot-${p.key}`} onClick={() => onOpen(p.key)}>
                  <span className="ua-voyage-place-head">
                    <ShellIcon name={placeIcon(p.kind)} scale={1} />
                    <b>{names.place(p.key)}</b>
                    {flags > 0 && <span className="ua-spot-list-flag">!</span>}
                  </span>
                  {hint && <span className="ua-voyage-place-hint">{hint}</span>}
                  <span className="ua-voyage-place-acts">{acts.length > 0 ? acts.map((a) => actionName(a.kind)).join("、") : ta("pl.nothing")}</span>
                  <span className="ua-voyage-place-people">
                    {p.people.length === 0 ? (
                      <span className="ua-quiet">{tz("ub.act.voyage.nobody")}</span>
                    ) : (
                      p.people.map((x) => (
                        <span key={x.key} className="ua-voyage-person">
                          <MiniFace ctx={ctx} person={x.key} size={26} />
                          {names.person(x.key)}
                        </span>
                      ))
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
