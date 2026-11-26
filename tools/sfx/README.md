# 游戏音效的素材管线（`tools/sfx/build.py`）

把公有领域的录音音效包里挑出来的素材，裁剪、滤波、变调、叠层、统一响度，做成游戏里用的 MP3 与素材清单。
播放与触发见 `frontend/src/audio/sfx/`。

## 素材的来源与许可

五个 **Kenney**（<https://www.kenney.nl>）的音效包，许可都是 **CC0 1.0 Universal**（公有领域贡献）：可以自由使用、修改、再发布，
包括商业用途，不要求署名。这里与清单文件（`frontend/src/audio/sfx/samples.ts`）的开头照样写明出处。
下载地址、文件大小与 SHA-256 固定在 [`sources.json`](sources.json)。

| 包 | 版本 | 用了几个文件 | 用来做什么 |
|---|---|---|---|
| RPG Audio | — | 34 | 书页、合上与翻开书、皮钱袋、钱币、布料（帆）、木头的吱呀、脚步、刀剑、金属搭扣 |
| Impact Sounds | 1.0 | 25 | 金属撞击（铁链）、船板与木头的闷响（靠岸、锤子、命中）、沉的软物（粮袋） |
| Casino Audio | 1.1 | 12 | 黏土筹码的轻响（按钮、滑条的档位）、纸牌滑动与放下（开关窗口、翻页、提示）、筹码堆（钱币的厚度） |
| UI SFX Set（UI Audio） | — | 2 | 拨动开关（勾选框） |
| Interface Sounds | 1.0 | 0 | 下载了、听过（看过频谱）：几乎都是合成的“叮咚”、滑音与电子提示音，与管弦配乐不搭，一个没用 |

另外两种来源：

- 炮声的“咚”用了仓库里管弦采样的大鼓（`frontend/public/audio/orchestra/perc-bd/`，来自 VS Chamber Orchestra: Community Edition，
  同为 CC0 1.0，见 [`tools/orchestra/README.md`](../orchestra/README.md)），降低音高；
- 炮声的爆裂与余响、落水的水花、木屑与水滴是程序合成的（这个脚本里的 `synth_noise`、`synth_thump`、`synth_droplets`，给定参数与种子结果逐采样相同）。

### Kenney 包里的许可文本（原文，五个包的写法大同小异，这里是 RPG Audio 与 Impact Sounds 的两种）

```
	RPG Audio

	by  Kenney Vleugels (Kenney.nl)

			------------------------------

	License (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	You may use these assets in personal and commercial projects.
	Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.
```

```
	Impact Sounds (1.0)

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 19-12-2019

			------------------------------

	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	This content is free to use in personal, educational and commercial projects.
	Support us by crediting Kenney or www.kenney.nl (this is not mandatory)
```

Casino Audio（1.1）与 UI SFX Set 的许可文本与 RPG Audio 的写法相同，Interface Sounds（1.0）与 Impact Sounds 的写法相同，都是 CC0。

## 环境

- Python 3.10+，`numpy` 与 **PyAV**（`pip install numpy av`；PyAV 自带 FFmpeg 与 libmp3lame，不需要另装 ffmpeg）；画频谱图（`sheet`）另要 Pillow。
- 下载直连慢时用 `--proxy http://127.0.0.1:8080`（或环境变量 `SFX_PROXY`）。

## 原始素材放在哪里

五个 zip（约 3.8 MB）不进仓库：`fetch` 下载到 `.tools/kenney/`（整个 `.tools/` 已在 `.gitignore` 中），已有且校验和对的跳过；
`build` 先把各包 `Audio/` 下的 OGG 解压到 `.tools/kenney/<包>/`。

## 用法（在仓库根目录）

