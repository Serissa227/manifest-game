// 任务日志（FRAMEWORK §10.2，docs/UI-CONTRACT.md I5；第十轮 R10-Q02 改版）。
// 后端给了任务视图（story_log.quests，R10-Q01 契约 4）时：按种类分组（主线 / 引导 / 人物 / 请托 / 委托 / 年度目标 / 史事），
// 每条写标题、目标文字（hint）、目标行与进度、地点、剩余天数、奖励摘要（主线、人物、请托不写奖励，免得剧透）、“去”与“置顶”；
// 办完的、错过的折叠在最下面（没办成的写原因：Q01b 的失败码）。句子由 questKit.ts 按种类出字。
// FE1 对着后端真实的视图（quest_view.rs）改：“任一”的目标行下面逐条列分支（任一做成即可）；隐式行的地点可能为 null；
// 开过以后又悄悄结束、从没露过面的旁轨后端不发，这里不用管。
// 后端没给 quests（旧后端、quests 关着）时照旧画轨道列表（降级，下面的 LegacyQuests，与改版前一样）：
// 每条故事轨道的当前章节与目标；目标写明去哪里、还剩几天，完成的打勾。进行中的排在前面，有期限的按剩余天数。
// 新界面（v2）：没有进行中的任务时，空状态给下一步（有收起的完成任务就“也看看”，否则去人物页见见人）；旧界面照旧一行字。
// 跨洋送货的两条主线在要出海的那几章下面写一行沿途在哪些港口补给（V01，stopovers.ts）。
import { useState } from "react";
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { QuestView, StoryLog, TrackView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { EmptyState, Loading } from "../feedback";
import { canGo, goQuest } from "../shell/questGo";
import { openWindow } from "../shell/shellState";
import { sortTracks } from "./peopleKit";
import {
  anyBranches,
  daysLeftText,
  failureText,
  groupQuests,
  implicitText,
  isOpen,
  kindName,
  mechanicName,
  questTitle,
  rewardText,
  rowProgress,
  rowText,
  sortQuests,
  statusName,
  urgent,
} from "./questKit";
import { stopoverText } from "./stopovers";
import { useBlockedPorts } from "../nav/blockedPorts";

const NONE: TrackView[] = [];

export default function QuestsPanel() {
  // 取不到时当作没有任务
  const log = useView("storylog", () => api.storyLog(), { quiet: true });
  if (log.status === "error") return <LegacyQuests tracks={NONE} />;
  if (!log.data) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  if (Array.isArray(log.data.quests)) return <QuestLog log={log.data} quests={log.data.quests} />;
  return <LegacyQuests tracks={log.data.tracks ?? NONE} />;
}

/** 置顶 / 取消置顶：成功后换上新的概览（追踪条随之换），任务日志重新取一次。 */
async function pin(id: string | null): Promise<void> {
  const g = useGame.getState();
  try {
    const o = await api.pinQuest(id);
    if (o && typeof o === "object" && Array.isArray(o.fleets)) g.setOverview(o);
    g.refreshViews();
  } catch (e) {
    g.fail(tz("quest.pinFailed", { why: e instanceof Error ? e.message : String(e) }));
  }
}

function QuestLog({ log, quests }: { log: StoryLog; quests: QuestView[] }) {
  const statics = useGame((s) => s.statics);
  const year = useGame((s) => s.overview?.world_date?.[0] ?? null);
  const open = quests.filter(isOpen);
  const closed = sortQuests(quests.filter((q) => !isOpen(q)));
  const groups = groupQuests(open);
  const trackOf = (q: QuestView) => (q.id.startsWith("track:") ? log.tracks.find((x) => `track:${x.key}` === q.id) : undefined);
  return (
    <div className="qs-panel qs2" data-testid="quests">
      {groups.length === 0 ? (
        <EmptyState
          v1={<p className="ts-empty">{tz("quest.empty")}</p>}
          text={tz("quest.empty")}
          action={{ label: t("v2.fleet.goPeople"), onClick: () => openWindow("people") }}
        />
      ) : (
        groups.map((g) => (
          <section key={g.kind} className="qs2-group" data-kind={g.kind} data-testid={`quest-group-${g.kind}`}>
            <h3 className="qs2-group-title">
              {kindName(g.kind)}
              <small>{g.items.length}</small>
            </h3>
            <ul className="qs2-list">
              {g.items.map((q) => {
                const track = trackOf(q);
                return <QuestItem key={q.id} q={q} year={year} autoPinned={!!log.pinned_auto} stopover={track ? stopoverText(statics, track) : null} />;
              })}
            </ul>
          </section>
        ))
      )}
      {closed.length > 0 && (
        <details className="qs2-closed" data-testid="quest-closed">
          <summary>{tz("quest.closed", { n: closed.length })}</summary>
          <ul className="qs2-list">
            {closed.map((q) => (
              <li key={q.id} className={`qs2-item qs2-item--${q.status}`} data-testid={`quest-${q.id}`}>
                <p className="qs2-head">
                  <span className="qs2-title">{questTitle(q)}</span>
                  <span className="qs2-kind">{kindName(q.kind)}</span>
                  <span className="qs2-status">{statusName(q.status)}</span>
                </p>
                {q.chapter_title && <p className="qs2-chapter">{q.chapter_title}</p>}
                {q.status === "failed" && failureText(q.failure) && (
                  <p className="qs2-failure" data-testid={`quest-${q.id}-failure`}>
                    {tz("quest.failedWhy", { why: failureText(q.failure) ?? "" })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestItem({ q, year, autoPinned, stopover }: { q: QuestView; year: number | null; autoPinned: boolean; stopover: string | null }) {
  const left = daysLeftText(q.days_left);
  const place = q.go?.port ?? q.rows.find((r) => r.place)?.place ?? null;
  // 隐式行里“去某地”已经写在地点上、期限已经写在剩余天数上：列出来的只留等日子与没到的地方
  const implicit = q.implicit.filter((r) => r.kind === "wait_until" || (r.kind === "go_to" && !r.done && q.rows.length === 0));
  const target = { go: q.go, phase: q.phase, rows: q.rows, implicit: q.implicit };
  // R10-FIX8：这支舰队去不了的港（禁港、进港限制）也事先灰着，写与真去时被拒的同一句
  const noGo = useBlockedPorts();
  const blocked = place?.loc !== null && place?.loc !== undefined ? (noGo.get(place.loc) ?? null) : null;
  const showRewards = !q.rewards_hidden && q.rewards.length > 0;
  return (
    <li className={`qs2-item qs2-item--${q.status}${q.pinned ? " is-pinned" : ""}`} data-testid={`quest-${q.id}`}>
      <p className="qs2-head">
        <span className="qs2-title">{questTitle(q)}</span>
        {q.status === "waiting" && <span className="qs2-status">{statusName(q.status)}</span>}
        {left && <span className={urgent(q.days_left) ? "qs-left is-urgent" : "qs-left"}>{left}</span>}
      </p>
      {q.chapter_title && <p className="qs2-chapter">{q.chapter_title}</p>}
      {q.hint && <p className="qs2-hint">{q.hint}</p>}
      {(q.rows.length > 0 || implicit.length > 0) && (
        <ul className="qs-objs qs2-rows">
          {q.rows.map((r, i) => {
            const branches = anyBranches(r);
            if (branches.length > 0) {
              // “任一”：父行写“下面做成一件就行”，分支缩进列出，各自打勾、各自的进度
              return (
                <li key={`r${i}`} className={r.done ? "qs2-any is-done" : "qs2-any"} data-testid={`quest-${q.id}-any`}>
                  <span className="qs-check" aria-hidden>
                    {r.done ? "☑" : "☐"}
                  </span>
                  <span>{tz("quest.row.any")}</span>
                  <ul className="qs2-branches">
                    {branches.map((b, j) => {
                      const n = rowProgress(b);
                      return (
                        <li key={j} className={b.done ? "is-done" : undefined}>
                          <span className="qs2-or" aria-hidden>
                            {b.done ? "☑" : "○"}
                          </span>
                          <span>{rowText(b)}</span>
                          {n && <span className="qs2-n">{n}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            }
            const n = rowProgress(r);
            return (
              <li key={`r${i}`} className={r.done ? "is-done" : undefined}>
                <span className="qs-check" aria-hidden>
                  {r.done ? "☑" : "☐"}
                </span>
                <span>{rowText(r)}</span>
                {n && <span className="qs2-n">{n}</span>}
              </li>
            );
          })}
          {implicit.map((r, i) => (
            <li key={`i${i}`} className="qs2-implicit">
              <span className="qs-check" aria-hidden>
                ☐
              </span>
              <span>{implicitText(r, year)}</span>
            </li>
          ))}
        </ul>
      )}
      {stopover && (
        <p className="qs-stopover" data-testid={`quest-${q.id}-stopover`}>
          {stopover}
        </p>
      )}
      <p className="qs2-meta">
        {place && !implicit.some((r) => r.kind === "go_to") && <span className="qs-place">{place.label ? tz("quest.where", { place: place.label }) : tz("quest.whereUnknown")}</span>}
        {q.teaches.length > 0 && <span className="qs2-teaches">{tz("quest.teaches", { list: q.teaches.map(mechanicName).join("、") })}</span>}
      </p>
      {showRewards && (
        <p className="qs2-rewards" data-testid={`quest-${q.id}-rewards`}>
          {tz("quest.rewards")}
          {q.rewards.map(rewardText).join("、")}
          {q.rewards_vary && <small>{tz("quest.rewardsVary")}</small>}
        </p>
      )}
      <div className="qs2-actions">
        {(canGo(target) || blocked) && (
          <button
            type="button"
            className={blocked ? "btn qs2-go" : "btn primary qs2-go"}
            data-testid={`quest-${q.id}-go`}
            disabled={!!blocked}
            title={blocked ?? undefined}
            onClick={() => goQuest(target)}
          >
            {tz("quest.go")}
          </button>
        )}
        {q.pinned && !autoPinned ? (
          <button type="button" className="btn qs2-pin is-on" aria-pressed="true" onClick={() => void pin(null)}>
            {tz("quest.unpin")}
          </button>
        ) : (
          <button type="button" className={q.pinned ? "btn qs2-pin is-auto" : "btn qs2-pin"} aria-pressed={q.pinned} title={tz("quest.pinHint")} onClick={() => void pin(q.id)}>
            {q.pinned ? tz("quest.pinnedAuto") : tz("quest.pin")}
          </button>
        )}
      </div>
      {blocked && (
        <p className="sub qs2-why" data-testid={`quest-${q.id}-why`}>
          {blocked}
        </p>
      )}
    </li>
  );
}

/** 旧的轨道列表（后端没给任务视图时；与改版前一样）。 */
function LegacyQuests({ tracks }: { tracks: TrackView[] }) {
  const [showDone, setShowDone] = useState(false);
  const statics = useGame((s) => s.statics);
  const shown = sortTracks(tracks).filter((x) => showDone || x.status === "active" || x.status === "waiting");
  return (
    <div className="qs-panel" data-testid="quests">
      <label className="pp-here">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        {t("qs.showDone")}
      </label>
      {shown.length === 0 ? (
        <EmptyState
          v1={<p className="ts-empty">{t("qs.empty")}</p>}
          text={t("qs.empty")}
          hint={t("v2.fleet.questsHint")}
          action={
            !showDone && tracks.length > 0
              ? { label: t("v2.fleet.showDone"), onClick: () => setShowDone(true) }
              : { label: t("v2.fleet.goPeople"), onClick: () => openWindow("people") }
          }
        />
      ) : (
        <ul className="qs-list">
          {shown.map((x) => {
            const stopover = stopoverText(statics, x);
            return (
              <li key={x.key} className={`qs-track qs-track--${x.status}`} data-testid={`track-${x.key}`}>
                <p className="qs-head">
                  <span className="qs-name">{x.name}</span>
                  <span className="qs-kind">{tk(`qs.kind.${x.kind}`) === `qs.kind.${x.kind}` ? x.kind : tk(`qs.kind.${x.kind}`)}</span>
                  <span className="qs-status">{tk(`qs.status.${x.status}`)}</span>
                </p>
                <p className="qs-chapter">{x.chapter_title}</p>
                {stopover && (
                  <p className="qs-stopover" data-testid={`track-${x.key}-stopover`}>
                    {stopover}
                  </p>
                )}
                <ul className="qs-objs">
                  {x.objectives.map((o, i) => (
                    <li key={i} className={o.done ? "is-done" : undefined}>
                      <span className="qs-check" aria-hidden>
                        {o.done ? "☑" : "☐"}
                      </span>
                      <span>{o.text}</span>
                      {o.place && <span className="qs-place">{o.place}</span>}
                      {!o.done && typeof o.days_left === "number" && <span className={o.days_left <= 10 ? "qs-left is-urgent" : "qs-left"}>{t("qs.daysLeft", { n: o.days_left })}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
