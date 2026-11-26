# C1 基础数据交接

世界英文名：Terra · The Sixteenth Century。日期：2026-10-07。

C1 只提供隐藏的世界骨架与六类基础表；没有 earth 地图、港口、剧本和经济设置，不能整世界加载或游玩。`hidden = true`，没有继承经典条目表。

## 数量与顺序

| 表 | 数量 | 说明 |
|---|---:|---|
| goods | 115 | 经典72个key原序 + §5.1列名36个原序 + 7个生产必需物料 |
| industries / recipes | 4 / 113 | 70个产地供应、43个加工配方；关键物资可追溯至原料 |
| workshops | 72 | 28个港口引用与1个内陆城市引用中的实际作坊；share为0.25或0.35 |
| factions / relations | 121 / 103 | 按现行§4逐个拆开联合列名；关系每对只列一次，未列者为0 |
| companies | 16 | §5.3实际列名16个网络，全部落实 |
| ships | 35 | 19个经典普通key + 16个新增普通key |

船型数量按实际去重：经典21项去掉两种独有船型；新表19行去掉已存在的 `galleass`、事件独有的 `geobukseon` 和秘境的 `ring_ship`，因此是35项。本包不提前制作传说船，也不改动经典船型表。

势力使用具体名单，未按“约87”截断。补入日本朝廷、苏尔王朝与吉里以保持开局叙事完整。东江镇、大顺、海上乞丐、法属南极、独立阮主和亚特兰蒂斯等后来/秘境政权留给相应内容包追加；当前没有港口强行归给尚未成立的势力。

## C2 地点契约

共28个港口key、1个内陆城市key。下表“投入”均须进入该市场；“产出”既须交易又须有正产量。表中的数量只是连通要求，不是港口平衡稿。C2仍须核算人口、供需、特产、工坊日耗与产能；无投入采集配方只能在相应货物是当地特产时建造，转口货不能误标为本地特产。

| key | 地点 | 势力key（1553） | 工坊投入必须交易 | 工坊产出须有产量 |
|---|---|---|---|---|
| `antwerp` | 安特卫普 | `netherlands` | alum, calamine, charcoal, cloth, cochineal, copper, gems, gold_ingot, ironware, planks, wool | brass, furniture, garments, jewelry, scarlet_cloth |
| `bergen` | 卑尔根 | `denmark_norway` | timber | pitch, planks |
| `campeche` | 坎佩切 | `new_spain` | tobacco | cigars |
| `funchal` | 丰沙尔 | `portugal` | sugarcane, timber | sugar |
| `guangzhou` | 广州 | `ming` | cloth, cocoons | garments, raw_silk |
| `hakata` | 博多 | `ouchi` | — | — |
| `hamburg` | 汉堡 | `hanse` | charcoal, lead_ore, pig_iron | ironware, lead |
| `istanbul` | 伊斯坦布尔 | `ottoman` | beeswax, charcoal, copper, herbs, indigo, paper, quinine, raw_silk, saltpeter, sugar, sulfur, tin, wool | books, cannon, carpets, gunpowder, medicine |
| `jingdezhen` | 景德镇（内陆城市） | `ming` | kaolin, timber | porcelain |
| `julfar` | 尤尔法（哈伊马角） | `hormuz` | — | — |
| `khambhat` | 坎贝 | `gujarat` | alum, cloth, cotton, indigo, sugarcane, timber, yarn | calico, cloth, sugar, yarn |
| `kilwa` | 基尔瓦 | `swahili_cities` | — | — |
| `lisbon` | 里斯本 | `portugal` | brass, charcoal, copper, hemp, ironware, pitch, timber, tin | cannon, instruments, rope |
| `london` | 伦敦 | `england` | alum, cochineal, flax, hemp, wool | sailcloth, scarlet_cloth |
| `lubeck` | 吕贝克 | `hanse` | flax, hemp, pitch, timber | planks, rope, sailcloth |
| `marseille` | 马赛 | `france` | grapes, timber, wine | rum, wine |
| `nagapattinam` | 纳加帕蒂南 | `vijayanagara` | alum, cloth, indigo | calico |
| `naha` | 那霸 | `ryukyu` | — | — |
| `ningbo` | 宁波 | `ming` | charcoal, cocoons, cotton, flax, gold_ingot, hemp, lacquer, pig_iron, planks, raw_silk, silk, yarn | brocade, cloth, ironware, lacquerware, paper, raw_silk, silk, yarn |
| `olinda` | 奥林达 | `portugal` | sugarcane, timber | sugar |
| `porto` | 波尔图 | `portugal` | grapes | wine |
| `sakai` | 堺 | `sakai` | beeswax, charcoal, copper_ore, gunpowder, ironware, lacquer, lead, paper, pig_iron, planks, silver_ore, timber | arquebus, books, copper, ironware, lacquerware, silver_ingot, swords |
| `santo_domingo` | 圣多明各 | `spain` | tobacco | cigars |
| `seville` | 塞维利亚 | `spain` | charcoal, grapes, lead_ore, olives, sugar, timber, wine | candy, lead, olive_oil, rum, wine |
| `stockholm` | 斯德哥尔摩 | `sweden` | charcoal, copper_ore, iron_ore, timber | charcoal, copper, pig_iron, pitch |
| `tunis` | 突尼斯 | `hafsid` | olives | olive_oil |
| `venice` | 威尼斯 | `venice` | beeswax, brass, charcoal, copper, flax, glass, gold_ingot, hemp, ironware, lead, paper, quartz_sand, raw_silk, saltpeter, silk, sulfur, timber, tin, whale_oil | books, brocade, cannon, crystal_lamp, glass, gunpowder, instruments, paper, silk |
| `veracruz` | 韦拉克鲁斯 | `new_spain` | cocoa, sugar | chocolate |
| `yuegang` | 月港 | `ming` | — | — |

