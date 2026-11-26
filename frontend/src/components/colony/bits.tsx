// 殖民地界面共用的小部件：殖民建筑图标、带图标的商品、数值条、状态牌。
// 所有图标都对辅助技术隐藏（<Sprite> 不给 label），可访问名称只来自文字。
import { GoodGlyphOf } from "../panels/GoodGlyph";
import type { ReactNode } from "react";
import { colonyBuildingIcon, type IconName } from "../../art/icons";
import { Sprite } from "../../art/Sprite";
import type { StaticView } from "../../ipc/types";
import { iconPx } from "../panels/panelArt";

/** 殖民建筑图标（按建筑 key；未知建筑用通用的“建造”图标）。 */
export function BuildingIcon({ statics, building, scale = 2 }: { statics: StaticView; building: number; scale?: number }) {
  const key = statics.colony_buildings[building]?.key ?? "";
  const name: IconName = colonyBuildingIcon(key) ?? "build";
  return (
    <span className="colony-bicon">
      <Sprite px={iconPx(name)} scale={scale} />
    </span>
  );
}

/** 一件带图标的商品：图标 + 名称 + 可选的数量文字。 */
export function GoodChip({ statics, good, children, bad }: { statics: StaticView; good: number; children?: ReactNode; bad?: boolean }) {
  return (
    <span className={bad ? "colony-good bad" : "colony-good"}>
      <GoodGlyphOf statics={statics} good={good} scale={1} className="colony-good-icon" />
      <span className="colony-good-name">{statics.goods[good]?.name ?? String(good)}</span>
      {children !== undefined && <span className="colony-good-qty">{children}</span>}
    </span>
  );
}

export type MeterTone = "pop" | "morale" | "food" | "cargo" | "build" | "defense" | "fertile" | "hazard" | "rich" | "tax";

/** 像素风的数值条（纯装饰，数值另有文字说明）；mark 是一条竖线标记（例如士气 50 的增长门槛）。 */
export function Meter({ value, max, tone, mark, warn }: { value: number; max: number; tone: MeterTone; mark?: number; warn?: boolean }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={`pn-bar colony-meter colony-tone-${tone}${warn ? " warn" : ""}`} aria-hidden="true">
      <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      {mark !== undefined && max > 0 && <b style={{ left: `${Math.round(Math.min(1, mark / max) * 100)}%` }} />}
    </span>
  );
}

/** 醒目的状态牌：图标 + 名称 + 大号数值 + 数值条。 */
export function Tile({
  icon,
  label,
  value,
  children,
  tone,
  testId,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  children?: ReactNode;
  /** 颜色提示：正常 / 注意 / 危险 */
  tone?: "ok" | "warn" | "bad";
  testId?: string;
}) {
  return (
    <div className={tone ? `colony-tile is-${tone}` : "colony-tile"} data-testid={testId}>
      <span className="colony-tile-head">
        <Sprite px={iconPx(icon)} scale={1} className="pn-icon" />
        {label}
      </span>
      <strong className="colony-tile-value">{value}</strong>
      {children}
    </div>
  );
}
