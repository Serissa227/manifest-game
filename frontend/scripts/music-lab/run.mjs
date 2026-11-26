// 让无界面的 Edge（或 Chrome）打开配乐试听台，依次执行若干个 lab.* 表达式（每个都 await），把结果按行打印成 JSON。
// 用法（试听台先用 vite 起来，见 vite.config.ts）：
//   node scripts/music-lab/run.mjs <表达式的 JSON 文件> [试听台地址，缺省 http://localhost:5241/]
// JSON 文件是字符串数组，例如 ["lab.inst('shamisen')", "lab.measure('port_japan','orch')", "lab.renderSave('port_japan','orch','clips/port_japan.wav',40)"]。
// 浏览器路径用环境变量 BROWSER 指定（缺省 Windows 上的 Edge）；同时开几个时用 CDP_PORT 错开调试端口。
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = process.env.BROWSER ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const exprs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const url = process.argv[3] ?? "http://localhost:5241/";
const port = Number(process.env.CDP_PORT ?? 5236);
const profile = mkdtempSync(join(tmpdir(), "music-lab-"));
const browser = spawn(BROWSER, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  "about:blank",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let seq = 0;
const pending = new Map();
const logs = [];

async function connect() {
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => {
          ws.onopen = r;
          ws.onerror = j;
        });
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) {
            const { resolve, reject } = pending.get(m.id);
            pending.delete(m.id);
            if (m.error) reject(new Error(JSON.stringify(m.error)));
            else resolve(m.result);
          } else if (m.method === "Runtime.consoleAPICalled") {
            logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
          } else if (m.method === "Runtime.exceptionThrown") {
            logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
          }
        };
        return;
      }
    } catch {
      // 浏览器还没起来
    }
    await sleep(200);
  }
  throw new Error("连不上浏览器（端口被占用时换一个 CDP_PORT）");
}

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function ready() {
  for (let i = 0; i < 300; i++) {
    try {
      if (await evaluate("!!window.lab")) return;
    } catch {
      // 页面还在加载
    }
    await sleep(200);
  }
  throw new Error("试听台没有就绪");
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  for (const ex of exprs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await ready();
        console.log(JSON.stringify(await evaluate(ex)));
        break;
      } catch (e) {
        if (attempt === 1) console.log(JSON.stringify({ error: String(e.message ?? e), expr: ex }));
        await sleep(1000);
      }
    }
  }
} catch (e) {
  console.error("出错：", e.message);
  process.exitCode = 1;
} finally {
  if (logs.length) console.error(logs.slice(-30).join("\n"));
  try {
    ws?.send(JSON.stringify({ id: ++seq, method: "Browser.close", params: {} }));
    await sleep(500);
    ws?.close();
  } catch {
    // 忽略
  }
  browser.kill();
}
