// H07 季风历的开关与拨月份：世界图右上角缩放按钮下面一枚“季风历”按钮；开着时旁边是“‹ 5 月 ›”与“本月”。
// 数据由后端按月给（monsoon，只含已有海图的海区），交给渲染器画（map/monsoonLayer.ts）。只在手动航行的世界出现。
// 不渲染画布、不碰别的图层：MapView 里挂一次 <MonsoonControl renderer={renderer} ready={ready} />。
import { useEffect, useState } from "react";
import { isManualWorld } from "../../hooks/useNavigation";
import { routingApi, type MonsoonView } from "../../ipc/routing";
import type { MapRenderer } from "../../map/renderer";
import { useGame } from "../../store/game";
import { usePrefersReducedMotion } from "../portrait/motion";
import { stepMonth, useRouteStore } from "./routeStore";
import { routeText } from "./routeText";

export default function MonsoonControl({ renderer, ready }: { renderer: { current: MapRenderer | null }; ready: boolean }) {
  const manual = useGame((s) => isManualWorld(s.statics));
  const on = useRouteStore((s) => s.monsoon);
  const month = useRouteStore((s) => s.month);
  // 换天时重新取（月份可能变了；揭开的海区也可能多了）
  const bucket = useGame((s) => Math.floor((s.overview?.day ?? 0) / 30));
  const fogVersion = useGame((s) => s.overview?.fog_version ?? 0);
  const reduced = usePrefersReducedMotion();
  const [data, setData] = useState<MonsoonView | null>(null);

  useEffect(() => {
    if (!manual || !on) {
      setData(null);
      return;
    }
    let alive = true;
    routingApi
      .monsoon(month)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
    // 当前月份只在换月时变：每三十天重取一次就够
  }, [manual, on, month, bucket, fogVersion]);

  useEffect(() => {
    if (ready) renderer.current?.setMonsoon?.(on ? data : null, reduced);
  }, [ready, renderer, on, data, reduced]);
  useEffect(() => () => renderer.current?.setMonsoon?.(null), [renderer]);

  if (!manual || !ready) return null;
  const periods = data?.periods ?? 12;
  const shown = data ? data.period + 1 : (month ?? 1);
  const label = periods === 12 ? routeText.month(shown) : routeText.season(shown - 1);
  return (
    <div className={on ? "route-monsoon on" : "route-monsoon"} data-testid="route-monsoon">
      <button
        type="button"
        className={on ? "chart-btn active" : "chart-btn"}
        aria-pressed={on}
        title={routeText.monsoonTip()}
        data-testid="route-monsoon-toggle"
        onClick={() => useRouteStore.setState({ monsoon: !on })}
      >
        {routeText.monsoon()}
      </button>
      {on && (
        <span className="route-monsoon-month" role="group" aria-label={routeText.monsoon()}>
          <button
            type="button"
            className="chart-zoom-btn"
            aria-label={routeText.monthPrev()}
            data-testid="route-month-prev"
            onClick={() => useRouteStore.setState({ month: stepMonth(shown, -1, periods) })}
          >
            ‹
          </button>
          <strong data-testid="route-month">{label}</strong>
          <button
            type="button"
            className="chart-zoom-btn"
            aria-label={routeText.monthNext()}
            data-testid="route-month-next"
            onClick={() => useRouteStore.setState({ month: stepMonth(shown, 1, periods) })}
          >
            ›
          </button>
          {data && data.period !== data.now && (
            <button type="button" className="chart-btn" onClick={() => useRouteStore.setState({ month: null })}>
              {routeText.monthNow()}
            </button>
          )}
        </span>
      )}
      {on && data && data.points.length === 0 && <p className="route-note">{routeText.monsoonEmpty()}</p>}
    </div>
  );
}
