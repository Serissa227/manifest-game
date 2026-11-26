# Manifest · 船货清单

单机的航海贸易经营游戏。内核用 Rust 写成，桌面程序是 Tauri 2，界面用 React、PixiJS 与 ECharts。

> 1553 年的地球：先在家乡与学院度过少年时代，再扬帆驶进史实与传说交织的海洋。

- **养成**：少年时代在家乡与学院里按周安排功课、营生与出游，属性、技能、交情和起步的本钱都从这里来。
- **贸易与经营**：近两百个港口、四十多座内陆城市，两百多种交易品；现货买卖、仓库、陆路商队、工坊、港口投资与各方的委托。
- **航海**：风、洋流、天气与补给，手动驾船或自动领航；三十多种船型与改装，海战，探索与近百处发现。
- **人物与故事**：六百多位有名有姓的人物，九位推荐主角各有一条主线，也可以自己捏一位；同学、航海士与史实人物各有来往。学会、秘术、怪异与秘境是中后期才慢慢露面的内容。
- **AI（可选）**：接上自己的大语言模型后，事件导演、传闻、议价台词与编年史由模型来写。模型的输出只是提案，先过裁决、再过内核校验才生效；不接模型时用离线模板，照样能玩，也不联网。

界面里新开局只有“寰宇·十六世纪”这一个世界，内容以中文为主，英文翻译还不全。仓库里另有早期的“经典世界”（原创的架空海域，中英文齐全），现在主要给命令行模拟、平衡测试与单元测试用。

世界观是原创的；史实部分的出处写在数据文件里。

## 下载

Windows 安装包在本仓库的 Releases 页。

- 安装包**没有代码签名**。Windows 可能提示“Windows 已保护你的电脑”，点“更多信息”再点“仍要运行”。介意的话，先核对 Release 说明里的 SHA-256：
  ```powershell
  Get-FileHash .\Manifest_0.1.1_x64-setup.exe -Algorithm SHA256
  ```
