// 养成主画面的“城中各处”（场景视图）：日程纸最上面一幅这一阶段所在城市的 CG（家乡期是家乡港，学院期是学院所在的城市；按当月挑季节版，
// 没有这座城的图时用同文化的图，再没有就是按季节着色的渐变底，挑法见 townKit.ts），可以去的地点按数据里的 x、y 摆成能点的图标。
// 点一个地点等同于在原来的“去哪里”下拉框里选它：那一格是要选地点的活动就补上地点，否则换成“去走走”的活动再补上（townKit.ts 的 goPlace），
// 同伴之类的照旧在格子下面的下拉框里接着选；能不能去仍以后端为准（地点没开放、这个月排不了“去走走”时图标是灰的，写明原因：
// 整片点不了的原因写在画面上方那一行，单个地点没开放的原因在悬停提示与读屏描述里）。
// 每个地点是真正的 <button>：读屏名是地名，图标与地名小签是它的内容；悬停与键盘焦点有反馈。
// 地名小签缺省在图标下面，会压到邻近的图标时换到上面、右边或左边（townKit.ts 的 labelSides，data-label）。
// 日程纸窄（< 520 px，手机竖屏、窄平板）时画面缩成一条横幅，地点改成画面下面一行左右滑的小签（CSS 容器查询），不会挤在一起点不着。
import { SceneImg } from "../scene/SceneImg";
import { sceneFileOf } from "../scene/sceneKit";
import { useMemo } from "react";
import { publicImage } from "../../art/imageUrl";
import { t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { PlaceView, UpbringingView } from "../../ipc/types";
import { ShellIcon } from "../shell/ShellIcon";
import { labelSides, placeIcon, spotPos, townArtOf, outings } from "./townKit";
import type { Cell } from "./ubKit";

/** 一个地点为什么点不了（能点时为 null）：整片点不了的原因优先，其次是这个地点没开放。 */
function spotReason(p: PlaceView, shared: string | null): string | null {
  if (shared) return shared;
  return p.open ? null : (p.hint ?? tz("ub.town.closed"));
}

export function UbTown({
  view,
  target,
  editable,
  chosen,
  onPlace,
  note,
}: {
  /** 整片地点都点不了时另给的原因（盖过“日程已经定了”那一类；例如这一阶段还没开始） */
  note?: string;
  view: UpbringingView;
  /** 点地点会排进的那一格（课后格；没有时地点点不了） */
  target: Cell | undefined;
  editable: boolean;
  /** 地点 key → 这个月已经排了去那里的旬 */
  chosen: (place: string) => string[];
  onPlace: (place: string) => void;
}) {
  const art = townArtOf(view);
  const sides = useMemo(() => labelSides(view.places), [view.places]);
  // 城市名：旧后端没有 town 时家乡期写家乡、学院期写学院名（都没有就不写，不拿阶段名顶替——顶栏已经写着阶段）
  const name = view.town?.name ?? (view.stage === "academy" ? view.academy?.name : view.home);
  const go = outings(view);
  const canGo = go.some((a) => a.enabled);
  // 整片地点都点不了的原因：日程已经定了 / 这个月没有能排的“去走走”（有被挡住的就写它的原因）
  const shared = note ? note : !editable || !target ? tz("ub.town.locked") : canGo ? null : (go[0]?.blocked_reason ?? tz("ub.town.noOuting"));
  const slot = target ? (view.plan.slots.find((s) => s.index === target.index)?.label ?? "") : "";
  // 按周（U05）的栏位叫“课余”，按旬照旧叫“课后”
  const part = view.plan.mode === "week" ? tz("ub.wk.col.after") : tk("ub.part.after");
  const where = view.stage === "academy" ? t("v2.upbringing.where", { slot, part }) : slot;
  const hintId = "ub-town-hint";
  return (
    <section
      className="ub-town"
      data-testid="ub-town"
      data-town={view.town?.key ?? ""}
      data-art={art?.file ?? ""}
      data-art-from={art?.from ?? "none"}
      aria-label={tz("ub.town.label")}
    >
      {(name || view.places.length > 0) && (
        <p className="ub-town-cap">
          {name && <b className="ub-town-name">{name}</b>}
          {view.places.length > 0 && (
            <span className={`ub-town-hint${shared ? " is-blocked" : ""}`} id={hintId}>
              {shared ?? tz("ub.town.hint", { where })}
            </span>
          )}
        </p>
      )}
      <div className={art ? "ub-town-view" : "ub-town-view ub-town-view--plain"} data-season={view.protagonist.season}>
        {art ? (
          <SceneImg className="ub-town-img" src={publicImage(art.src)} file={sceneFileOf(art.src)} testId="ub-town-img" lazy={false} />
        ) : (
          <span className="ub-town-plain" aria-hidden data-testid="ub-town-plain" />
        )}
        {view.places.length > 0 && (
          <ul className="ub-town-spots">
            {view.places.map((p) => {
              const why = spotReason(p, shared);
              const when = chosen(p.key);
              const pos = spotPos(p.x, p.y);
              const notes = [
                p.people.length > 0 ? tz("ub.town.people", { people: p.people.map((x) => x.name).join("、") }) : "",
                when.length > 0 ? tz("ub.town.chosen", { when: when.join("、") }) : "",
                why && !shared ? why : "",
              ].filter(Boolean);
              const descId = `ub-spot-${p.key}-d`;
              const described = [shared ? hintId : "", notes.length > 0 ? descId : ""].filter(Boolean).join(" ");
              return (
                <li
                  key={p.key}
                  className="ub-town-spot"
                  data-label={sides[p.key] ?? "below"}
                  style={{ "--x": `${pos.left}%`, "--y": `${pos.top}%` } as React.CSSProperties}
                >
                  {/* 点不了时用 aria-disabled 而不是 disabled：灰着也能悬停看原因（disabled 的按钮不出提示）、键盘也能停上去听原因 */}
                  <button
                    type="button"
                    className={`ub-spot${when.length > 0 ? " is-chosen" : ""}${why !== null ? " is-off" : ""}`}
                    data-testid={`spot-${p.key}`}
                    data-kind={p.kind}
                    aria-label={p.name}
                    aria-describedby={described || undefined}
                    aria-disabled={why !== null || undefined}
                    title={[p.name, ...notes, shared ?? ""].filter(Boolean).join("\n")}
                    onClick={() => {
                      if (why === null) onPlace(p.key);
                    }}
                  >
                    <span className="ub-spot-icon">
                      <ShellIcon name={placeIcon(p.kind)} scale={2} />
                      {p.people.length > 0 && (
                        <span className="ub-spot-people" aria-hidden>
                          {p.people.length}
                        </span>
                      )}
                    </span>
                    <span className="ub-spot-name">{p.name}</span>
                    {when.length > 0 && (
                      <span className="ub-spot-when" aria-hidden>
                        {when.join("、")}
                      </span>
                    )}
                    {notes.length > 0 && (
                      <span className="ub-sr" id={descId}>
                        {notes.join("；")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
