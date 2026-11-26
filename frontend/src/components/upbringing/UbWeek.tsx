// 养成主画面的周条（P10 的界面接线）。
// 按周播放的世界（寰宇）里，时钟每过完一周停一下：这里写清这一周是几号到几号、这个月的几周各过到哪儿，
// 并给一个一眼找得到的主按钮——停在一周开头时“开始第 N 周”，过到一半停下时“继续这一周”，正在走时“暂停”。
// 有一段收起的剧情在等回应时，主按钮先把它重新交给玩家（不然时间走不动）。月初排日程时不另给按钮（日程里的“开始这个月”就是第 1 周）。
// 不按周播放的世界（养成视图里没有 week）不画这一条。新文案先只写中文（i18n/zhOnly.ts）。
// U05 按周排程：周条固定 4 段（第 4 周到月末），“第 N 周 / 4”；常设周课表铺不上时停在安排阶段，主按钮在日程里；
// 另有一个小下拉框选停顿方式（每周停 / 每月停 / 有事才停）。
import { useEffect, useState } from "react";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { AppSettings, UpbringingPause, UpbringingView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd } from "../feedback";
import { ShellIcon } from "../shell/ShellIcon";
import { monthLastDay, monthWeeks, weekAction, type WeekAction } from "./ubKit";
import { useUbPause } from "./ubPause";

/** 主按钮上的字。 */
function actionLabel(action: WeekAction, n: number): string {
  switch (action) {
    case "story":
      return tz("ub.week.story");
    case "start":
      return tz("ub.week.start", { n });
    case "resume":
      return tz("ub.week.resume");
    default:
      return tz("ub.week.pause");
  }
}

