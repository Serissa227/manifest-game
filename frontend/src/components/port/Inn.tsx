// 港口的旅店：在港时间不走，住旅店才过天。
// 手动航行的世界里旗舰队在港时时间不走（Overview.port_hold），在这里住下日子才过去：
// - 休息 1 / 3 / 7 天，或住到下月初：调用现有的按天推进（step），每天照常结算（工钱、利息、行情……）；一周以内一天推进一次，
//   住到下月初几天推进一次（innKit.ts：每次都回传整份概览）；
// - 推进时显示“休息中：第 k / n 天”，可以中途“起床”（做完手上这一次就停）；关上窗口也就不睡了；
// - 遇到要玩家回应的事（剧情、海战……，后端在概览的 awaiting 里写明是哪一类）提前起来，写明第几天、为什么；
// - 先不收房钱，也没有别的数值效果（只是让时间过去）。
// 分页只在旗舰队停着的那座港口出现（PortPanel），排在酒馆后面；街景名牌下另有一个“旅店”键（PortScene）。
import { useEffect, useRef, useState } from "react";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { AwaitingKind, PortHoldView, WorldDate } from "../../ipc/types";
import { useGame } from "../../store/game";
import { questDate } from "../people/questKit";
import { daysBetween, useQuestUi } from "../shell/questGo";
import { tierName } from "../../time/speedText";
import { Section } from "../common";
import { INN_DAYS, INN_PACE, innChunk } from "./innKit";

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

type Why = AwaitingKind | "other";

/** 休息结束时的一句话。 */
function summary(total: number, done: number, why: Why | null): string {
  if (why) {
    const reason = tz(`inn.why.${why}` as const);
    return done > 0 ? tz("inn.woken", { k: done, why: reason }) : tz("inn.blocked", { why: reason });
  }
  return done < total ? tz("inn.stopped", { k: done }) : tz("inn.done", { n: done });
}

export default function InnPanel({ hold }: { hold: PortHoldView }) {
  const [rest, setRest] = useState<{ total: number; done: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // 中途起床、窗口关上：做完手上这一天就停
  const stop = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);

  // until（R10-Q02 任务的“在旅店等到那天”）：住到世界日历的那一天就起来；total 只是估的天数（进度条用），
  // 每次推进不越过估出来的剩余天数，最后几天一天一推，不会多睡过头
  const run = async (total: number, until?: WorldDate) => {
    stop.current = false;
    setResult(null);
    setRest({ total, done: 0 });
    let done = 0;
    let why: Why | null = null;
    let reached = false;
    const chunk = innChunk(total);
    const left = () => {
      const g = useGame.getState();
      const today = g.overview?.world_date;
      return until && today ? daysBetween(today, until, g.statics?.world?.calendar?.months) : total - done;
    };
    try {
      while ((until ? left() > 0 && done < total + 31 : done < total) && !stop.current) {
        const g = useGame.getState();
        const before = g.overview?.day ?? 0;
        const want = Math.max(1, Math.min(chunk, until ? (left() <= 3 ? 1 : left()) : total - done));
        const o = await api.step(want);
        g.setOverview(o);
        const got = o.day - before;
        if (until && left() <= 0) reached = true;
        // 一天也没过去（有事在等着、还没回应）：不再空转
        if (got <= 0) {
          why = o.awaiting ?? "other";
          break;
        }
        done = Math.min(total, done + got);
        if (alive.current) setRest({ total, done });
        // 在那一天停下了：有事要回应
        if (o.awaiting || got < want) {
          why = o.awaiting ?? "other";
          break;
        }
        // 旗舰队不在港了（不会在休息时发生，以防万一）
        if (!o.port_hold) break;
        if (done < total && !stop.current) await wait(INN_PACE.ms(total));
      }
    } catch (e) {
      useGame.getState().fail(e);
      void useGame.getState().resync();
    }
    useGame.getState().refreshViews();
    if (!alive.current) return;
    setRest(null);
    setResult(reached && !why && until ? tz("quest.innUntilDone", { date: questDate(until, null) }) : summary(total, done, why));
  };

  const busy = rest !== null;
  // 任务的“在旅店等到那天”（questGo.ts）：打开这一页时带着要住到的日子，直接住下（只认一次）
  const askSeq = useQuestUi((s) => s.inn?.seq ?? 0);
  useEffect(() => {
    const a = useQuestUi.getState().inn;
    if (!a || a.seq !== askSeq || busy) return;
    useQuestUi.setState({ inn: null });
    void run(a.days, a.until);
    // 只在新的请求到了时开始；run 每次渲染都是新的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askSeq]);
  return (
    <div className="inn" data-testid="inn">
      <Section title={tz("inn.tab")}>
        <p className="sub">{tz("inn.hint")}</p>
        <div className="inn-rest" role="group" aria-label={tz("inn.tab")}>
          {INN_DAYS.map((n) => (
            <button key={n} type="button" className="btn" disabled={busy} onClick={() => void run(n)}>
              {tz("inn.rest", { n })}
            </button>
          ))}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run(hold.month_days)}>
            {tz("inn.restMonth", { n: hold.month_days })}
          </button>
        </div>
        {rest && (
          <div className="inn-progress" data-testid="inn-progress">
            <span className="inn-bar" role="progressbar" aria-valuemin={0} aria-valuemax={rest.total} aria-valuenow={rest.done}>
              <span style={{ width: `${(rest.done / rest.total) * 100}%` }} />
            </span>
            <span role="status">{tz("inn.resting", { k: Math.min(rest.done + 1, rest.total), n: rest.total })}</span>
            <button type="button" className="btn" onClick={() => (stop.current = true)}>
              {tz("inn.wake")}
            </button>
          </div>
        )}
        {result && (
          <p className="inn-result" role="status" data-testid="inn-result">
            {result}
          </p>
        )}
        <p className="sub">{tz("inn.after", { name: tierName(hold.resume) })}</p>
      </Section>
    </div>
  );
}
