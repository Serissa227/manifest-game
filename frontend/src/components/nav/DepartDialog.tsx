// 手动航行的世界里出港（FRAMEWORK §6.3 的 Depart）：不再“选目的港”，而是在罗经盘上定一个出港的航向，启航后在海上操船。
// 初始航向朝着港外最开阔的海面（按地图图层找；还没有图层时朝北）。
// H10hF：初始航向落在逆风禁区里时（当地的风、按船型估的禁区），改到禁区边缘再偏出 10° 的两个方向里更合适的那个
// （先挑前方几格没有陆地的，再挑离原航向近的）；罗经盘上同时画出风与禁区。只改默认值，玩家拨过的不动。
// 新界面（v2，11-03 操作手感）：Esc 取消出港（与经典世界出港确认的“重新选择”一样）；“启航”是这个对话框的主按钮，焦点不在别的按钮上时回车就按它。
// 新界面（V01 补给）：罗经盘下面写“船上粮 X / 水 Y，够 N 天”，并给“补到 10 / 30 天”的一键补给（手动航行没有目的地，出港前在这里看一眼够不够）。
import { useMemo, useState } from "react";
import { useIsV2 } from "../../ui/uiMode";
import { cancelDeparture } from "../../hooks/useVoyage";
import { departWith, useNavStore } from "../../hooks/useNavigation";
import { t } from "../../i18n";
import { modX } from "../../map/wrap";
import { flagship, useGame } from "../../store/game";
import type { ChartSource } from "../../hooks/useChartSource";
import CompassDial from "./CompassDial";
import { avoidIrons, portSailLimit, seaRun, seawardHeading, windFromOctant } from "./navKit";
import { localWeather } from "../hudWeather";
import { locById } from "../../ipc/byId";
import { SupplyPresets } from "../panels/SupplyPresets";
import { haveText, supplyDays } from "../panels/supplyKit";
import { tz } from "../../i18n/zhOnly";
import DepartAuto from "./DepartAuto";

/** 粮水不到三天（与航行仪表的告急同一条线）。 */
function lowSupply(fleet: Parameters<typeof supplyDays>[0]): boolean {
  const days = supplyDays(fleet);
  return days !== null && days <= 3;
}

export default function DepartDialog({ source }: { source: ChartSource | null }) {
  const departing = useNavStore((s) => s.departing);
  const busy = useNavStore((s) => s.busy);
  const statics = useGame((s) => s.statics);
  const overview = useGame((s) => s.overview);
  const fleet = flagship(overview);
  const port = fleet && fleet.docked !== null ? locById(statics, fleet.docked) : undefined;
  // 当地的风（风力 0 时不画、不避）与按船型估的逆风禁区
  const weather = localWeather(overview);
  const windFrom = weather && weather.wind_strength > 0 ? windFromOctant(weather.wind_dir) : null;
  const sailLimit = fleet ? portSailLimit(fleet.ships, statics?.ships) : 0;
  const initial = useMemo(() => {
    const rows = source?.statics.map.rows ?? [];
    const W = source?.statics.map.width ?? 0;
    const wrap = source?.wrap ?? false;
    const isSea = (x: number, y: number) => {
      const xx = wrap ? modX(x, W) : x;
      const ch = rows[y]?.[xx];
      return ch !== undefined && ch !== "#";
    };
    const hasMap = !!port && rows.length > 0;
    const seaward = hasMap ? seawardHeading(isSea, port.x, port.y) : 0;
    if (windFrom === null) return seaward;
    // 判断不了陆地（还没有图层）时只按风来
    return avoidIrons(seaward, windFrom, sailLimit, hasMap ? (h) => seaRun(isSea, port.x, port.y, h) : undefined);
  }, [source, port, windFrom, sailLimit]);
  const [heading, setHeading] = useState<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  // FIX5F 第二趟：两种出港方式——定航向（原来的）与自动驶往（挑目的地，出港即设好自动航行）
  const [mode, setMode] = useState<"heading" | "auto">("heading");
  const v2 = useIsV2();
  if (!departing || !fleet || fleet.docked === null) return null;
  const h = heading ?? initial;
  const cancel = () => {
    useNavStore.setState({ departing: false });
    cancelDeparture();
  };
  return (
    <div className="chart-dialog-backdrop">
      <section
        className="chart-win chart-dialog nav-depart"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-depart-title"
        data-testid="nav-depart"
        onKeyDown={
          v2
            ? (e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                cancel();
              }
            : undefined
        }
      >
        <header className="chart-win-title">
          <h3 id="nav-depart-title">{t("nav.departTitle")}</h3>
        </header>
        {/* FIX5F 第二趟：两种出港方式的切换（新界面），一眼看得见现在是哪一种 */}
        {v2 && (
          <div className="nav-depart-modes" role="radiogroup" aria-label={tz("depart.modeLabel")} data-testid="nav-depart-modes">
            {(["heading", "auto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? "nav-depart-mode is-on" : "nav-depart-mode"}
                data-testid={`nav-depart-mode-${m}`}
                onClick={() => setMode(m)}
              >
                <b>{tz(m === "heading" ? "depart.modeHeading" : "depart.modeAuto")}</b>
                <small>{tz(m === "heading" ? "depart.modeHeadingHint" : "depart.modeAutoHint")}</small>
              </button>
            ))}
          </div>
        )}
        {v2 && mode === "auto" ? (
          <DepartAuto fleet={fleet} onCancel={cancel} />
        ) : (
          <>
          <div className="chart-dialog-body">
            <p className="chart-note">{t("nav.departHint")}</p>
            <CompassDial
              heading={h}
              draft={draft}
              windFrom={windFrom}
              windForce={weather?.wind_strength ?? 0}
              sailLimit={sailLimit}
              onDraft={setDraft}
              onCommit={(v) => {
                setDraft(null);
                setHeading(v);
              }}
            />
            {v2 && (
              <div className="nav-depart-supply" data-testid="nav-depart-supply">
                <p className={lowSupply(fleet) ? "chart-note chart-warn" : "chart-note"}>{haveText(fleet, true)}</p>
                <SupplyPresets fleet={fleet} testId="nav-depart-quick" />
              </div>
            )}
          </div>
          <footer className="chart-dialog-actions">
            <button
              type="button"
              className="chart-btn primary"
              disabled={busy}
              data-testid="nav-depart-go"
              data-hotkey={v2 ? "primary" : undefined}
              onClick={() => void departWith(h)}
            >
              {t("nav.departGo")}
            </button>
            <button type="button" className="chart-btn" onClick={cancel}>
              {t("nav.departCancel")}
            </button>
          </footer>
          </>
        )}
      </section>
    </div>
  );
}
