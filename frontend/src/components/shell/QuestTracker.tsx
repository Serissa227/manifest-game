// 任务追踪条（R10-Q02）：舞台上方常驻的一小块——第一行是种类、置顶任务的名字、剩几天、“去”；
// 下面一行是这一章的目标文字（hint，FE1：照后端给的全文写，不截半句，长了就折行）；再下面一小行是眼下还差的那一件（“任一”的写成“A，或者 B”）。
// 可以收起成一枚小标（记在本机）。航海外壳与养成外壳都挂；与多站行程的小条同一层（.stage-chips），不挡海图。
// 数据来自概览的 quest_pin（quest_view.rs QuestPin）；后端没给、或者这一期没有可追踪的任务时整块不画（不留空壳）。
// “去”的按钮在要等日子、人又已经在地方时写成“在旅店等到某日”，一次点到（questGo.ts）。手动置顶的在名字后面标“已置顶”。
import { memo, useMemo, useState } from "react";
import { tz } from "../../i18n/zhOnly";
import type { QuestPin } from "../../ipc/types";
import { flagship, useGame } from "../../store/game";
import { anyRowText, daysLeftText, isExplicit, kindName, pinPlace, pinRow, questDate, questTitle, rowProgress, urgent } from "../people/questKit";
import { canGo, goQuest, type QuestTarget } from "./questGo";
import { openWindow } from "./shellState";
import { ShellIcon } from "./ShellIcon";

const KEY = "manifest.questTracker.collapsed";

function loadCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(KEY, "1");
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // 本机存储不可用时只在本次运行中记着
  }
}

/** 概览里的置顶任务：按内容取签名（每天的概览都是新对象，内容不变时追踪条不重渲染）。 */
function usePin(): QuestPin | null {
  const sig = useGame((s) => (s.overview?.quest_pin ? JSON.stringify(s.overview.quest_pin) : ""));
  return useMemo(() => (sig ? (JSON.parse(sig) as QuestPin) : null), [sig]);
}

/** 置顶任务的“去”要等日子、人又已经在地方：按钮写成“在旅店等到某日”。 */
function waitLabel(pin: QuestPin, docked: number | null, year: number | null): string | null {
  const until = pin.go?.wait_until ?? (pin.row && !isExplicit(pin.row) && pin.row.kind === "wait_until" ? pin.row.date : null);
  if (!until || docked === null) return null;
  const place = pinPlace(pin);
  if (place && place.loc !== docked) return null;
  return tz("quest.waitInn", { date: questDate(until, year) });
}

export default memo(function QuestTracker({ upbringing = false }: { upbringing?: boolean }) {
  const pin = usePin();
  const year = useGame((s) => s.overview?.world_date?.[0] ?? null);
  const docked = useGame((s) => flagship(s.overview)?.docked ?? null);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  if (!pin) return null;
  // 养成外壳只挂养成期的任务，航海外壳只挂航海期的（自动置顶本来就按当前的期挑）
  if (upbringing !== (pin.phase === "upbringing")) return null;
  const title = questTitle(pin);
  const fold = (on: boolean) => {
    setCollapsed(on);
    saveCollapsed(on);
  };
  if (collapsed) {
    return (
      <button
        type="button"
        className="quest-badge"
        data-kind={pin.kind}
        data-testid="quest-badge"
        title={tz("quest.expand", { title })}
        aria-label={tz("quest.expand", { title })}
        onClick={() => fold(false)}
      >
        <ShellIcon name="quest" scale={1} />
        {pin.progress.total > 0 && <span className="quest-badge-n">{tz("quest.progress", pin.progress)}</span>}
      </button>
    );
  }
  const row = pinRow(pin);
  const rowText = row ? anyRowText(row, year) : "";
  const progress = row && isExplicit(row) ? rowProgress(row) : null;
  const left = daysLeftText(pin.days_left);
  const target: QuestTarget = { go: pin.go, phase: pin.phase, row: pin.row };
  const goable = canGo(target);
  const wait = waitLabel(pin, upbringing ? null : docked, year);
  const pinTip = tz(pin.auto ? "quest.tipAuto" : "quest.tipManual");
  const tip = `${title}\n${pinTip}`;
  return (
    <div className="quest-tracker" data-kind={pin.kind} role="status" data-testid="quest-tracker" data-auto={pin.auto ? "1" : "0"}>
      <div className="quest-tracker-head" title={tip}>
        <span className="quest-tracker-kind">{kindName(pin.kind)}</span>
        {upbringing ? (
          <span className="quest-tracker-title">{title}</span>
        ) : (
          <button type="button" className="quest-tracker-title" onClick={() => openWindow("quests")} title={tz("quest.openLog")}>
            {title}
          </button>
        )}
        {!pin.auto && (
          <span className="quest-tracker-pin" data-testid="quest-tracker-pin">
            {tz("quest.pinnedManual")}
          </span>
        )}
        <span className="quest-tracker-gap" />
        {left && <span className={urgent(pin.days_left) ? "quest-tracker-left is-urgent" : "quest-tracker-left"}>{left}</span>}
        {goable && (
          <button type="button" className="chart-btn primary quest-go" data-testid="quest-go" title={tz("quest.goHint")} onClick={() => goQuest(target)}>
            {wait ?? tz("quest.go")}
          </button>
        )}
        <button type="button" className="quest-fold" aria-label={tz("quest.collapse")} title={tz("quest.collapse")} onClick={() => fold(true)}>
          –
        </button>
      </div>
      {pin.hint && (
        <p className="quest-tracker-hint" data-testid="quest-tracker-hint">
          {pin.hint}
        </p>
      )}
      {rowText && (
        <p className={row && isExplicit(row) && row.kind === "any" ? "quest-tracker-row is-any" : "quest-tracker-row"} data-testid="quest-tracker-row">
          <span className="quest-tracker-check" aria-hidden>
            ☐
          </span>
          {rowText}
          {progress && <b className="quest-tracker-n">{progress}</b>}
        </p>
      )}
    </div>
  );
});
