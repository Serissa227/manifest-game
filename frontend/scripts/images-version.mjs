// public/portraits 下全部图片（相对路径与内容）的哈希前 10 位：图片地址带上它（?v=），服务端对带版本号的地址长期缓存，
// 换了图地址就变（见 src/art/imageUrl.ts）。vite.config.ts 在启动与构建时调用一次；读不到目录时为空。
// 写成普通的 .mjs：前端没有装 Node 的类型包，配置文件里不直接用 node:fs 等模块。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export function imagesVersion() {
  const root = fileURLToPath(new URL("../public/portraits", import.meta.url));
  const h = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        h.update(relative(root, path).split("\\").join("/"));
        h.update(readFileSync(path));
      }
    }
  };
  try {
    walk(root);
  } catch {
    return "";
  }
  return h.digest("hex").slice(0, 10);
}
