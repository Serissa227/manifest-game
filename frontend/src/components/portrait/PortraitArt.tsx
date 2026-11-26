// 人物头像：优先显示 AI 生成的时代肖像（public/portraits/，平滑缩放），没有这张图或图片加载失败时回退到程序生成的像素头像。
// 小头像位（≤ 96 CSS 像素）用 256×256 的脸部特写，大头像位用 512×512 的胸像（专属头像 768）；按设备像素比核对：
// 脸部特写的像素不够这个位子在这块屏上用时（缺原图、只有 128 旧图的人物）改用胸像（portraitVariantFor）。
// 给 label 时作为图片暴露给辅助技术（aria-label 即可访问名称），否则对辅助技术隐藏。
// live：大头像位可以要“会动的”——这位人物有会动的素材（STORY_LIVE：寰宇九位主角）、又是新界面时，换成 LiveFigure
// （眨眼、呼吸、发梢轻摆）；经典像素界面与没有这套素材的人物照旧是一张静止的图。
import { useState, type CSSProperties } from "react";
import { liveArtOf, portraitSrc, portraitVariantFor, type PortraitVariant } from "../../art/portraitCast";
import type { Px } from "../../art/px";
import { Sprite } from "../../art/Sprite";
import { useIsV2 } from "../../ui/uiMode";
import { LiveFigure } from "./LivePortrait";

/** 显示尺寸不超过这个值（CSS 像素）时用脸部特写。 */
export const FACE_MAX = 96;

export function PortraitArt({
  asset,
  fallback,
  size,
  variant,
  label,
  className,
  style,
  live,
}: {
  /** 素材 id（portraitCast.ts 的各种 *AssetId）；null 表示没有素材，直接用程序头像 */
  asset: string | null | undefined;
  /** 程序生成的头像（64×64 等），只在需要回退时才调用 */
  fallback: () => Px;
  /** 显示边长（CSS 像素） */
  size: number;
  /** 强制用胸像或脸部特写；缺省按尺寸选 */
  variant?: PortraitVariant;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** 这个头像位想要会动的（只对有会动素材的人物、在新界面里、用胸像时生效） */
  live?: boolean;
}) {
  const v2 = useIsV2();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const which = variant ?? portraitVariantFor(asset, size, dpr, FACE_MAX);
  const art = live && v2 && which === "full" ? liveArtOf(asset) : undefined;
  const src = portraitSrc(asset, which);
  // 记住加载失败的地址：素材 id 变了会重新尝试
  const [failed, setFailed] = useState<string | null>(null);
  if (art && src && failed !== src) {
    // 外面一层接原来 <img> 的类名与尺寸（各处的边框、衬纸、响应式尺寸都写在这些类上），里面一层铺满它
    return (
      <span
        className={className ? `portrait-art portrait-live ${className}` : "portrait-art portrait-live"}
        style={{ width: size, height: size, ...style }}
        data-portrait={asset ?? undefined}
      >
        <LiveFigure art={art} width={size} label={label} fallback={fallback} fill />
      </span>
    );
  }
  if (!src || failed === src) {
    const px = fallback();
    return (
      <Sprite
        px={px}
        scale={size / Math.max(1, px.w)}
        label={label}
        className={className ? `portrait-fallback ${className}` : "portrait-fallback"}
        style={style}
      />
    );
  }
  return (
    <img
      className={className ? `portrait-art ${className}` : "portrait-art"}
      src={src}
      width={size}
      height={size}
      style={{ width: size, height: size, ...style }}
      alt={label ?? ""}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      draggable={false}
      decoding="async"
      data-portrait={asset ?? undefined}
      onError={() => setFailed(src)}
    />
  );
}
