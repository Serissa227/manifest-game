# 管弦版配乐的采样管线（`tools/orchestra/build.py`）

把公有领域的管弦乐采样库里要用的乐器与奏法，做成游戏里用的 MP3 与采样清单。播放见 `frontend/src/audio/orchestra/`。

## 采样的来源与许可

- **VS Chamber Orchestra: Community Edition**（VSCO 2 CE），Versilian Studios 出品：Sam Gossner、Simon Dalzell 录音，
  Elan Hickler / Soundemote 剪辑。<https://github.com/sgossner/VSCO-2-CE>（本作用的是提交 `4403009`）。
- 许可：**CC0 1.0 Universal**（公有领域贡献）。可以自由使用、修改、再发布，包括商业用途，不要求署名；
  这里与清单文件（`frontend/src/audio/orchestra/samples.ts`）的开头照样写明出处。

## 环境

- Python 3.10+，`numpy` 与 **PyAV**（`pip install numpy av`；PyAV 自带 FFmpeg 与 libmp3lame，不需要另装 ffmpeg）。
- 下载走 `raw.githubusercontent.com`；直连慢时用 `--proxy http://127.0.0.1:8080`（或环境变量 `VSCO_PROXY`）。

## 原始采样放在哪里

原始 WAV 不进仓库：`fetch` 按 [`sources.json`](sources.json) 的清单（仓库内路径与字节数，约 484 MB、376 个文件）下载到
`.tools/vsco2/`（整个 `.tools/` 已在 `.gitignore` 中），已下好且大小对的跳过。全库约 2.3 GB，这里只取用得到的乐器与奏法：

| 乐器 | 奏法（VSCO 的文件夹） | 取哪些 |
|---|---|---|
| 小提琴组 | `susVib` 揉弦长音、`Trem` 颤弓、`Pizz` 拨奏、`Spic` 跳弓 | 长音 11 个采样点 × 两个力度层；颤弓一层；拨奏、跳弓一层 × 两个轮换 |
| 中提琴组 | `susvib` | 13 个采样点，一层 |
| 大提琴组 | `susvib`、`pizzT` 拨奏、`spic` 跳弓 | 长音强的一层全部采样点、弱的一层每隔一个；拨奏两个轮换 |
| 低音提琴（独奏） | `SusVib`、`Pizz` | 长音一层；拨奏两个轮换 |
| 竖琴 | 全部 | 22 个采样点（最低的 E1 用不到，不下） |
| 圆号 | `sus` | v1、v3 两层（C4 与 D5 之间没有采样点） |
| 小号、长号 | `sus` | 各一层 |
| 长笛、双簧管、单簧管、大管 | 揉音或长音 | 双簧管两层，其余一层 |
| 定音鼓 | 单击、滚奏 | 五只鼓；单击两层 × 两个轮换，滚奏一层 |
| 钟琴、马林巴、管钟 | 单击 | 管钟只取 C4、G4、F5 |
| 其他打击乐 | 军鼓（击、滚奏）、大鼓、对击钹、吊镲渐强、铃鼓（击、摇）、三角铁、响棒、木鼓、大锣、沙锤 | 各一两层 |

## 用法（在仓库根目录）

```sh
python tools/orchestra/build.py fetch                      # 下载原始 WAV（可以重复运行，缺什么补什么）
python tools/orchestra/build.py fetch --proxy http://127.0.0.1:8080
python tools/orchestra/build.py analyze                    # 逐个量音高、长度、峰值、左右声道相关，核对文件名（结果另存 .tools/vsco2/analysis.json）
python tools/orchestra/build.py analyze --only harp,timp.hit
python tools/orchestra/build.py build                      # 全部重做（多进程，十几秒）
python tools/orchestra/build.py build --only vn.sus,hn.sus # 只重做几组，其余沿用上次的结果（缓存在 .tools/vsco2/zones.json）
```

输出：

| 路径 | 内容 |
|---|---|
| `frontend/public/audio/orchestra/<组>/<音名>-l<力度层>-r<轮换>.mp3` | 处理好的采样（立体声弦乐组、竖琴、钹与锣 VBR V4；独奏乐器混成单声道 VBR V5） |
| `frontend/src/audio/orchestra/samples.ts` | 采样清单（生成文件，不要手改）：每个采样的音高、力度层、轮换、增益、长度、起音标记、奏稳的时刻、最响处、循环段、字节数、内容哈希 |

构建结束时打印各组的体积与合计，超过 15 MB 警告、超过 20 MB 失败（目前约 9 MB）。

## 每个采样怎么处理

1. **音名与八度**：VSCO 各文件夹的音名八度约定不一样——大多数是“C3 = 中央 C”（弦乐、管乐、钟琴、马林巴），竖琴与管钟是“C4 = 中央 C”；
   `analyze` 在文件名的音上下 150 音分里找谐波和最大的基频来核对。实测与文件名差 30 音分以上的会列出来
   （单簧管的 “F#5” 实际是 F6，按实测用；低音提琴拨奏的 A1 偏高约 40 音分，也按实测）。
   **定音鼓**的文件名只有鼓的编号：按鼓皮的模态（主音、1.5 倍、1.98 倍、2.44 倍）拟合出主音；滚奏的频谱糊成一片，2、3 号鼓手工定。
2. **起音**：从第一次超过峰值 1% 的地方往前留 2 毫秒并淡入，前面的静音裁掉。
3. **长音**（弦乐组、管乐、颤弓、滚奏）：先量“奏稳”的时刻（包络第一次到达持续部分典型响度的 70%，弱奏的小提琴、中提琴有的要一两秒），
   渐强慢的多留一点长度；在奏稳之后找循环段：接缝两边的波形最相关（相位对齐）、响度最接近、循环尽量长（至少 0.9–1.2 秒），
   循环终点之后只留 30 毫秒并淡出。播放时由采样器按循环段一段段接上，接缝处交叉淡化。
4. **一次性采样**（拨奏、竖琴、打击乐）：截到合适的长度（拨奏约 1 秒，竖琴 2.4 秒，管钟 3.2 秒，大锣 6 秒），最后一段淡出。
5. **响度**：K 计权（约 60 Hz 高通 + 1.5 kHz 以上 +4 dB）后，长音量循环段的均方根，其余量最响的 400 毫秒；
   清单里的 `gain` 把每个采样都校到同一个参考响度——力度层只管音色（弱奏柔、强奏亮），响度由采样器的力度曲线决定。
6. **编码**：峰值归一到 −1 dBFS 后用 LAME 编码成 MP3。独奏乐器混成单声道（声像由乐队的座位决定），弦乐组、竖琴、钹与锣保留立体声的宽度。
7. **起音标记**：在编码前的信号上量“各声道平均后 |x| 第一次超过峰值 0.5%”的时刻写进清单；有的浏览器解码 MP3 时不裁掉编码器补的静音，
   前端解码后在同样的规则下再量一次，差值就是这个浏览器多出来的延迟（`frontend/src/audio/orchestra/bank.ts`）。

## 改动之后

- 改了挑选（`sources.json` 或 `build.py` 里的 `SETS`）要重新 `fetch`、`build`；清单变了，前端的测试（`frontend/src/audio/orchestra/orchestra.test.ts`）
  会核对每个文件都在、大小与清单一致、总体积在预算内、每首管弦版曲目的每个音都有采样可用。
- 乐器的音量校准（`frontend/src/audio/orchestra/instruments.ts` 的 `level`）是按这一版采样在本地试音台上量的，换了采样要重新校准。