```sh
python tools/sfx/build.py fetch                              # 下载五个音效包（可以重复运行）
python tools/sfx/build.py fetch --proxy http://127.0.0.1:8080
python tools/sfx/build.py build                              # 解压、按配方处理、编码 MP3、写清单（几秒）
python tools/sfx/build.py list                               # 列出每种素材用到的原始文件
python tools/sfx/build.py sheet                              # 把做好的音效画成频谱图（.tools/kenney/sheet-*.png），检查用
```

输出：

| 路径 | 内容 |
|---|---|
| `frontend/public/audio/sfx/<素材>-<n>.mp3` | 做好的音效（单声道、44.1 kHz、LAME VBR V4；炮声与落水 V5） |
| `frontend/src/audio/sfx/samples.ts` | 素材清单（生成文件，不要手改）：每种素材的说明与各变体的文件、增益、长度、起音标记、字节数、内容哈希 |

构建结束时打印每种素材的体积、长度与校准后的峰值和响度，合计超过 2 MB 直接失败（目前约 0.4 MB）。

## 配方与处理

配方写在 `build.py` 的 `SAMPLES` 里：每种素材（例如 `ui.click`、`coin.take`、`sea.chain`）有 2–4 个变体，播放时随机轮换；
一个变体由一层或几层素材叠成，每层可以指定从素材起音之后的哪一段、取多长、快慢（同时变调）、高通与低通、音量、在成品里的位置。
起锚的铁链、炮声、命中、落水这些由几十层拼出来的，写成函数（`chain_layers`、`cannon_layers`……），种子固定，结果确定。

每一层、每个变体怎么处理：

1. **读取**：解码 OGG / MP3；立体声的两个声道相关高时取平均，相关低（宽的立体声录音，平均会互相抵消）时取较响的一个声道；换算到 44.1 kHz。
2. **截取**：从起音（|x| 第一次超过峰值 2%）前 3 毫秒起截取，这 3 毫秒淡入；末尾按配方淡出。
3. **变调**：频域的带限重采样（前后补零，不会首尾相接）。
4. **滤波**：二阶巴特沃斯的幅度响应，零相位，在频域里做（界面的声音削掉 500 Hz 以下与 4.5–7.5 kHz 以上，只留轻轻的一点）。
5. **叠层**：每层先把峰值归一，再按配方的音量相加。
6. **截尾**：尾部截到比峰值低 58 dB，最后 12 毫秒淡出。
7. **统一响度**：K 计权（约 60 Hz 高通 + 1.5 kHz 以上 +4 dB）后最响一段（短的 50 毫秒，长的 100–200 毫秒）的均方根。
   一组变体校到同一个参考响度（−20 dB），清单里的 `gain` 就是播放时乘的倍数；极短的“嗒”“咔”（`norm="mix"`）按响度与峰值各算一半，
   免得瞬态尖的变体听起来比别的重。各事件的最终音量写在前端的事件表（`frontend/src/audio/sfx/events.ts`）里，都相对这个参考响度。
8. **编码**：峰值归一到 −1 dBFS 后用 LAME 编码成单声道 MP3。
9. **起音标记**：在编码前的信号上量“|x| 第一次超过峰值 0.5%”的时刻写进清单；有的浏览器解码 MP3 时不裁掉编码器补的静音，
   前端解码后在同样的规则下再量一次，差值就是这个浏览器多出来的延迟（与管弦采样同一个办法，见 `frontend/src/audio/orchestra/bank.ts`）。
   构建时也用 PyAV 解码核对，差超过 4 毫秒会提示。

## 改动之后

- 改了配方要重新 `build`；清单变了，前端的测试（`frontend/src/audio/sfx/sfx.test.ts`）会核对每个文件都在、大小与清单一致、
  没有清单外的文件、总体积不超过 2 MB、每种素材 2–4 个变体、事件表用到的素材都在。
- 各事件的音量（`events.ts` 的 `level`）是按这一版素材在本地试音台上离线渲染量的（缺省音效音量下的峰值与响度），
  换了素材要重新量一遍。
