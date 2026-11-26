// 测试里读仓库文件的原文（样式表、index.html）：测试环境不处理 CSS，`?raw` 导入拿不到样式表的内容，直接用 Node 读。
// 前端没有装 Node 的类型包，这里只声明用到的这一个函数；只在测试（Node 环境）里用。
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
  /** 目录里的文件名（新界面的样式表拆成多个文件，测试列出目录核对每个文件） */
  export function readdirSync(path: URL | string): string[];
}
