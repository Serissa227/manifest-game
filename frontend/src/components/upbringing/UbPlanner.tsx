// 养成主画面的中栏：最上面是“城中各处”（这一阶段所在城市的 CG 与可以去的地点，UbTown.tsx），下面是本月日程（三旬；学院期每旬"课业 + 课后"两格）与活动卡片。
// 点一个地点等同于在选中那一旬的课后格里选它（不是“去走走”的活动时先换成它，见 townKit.ts 的 goPlace）。
// 点一格把它选中，再点一张活动卡片放进去，选中自动移到下一个空格；课后的活动需要补选地点、同伴、书或远足点时，格子下面出现下拉框。
// 活动卡片写明预计收益（成长值的区间）、疲劳、心情、花费与收入、导师在不在、打工的段位、失败的风险；不能选的卡片写明原因。
// 合法性一律以后端为准（enabled / blocked_reason）；提交前按草稿算这个月的预计，疲劳过高时提醒。
// 新界面（v2，docs/UI-REDESIGN.md 第 9 节）多三处小结构，旧界面不变：
//   活动卡上面一行“点一张卡，排进中旬”（选中的格子已经排了时写“换掉……”）——新手一眼知道点卡会放到哪里；
//   底栏的“本月预计”分成一枚枚小签（成长、疲劳、心情、零用钱），还没排时写一句说明；“太累”的提醒用短一些的一句（v2.upbringing.tired），和小签排在一起；
//   “开始这个月”按不了时就地写原因（还有几格没排 / 哪一格还要补选什么）和补救按钮（跳到那一格、焦点落在要选的下拉框上）。
// U05 按周排程（养成视图 plan.mode === "week"）：日程是本周的格子——家乡期 3 格，学院期 3 节课 + 2 格课余，按结算日排成一行；
//   每格写明结算日与这一格的预计收益（单格取整）；已经结算的格只读，落在换阶段之后的格标“换阶段后重排”；
//   常设周课表铺不上时，出问题的那一格标红并就地写原因与“改这一格”。底栏是“本周预计”（按精确值加总）。
//   暂停时都能改本周还没结算的格；运行中的“开始第 N 周”在周条上（UbWeek），改过的格开始时一并提交 PlanWeek。
import { useEffect, useMemo, useRef, useState } from "react";
import { listJoin, money, t, tk } from "../../i18n";
import type { ActivityNeed, ActivityView, CompanionView, UpbringingView } from "../../ipc/types";
import { useIsV2 } from "../../ui/uiMode";
import { InlineError, Kbd } from "../feedback";
import { tz } from "../../i18n/zhOnly";
import { UbScene } from "./UbScene";
import { UbTown } from "./UbTown";
import { chosenSlots, goPlace, townCell } from "./townKit";
import {
  activityIndex,
  assign,
  cellId,
  cellsOf,
  chosenAt,
  fatigueWarning,
  isComplete,
  isWeekly,
  kindsOf,
  missingNeeds,
  openCells,
  openSlot,
  planDirty,
  problemStale,
  project,
  refine,
  stageStarted,
  type Cell,
  type Draft,
} from "./ubKit";

