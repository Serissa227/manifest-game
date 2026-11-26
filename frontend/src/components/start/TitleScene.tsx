// 标题画面的背景：会动的黄昏港湾（灯塔光束转动、帆船归航、海浪起伏、海鸥飞过、星星闪烁）。
// 按整数倍放大铺满整个窗口；偏好“减少动态效果”时只画静止的一帧。
import { useCallback, useState } from "react";
import { Px } from "../../art/px";
import { canDraw } from "../../art/render";
import { PixelStage, type StageLayout } from "../../art/Sprite";
import { t } from "../../i18n";
import { TITLE_H, TITLE_MIN_W, drawTitleScene } from "./titleArt";

const BLANK = new Px(1, 1);

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function TitleScene() {
  const [still] = useState(prefersReducedMotion);
  // 测试环境没有画布：不做合成，直接给一张空图
  const draw = useCallback(
    (frame: number, layout: StageLayout) => (canDraw() ? drawTitleScene(layout.width, still ? 0 : frame) : BLANK),
    [still],
  );
  return (
    <PixelStage
      height={TITLE_H}
      minWidth={TITLE_MIN_W}
      minScale={2}
      fps={10}
      animate={!still}
      draw={draw}
      className="title-scene"
      label={t("start.sceneLabel")}
    />
  );
}
