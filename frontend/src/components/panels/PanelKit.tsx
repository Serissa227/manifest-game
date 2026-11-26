// 功能面板共用的小部件：带图标的分节标题、像素图标、状态条、画框头像。
// 所有图标都对辅助技术隐藏（<Sprite> 不给 label 即 aria-hidden），可访问名称只来自文字。
import { memo, type ReactNode } from "react";
import type { IconName } from "../../art/icons";
import type { PortraitSpec } from "../../art/portraits";
import type { Px } from "../../art/px";
import { Sprite } from "../../art/Sprite";
import { PortraitArt } from "../portrait/PortraitArt";
import { iconPx, portraitPx } from "./panelArt";

/** 16×16 界面图标（装饰用，对辅助技术隐藏）。 */
export const Icon = memo(function Icon({ name, scale = 1, className }: { name: IconName; scale?: number; className?: string }) {
  return <Sprite px={iconPx(name)} scale={scale} className={className ? `pn-icon ${className}` : "pn-icon"} />;
});

/** 与全局 Section 结构相同，标题前多一个图标。 */
export function PnSection({
  title,
  icon,
  testId,
  className,
  children,
}: {
  title: string;
  icon: IconName;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `section pn-section ${className}` : "section pn-section"} data-testid={testId}>
      <h3 className="pn-h">
        <Icon name={icon} />
        {title}
      </h3>
      {children}
    </section>
  );
}

export type BarTone = "hp" | "cargo" | "food" | "water" | "morale" | "crew" | "nav" | "trade" | "combat" | "mgmt" | "loyal";

/** 像素风的分段状态条（纯装饰，数值另有文字说明）。 */
export function Bar({ value, max, tone, mark }: { value: number; max: number; tone: BarTone; mark?: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const level = tone === "hp" ? (ratio > 0.6 ? "ok" : ratio > 0.3 ? "warn" : "bad") : "";
  return (
    <span className={`pn-bar pn-tone-${tone} ${level}`} aria-hidden="true">
      <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      {mark !== undefined && max > 0 && <b style={{ left: `${Math.round(Math.min(1, mark / max) * 100)}%` }} />}
    </span>
  );
}

/** 一行带图标的状态：图标、文字（含名称与数值）、状态条。label 作为悬停提示。 */
export function Stat({
  icon,
  label,
  value,
  max,
  tone,
  mark,
  children,
}: {
  icon: IconName;
  label: string;
  value: number;
  max: number;
  tone: BarTone;
  mark?: number;
  children: ReactNode;
}) {
  return (
    <div className="pn-stat" title={label}>
      <Icon name={icon} />
      <span className="pn-stat-text">{children}</span>
      <Bar value={value} max={max} tone={tone} mark={mark} />
    </div>
  );
}

/**
 * 画框里的头像（64 × scale 像素）；给 label 时作为图片暴露给辅助技术。
 * 给 asset（素材 id，见 art/portraitCast.ts）时优先显示 AI 生成的时代肖像，缺图时回退到程序头像；
 * 程序头像给 px 时直接画这张图（专属头像），否则按 spec 生成。
 */
export function Portrait({
  spec,
  px,
  asset,
  scale = 1,
  label,
  className,
}: {
  spec: PortraitSpec;
  px?: Px;
  asset?: string | null;
  scale?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span className={className ? `pn-portrait ${className}` : "pn-portrait"}>
      {asset !== undefined ? (
        <PortraitArt asset={asset} fallback={() => px ?? portraitPx(spec)} size={64 * scale} label={label} />
      ) : (
        <Sprite px={px ?? portraitPx(spec)} scale={scale} label={label} />
      )}
    </span>
  );
}