export function UbWeek({
  view,
  paused,
  storyWaiting,
  onAction,
}: {
  view: UpbringingView;
  /** 时钟停着 */
  paused: boolean;
  /** 有一段收起（“稍后再说”）的剧情在等回应 */
  storyWaiting: boolean;
  /** 主按钮：与顶上的播放键、空格同一个动作 */
  onAction: () => void;
}) {
  const v2 = useIsV2();
  const week = view.week;
  if (!week) return null;
  const action = weekAction(view, { paused, storyWaiting });
  if (action === null) return null;
  const today = view.today[2];
  // 按周排程（U05）：每月固定 4 周，第 4 周到月末
  const weekly = view.plan.mode === "week";
  const weeks = monthWeeks(monthLastDay(view), today, week.count);
  const m = week.from[1];
  const range =
    week.from[2] === week.to[2] ? tz("ub.week.day", { m, a: week.from[2] }) : tz("ub.week.range", { m, a: week.from[2], b: week.to[2] });
  const firstPlan = weekly && view.plan.slots.every((s) => !s.timetable);
  const note =
    action === "plan"
      ? weekly
        ? firstPlan
          ? tz("ub.wk.noteFirst")
          : tz("ub.wk.notePlan")
        : tz("ub.week.notePlan")
      : action === "story"
        ? tz("ub.week.noteStory")
        : action === "start"
          ? week.number > 1
            ? tz("ub.week.noteNext", { n: week.number - 1 })
            : tz("ub.week.noteFirst")
          : action === "resume"
            ? tz("ub.week.noteResume", { m, d: today })
            : tz("ub.week.noteRunning", { b: week.to[2] });
  // 这一周过了几天（停在开头时为 0）
  const span = week.to[2] - week.from[2] + 1;
  const done = Math.max(0, Math.min(span, today - week.from[2]));
  const primary = action === "start" || action === "resume" || action === "story";
  return (
    <section className="ub-week" data-testid="ub-week" data-action={action} aria-label={tz("ub.week.label")}>
      <div className="ub-week-now">
        <strong className="ub-week-no" data-testid="ub-week-no" title={week.count ? tz("ub.wk.of", { n: week.number, total: week.count }) : undefined}>
          {tz("ub.week.no", { n: week.number })}
          {week.count && <span className="ub-week-of">/{week.count}</span>}
        </strong>
        <span className="ub-week-range" data-testid="ub-week-range">
          {range}
        </span>
      </div>
      <ol className="ub-week-track" aria-label={tz("ub.week.track")}>
        {weeks.map((w) => (
          <li
            key={w.number}
            className={`ub-week-seg is-${w.state}`}
            aria-current={w.state === "current" ? "step" : undefined}
            title={tz(`ub.week.seg.${w.state}`, { n: w.number, a: w.from, b: w.to })}
          >
            <span className="ub-week-seg-days">{w.from === w.to ? `${w.from}` : `${w.from}–${w.to}`}</span>
            {w.state === "current" && (
              <span className="ub-week-seg-bar" aria-hidden="true">
                <span className="ub-week-seg-fill" style={{ width: `${Math.round((done / span) * 100)}%` }} />
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="ub-week-note" role="status" data-testid="ub-week-note">
        {note}
      </p>
      {action !== "plan" && (
        <button
          type="button"
          className={primary ? "ts-btn ub-week-go is-primary" : "ts-btn ub-week-go"}
          data-testid="ub-week-go"
          // 新界面：回车按这个主按钮（月初排日程时主按钮是“开始这个月”，这里不抢）
          data-hotkey={v2 && primary && view.phase === "running" ? "primary" : undefined}
          onClick={onAction}
        >
          <ShellIcon name={action === "pause" ? "pause" : "play"} scale={1} />
          {actionLabel(action, week.number)}
          {/* 小键帽：空格与这个按钮同一个动作（触屏上不显示；不算进按钮的名字） */}
          {v2 && action !== "story" && (
            <span className="ub-week-key" aria-hidden="true">
              <Kbd k="Space" />
            </span>
          )}
        </button>
      )}
      {weekly && <PauseMode />}
    </section>
  );
}

/**
 * 停顿方式（U05）：每周停（缺省）/ 每月停 / 有事才停。存在应用设置里（`upbringing_pause`），与设置面板同一项；
 * 不论哪一种，课表排不上、有剧情、太累时都会停。读不到设置（旧后端、测试替身）时不画。
 * inMenu（FIX4F）：放在行动制的主菜单里（行动制没有周条）——同一个设置、同一份状态，只是写全名、换一套样式。
 */
const PAUSE_MODES = ["week", "month", "event"] as const satisfies readonly UpbringingPause[];

export function PauseMode({ inMenu = false }: { inMenu?: boolean } = {}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getSettings()
      .then((v) => {
        if (!alive || !v?.settings) return;
        setSettings(v.settings);
        useUbPause.setState({ pause: v.settings.upbringing_pause ?? "week", loaded: true });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!settings) return null;
  const value: UpbringingPause = settings.upbringing_pause ?? "week";
  const pick = (k: UpbringingPause) => {
    const next = { ...settings, upbringing_pause: k };
    setSettings(next);
    useUbPause.setState({ pause: k, loaded: true });
    api
      .saveSettings(next)
      .then((v) => {
        if (!v?.settings) return;
        setSettings(v.settings);
        useUbPause.setState({ pause: v.settings.upbringing_pause ?? "week", loaded: true });
      })
      .catch((err) => useGame.getState().fail(err));
  };
  if (inMenu) {
    // FIX5F：主菜单里地方够，三种方式排成三行，各自下面一行小字说明会怎样（下拉框里写不下）
    return (
      <fieldset className="ub-menu-pause" data-testid="ub-menu-pause">
        <legend>{tz("settings.upbringingPause")}</legend>
        {PAUSE_MODES.map((k) => (
          <label key={k} className={value === k ? "ub-menu-pause-opt is-on" : "ub-menu-pause-opt"}>
            <input type="radio" name="ub-menu-pause" value={k} checked={value === k} onChange={() => pick(k)} data-testid={`ub-menu-pause-${k}`} />
            <span className="ub-menu-pause-text">
              <b>{tz(`ub.wk.pause.${k}`)}</b>
              <small>{tz(`ub.wk.pauseNote.${k}`)}</small>
            </span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <label className="ub-week-pause" title={tz("ub.wk.pauseTip")}>
      <span>{tz("ub.wk.pauseLabel")}</span>
      <select aria-label={tz("settings.upbringingPause")} data-testid="ub-week-pause" value={value} onChange={(e) => pick(e.target.value as UpbringingPause)}>
        {PAUSE_MODES.map((k) => (
          <option key={k} value={k}>
            {tz(`ub.wk.pause.${k}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
