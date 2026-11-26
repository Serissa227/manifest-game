// public 下的图片（立绘、Q 版小人、乌鸦的帧、场景插画、物品图标……）的地址：带上构建时算出的版本号（public/portraits 下全部图片的哈希，见 vite.config.ts），
// 换了图版本号就变，不会用到旧缓存。
// 测试里版本号为空，地址与以前相同（测试不依赖图片的内容）。

/** 图片的版本号（构建时注入；测试里为空）。 */
export const IMAGES_VERSION: string = __PORTRAITS_VERSION__;

/** 给地址加上版本号（版本号为空时原样返回）。 */
export function withVersion(url: string, v: string = IMAGES_VERSION): string {
  if (!v) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}

/** public 下某张图的地址：`path` 形如 "portraits/captain-00.webp"（以部署的挂载路径开头），带统一的版本号。 */
export function publicImage(path: string): string {
  return withVersion(`${import.meta.env.BASE_URL}${path}`);
}

/** public/portraits 下某个文件的地址：`file` 形如 "guide-crow/frames.webp"。 */
export function portraitFile(file: string): string {
  return publicImage(`portraits/${file}`);
}
