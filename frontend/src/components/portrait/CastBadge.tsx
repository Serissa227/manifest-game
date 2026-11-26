// 新增人物的小头像位：画框里的头像 + 双行名字 + 一行头衔（酒馆情报贩子、殖民地总管、君主、商会会长、各国船长）。
// 头像是装饰（名字就在旁边），对辅助技术隐藏；名字是程序生成的中英成对人名（portraitCast.castName）。
import type { NamePairText } from "../../art/names";
import type { Px } from "../../art/px";
import { BiName } from "../BiName";
import { PortraitArt } from "./PortraitArt";

export function CastBadge({
  asset,
  fallback,
  name,
  title,
  size = 48,
  className,
  testId,
}: {
  asset: string | null;
  fallback: () => Px;
  name: NamePairText;
  /** 头衔（“情报贩子”“殖民地总管”“翠岚王国国王”……） */
  title: string;
  size?: number;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={className ? `cast-row ${className}` : "cast-row"} data-testid={testId} data-portrait-id={asset ?? undefined}>
      <span className="cast-frame">
        <PortraitArt asset={asset} fallback={fallback} size={size} />
      </span>
      <span className="cast-text">
        <BiName as="strong" zh={name.zh} en={name.en} />
        <small>{title}</small>
      </span>
    </div>
  );
}