- 装在当前用户名下，不需要管理员权限。
- 需要 WebView2 运行时（Windows 11 自带；没有的话安装程序会联网下载）。
- 设置与存档在 `%APPDATA%\dev.manifest.game\`（`settings.json` 与 `saves\`），卸载时默认保留。

## 从源码构建

环境要求：

- Rust 1.88 或更新（edition 2024）。
- Node.js 20 或更新（含 npm）。
- Windows 上 MSVC 与 GNU 工具链都可以。
  - 用 **GNU 工具链**（`x86_64-pc-windows-gnu`）又没有装 MinGW 时，`.cargo/config.toml` 已经启用 Rust 自带的链接组件；
    Tauri 编译 Windows 资源还需要 `windres` 与 `dlltool`：把 [w64devkit](https://github.com/skeeto/w64devkit) 解压到仓库的
    `.tools/w64devkit/`（已被 `.gitignore` 忽略）。`cargo xtask verify` 会自动把 `.tools/w64devkit/bin` 加到子进程的 `PATH`；
    直接运行 `cargo build` 时请先手动加进去：
    ```bash
    export PATH="$PWD/.tools/w64devkit/bin:$PATH"
    ```
  - xtask 在 Windows 上调用 `npm.cmd`。

桌面程序：

```bash
cd frontend && npm install && cd ..
cd crates/manifest-app && cargo tauri dev
```

需要 `cargo install tauri-cli`（或者用 `frontend/node_modules/.bin/tauri`）。也可以先在 `frontend/` 下 `npm run build`，再
`cargo build -p manifest-app --release`，运行 `target/release/manifest-app`。程序先找可执行文件旁边的 `data/`，再从当前目录向上找，
也可以用环境变量 `MANIFEST_DATA_DIR` 指定。

命令行（无界面）：

```bash
cargo run -p manifest-cli --release -- validate-data
cargo run -p manifest-cli --release -- simulate --seed 42 --days 365 --ai offline
cargo run -p manifest-cli --release -- replay-check --seed 7 --days 730 --ai mock
cargo run -p manifest-cli --release -- balance --seeds 20 --years 30
```

- `--world <key>` 选世界：模拟、重放与平衡默认 `classic`，数据校验默认查全部世界。
- `simulate`：`--bot passive|route|arbitrage|futures` 选代替玩家的脚本，`--ai off|offline|mock` 选 AI 模式，`--scenario` 选剧本。
- `replay-check`：跑完以后关掉 AI、只用命令日志重放，比对状态哈希。
- `balance`：多个种子 × 四种脚本的长期模拟，按阈值判定，报告写进 `docs/BALANCE.md`。

全量验证：

```bash
cargo xtask verify
```

依次做 12 项检查（格式、clippy、全部测试、禁用模式扫描、数据校验、十年模拟、Mock AI 重放、平衡测试、前端检查、
桌面程序 release 构建、其他世界的数据校验、素材清单），全部通过时末行输出 `ALL CHECKS PASSED`。`cargo xtask verify --only 1-7` 只跑前 7 项。
全部测试要跑很久，带调试信息的测试程序也很占磁盘；平时改哪里就跑哪里的测试，用 `fast` 档位：

```bash
cargo test --profile fast -p manifest-core --lib <测试名>
```

已知问题：这一版有 17 条测试在默认的调试档位下失败。`agency.*`、`shore.*` 共 13 个原因码还没有登记进
`crates/manifest-core/src/error.rs` 的 `REASON_CODES`，调试断言会拦住；同样这 17 条用 `--profile fast` 跑是通过的。
所以 `cargo xtask verify` 的第 3 项（它用默认档位跑全部测试）眼下过不了。

打 Windows 安装包（NSIS，需要 PowerShell 7）：

```powershell
pwsh tools/release/package-installer.ps1
```

产物在 `target/release/bundle/nsis/`，同时生成 `.sha256`。打包用的配置是 `crates/manifest-app/tauri.bundle.conf.json`。

## 目录

| 路径 | 内容 |
|---|---|
| `crates/manifest-core` | 确定性的模拟内核（没有 IO、没有异步、没有浮点） |
| `crates/manifest-data` | 读取并校验 `data/` |
| `crates/manifest-ai` | AI 管线：提案与输出 Schema、裁决（规则 / Jev）、模型提供商（结构化输出）、预算与离线模板 |
| `crates/manifest-sim` | 游戏会话、命令日志与重放、存档文件、脚本玩家、平衡测试 |
| `crates/manifest-cli` | 命令行：`simulate` / `replay-check` / `balance` / `validate-data` 等 |
| `crates/manifest-appcore` | 应用层：界面操作的处理函数、视图、设置、存档与时钟 |
| `crates/manifest-app` | Tauri 2 桌面程序（后端） |
| `frontend/` | 界面（React + Zustand + PixiJS + ECharts；字符串表在 `src/i18n/`） |
| `data/` | 全部内容：规则、地图、港口、商品、船型、势力、人物、故事、事件、提示词与离线模板。带中文注释，可以直接改。经典世界在 `data/` 根下，其余世界在 `data/worlds/<key>/` |
| `xtask/` | `cargo xtask verify` 全量验证，以及地图生成 |
| `tools/` | 打包脚本（`release/`）、配乐采样与音效的构建脚本（`orchestra/`、`sfx/`） |
| `art-src/` | 人物肖像的编号清单（`portraits.json`，素材校验要读） |
| `docs/` | 素材出处（`CREDITS.md`）、Jev 接口契约（`JEV_CONTRACT.md`）、测试要读的几份交易品设计稿（`drafts/`） |

## 配置 LLM（可选）

在游戏的**设置**面板里：

1. **AI 模式**：`关闭` / `离线模板`（默认，不联网）/ `Mock`（演示）/ `在线模型`。
2. **模型提供商**：`Anthropic`（Messages API）或 `OpenAI 兼容接口`（`/v1/chat/completions`），填接口地址。
3. **模型档位**：快速 / 均衡 / 高质量，各档的模型名可以改。
4. **API 密钥**：粘贴后点“保存密钥”。密钥只存进系统的凭据管理器（Windows 凭据管理器 / macOS 钥匙串 / Linux 密钥环），
   不写进设置文件、存档或日志；提供商的回复或报错里要是回显了密钥，也会被遮掉。
5. **预算**：每个游戏月的调用次数与 token 上限。超出预算、没配密钥或网络失败时自动改用 `data/templates/` 的离线模板。

发给模型的只有内核生成的世界摘要与 `data/prompts/` 里的提示词模板。模型的输出只是提案：先经裁决器（规则或 Jev），
再经内核校验，才会变成命令写进日志；读档与重放只读命令日志，从不重新调用模型。

| 提供商 | 接口地址（不含 `/v1/...`） | 密钥 |
|---|---|---|
| Anthropic | `https://api.anthropic.com` | Anthropic Console 创建的 API key |
| OpenAI 兼容接口 | 例如 `https://api.openai.com`，或本机的 `http://localhost:8080`（vLLM、llama.cpp server 等） | 服务要求的 Bearer 密钥 |