- `yuegang`：1553年为私贸港，1567年后才合法开放；不能因商会有本据就抹掉海禁。
- `julfar`：按尤尔法地区的哈伊马角海港处理；旧城此时已衰退。
- `hakata`：1553年按大内体系，不提前给大友。
- `nagapattinam`：科罗曼德尔的纳加帕蒂南，按维查耶纳伽尔及地方纳亚克体系。
- `jingdezhen`：城市而非港口。瓷窑留在实际产地，不把广州转口市场写成瓷窑产地。

## 尚未进入运行时的编辑字段

所有表使用现有严格schema。`# basis`、`# sources`、商品的 `origin_regions` / `origin_cultures` / `trade_policy`、势力的 `group` / `situation`、商会的 `faction` / `affiliation`、船的 `rig` / `propulsion` / `oar_speed` / `seaworthiness` / `draft_cm` / `available_from` 均为结构化注释。它们便于校验和后续迁移，**不会自动改变模拟**。商会运行时势力来自本据港，`affiliation`只表示商人网络的背景。

商品 `license` 已用现有字段实现统一许可证要求；明海禁、边市禁运和盐专营不是一张通用许可证能表达的制度，须由后续政策/事件接入。关系 `value` 只是基准好恶，不是新增的战争/同盟/朝贡枚举。

建筑风格除既有名称外使用 `japanese`、`ming`、`ottoman`、`swahili`、`indian`、`malay`、`maya`、`andean`。任务要求保留这些名称，现有整世界转换器只接受7种风格，需在引擎包扩充校验及前端映射。本包没有把新名字暗改为旧名。非斯瓦希里的非洲政权暂用 `swahili` 作为美术候选，政治文化说明保持各自身份。

硬帆/编席帆暂以 `sail="square"`、蟹爪形帆以 `lateen` 接入两类现有帆型；纯桨船也保留必填帆型占位。真实推进方式、桨速、吃水和适航限制只在注释与描述，不能据本包声称机制已落地。

普通船 `atakebune`（配置门槛1569，精确初见待核）与 `panokseon`（保守采用实录1557锚点）不得列入1553开局船厂，商会没有引用它们。C2须在船厂白名单中排除，后续时间线再启用。`galleass`在本包指商用大桨船武装谱系，不是提前出现勒班陀的六艘旗舰。

## 年代选择、出处与待核

- `rum`改为葡萄烧酒，`quinine`改为药用柳树皮，`star_crystal`为天降石，`crystal_lamp`为穆拉诺玻璃灯；`spice`为胡椒，`books`为书籍与抄本。全部保留key和原顺序。食用可可写作冲调料，不写近代硬巧克力。
- 关键工艺显式使用木炭、精铜、锡、炉甘石、铅、纸张、生漆、橄榄。火药需要木炭；火炮用铜锡合金；黄铜用铜和炉甘石；1553提银用灰吹，不默认启用后来的美洲混汞法。游戏数量和价格不是史实测量。
- `star_crystal`、`relics`、`orichalcum`分别由探索/遗物/秘境提供，均不作为关键配方原料，未伪造无穷开采作坊。山铜的basis为literature，依据柏拉图。
- 建州、叶赫、乌拉、察哈尔按指定的辽东线提前约55年，basis为extended；其余东亚仍按1553年处理。
- 摩洛哥采用1553年萨阿德已占非斯、1554年瓦塔斯短暂复辟再失城的次序；俄罗斯用1547年以后的沙皇国称号，佛罗伦萨不提前1569年的大公国称号。
- 待核：穆索祖母绿矿具体殖民开采起年（不采用草案1544）；阿朱兰与摩加迪沙地方王朝宗属；德马克—帕章转换年份；万丹独立起年；鸟船1553年前后直接记载；安宅船成熟型初见和尺度；板屋船1555首造说。分片已逐项标注，争议没有写成确定事实。
- 书名/年代和研究笔记定位见每个条目的sources注释；1637年《天工开物》、1596年《本草纲目》等仅作为后世工艺旁证，不把出版年代提前。

## 英文与验证边界

每个分片都有 `locales/en/` 同路径文件，全部商品、产业、配方、势力、商会、船型的英文名齐全；作坊与关系没有显示名，其英文同名文件只留说明。C1要求的是英文名，长描述与商会persona暂回退中文；世界元信息英文名列在本交接页，现有locale接口尚未消费它。

新增测试 `crates/manifest-data/tests/terra16_fragments.rs` 复用生产Raw结构与EffectiveWorld分片合并器；六表还经真实load入口做反序列化校验。它检查英文key、出处注释、配方闭环、Hawkins–Simon条件、关系/商会引用、作坊份额和经典哈希，不伪造地图和港口来宣称整世界可加载。

locale登记测试已扩充为按实际[tables]清单映射每个物理分片，仍拒绝未登记文件、未知逻辑表和无效元信息。现有世界目录会先加载地图再判断hidden，此集成问题的最小修复涉及任务禁止改动的加载器，已提出范围例外申请；未获确认前保持加载器原样。未新增命令、视图字段、Tauri或HTTP接口，未新增Cargo依赖。
