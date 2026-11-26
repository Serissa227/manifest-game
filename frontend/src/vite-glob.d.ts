// Vite 的 import.meta.glob：测试用它列出 public/ 下的素材文件（只取键，不加载）以及读取补丁偏移 JSON。
interface ImportMeta {
  glob(pattern: string | readonly string[], options?: { eager?: boolean; query?: string; import?: string }): Record<string, unknown>;
}
