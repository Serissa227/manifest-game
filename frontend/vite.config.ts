/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { imagesVersion } from "./scripts/images-version.mjs";

// Tauri 开发模式固定端口，见 crates/manifest-app/tauri.conf.json。
export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    // 图片的版本号（测试里为空：测试不依赖图片的内容，地址与以前相同）
    define: { __PORTRAITS_VERSION__: JSON.stringify(mode === "test" ? "" : imagesVersion()) },
    base: "/",
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
      // 测试会读取仓库里的 data/（?raw 导入），明确允许仓库根目录
      fs: { allow: [".."] },
    },
    build: { target: "es2022", chunkSizeWarningLimit: 4096, outDir: "dist" },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
