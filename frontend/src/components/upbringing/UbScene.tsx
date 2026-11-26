// 活动的小场景（养成主画面里一格日程的缩略画与执行时的大画面）：按场景 key 取一组底色与远景（CSS 渐变画出天、地、水），
// 再叠一个像素图标。有活动插画（F12，Codex 出图的像素场景）的场景直接用插画。
import { publicImage } from "../../art/imageUrl";
import { useGame } from "../../store/game";
import { SceneImg } from "../scene/SceneImg";
import { sceneFileOf } from "../scene/sceneKit";
import { ShellIcon } from "../shell/ShellIcon";
import { sceneArtPath, sceneOf } from "./ubKit";

/** activity（U06F8，可选）：这一格的活计键——按文化换图时先按它查（守夜、操练、体能在数据里共用一个场景键）。 */
export function UbScene({ scene, size = "small", label, children, activity }: { scene: string; size?: "small" | "large"; label?: string; children?: React.ReactNode; activity?: string | null }) {
  const s = sceneOf(scene);
  // 有插画（public/scenes/，清单在 ubKit 的 SCENE_ART；小格用缩略图）就用插画；没有时用底色 + 图标。有季节版的场景按世界日历的当月挑
  const month = useGame((s) => s.overview?.world_date?.[1]);
  const art = sceneArtPath(scene, size, month, activity);
  if (art) {
    return (
      <div className={`ub-scene ub-scene--art ub-scene--${size}`} data-scene={scene} role={label ? "img" : undefined} aria-label={label}>
        <SceneImg className="ub-scene-img" src={publicImage(art)} file={size === "large" ? sceneFileOf(art) : null} />
        {children}
      </div>
    );
  }
  return (
    <div className={`ub-scene ub-scene--${s.look} ub-scene--${size}`} data-scene={scene} role={label ? "img" : undefined} aria-label={label}>
      <span className="ub-scene-sky" aria-hidden />
      <span className="ub-scene-ground" aria-hidden />
      <ShellIcon name={s.icon} scale={size === "large" ? 4 : 2} className="ub-scene-icon" />
      {children}
    </div>
  );
}
