# 资源许可与署名

本文仅汇集仓库现有素材清单与构建说明，不新增许可声明。

| 资源 | 许可 | 署名 | 仓库依据 |
|---|---|---|---|
| audio/orchestra | CC0 1.0 | VS Chamber Orchestra: Community Edition；Versilian Studios；Sam Gossner；Simon Dalzell；Elan Hickler / Soundemote | tools/orchestra/README.md；frontend/src/audio/orchestra/samples.ts |
| audio/sfx 的 Kenney 录音素材 | CC0 1.0 | Kenney | tools/sfx/README.md；frontend/src/audio/sfx/samples.ts |
| audio/sfx 炮声中的大鼓录音 | CC0 1.0 | VS Chamber Orchestra: Community Edition；完整录音署名同上 | tools/sfx/README.md；tools/orchestra/README.md |

炮声的轰鸣、余响及落水等程序合成部分来自 tools/sfx/build.py；既有清单未为这些合成部分设置单独许可字段，不将录音素材的 CC0 声明扩展到它们。

头像、场景插画、物品与交易品的图标由图像生成模型按本项目的提示词生成，再经脚本裁切与压缩；生成脚本与提示词工作稿没有随本仓库发布，素材清单见 art-src/portraits.json 与 frontend/src/art/ 下的生成清单。这些图像没有单独的许可或署名字段，检查不推定它们具有 CC0 许可。

地图的海陆、湖泊、河流与高程取自 Natural Earth 1:10m 与 NOAA NGDC ETOPO5（均为公有领域），来源文件与校验和见 data/maps/earth/sources.toml。港口与城市的坐标参照 GeoNames cities500（CC BY 4.0，https://www.geonames.org/），逐条出处写在 data/worlds/terra16/ 下各地点文件的注释里。
