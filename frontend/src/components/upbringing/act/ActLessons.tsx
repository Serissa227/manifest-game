// 平日：课业格逐格在那门课的地方的场景里出结果。后端每过一天结算当天的格，这里把新出的结果在场景上闪一下（约半秒一格；
// 开课时时钟换成“快”，五个平日约两秒半），出彩是金色、失手是红色；场景下面一条列着本周每一格。“跳过”：不再一格格闪。
import { useEffect, useRef, useState } from "react";
import { publicImage } from "../../../art/imageUrl";
import type { LessonSlotView } from "../../../ipc/actTypes";
import { SceneImg } from "../../scene/SceneImg";
import type { ActCtx } from "./actCtx";
import { tz } from "../../../i18n/zhOnly";
import { momentResult } from "./k2Kit";
import { activityScene, currentSlot, deltaChips, fracChips, isInlandVoyage, isRiverVoyage, lessonScene, placeScene } from "./actKit";
import { ta, type ActTextKey } from "./actText";

/** 一格结果在场景上停多久：课业时间按“快”走（一天半秒），学院一周七格约三秒。 */
const FLASH_MS = 450;

function grades(ctx: ActCtx, s: LessonSlotView) {
  const r = s.result;
  if (!r) return null;
  // K2：病中的格不上课（grade = ill）；关键时刻那一格另写一段“险·成了”
  const moment = momentResult({ moment: r.moment ?? s.moment, moment_ok: r.moment_ok ?? s.moment_ok });
  return {
    grade: r.grade === "ill" ? tz("ub.act.result.ill") : ta(`ls.grade.${r.grade}` as ActTextKey),
    moment,
    // 第三趟：后端给了带小数的成长（growth_x100）就按它写（+0.4），不把小于 1 的写成 +1；没给时照旧写记上的整数点
    chips: [
      ...(r.growth_x100 ? fracChips(r.growth_x100, ctx.names.attr) : deltaChips(r.growth, ctx.names.attr)),
      ...deltaChips(r.skill, ctx.names.skill),
      ...deltaChips(r.affinity, ctx.names.person),
    ],
  };
}

export function ActLessons({ ctx, onSkip }: { ctx: ActCtx; onSkip: () => void }) {
  const { act, view, names } = ctx;
  const slots = act.lessons.slots.filter((s) => !s.past);
  // 闪过的格：挂上时已经有结果的不再闪（读档、切回来）——只有昨天、今天刚出的那一格还闪一次
  const seen = useRef<Set<number> | null>(null);
  if (seen.current === null) {
    const settled = slots.filter((s) => s.result);
    const last = settled[settled.length - 1];
    const fresh = last && last.date[0] === view.today[0] && last.date[1] === view.today[1] && view.today[2] - last.date[2] <= 1 ? last.index : -1;
    seen.current = new Set(settled.map((s) => s.index).filter((i) => i !== fresh));
  }
  const [flash, setFlash] = useState<number | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [skipped, setSkipped] = useState(false);
  const done = slots
    .filter((s) => s.result)
    .map((s) => s.index)
    .join(",");
  useEffect(() => {
    const fresh = done
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((i) => !seen.current?.has(i));
    if (fresh.length === 0) return;
    for (const i of fresh) seen.current?.add(i);
    if (!skipped) setQueue((q) => [...q, ...fresh]);
  }, [done, skipped]);
  useEffect(() => {
    if (flash !== null || queue.length === 0) return;
    setFlash(queue[0]);
    setQueue((q) => q.slice(1));
  }, [flash, queue]);
  useEffect(() => {
    if (flash === null) return;
    const id = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  const showing = slots.find((s) => s.index === flash) ?? currentSlot(act);
  const line = act.lines.find((l) => l.key === showing?.line);
  const place = act.places.find((p) => p.key === line?.place);
  // 有专画的课（A04 京都三门）用它自己的场景，别的按地点
  const activity = showing?.activity ?? line?.tiers[Math.max(0, showing?.tier ?? 0)]?.activity;
  // U06F5：出海那几周的船课在小早的甲板上上
  // U06F9：这门课这一档的活计自己写了场景键（如“拿桨当棍”→ dojo_tosa、守夜 → 望楼）就用它；没有再按地点挑
  const acts = [...(view.lessons ?? []), ...(view.activities ?? [])];
  const art = ctx.act.voyage
    ? placeScene(isRiverVoyage(ctx.act.voyage.key) ? "river" : isInlandVoyage(ctx.act, ctx.act.voyage.key) ? "dock" : "deck", view.town?.culture ?? view.culture, view.today[1], ctx.act.voyage.port)
    : (lessonScene(activity, view.lessons ?? [], view.today[1]) ??
      activityScene(activity, acts, view.today[1]) ??
      placeScene(place?.kind ?? "classroom", view.town?.culture ?? view.culture, view.today[1], ctx.town));
  const flashing = flash !== null ? slots.find((s) => s.index === flash) : undefined;
  const g = flashing ? grades(ctx, flashing) : null;
  const src = art ? publicImage(art.src) : null;

  return (
    <section className="ua-lessons" data-testid="ua-lessons" aria-label={ta("ls.title")}>
      <div className="ua-fit" style={src ? ({ "--ua-art": `url("${src}")` } as React.CSSProperties) : undefined}>
        <div className="ua-scene">
          {art && src ? <SceneImg className="ua-scene-img" src={src} file={art.file} lazy={false} /> : <span className="ua-scene-plain" aria-hidden />}
          {flashing && g && (
            <div className={`ua-flash is-${flashing.result?.grade}`} key={flashing.index} role="status">
              <b>{g.grade}</b>
              {g.moment && <span className="ua-moment-tag">{g.moment}</span>}
              <span className="ua-chips">
                {g.chips.map((c) => (
                  <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                    {c.text}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        <div className="ua-scene-plate">
          <span className="ua-scene-name">
            {showing ? `${showing.date[2]} 日 · ${names.line(showing.line)}` : ta("ls.title")}
            {place && <span className="ua-quiet"> · {names.place(place.key)}</span>}
          </span>
        </div>
        <button
          type="button"
          className="ua-btn ua-btn--ghost ua-skip"
          data-testid="ua-skip"
          title={ta("ls.skipTip")}
          onClick={() => {
            setSkipped(true);
            setQueue([]);
            setFlash(null);
            onSkip();
          }}
        >
          {ta("ls.skip")} »
        </button>
      </div>
      <ol className="ua-ticker" data-n={slots.length}>
        {slots.map((s) => {
          const r = grades(ctx, s);
          return (
            <li
              key={s.index}
              className={`ua-tick${s.result ? ` is-${s.result.grade}` : ""}${showing?.index === s.index ? " is-now" : ""}${s.kind === "evening" ? " is-evening" : ""}`}
            >
              <span className="ua-tick-day">
                {s.date[2]} 日{s.kind === "evening" ? ` ${ta("tt.evening")}` : ""}
              </span>
              <b className="ua-tick-line">{names.line(s.line)}</b>
              {r ? (
                <>
                  <span className="ua-tick-grade">{r.grade}</span>
                  {r.moment && <span className="ua-moment-tag">{r.moment}</span>}
                  <span className="ua-chips">
                    {r.chips.slice(0, 3).map((c) => (
                      <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                        {c.text}
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                <span className="ua-quiet">{ta("ls.pending")}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
