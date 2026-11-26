// 配乐试听台（开发工具，不进游戏的构建）：离线渲染曲目与地方乐器的音色样本，量响度（BS.1770 近似）、峰值、咔嗒声与非数，存 WAV。
// 启动（在 frontend 目录下）：npx vite --config scripts/music-lab/vite.config.ts
// 然后用 scripts/music-lab/run.mjs 让无界面的 Edge / Chrome 打开它、依次执行 lab.* 的表达式（用法见 run.mjs 与 lab.ts 的开头）。
// 结果（JSON、WAV）POST 到 /__save，存进 MUSIC_LAB_OUT（缺省 frontend/.art-preview/music-lab-out，git 忽略）。
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const OUT = process.env.MUSIC_LAB_OUT ?? resolve(here, "../../.art-preview/music-lab-out");
const PORT = Number(process.env.MUSIC_LAB_PORT ?? 5241);

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  server: { port: PORT, strictPort: true, fs: { allow: ["../.."] }, hmr: false },
  plugins: [
    {
      name: "save",
      configureServer(server) {
        server.middlewares.use("/__save", (req, res) => {
          const name = (new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "out.bin").replace(/[^\w./-]/g, "_").replace(/\.\./g, "_");
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            const path = join(OUT, name);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, Buffer.concat(chunks));
            res.end(path);
          });
        });
      },
    },
  ],
});
