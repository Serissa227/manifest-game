// 设施掌柜：分页内容上方的“人物 + 对话气泡”头部。头像是 128 像素的时代肖像（缺图时回退到放大两倍的程序头像），
// 问候语按地点与日期确定性挑选。
// 掌柜的名字是双行名字（EXPANSION.md §12.3）。
import { useMemo } from "react";
import { styleOf } from "../../art/buildings";
import { drawPortrait } from "../../art/portraits";
import type { LocView, PortView } from "../../ipc/types";
import { useGame, useOverviewFields, type Facility } from "../../store/game";
import { BiName } from "../BiName";
import { PortraitArt } from "../portrait/PortraitArt";
import { greeting, keeper, keeperPlaces } from "./greeting";

export function Keeper({ loc, facility, port }: { loc: LocView; facility: Facility; port: PortView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：问候语只看日期、季节与主角的名字
  const overview = useOverviewFields("day", "season", "captain");
  const faction = statics?.factions[loc.faction];
  // 各地点的位置与文化（每个港口与离它最近的两个同文化地点，同一种设施换一位掌柜），随静态数据缓存
  const places = useMemo(() => (statics ? keeperPlaces(statics.locations, statics.factions) : undefined), [statics]);
  // 掌柜的衣着随所属势力的建筑风格（势力数据的 style 字段优先）
  const who = useMemo(
    () => keeper(loc.key, facility, styleOf(faction?.key, faction?.style), places, faction?.style),
    [loc.key, facility, faction?.key, faction?.style, places],
  );
  const text = greeting(facility, {
    locKey: loc.key,
    port: loc.name,
    faction: faction?.name ?? "",
    day: overview?.day ?? 0,
    season: overview?.season ?? 0,
    captain: overview?.captain?.name,
    view: port,
  });
  return (
    <div className={`keeper keeper-${facility}`} data-testid="keeper">
      <div className="keeper-portrait">
        <PortraitArt asset={who.asset} fallback={() => drawPortrait(who.spec)} size={128} />
      </div>
      <div className="keeper-talk">
        <div className="keeper-name">
          {/* 程序生成的人名：中文界面“中文音译 + 小一行英文原形”，英文界面只有英文 */}
          <BiName as="strong" zh={who.name} en={who.nameEn} testId="keeper-name" />
          <small>{who.title}</small>
        </div>
        <p className="keeper-bubble" data-testid="keeper-greeting">
          {text}
        </p>
      </div>
    </div>
  );
}
