// 交易品的小图。新界面里有手绘图标的货用图片（public/goods/<key>.webp，tools/items/draw.py 生成），
// 经典像素界面、以及还没有手绘图的货，用原来的 16×16 像素图样（art/icons 的 drawGoodIcon）。
// scale 沿用像素图样的倍数：手绘图在同一位置上略放大一圈（16 像素的手绘图看不清）。
import { memo as reactMemo } from "react";
import { drawGoodIcon } from "../../art/icons";
import { publicImage } from "../../art/imageUrl";
import { memo } from "../../art/render";
import { Sprite } from "../../art/Sprite";
import type { StaticView } from "../../ipc/types";
import { useIsV2 } from "../../ui/uiMode";
import { goodArtSize, hasGoodArt } from "./goodGlyphKit";

export const GoodGlyph = reactMemo(function GoodGlyph({ goodKey, category, scale = 1, className }: { goodKey: string | undefined; category?: string; scale?: number; className?: string }) {
  const v2 = useIsV2();
  const key = goodKey ?? "unknown";
  if (v2 && hasGoodArt(key)) {
    const size = goodArtSize(scale);
    return (
      <img
        className={className ? `good-art ${className}` : "good-art"}
        src={publicImage(`goods/${key}.webp`)}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        alt=""
        aria-hidden
        decoding="async"
        loading="lazy"
        draggable={false}
        data-good={key}
      />
    );
  }
  const px = memo(`good-glyph|${key}|${category ?? ""}`, () => drawGoodIcon(key, category));
  return <Sprite px={px} scale={scale} className={className} />;
});

/** 按商品编号取图（面板里大多只有编号）。 */
export const GoodGlyphOf = reactMemo(function GoodGlyphOf({ statics, good, scale = 1, className }: { statics: StaticView; good: number; scale?: number; className?: string }) {
  const g = statics.goods[good];
  return <GoodGlyph goodKey={g?.key ?? ""} category={g?.category} scale={scale} className={className} />;
});