/** 一格日程：选了的活动的小场景与名字，或"空"。 */
function CellView({
  view,
  draft,
  cell,
  active,
  acts,
  onFocus,
  onChange,
  editable,
  attrName,
}: {
  view: UpbringingView;
  draft: Draft;
  cell: Cell;
  active: boolean;
  acts: Map<string, ActivityView>;
  onFocus: () => void;
  onChange: (d: Draft) => void;
  editable: boolean;
  attrName: (k: string) => string;
}) {
  const key = chosenAt(draft, cell);
  const act = key ? acts.get(key) : undefined;
  const slot = view.plan.slots.find((s) => s.index === cell.index);
  const choice = cell.part === "after" ? (draft.after[cell.index] ?? null) : null;
  const missing = missingNeeds(choice, act);
  const result = slot?.result;
  const weekly = isWeekly(view);
  const locked = weekly && slot !== undefined && (slot.locked === true || slot.status === "locked");
  // FE2：草稿改过、出问题的那一格已经排上了，就不再标红（problemStale）
  const problem = weekly && view.plan.timetable_problem?.index === cell.index && view.phase === "plan" && !problemStale(view, draft);
  // 按周：栏位名（课 / 课余 / 自由）；按旬照旧（课业 / 课后 / 本旬）
  const part = weekly ? tz(`ub.wk.col.${slot?.column ?? "free"}`) : tk(`ub.part.${view.stage === "academy" ? cell.part : "home"}`);
  const label = weekly
    ? tz("ub.wk.cellLabel", { date: slot?.label ?? "", col: part, act: act?.name ?? t("ub.empty") })
    : t("ub.cellLabel", { slot: slot?.label ?? "", part, act: act?.name ?? t("ub.empty") });
  // 按周：这一格的预计收益（卡片上的单格取整值），结算过的格改写结果
  const gain =
    weekly && act && !result
      ? [
          ...act.gains
            .filter((g) => g.range[1] > 0)
            .sort((a, b) => b.range[1] - a.range[1])
            .slice(0, 2)
            .map((g) => `${attrName(g.attr)} +${Math.round((g.range[0] + g.range[1]) / 2)}`),
          ...(act.fatigue !== 0 ? [t("ub.fatigueN", { n: act.fatigue > 0 ? `+${act.fatigue}` : `${act.fatigue}` })] : []),
        ].join(" ")
      : "";
  return (
    <div
      className={`ub-cell${active ? " is-active" : ""}${act ? " is-filled" : ""}${slot?.status === "current" ? " is-current" : ""}${slot?.status === "done" ? " is-done" : ""}${locked ? " is-locked" : ""}${problem ? " is-problem" : ""}`}
      data-column={weekly ? slot?.column : undefined}
    >
      <button
        type="button"
        className="ub-cell-btn"
        aria-pressed={active}
        disabled={!editable}
        data-testid={`cell-${cellId(cell)}`}
        aria-label={label}
        onClick={onFocus}
      >
        <span className="ub-cell-part">{part}</span>
        {act ? (
          <>
            <UbScene scene={act.scene} activity={act.key} />
            <span className="ub-cell-name">{act.name}</span>
          </>
        ) : (
          <span className="ub-cell-empty">{locked ? tz("ub.wk.locked") : t("ub.pick")}</span>
        )}
      </button>
      {gain && (
        <span className="ub-cell-gain" title={tz("ub.wk.gainTip")} data-testid={`gain-${cell.index}`}>
          {gain}
        </span>
      )}
      {editable && act && missing.length > 0 && choice && (
        <Refine view={view} index={cell.index} act={act} draft={draft} onChange={onChange} />
      )}
      {editable && act && missing.length === 0 && choice && (choice.place || choice.companion || choice.book || choice.node) && (
        <span className="ub-cell-extra">{extraText(view, choice)}</span>
      )}
      {result && (
        <span className={`ub-cell-result${result.success === false ? " is-fail" : ""}`}>
          {result.growth
            .filter((g) => g.delta !== 0)
            .slice(0, 3)
            .map((g) => `${attrName(g.attr)} ${g.delta > 0 ? "+" : ""}${g.delta}`)
            .join(" ")}
        </span>
      )}
    </div>
  );
}

function extraText(view: UpbringingView, c: NonNullable<Draft["after"][number]>): string {
  const parts: string[] = [];
  if (c.place) parts.push(view.places.find((p) => p.key === c.place)?.name ?? c.place);
  if (c.companion) parts.push(view.companions.find((p) => p.key === c.companion)?.name ?? c.companion);
  if (c.book) parts.push(view.books?.find((b) => b.key === c.book)?.name ?? c.book);
  if (c.node) {
    const ex = view.excursions.find((e) => e.key === c.excursion);
    parts.push(ex?.nodes.find((n) => n.key === c.node)?.name ?? c.node);
  }
  return parts.join(" · ");
}

