# 地图生成配置

经典世界的入口：

```powershell
cargo xtask mapgen procedural
# 旧命令是同一入口
cargo xtask worldgen
```

两者默认读取 `xtask/maps/classic.toml`，输出到 `data/world/`，调试图与报告放到
`$env:CARGO_TARGET_DIR/worldgen`（未设置时才使用仓库的 `target/worldgen`）。
经典配置保留旧注释文字，六个图层文件逐字节不变。

参数兼容原来的 `--layout`、`--world`、`--debug`、`--dry-run`、`--write-places`、`--write-roads`，
并增加 `--config`、`--output`。`--world` 同时指定输入世界与图层输出位置；`--output` 单独改变图层输出目录，
会复制校验所需的地区与地点表。`--write-places` 与 `--write-roads` 仍明确写回输入世界，
`--dry-run` 只生成调试图与报告。命令行路径相对工作目录，配置内路径相对配置文件。

```powershell
# 检查经典输出而不改 data/
cargo xtask mapgen procedural --output build/mapgen-check/world --debug build/mapgen-check/debug
cargo test -p xtask
```

`classic.toml` 中的内容均来自原生成器：次级河流命名地区、报告地区、沿岸泛洪范围与种子、针叶林统计、截图范围、
气候缺省曲线、输出说明文字。地区矩形为 `[x0,y0,x1,y1]`，不含右、下端点；截图使用 `origin` 与 `size`。
骨架的气候字段优先于本配置的 `[climate]`，两处都没有给出的气候字段会报错，不隐式采用经典世界。
新地图必须提供自己的配置，尺寸要与骨架一致；这个工作包未给程序生成器接入环绕。

经典配置继续放在 `xtask/maps/`。E01之后哈希按有效世界文件隔离，真实地图配置放在 `data/maps/<key>/`，
不会进入经典世界哈希；经典六图层与缺省命令仍保持逐字节兼容。

真实地理入口：

```powershell
cargo xtask mapgen real --config data/maps/<map>/mapgen.toml
# 仓库提供的缺输入示例
cargo xtask mapgen real --config xtask/maps/real.example.toml
```

配置 `version = 1`、`mode = "real"`、尺寸、`wrap_x` 与 `output`，来源写在 `[sources.land]`、`[sources.lakes]`、
`[sources.elevation]`、`[sources.rivers]`；气候来源可选。每项都有本地 `path`、64 位十六进制 `blake3`、`attribution`。
校验和针对原文件字节，须用 BLAKE3 工具计算后填写；不统一输入文件的换行符。
缺配置项或文件会报“缺少 …（见 mapgen.toml 的 [sources]）”；哈希不一致也会失败。

B9 已实现真实地理管线。寰宇的可复现入口为：

```powershell
cargo xtask mapgen real --config data/maps/earth/mapgen.toml
```

输入仅使用该配置声明的五份本地文件，不联网下载；缺文件、BLAKE3不符或缺少 `[real]` 都明确失败。
`[real]` 指定整数角分投影、岛/湖面积阈值、河流显示等级、ETOPO5 NoData 与显式海峡/陆障。
海岸按多边形奇偶扫描，港口/地标所属岛优先保留；ETOPO5按海陆类别分别聚合。
没有授权气候栅格，因此输出明确标记为纬度、高程、海陆距离推断的降级地貌。

写出六个地理图层，以及 `map.toml`、`regions.toml`、`anchors.toml`、`sources.toml`；
C12的月度 `navigation` 子表另写入所选世界的 `navigation.toml`，手写的经纬度不改。
93个海区使用Unicode单字符编码；尺寸按字符数计算，地图、起伏、地貌仍只接受各自的既有代码。
`regions.toml` 的四季兼容回退取1/4/7/10月，风险保留旧格式5%上限；实际月度导航完整保留C12原值。

## 细图层（第九批 M01“细海图”）

同一条命令另外在 `data/maps/<map>/fine/` 下写出三层只给显示用的细数据与一份说明：

| 文件 | 内容 |
| --- | --- |
| `coast.bin` | 细海岸：每粗格 24 × 24 细格（寰宇 25920 × 9504），每细格一类——海、陆、内陆水（湖） |
| `elevation.bin` | 细高程：ETOPO5 的原始 5 角分样本（每粗格 4 × 4），单位米，含海底深度 |
| `rivers.bin` | 细河流：Natural Earth 河流中线（不含湖心线），坐标单位 1/24 格，带 `scalerank` |
| `fine.toml` | 说明：来源、统计与三个文件的 BLAKE3（自动生成，不要手改） |

二进制格式的逐字节定义在 `crates/manifest-data/src/fine_map.rs` 开头；应用层经 `map_fine` 命令原样下发给前端。

航行网格（`map.txt`）仍是权威。细海岸在导出前照“骨架”约束修正：每个可航行粗格以格心为圆心、半径 4 细格的圆，
以及内核允许直接相通的相邻可航行粗格（八方向，斜向不穿陆角，与 `manifest-core` 的 `SeaMap::step` 同一条规则）之间
沿格心连线、半宽 3 细格的通道，凡被真实海岸挡住的细格改成水（真挖过的地方两岸按噪声啃得参差一些、夹在水道之间的小块碎地一并清掉）；
其余真实海岸原样保留，粗格是陆的地方一格不改。`manifest_data::fine_map::verify_skeleton` 对全部可航行格与全部邻接逐一验证
（`cargo test -p manifest-data --test fine_map`）。

**只更新细图层**用 `--fine-only`：

```powershell
cargo xtask mapgen real --config data/maps/earth/mapgen.toml --fine-only
```

它只重写 `fine/` 目录，并要求重新栅格化的海陆与已提交的 `map.txt` 逐字节一致（对不上就失败）。
不带这个开关时整套图层都会重写——注意 `anchors.toml` 里有后来手工追加的条目与注释、`landmarks.toml` 的说明随文案更新过，
整套重写会改动这两个文件（它们的哈希由 `b9b_preserves_non_climate_layer_hashes` 锁着），所以平时只用 `--fine-only`。
调试图 `fine-*.png`（几处海峡与多岛海，每细格一个像素）与 `fine-report.json` 写在 `$env:CARGO_TARGET_DIR/earth/`。

PNG与JSON验收报告写入 `$env:CARGO_TARGET_DIR/earth/`（未设置时使用仓库 `target/earth/`）：
`preview.png` 全图及配置中的地区截图；`report.json` 包含逐海区水格数、湖泊与陆块统计、
每次水道补丁的原始变更格、全部锚地偏移、原始高程缺同类样本计数和河网诊断。
原始资料与PNG不入仓库。地理图层只支持资源加载；`terra16` 保持草稿，E24负责游戏开局接线。