- **结构化输出**（设置面板里的开关，默认开）：输出的格式由提供商一侧强制，内容由模型决定。Anthropic 走强制工具调用，
  OpenAI 兼容接口走 `response_format = json_schema`；服务不支持时自动退回纯文本加修复解析。Schema 由代码从数据生成，
  与裁决器、内核校验读的是同一份数据。
- AI 能用的效果词表与各项边界都在 `data/effects.toml`，改完运行 `manifest-cli validate-data` 即可，不用改代码。
- 测试一律用 wiremock 或 Mock LLM，不调用任何真实服务。

### Jev

Jev 裁决器通过一份中立的 HTTP 契约接入，见 [docs/JEV_CONTRACT.md](docs/JEV_CONTRACT.md)：

1. 写一个小适配层，把 `POST /v1/adjudicate` 与 `POST /v1/classify` 转到真实的 Jev 服务。
2. 带 `jev` 特性构建桌面程序：`cargo build -p manifest-app --release --features jev`。
3. 在设置面板勾选“启用 Jev”并填地址。超时或出错时自动退回规则裁决器。

## 修改内容

`data/` 下的文件都带中文注释。改完运行 `manifest-cli validate-data`，报错会指出文件、条目与原因。

- 各表的条目只在末尾追加：存档按下标引用，重排或删除会让旧存档读不了。
- `key` 是内部标识，不要改；`name`、`description`、`lore` 这些显示文字可以随意重写。
- 翻译写在覆盖文件里：`data/locales/en/` 下与原文件同名同路径（其余世界在 `data/worlds/<key>/locales/en/`），只写要覆盖的显示字段，
  缺的条目回退到中文。改译文不会改变数据哈希。
- 界面文字在 `frontend/src/i18n/`：中文表 `zh-CN*.ts`，英文表 `en*.ts`，键与占位符一一对应；缺译文时类型检查与 `i18n` 的测试会列出具体的键。

## 语言

支持**简体中文**（默认）与**英语**。语言只影响显示：切换语言不改变世界状态、存档内容与重放结果，也不用重开游戏。
第一次启动按系统语言，之后以设置里的为准；标题画面左下角与设置面板里都能切换。

## 素材与出处

见 [docs/CREDITS.md](docs/CREDITS.md)。简单说：

- 配乐的管弦采样与部分音效录音是 CC0 素材（VS Chamber Orchestra: Community Edition、Kenney）。
- 人物肖像、场景插画与图标由图像生成模型生成。
- 地图的海陆、河流与高程取自 Natural Earth 与 NOAA ETOPO5（公有领域），地名坐标参照 GeoNames（CC BY 4.0）。

## 许可

代码与内容（文案、数据、图片、曲谱）以 [MIT 许可](LICENSE)发布。
第三方素材保留各自的许可：管弦采样与音效录音是 CC0，地图数据是公有领域，地名坐标参照的 GeoNames 是 CC BY 4.0，
详见上一节与 [docs/CREDITS.md](docs/CREDITS.md)。