/** 课后活动的补选：地点、同伴、书、远足点。 */
function Refine({ view, index, act, draft, onChange }: { view: UpbringingView; index: number; act: ActivityView; draft: Draft; onChange: (d: Draft) => void }) {
  const c = draft.after[index];
  if (!c) return null;
  const companions: CompanionView[] = act.companions.length > 0 ? view.companions.filter((p) => act.companions.some((x) => x.key === p.key)) : view.companions;
  return (
    <div className="ub-refine">
      {act.needs.includes("place") && (
        <select aria-label={t("ub.needPlace")} value={c.place ?? ""} onChange={(e) => onChange(refine(draft, index, { place: e.target.value || null }))}>
          <option value="">{t("ub.needPlace")}</option>
          {view.places
            .filter((p) => p.open)
            .map((p) => (
              <option key={p.key} value={p.key}>
                {p.people.length > 0 ? t("ub.placeWithPeople", { place: p.name, people: p.people.map((x) => x.name).join("、") }) : p.name}
              </option>
            ))}
        </select>
      )}
      {act.needs.includes("companion") && (
        <select aria-label={t("ub.needCompanion")} value={c.companion ?? ""} onChange={(e) => onChange(refine(draft, index, { companion: e.target.value || null }))}>
          <option value="">{t("ub.needCompanion")}</option>
          {companions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {act.needs.includes("book") && (
        <select aria-label={t("ub.needBook")} value={c.book ?? ""} onChange={(e) => onChange(refine(draft, index, { book: e.target.value || null }))}>
          <option value="">{t("ub.needBook")}</option>
          {(view.books ?? []).map((b) => (
            <option key={b.key} value={b.key}>
              {b.done ? t("ub.bookDone", { name: b.name }) : t("ub.bookDays", { name: b.name, days: b.days })}
            </option>
          ))}
        </select>
      )}
      {act.needs.includes("excursion") && (
        <select
          aria-label={t("ub.needNode")}
          value={c.excursion && c.node ? `${c.excursion}/${c.node}` : ""}
          onChange={(e) => {
            const [excursion, node] = e.target.value.split("/");
            onChange(refine(draft, index, { excursion: excursion || null, node: node || null }));
          }}
        >
          <option value="">{t("ub.needNode")}</option>
          {view.excursions.flatMap((ex) =>
            ex.nodes
              .filter((n) => n.state !== "unknown")
              .map((n) => (
                <option key={`${ex.key}/${n.key}`} value={`${ex.key}/${n.key}`}>
                  {t("ub.nodeOption", { area: ex.name, name: n.name, state: tk(`ub.node.${n.state}`) })}
                </option>
              )),
          )}
        </select>
      )}
    </div>
  );
}

/** 一张活动卡片。 */
function ActivityCard({ act, attrName, onPick, disabled }: { act: ActivityView; attrName: (k: string) => string; onPick: () => void; disabled: boolean }) {
  const blocked = !act.enabled;
  return (
    <li className={`ub-act${blocked ? " is-blocked" : ""}`} data-testid={`act-${act.key}`}>
      <button type="button" className="ub-act-btn" disabled={blocked || disabled} onClick={onPick} aria-describedby={blocked ? `${act.key}-why` : undefined}>
        <UbScene scene={act.scene} activity={act.key} />
        <span className="ub-act-body">
          <span className="ub-act-name">
            {act.placeholder ? tz("ub.unlock.placeholder") : act.name}
            {act.new && <span className="ub-new">{t("ub.new")}</span>}
            {blocked && act.near && (
              <span className="ub-near" title={tz("ub.unlock.nearTip")}>
                {tz("ub.unlock.near")}
              </span>
            )}
          </span>
          <span className="ub-act-desc">{act.desc}</span>
          {(act.gains.length > 0 || act.skills.length > 0) && (
            <span className="ub-act-gains" title={tz("ub.act.gainsTip")}>
              <span className="ub-act-label">{tz("ub.act.gains")}</span>
              {act.gains.map((g) => (
                <span key={g.attr} className="ub-gain">
                  {attrName(g.attr)} <b>+{g.range[0]}–{g.range[1]}</b>
                </span>
              ))}
              {act.skills.map((s) => (
                <span key={s.skill} className="ub-gain ub-gain-skill">
                  {tz("ub.act.skill", { name: s.name, xp: s.xp })}
                </span>
              ))}
            </span>
          )}
          {/* 代价与收获：每个数字都写成一句人话，悬停有解释 */}
          {(act.fatigue !== 0 || act.mood !== 0 || act.cost > 0 || act.income[1] > 0 || act.risk > 0 || act.mentor) && (
          <span className="ub-act-meta">
            <span className="ub-act-label">{tz("ub.act.costs")}</span>
            {act.fatigue > 0 && (
              <span className="is-cost" title={tz("ub.act.fatigueUpTip", { n: act.fatigue })}>
                {tz("ub.act.fatigueUp", { n: act.fatigue })}
              </span>
            )}
            {act.fatigue < 0 && (
              <span className="is-good" title={tz("ub.act.fatigueDownTip", { n: -act.fatigue })}>
                {tz("ub.act.fatigueDown", { n: -act.fatigue })}
              </span>
            )}
            {act.mood > 0 && (
              <span className="is-good" title={tz("ub.act.moodUpTip", { n: act.mood })}>
                {tz("ub.act.moodUp", { n: act.mood })}
              </span>
            )}
            {act.mood < 0 && (
              <span className="is-cost" title={tz("ub.act.moodDownTip", { n: -act.mood })}>
                {tz("ub.act.moodDown", { n: -act.mood })}
              </span>
            )}
            {act.cost > 0 && (
              <span className="is-cost" title={tz("ub.act.spendTip")}>
                {tz("ub.act.spend", { v: money(act.cost) })}
              </span>
            )}
            {act.income[1] > 0 && (
              <span className="is-good" title={tz("ub.act.earnTip")}>
                {tz("ub.act.earn", { lo: act.income[0], hi: act.income[1] })}
              </span>
            )}
            {act.risk > 0 && (
              <span className="is-cost" title={tz("ub.act.riskTip")}>
                {tz("ub.act.risk", { pct: Math.max(1, Math.round(act.risk / 100)) })}
              </span>
            )}
            {act.mentor && (
              <span className={act.mentor.present ? "is-good" : undefined} title={tz("ub.act.mentorTip")}>
                {act.mentor.present ? tz("ub.act.mentorHere", { name: act.mentor.name }) : tz("ub.act.mentorAway", { name: act.mentor.name })}
              </span>
            )}
          </span>
          )}
          {act.tier && (
            <span
              className="ub-tier-line"
              title={act.tier.next > 0 ? tz("ub.act.tierTip", { n: act.tier.progress, max: act.tier.next }) : tz("ub.act.tierTop")}
            >
              <span className="ub-tier-name">{tz("ub.act.tier", { name: act.tier.name })}</span>
              <span className="ub-tier-track" aria-label={t("ub.tierProgress", { name: act.tier.name, n: act.tier.progress, max: act.tier.next })}>
                <span style={{ width: `${act.tier.next > 0 ? Math.min(100, Math.round((act.tier.progress / act.tier.next) * 100)) : 100}%` }} />
              </span>
            </span>
          )}
          {blocked && act.blocked_reason && (
            <span className="ub-act-why" id={`${act.key}-why`}>
              {act.blocked_reason}
            </span>
          )}
          {/* U04：只差能练出来的项时，写清差多少（如“航海 312 / 340”） */}
          {blocked && act.unlock_gap && act.unlock_gap.length > 0 && (
            <span className="ub-act-gap" data-testid={`gap-${act.key}`}>
              {tz("ub.unlock.gap", {
                items: listJoin(act.unlock_gap.map((g) => tz("ub.unlock.gapItem", { label: g.label, have: g.have, need: g.need }))),
              })}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** 补选框在格子里的先后（与 Refine 里下拉框的顺序一致）：原因里按这个顺序写，补救时焦点落在第一个。 */
const NEED_ORDER: readonly ActivityNeed[] = ["place", "companion", "book", "excursion"];

/** 补选项的名字（“去哪里”“和谁”……）：v2 写开始键按不了的原因时用。 */
function needLabel(n: ActivityNeed): string {
  switch (n) {
    case "place":
      return t("ub.needPlace");
    case "companion":
      return t("ub.needCompanion");
    case "book":
      return t("ub.needBook");
    case "excursion":
      return t("ub.needNode");
  }
}

/** 带正负号的数（+3 / -20）。 */
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function UbPlanner({
  view,
  draft,
  onDraft,
  attrName,
  onSubmit,
  onPreset,
  busy,
  onStory,
}: {
  /** 有剧情在等回应时：把它重新交给玩家（这一阶段还没开始时中栏的“看剧情”） */
  onStory?: () => void;
  view: UpbringingView;
  draft: Draft;
  onDraft: (d: Draft) => void;
  attrName: (k: string) => string;
  onSubmit: () => void;
  onPreset: (preset: string) => void;
  busy: boolean;
}) {
  const v2 = useIsV2();
  const weekly = isWeekly(view);
  const cells = useMemo(() => cellsOf(view), [view]);
  // 能排的格：按旬是全部；按周只有本周还没结算、没落在换阶段之后的格
  const open = useMemo(() => openCells(view), [view]);
  const acts = useMemo(() => activityIndex(view), [view]);
  // 按周（U05）：暂停时（运行中也算）都能改本周还没结算的格；按旬只在月初安排时
  const editable = weekly ? view.plan.editable : view.plan.editable && view.phase === "plan";
  // FE2：“自动安排”只改草稿、不重交课表，后端那句“某日排不上”跟着草稿判断还算不算数
  const stale = problemStale(view, draft);
  const problemCell = weekly && view.phase === "plan" && !stale ? open.find((c) => c.index === view.plan.timetable_problem?.index) : undefined;
  const firstEmpty = problemCell ?? open.find((c) => !chosenAt(draft, c)) ?? open[0] ?? cells[0];
  const [focus, setFocus] = useState<string>(() => (firstEmpty ? cellId(firstEmpty) : ""));
  const focused = open.find((c) => cellId(c) === focus) ?? firstEmpty;
  const list = focused?.part === "lesson" ? view.lessons : view.activities;
  const kinds = kindsOf(list);
  const [kind, setKind] = useState<string>("all");
  // v2：选中的分类在这一张表里没有（从课后格换到课业格时）就当“全部”，免得列表空着；旧界面照旧
  const kindNow = v2 && kind !== "all" && !kinds.some((k) => k === kind) ? "all" : kind;
  const shown = kindNow === "all" ? list : list.filter((a) => a.kind === kindNow);
  const proj = project(view, draft);
  const complete = isComplete(view, draft);
  const tired = fatigueWarning(view.meters.fatigue, proj.fatigue);

  // ───── 只在 v2 用的：格子的位置名、开始键按不了的原因与补救 ─────
  const gridRef = useRef<HTMLDivElement>(null);
  // 按周（U05）：手机上一周的格子是可以左右滑的横条；右边还有没露出来的格时，横条带 data-more，CSS 在右沿画渐隐与“还有”的提示
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !weekly) return;
    const update = () => {
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft > 4;
      if (more) el.dataset.more = "right";
      else delete el.dataset.more;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [weekly, view.plan.slots.length]);
  // 补救按钮按过几次：每按一次，渲染完把键盘焦点放到要补的那一格（还要补选的放在第一个没选的下拉框上）
  const [jump, setJump] = useState(0);
  useEffect(() => {
    if (jump === 0) return;
    const box = gridRef.current?.querySelector<HTMLElement>(".ub-cell.is-active");
    if (!box) return;
    const select = [...box.querySelectorAll("select")].find((s) => s.value === "");
    const target = select ?? box.querySelector<HTMLElement>(".ub-cell-btn");
    target?.focus();
    // 手机上底栏贴在屏幕下沿：滚到屏幕中间，免得被底栏挡住（jsdom 没有 scrollIntoView）
    target?.scrollIntoView?.({ block: "center" });
  }, [jump]);
  const whereOf = (c: Cell): string => {
    const s = view.plan.slots.find((x) => x.index === c.index);
    const slot = s?.label ?? "";
    if (weekly) return s?.column === "free" ? slot : t("v2.upbringing.where", { slot, part: tz(`ub.wk.col.${s?.column ?? "free"}`) });
    return view.stage === "academy" ? t("v2.upbringing.where", { slot, part: tk(`ub.part.${c.part}`) }) : slot;
  };
  const goTo = (c: Cell) => {
    setFocus(cellId(c));
    setJump((n) => n + 1);
  };
  const empties = open.filter((c) => !chosenAt(draft, c));
  const needy = open.find((c) => {
    const k = chosenAt(draft, c);
    return k !== null && c.part === "after" && missingNeeds(draft.after[c.index] ?? null, acts.get(k)).length > 0;
  });
  const needyAct = needy ? acts.get(chosenAt(draft, needy) ?? "") : undefined;
  const goWhy =
    !v2 || complete
      ? null
      : empties.length > 0
        ? { reason: t("v2.upbringing.goEmpty", { n: empties.length }), fix: t("v2.upbringing.goEmptyFix", { where: whereOf(empties[0]) }), cell: empties[0] }
        : needy && needyAct
          ? {
              reason: t("v2.upbringing.goNeeds", {
                where: whereOf(needy),
                act: needyAct.name,
                needs: listJoin(
                  [...missingNeeds(draft.after[needy.index] ?? null, needyAct)].sort((a, b) => NEED_ORDER.indexOf(a) - NEED_ORDER.indexOf(b)).map(needLabel),
                ),
              }),
              fix: t("v2.upbringing.goNeedsFix"),
              cell: needy,
            }
          : null;
  const focusedAct = focused ? acts.get(chosenAt(draft, focused) ?? "") : undefined;
  // 自动安排里的“照上月”（后端：上个月的日程这个月还排得了就原样照搬，否则按“均衡”）
  const repeat = view.presets.find((p) => p.key === "previous");
  const presetSelect = (
    <select aria-label={t("ub.auto")} value="" onChange={(e) => e.target.value && onPreset(e.target.value)}>
      <option value="">{t("ub.autoPick")}</option>
      {view.presets.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name}
        </option>
      ))}
    </select>
  );
  const growth = [...proj.growth.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  /** 某一格之后的下一个空格（先找同一种格子：课业格之间、课后格之间）。 */
  const nextEmptyAfter = (from: Cell, d: Draft): Cell | undefined => {
    const at = open.findIndex((c) => cellId(c) === cellId(from));
    const after = open.slice(at + 1).concat(open.slice(0, at));
    return after.find((c) => c.part === from.part && !chosenAt(d, c)) ?? after.find((c) => !chosenAt(d, c));
  };

  const pick = (a: ActivityView) => {
    if (!focused) return;
    const next = assign(draft, focused, a.key);
    onDraft(next);
    // 选中自动移到同一种格子的下一个空格（课业格之间、课后格之间）
    const nextEmpty = nextEmptyAfter(focused, next);
    if (nextEmpty && !a.needs.length) setFocus(cellId(nextEmpty));
  };

  // 补选（去哪里、和谁……）：v2 里选中的这一格补齐了，选中就移到下一个空格（与不用补选的卡一样，少点一下）；旧界面照旧停在原处
  const refined = (c: Cell, next: Draft) => {
    onDraft(next);
    if (!v2 || !focused || cellId(focused) !== cellId(c)) return;
    const k = chosenAt(next, c);
    if (k === null || missingNeeds(next.after[c.index] ?? null, acts.get(k)).length > 0) return;
    const nextEmpty = nextEmptyAfter(c, next);
    if (nextEmpty) setFocus(cellId(nextEmpty));
  };

  // 城中各处：点一个地点 = 在选中那一旬的课后格里选这个地点（那一格不是“去走走”的活动时换成它），选中停在那一格，接着选同伴
  const placeCell = editable ? townCell(view, focused) : undefined;
  const pickPlace = (place: string) => {
    if (!placeCell) return;
    const next = goPlace(view, draft, placeCell, place);
    if (!next) return;
    onDraft(next);
    setFocus(cellId(placeCell));
  };

  // 这一阶段还没开始（X02）：家乡期第一段带入学标记，要等开场剧情答完才算开始；在那之前后端给的阶段为空、
  // 课表一格也没有、活动表是空的，“本周课表排不上”与“日程已经定了”两句都不对——中栏只写一句为什么、给一个“看剧情”
  if (!stageStarted(view)) {
    return (
      <section className="ub-planner ub-prelude" aria-label={t("ub.planner")} data-testid="ub-prelude">
        <UbTown view={view} target={undefined} editable={false} chosen={() => []} onPlace={() => {}} note={tz("ub.town.prelude")} />
        <div className="ub-prelude-body" role="status">
          <h2 className="ub-month">{tz("ub.prelude.title")}</h2>
          <p className="ub-prelude-text">{onStory ? tz("ub.prelude.story") : tz("ub.prelude.wait")}</p>
          {onStory && (
            <button type="button" className="ts-btn ts-btn-go ub-go" onClick={onStory} data-testid="ub-prelude-story">
              {tz("ub.week.story")}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="ub-planner" aria-label={t("ub.planner")}>
      <UbTown view={view} target={placeCell} editable={editable} chosen={(k) => chosenSlots(view, draft, k)} onPlace={pickPlace} />
      <header className="ub-planner-head">
        <h2 className="ub-month">
          {weekly
            ? tz("ub.wk.title", { y: view.plan.month[0], m: view.plan.month[1], n: view.plan.week ?? 1 })
            : t("ub.month", { y: view.plan.month[0], m: view.plan.month[1] })}
        </h2>
        {editable && view.presets.length > 0 && v2 && repeat ? (
          // 新界面：最常用的“照上月”单独一个键，一次点击排好（原来要先展开下拉框再选）；其余几种照旧在下拉框里
          <div className="ub-preset">
            <button type="button" className="btn ub-repeat" disabled={busy} title={tz("ub.repeatTip")} onClick={() => onPreset(repeat.key)}>
              {repeat.name}
            </button>
            <label className="ub-preset-pick">
              <span>{t("ub.auto")}</span>
              {presetSelect}
            </label>
          </div>
        ) : (
          editable &&
          view.presets.length > 0 && (
            <label className="ub-preset">
              <span>{t("ub.auto")}</span>
              {presetSelect}
            </label>
          )
        )}
      </header>
      {weekly &&
        view.phase === "plan" &&
        view.plan.timetable_problem &&
        !stale &&
        (() => {
          const reason = problemCell
            ? tz("ub.wk.problem", { where: whereOf(problemCell), reason: view.plan.timetable_problem.reason })
            : tz("ub.wk.problemAll", { reason: view.plan.timetable_problem.reason });
          return (
            <InlineError
              tone="blocked"
              compact
              className="ub-wk-problem"
              reason={reason}
              action={problemCell ? { label: tz("ub.wk.fixIt"), onClick: () => goTo(problemCell) } : undefined}
              v1={<p className="ub-warn ub-wk-problem">{reason}</p>}
            />
          );
        })()}
      <div
        ref={gridRef}
        className={`ub-grid ub-grid--${view.stage}${weekly ? ` ub-grid--week ub-grid--n${view.plan.slots.length}` : ""}`}
        role="group"
        aria-label={t("ub.slots")}
      >
        {view.plan.slots.map((s) => (
          <div key={s.index} className={`ub-col${s.status === "current" ? " is-current" : ""}${weekly ? ` ub-col--${s.column ?? "free"}` : ""}`}>
            <div className="ub-col-head">
              <span className="ub-col-label">{s.label}</span>
              {!weekly && <span className="ub-col-days">{t("ub.days", { a: s.from[2], b: s.to[2] })}</span>}
            </div>
            {cells
              .filter((c) => c.index === s.index)
              .map((c) => (
                <CellView
                  key={cellId(c)}
                  view={view}
                  draft={draft}
                  cell={c}
                  acts={acts}
                  active={editable && (!weekly || openSlot(s)) && focused !== undefined && cellId(focused) === cellId(c)}
                  onFocus={() => setFocus(cellId(c))}
                  onChange={(d) => refined(c, d)}
                  editable={editable && (!weekly || openSlot(s))}
                  attrName={attrName}
                />
              ))}
          </div>
        ))}
      </div>

      {editable && (
        <>
          {/* v2：点卡会放到哪一格（新手引导；排完一格自动跳到下一格时这一行跟着变） */}
          {v2 && focused && (
            <p className="ub-target" aria-live="polite">
              {focusedAct ? t("v2.upbringing.targetReplace", { where: whereOf(focused), act: focusedAct.name }) : t("v2.upbringing.target", { where: whereOf(focused) })}
            </p>
          )}
          <div className="ub-tabs" role="tablist" aria-label={t("ub.kinds")}>
            {["all", ...kinds].map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kindNow === k} className={kindNow === k ? "ub-tab is-on" : "ub-tab"} onClick={() => setKind(k)}>
                {tk(`ub.kind.${k}`)}
              </button>
            ))}
          </div>
          <ul className="ub-acts" aria-label={focused?.part === "lesson" ? t("ub.lessonList") : t("ub.activityList")}>
            {shown.map((a) => (
              <ActivityCard key={a.key} act={a} attrName={attrName} onPick={() => pick(a)} disabled={busy} />
            ))}
          </ul>
          {/* U04：这一局永远排不上的折叠成一行计数 */}
          {(() => {
            const n = focused?.part === "lesson" ? (view.hidden_lessons ?? 0) : (view.hidden_count ?? 0);
            return n > 0 ? (
              <p className="ub-hidden-count" title={tz("ub.unlock.hiddenTip")} data-testid="ub-hidden-count">
                {focused?.part === "lesson" ? tz("ub.unlock.hiddenLessons", { n }) : tz("ub.unlock.hidden", { n })}
              </p>
            ) : null;
          })()}
          {v2 ? (
            <footer className="ub-plan-foot">
              <p className="ub-proj" data-testid="ub-projection">
                <span className="ub-proj-label">
                  {weekly ? (open.length < cells.length ? tz("ub.wk.projLeft") : tz("ub.wk.proj")) : t("v2.upbringing.projLabel")}
                </span>
                {growth.length === 0 && proj.fatigue === 0 && proj.mood === 0 && proj.cash === 0 && <span className="ub-proj-none">{t("v2.upbringing.projNone")}</span>}
                {growth.map(([k, v]) => (
                  <span key={k} className="ub-proj-item">
                    {attrName(k)} <b>+{v}</b>
                  </span>
                ))}
                {proj.fatigue !== 0 && <span className={`ub-proj-item ${proj.fatigue > 0 ? "is-cost" : "is-good"}`}>{t("ub.fatigueN", { n: signed(proj.fatigue) })}</span>}
                {proj.mood !== 0 && <span className={`ub-proj-item ${proj.mood < 0 ? "is-cost" : "is-good"}`}>{t("ub.moodN", { n: signed(proj.mood) })}</span>}
                {proj.cash !== 0 && <span className={`ub-proj-item ${proj.cash < 0 ? "is-cost" : "is-good"}`}>{t("ub.projCash", { v: signed(proj.cash) })}</span>}
                {tired && <span className="ub-warn">{t("v2.upbringing.tired")}</span>}
              </p>
              {weekly && (
                <p className="ub-wk-note" data-testid="ub-wk-note">
                  {view.phase === "running" && planDirty(view, draft) ? tz("ub.wk.changed") : tz("ub.wk.standing")}
                </p>
              )}
              <div className="ub-go-row">
                {goWhy && (
                  <InlineError
                    tone="blocked"
                    compact
                    id="ub-go-why"
                    className="ub-go-why"
                    reason={goWhy.reason}
                    action={{ label: goWhy.fix, onClick: () => goTo(goWhy.cell) }}
                  />
                )}
                {(!weekly || view.phase === "plan") && (
                <button
                  type="button"
                  className="ts-btn ts-btn-go ub-go"
                  data-hotkey="primary"
                  disabled={!complete || busy}
                  onClick={onSubmit}
                  aria-describedby={goWhy ? "ub-go-why" : undefined}
                >
                  {weekly ? tz("ub.week.start", { n: view.plan.week ?? 1 }) : t("ub.go")}
                  {/* 小键帽：焦点不在别的按钮上时回车就按它（shell/hotkeys.ts）；触屏上不显示，排好以前也不显示；不算进按钮的名字 */}
                  {complete && !busy && (
                    <span className="ub-go-key" aria-hidden="true">
                      <Kbd k="Enter" />
                    </span>
                  )}
                </button>
                )}
              </div>
            </footer>
          ) : (
            <footer className="ub-plan-foot">
              <p className="ub-proj" data-testid="ub-projection">
                {[...proj.growth.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([k, v]) => `${attrName(k)} +${v}`)
                  .join("　")}
                {proj.cash !== 0 && <span className={proj.cash < 0 ? "is-cost" : "is-good"}>{t("ub.projCash", { v: proj.cash > 0 ? `+${proj.cash}` : proj.cash })}</span>}
                {tired && <span className="ub-warn">{t("ub.tired")}</span>}
              </p>
              {weekly && (
                <p className="ub-wk-note" data-testid="ub-wk-note">
                  {view.phase === "running" && planDirty(view, draft) ? tz("ub.wk.changed") : tz("ub.wk.standing")}
                </p>
              )}
              {(!weekly || view.phase === "plan") && (
                <button type="button" className="ts-btn ts-btn-go ub-go" disabled={!complete || busy} onClick={onSubmit}>
                  {weekly ? tz("ub.week.start", { n: view.plan.week ?? 1 }) : t("ub.go")}
                </button>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );
}
