// 美术预览：把 src 下所有 *.preview.ts 的默认导出渲染成 PNG，写到 frontend/.art-preview/<模块>/。
// 用法（在 frontend 目录下）：
//   npx vite-node scripts/art-preview.ts            # 全部
//   npx vite-node scripts/art-preview.ts buildings  # 只渲染文件名包含 buildings 的预览
// 输出目录已在 .gitignore 中忽略。
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Px, type Preview, type PreviewContext } from "../src/art/px";
import { encodePng } from "./png";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const repo = resolve(frontend, "..");
const outRoot = join(frontend, ".art-preview");
const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".preview.ts")) out.push(p);
  }
}

/** 预览背景：中性灰棋盘格，便于看清透明边缘。 */
function backdrop(w: number, h: number, bg?: string): Px {
  const p = new Px(w, h);
  if (bg) return p.fill(bg);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.put(x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? "#6a6a74" : "#5a5a64");
  return p;
}

const ctx: PreviewContext = {
  readText: (repoPath) => readFileSync(join(repo, repoPath), "utf8"),
};

const files: string[] = [];
walk(join(frontend, "src"), files);
const picked = files.filter((f) => filters.length === 0 || filters.some((k) => relative(frontend, f).includes(k)));
if (picked.length === 0) {
  console.error("没有匹配的 *.preview.ts");
  process.exit(1);
}
for (const file of picked) {
  const mod = (await import(pathToFileURL(file).href)) as { default: (c: PreviewContext) => Preview[] | Promise<Preview[]> };
  const items = await mod.default(ctx);
  const dir = join(outRoot, file.slice(file.lastIndexOf(file.includes("\\") ? "\\" : "/") + 1).replace(/\.preview\.ts$/, ""));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const it of items) {
    const k = it.scale ?? 3;
    const big = it.px.scaled(k);
    const img = backdrop(big.w, big.h, it.bg).blit(big, 0, 0);
    const path = join(dir, `${it.name}.png`);
    writeFileSync(path, encodePng(img.w, img.h, img.toRGBA()));
    console.log(`${relative(frontend, path)}  ${it.px.w}×${it.px.h} ×${k}  颜色 ${it.px.colorCount()}`);
  }
}
