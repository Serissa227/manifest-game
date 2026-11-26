// 海图上悬停别家商会的船队时的信息卡：哪家商会的船队、船长是谁（各国船长的肖像，按船队所属势力与船队确定性地选）。
// 船队所属势力 = 商会会长的文化对应的势力（portraitCast.fleetCaptain）；船长的名字是程序生成的中英成对人名。
// 纯展示（不接收指针事件），位置跟着标记；靠近海图右边或下边时翻到标记的另一侧，不被裁掉（手机上海图窄）。
// 触屏上没有悬停：点一下船队标记显示、再点一下或点别处收起（map/renderer.ts）。
import { useLayoutEffect, useRef, useState } from "react";
import { styleOf } from "../art/buildings";
import { castName, fallbackSpec, fleetCaptain } from "../art/portraitCast";
import { nameOf, t } from "../i18n";
import type { StaticView } from "../ipc/types";
import type { FleetHover } from "../map/renderer";
import { portraitPx } from "./panels/panelArt";
import { CastBadge } from "./portrait/CastBadge";

/** 船队归属的商会编号：按名字（当前语言）或英文名在静态数据里找；找不到时为 -1。 */
function companyOfOwner(statics: StaticView, owner: string, ownerEn?: string): number {
  return statics.companies.findIndex((c) => c.name === owner || (!!ownerEn && c.name_en === ownerEn));
}

export default function FleetHoverCard({ statics, hover }: { statics: StaticView; hover: FleetHover }) {
  const company = companyOfOwner(statics, hover.owner, hover.owner_en);
  const seed = `${hover.owner_en || hover.owner}-${hover.index}`;
  const { asset, faction } = fleetCaptain(company, statics.factions, seed);
  const f = statics.factions.find((x) => x.key === faction);
  const region = f ? styleOf(f.key, f.style) : undefined;
  const who = `fleet-captain-${seed}`;
  const name = castName(asset, who, region);
  const companyName = company >= 0 ? nameOf(statics.companies[company]) : hover.owner;
  // 放不下时翻到另一侧（量出卡片与海图的大小之后）
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: hover.x + 14, top: hover.y + 12 });
  useLayoutEffect(() => {
    const el = card.current;
    const host = el?.parentElement;
    let left = hover.x + 14;
    let top = hover.y + 12;
    if (el && host) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && left + w > host.clientWidth - 8) left = Math.max(8, hover.x - 14 - w);
      if (h > 0 && top + h > host.clientHeight - 8) top = Math.max(8, hover.y - 12 - h);
    }
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [hover.x, hover.y]);
  return (
    <div ref={card} className="chart-fleet-card" style={pos} data-testid="fleet-hover-card" role="tooltip">
      <p className="chart-fleet-card-head">{t("cast.fleetOf", { company: companyName })}</p>
      <CastBadge
        asset={asset}
        fallback={() => portraitPx(fallbackSpec(asset, who, "captain", region))}
        name={name}
        title={f ? `${t("cast.fleetMaster")} · ${nameOf(f)}` : t("cast.fleetMaster")}
        size={48}
      />
    </div>
  );
}
