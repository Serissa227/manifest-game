// 行动制的主画面：这一阶段所在城市的城镇地图（townMaps.ts，2:1，会动）按 cover 铺满舞台，图钉按图上量好的坐标摆；
// 没有地图的城市仍用城市的大图（1536×672）按原比例铺开、四周用同一张图的虚影补满，各地点按数据的 x、y 摆。
// 图钉上：地点图标、地名、在场的人的小头像（最多三张，多了写 +n）、人物标记（!；要紧的与这周到期的是红的）、货架与活计的小标。
// 这周没人、没标记、没货、没活的地点淡一些（视图的 faded）。点图钉进地点（ActPlace）——进去、看、寒暄都不花点。
// 窄屏时图钉只剩图标与人数，图下面另列一行可以左右滑的地点签。
// 任务追踪条的“去”按 data-testid="spot-<地点>" 与 "ub-town" 圈地点（shell/questGo.ts），这里沿用同样的名字。
import { useMemo } from "react";
import { publicImage } from "../../../art/imageUrl";
import type { ActPlaceView } from "../../../ipc/actTypes";
import { SceneImg } from "../../scene/SceneImg";
import { sceneFileOf } from "../../scene/sceneKit";
import { ShellIcon } from "../../shell/ShellIcon";
import { labelSides, placeIcon, spotPos, townArtOf } from "../townKit";
import type { ActCtx } from "./actCtx";
import { markerLabel, markersAt, spotBadges } from "./actKit";
import { ta } from "./actText";
import { MiniFace } from "./ActFace";
import { townMapArt, townMapOf, type TownMap } from "./townMaps";

/** 图钉的位置（百分比）：有地图且地图上量过这个地点的，用图上的坐标；否则按数据的 x、y。 */
function pinPos(map: TownMap | null, p: { key: string; x: number; y: number }): { left: number; top: number } {
  const at = map?.spots[p.key];
  return at ? { left: at[0], top: at[1] } : spotPos(p.x, p.y);
}

function Spot({ ctx, p, map, side, onOpen }: { ctx: ActCtx; p: ActPlaceView; map: TownMap | null; side: string; onOpen: (k: string) => void }) {
  const pos = pinPos(map, p);
  const b = spotBadges(p, ctx.act);
  const ms = markersAt(ctx.act, p.key);
  const urgent = ms.some((m) => m.key || m.weeks_left <= 1);
  const name = ctx.names.place(p.key);
  const who = p.people.map((x) => ctx.names.person(x.key));
  const tip = [
    name,
    who.length > 0 ? who.join("、") : "",
    ms.map((m) => markerLabel(m, ctx.names.person)).join("、"),
    b.shop ? ta("map.shop") : "",
    b.job ? ta("map.job") : "",
    p.open ? "" : ta("map.closed"),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li
      className="ua-spot"
      data-label={side}
      data-faded={p.faded || undefined}
      data-closed={!p.open || undefined}
      style={{ "--x": `${pos.left}%`, "--y": `${pos.top}%` } as React.CSSProperties}
    >
      <button
        type="button"
        className={`ua-pin${urgent ? " is-urgent" : ""}${b.marker ? " has-marker" : ""}`}
        data-testid={`spot-${p.key}`}
        data-kind={p.kind}
        aria-label={tip.replace(/\n/g, "，")}
        aria-disabled={!p.open || undefined}
        title={tip}
        onClick={() => p.open && onOpen(p.key)}
      >
        <span className="ua-pin-icon">
          <ShellIcon name={placeIcon(p.kind)} scale={2} />
          {b.marker && (
            <span className="ua-pin-flag" aria-hidden>
              !
            </span>
          )}
        </span>
        <span className="ua-pin-name">
          {name}
          {(b.shop || b.job) && (
            <span className="ua-pin-tags" aria-hidden>
              {b.job && <ShellIcon name="coin" scale={1} />}
              {b.shop && <ShellIcon name="market" scale={1} />}
            </span>
          )}
        </span>
        {p.people.length > 0 && (
          <span className="ua-pin-people" aria-hidden>
            {p.people.slice(0, 3).map((x) => (
              <span key={x.key} className={`ua-pin-face${x.marker ? " has-marker" : ""}`}>
                <MiniFace ctx={ctx} person={x.key} size={24} />
              </span>
            ))}
            {p.people.length > 3 && <span className="ua-pin-more">+{p.people.length - 3}</span>}
          </span>
        )}
      </button>
    </li>
  );
}

export function ActMap({ ctx, onOpen }: { ctx: ActCtx; onOpen: (place: string) => void }) {
  const { view, act } = ctx;
  const map = townMapOf(ctx.town);
  const fallback = map ? null : townArtOf(view);
  // 四季：按今天的月份挑（townMaps.townMapFile；缺的季退回常景）
  const art = map ? townMapArt(map, view.today[1]) : fallback ? { ...fallback, url: publicImage(fallback.src) } : null;
  const named = useMemo(() => act.places.map((p) => ({ key: p.key, name: ctx.names.place(p.key), x: p.x, y: p.y })), [act.places, ctx.names]);
  const sides = useMemo(() => labelSides(named, (p) => pinPos(map, p)), [named, map]);
  const town = view.town?.name ?? (view.stage === "academy" ? view.academy?.name : view.home);
  const src = art?.url ?? null;
  const viewClass = map ? "ua-map-view ua-map-view--town" : src ? "ua-map-view" : "ua-map-view ua-map-view--plain";
  // 城镇地图按 cover 铺满、边上可能裁掉一点：城名签挂在框上（不跟着图被裁）；借图时仍挂在图的左上角
  const townTag = town && <span className="ua-map-town">{town}</span>;
  return (
    <section className="ua-map" aria-label={ta("map.label")}>
      <div className="ua-fit" data-map={map ? map.file : undefined} style={src ? ({ "--ua-art": `url("${src}")` } as React.CSSProperties) : undefined}>
        <div className={viewClass} data-testid="ub-town">
          {art && src ? <SceneImg className="ua-map-img" src={src} file={sceneFileOf(art.src)} testId="ua-map-img" lazy={false} /> : <span className="ua-map-plain" aria-hidden />}
          {!map && townTag}
          <ul className="ua-spots">
            {act.places.map((p) => (
              <Spot key={p.key} ctx={ctx} p={p} map={map} side={sides[p.key] ?? "below"} onOpen={onOpen} />
            ))}
          </ul>
        </div>
        {map && townTag}
      </div>
      {/* 窄屏：图上只剩图标，地点另列一行（宽屏隐藏） */}
      <ul className="ua-spot-list" aria-hidden>
        {act.places.map((p) => (
          <li key={p.key}>
            <button type="button" tabIndex={-1} data-faded={p.faded || undefined} disabled={!p.open} onClick={() => onOpen(p.key)}>
              <ShellIcon name={placeIcon(p.kind)} scale={1} />
              {ctx.names.place(p.key)}
              {p.people.length > 0 && <span className="ua-spot-list-n">{ta("map.people", { n: p.people.length })}</span>}
              {markersAt(act, p.key).length > 0 && <span className="ua-spot-list-flag">!</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
