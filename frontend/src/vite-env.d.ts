// Vite 注入的环境变量：MODE 为构建模式（测试里为 "test"），BASE_URL 为部署的挂载路径（"/"）。
interface ImportMetaEnv {
  readonly MODE: string;
  readonly BASE_URL: string;
  /** vite dev 时为 true；正式构建里替换成 false，靠它挂的开发探针整段被裁掉（H10iF2 的 window.__navProbe） */
  readonly DEV: boolean;
}

/** public/portraits 下全部图片的哈希（构建时注入，见 vite.config.ts；测试里为空）。 */
declare const __PORTRAITS_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
  /** Vite 的批量导入（只在测试里用：列出 public/ 下的采样文件，?inline 取得内容核对大小） */
  glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
}
