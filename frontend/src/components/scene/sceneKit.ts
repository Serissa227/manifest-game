// 会动的场景的小工具（与组件分开放，热更新才认）。
import { publicImage } from "../../art/imageUrl";
import { SCENE_RIGS } from "../../art/sceneLive";

const RIGS: ReadonlySet<string> = new Set(SCENE_RIGS);

/** 这张场景大图（public/scenes/<file>.webp 的 file）有没有权重图。 */
export function hasSceneRig(file: string | null | undefined): boolean {
  return !!file && RIGS.has(file);
}

/** 权重图的地址。 */
export function sceneRigSrc(file: string): string {
  return publicImage(`scenes/${file}-rig.webp`);
}

/** 从 `scenes/<file>.webp` 这样的路径里取出 file（小图 -s、中图 -m 与别的路径返回 null：只有大图会动）。 */
export function sceneFileOf(path: string | null | undefined): string | null {
  const m = path ? /(?:^|\/)scenes\/([^/]+)\.webp$/.exec(path) : null;
  if (!m || /-(s|m|rig)$/.test(m[1])) return null;
  return m[1];
}
