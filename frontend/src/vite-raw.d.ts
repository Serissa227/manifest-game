// Vite 的 `?raw` 导入：得到文件的原文（测试用它读仓库里的数据文件，例如 data/world/landmarks.toml）。
declare module "*?raw" {
  const text: string;
  export default text;
}
