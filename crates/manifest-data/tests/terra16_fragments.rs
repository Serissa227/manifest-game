//! 寰宇内容的严格分片登记和翻译检查；B9提供earth地图，terra16仍保留草稿门禁。
//! 经度纬度等作者字段通过草稿检查，不代表运行时转换、推进/吃水与地方禁运已经接入。
//! 复用生产代码的严格原始结构和分片合并器，不另造一个宽松的 TOML schema。

use manifest_data::worlds;

// 不修改公共模块的可见性；仅在本集成测试中复用生产解析类型。
#[allow(dead_code)]
#[path = "../src/raw.rs"]
mod raw;

use manifest_core::calendar::{Date, Season};
use manifest_core::defs::RecipeDef;
use manifest_core::ids::{GoodId, IndustryTypeId};
use manifest_data::worlds::{EffectiveFile, EffectiveWorld, FileMode, WorldManifest};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn package() -> PathBuf {
    root().join("worlds/terra16")
}

fn read(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn manifest() -> WorldManifest {
    toml::from_str(&read(package().join("world.toml"))).expect("C1 世界骨架应符合现有严格 schema")
}

fn fragments() -> EffectiveWorld {
    let mut world = manifest_data::resolve_world(&root(), "classic").expect("经典有效文件清单");
    world.manifest = manifest();
    world.files.clear();
    // 只借用真实合并器；没有伪造 earth 地图、港口或市场，也不调用 load_effective。
    for (table, paths) in &world.manifest.tables {
        let sources = paths.iter().map(|p| package().join(p)).collect();
        world.files.insert(format!("{table}.toml"), EffectiveFile { sources, mode: FileMode::Fragments });
    }
    world
}

fn text(table: &str) -> String {
    fragments().read(&format!("{table}.toml")).expect("分片按清单顺序合并且无重复 key")
}

fn goods() -> raw::GoodsFile {
    toml::from_str(&text("goods")).expect("生产 GoodRaw 严格解析")
}

fn recipes() -> raw::RecipesFile {
    toml::from_str(&text("recipes")).expect("生产 RecipeRaw 严格解析")
}

/// 注释里的编辑信息有明确 TOML 形状，但不伪称为运行时已支持的字段。
fn annotated_rows(table: &str) -> Vec<(toml::Table, toml::Table)> {
    let mut result = Vec::new();
    let m = manifest();
    let parent = if table == "industries" {
        "recipes"
    } else if table == "relations" {
        "factions"
    } else {
        table
    };
    for rel in &m.tables[parent] {
        let source = read(package().join(rel));
        let marker = format!("[[{table}]]");
        for block in source.split("\n\n").filter(|s| s.contains(&marker)) {
            let (comments, record) = block.split_once(&marker).expect("数组表标记");
            // Q01b ef6a856c 的保序别名说明不是元数据；仅放行该文件的这一行。
            let comments = comments
                .lines()
                .filter_map(|line| line.strip_prefix("# "))
                .filter(|line| {
                    !(rel == "factions_runtime.toml"
                        && *line == "已并入 murakami；保留定义只为不移动势力序号，不要再引用")
                })
                .collect::<Vec<_>>()
                .join("\n");
            let meta: toml::Table = toml::from_str(&comments).unwrap_or_else(|e| panic!("{rel} 注释元数据: {e}"));
            let row: toml::Table = toml::from_str(record).unwrap_or_else(|e| panic!("{rel} 条目: {e}"));
            result.push((row, meta));
        }
    }
    result
}

fn string<'a>(row: &'a toml::Table, key: &str) -> &'a str {
    row.get(key).and_then(toml::Value::as_str).unwrap_or_else(|| panic!("缺少字符串 {key}: {row:?}"))
}

#[test]
fn skeleton_uses_earth_strict_sources_and_a_365_day_northern_calendar() {
    let m = manifest();
    assert_eq!((&*m.key, &*m.name, &*m.map), ("terra16", "寰宇·十六世纪", "earth"));
    // 2026-11-02 起寰宇是成品世界，进入开局列表。
    assert!(!m.hidden && !m.draft);
    assert!(m.inherit.is_none(), "不能把经典条目混入本世界");
    assert!(matches!(m.lore.sourcing, worlds::Sourcing::Strict));
    assert_eq!(m.lore.allow_original, ["jackdaw"]);
    assert!([&m.lore.summary, &m.lore.terms, &m.lore.taboos].iter().all(|s| !s.trim().is_empty()));
    assert_eq!(m.money.currency.as_deref(), Some("金币"));
    assert_eq!(m.calendar.era(), "公元");
    assert_eq!(m.calendar.year_days(), 365);
    assert_eq!(m.calendar.date_of(59), Date { year: 1, month: 3, day: 1 });
    assert_eq!(m.calendar.season_of(0), Season::Winter);
    assert_eq!(m.calendar.season_of(59), Season::Spring);
    assert_eq!(
        m.tables.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "arcana",
            "auctions",
            // H08（2026-11-11）：甲板闲话 voyage/banter.toml
            "banter",
            "cities",
            "companies",
            "creatures",
            "discoveries",
            "factions",
            "goods",
            "guide",
            "history",
            "ideas",
            "items",
            "legend_ships",
            "lineages",
            "mates",
            "offstage",
            "opening_catalog",
            "past",
            "persons",
            "ports",
            "prompts",
            "realms",
            "recipes",
            "regions",
            "roads",
            "scenarios",
            "sets",
            "ships",
            // H04（2026-11-11）：海上所见 voyage/sightings.toml
            "sightings",
            "sites",
            "skills",
            "societies",
            "stories",
            "templates",
            "ties",
            "upbringing",
            "workshops",
        ]
    );
    let mut seen = BTreeSet::new();
    for paths in m.tables.values() {
        assert!(!paths.is_empty());
        for rel in paths {
            assert!(seen.insert(rel));
            assert!(!rel.contains(['\\', ':']) && !rel.split('/').any(|p| p == ".."));
            assert!(package().join(rel).is_file(), "缺少分片 {rel}");
        }
    }
}

#[test]
fn all_six_tables_use_the_production_strict_schemas() {
    // G02（2026-11-11）：60 种新货，各带一个来源配方：159 → 219、162 → 222。
    assert_eq!(goods().goods.len(), 219);
    let r = recipes();
    assert_eq!(r.industries.len(), 5);
    assert_eq!(r.recipes.len(), 222);
    let ships: raw::ShipsFile = toml::from_str(&text("ships")).expect("生产 ShipRaw");
    // 公开版拿掉 2 种船型：37 → 35。
    assert_eq!(ships.ships.len(), 35);
    let factions: raw::FactionsFile = toml::from_str(&text("factions")).expect("生产 FactionRaw");
    // 121 → 122：2026-10-11 补了宿务港引用的占位势力 cebu_rajahnate（见 DECISIONS“配乐的数据接线”）；
    // → 159：B10b 的 factions_runtime.toml 补登记 37 个已被港口 / 人物引用的政治归属（其中的 cebu_rajahnate 与上面重复，整合时去掉）
    assert_eq!(factions.factions.len(), 159);
    assert_eq!(factions.relations.len(), 103);
    let companies: raw::CompaniesFile = toml::from_str(&text("companies")).expect("生产 CompanyRaw");
    assert_eq!(companies.companies.len(), 16);
    // WorkshopRaw 是转换器私有类型。将六张合并表交给真实 load 入口；缺失其他
    // 必需文件会在语义转换前返回错误，但六张表都已走过生产反序列化，不能报语法错误。
    // 这里不补假地图/港口，不过滤真正属于这六张表的错误，也不宣称通过整世界校验。
    let temp = tempfile::tempdir().expect("分片解析临时目录");
    let files = ["goods", "ships", "factions", "companies", "recipes", "workshops"];
    for file in files {
        std::fs::write(temp.path().join(format!("{file}.toml")), text(file)).expect("写入分片原文");
    }
    let error = manifest_data::load(temp.path()).expect_err("缺少规则、地图和地点");
    assert!(error.issues.iter().any(|i| i.file == "rules.toml"));
    assert!(
        error.issues.iter().all(|i| !files.iter().any(|f| i.file == format!("{f}.toml"))),
        "生产转换器无法解析 C1 分片: {error}"
    );
    std::fs::write(
        temp.path().join("workshops.toml"),
        text("workshops").replacen("[[workshops]]", "[[workshops]]\nunknown = true", 1),
    )
    .expect("损坏样例");
    let error = manifest_data::load(temp.path()).expect_err("拒绝未知作坊字段");
    assert!(error.issues.iter().any(|i| i.file == "workshops.toml" && i.message.contains("unknown")));
    assert_eq!(annotated_rows("workshops").len(), 98);
    // 验证没有通过宽松解析悄悄丢弃尚不支持的字段。
    let invalid = text("goods").replacen("[[goods]]", "[[goods]]\nunsupported_c1_field = true", 1);
    assert!(toml::from_str::<raw::GoodsFile>(&invalid).is_err());
}

#[test]
fn classic_good_ids_and_the_specified_append_order_are_preserved() {
    let classic: raw::GoodsFile = toml::from_str(&read(root().join("goods.toml"))).expect("经典商品");
    let all = goods();
    let keys: Vec<_> = all.goods.iter().map(|g| g.key.as_str()).collect();
    assert_eq!(&keys[..72], classic.goods.iter().map(|g| g.key.as_str()).collect::<Vec<_>>());
    let expected = "cloves nutmeg cinnamon ginger saffron frankincense sandalwood camphor musk ivory ebony ambergris narwhal rice olive_oil horses copper tin mercury alum mastic emerald jade obsidian feathers cowries pitch carpets calico lacquerware swords arquebus ginseng sable beeswax orichalcum";
    assert_eq!(&keys[72..108], expected.split_whitespace().collect::<Vec<_>>());
    assert_eq!(&keys[108..115], ["paper", "lacquer", "charcoal", "calamine", "lead_ore", "lead", "olives"]);
    let draft: Vec<serde_json::Value> =
        serde_json::from_str(&read(root().join("../docs/drafts/goods-expansion.json"))).expect("G01 设计稿");
    assert_eq!(
        &keys[115..159],
        draft.iter().map(|row| row["key"].as_str().expect("新货 key")).collect::<Vec<_>>(),
        "G01 的 44 个编号只在原 115 个之后按三个分片追加"
    );
    // G02（2026-11-11）的 60 个编号接在 G01 之后，按设计稿的顺序追加，旧编号不动。
    let g02: Vec<serde_json::Value> =
        serde_json::from_str(&read(root().join("../docs/drafts/goods-g02.json"))).expect("G02 设计稿");
    assert_eq!(
        &keys[159..],
        g02.iter().map(|row| row["key"].as_str().expect("新货 key")).collect::<Vec<_>>(),
        "G02 的 60 个编号只在 G01 之后追加"
    );
    assert_eq!(keys.iter().copied().collect::<BTreeSet<_>>().len(), keys.len());
    for g in &all.goods {
        assert!(g.base_price > 0 && g.tier <= 3, "{}", g.key);
        assert!(!g.description.is_empty());
        for season in [&g.season_demand, &g.season_supply].into_iter().flatten() {
            assert_eq!(season.len(), 4);
            assert!(season.iter().all(|v| v.value() > 0.0));
        }
    }
    for key in ["saltpeter", "sulfur", "gunpowder", "cannon", "arquebus", "swords", "horses", "ironware"] {
        assert!(all.goods.iter().find(|g| g.key == key).expect("军需货").license, "{key}");
    }
    let mut groups = BTreeMap::new();
    for g in &all.goods {
        if let Some(group) = &g.group {
            let need = g.need.as_deref().expect("替代组必须有需求层级");
            if let Some(previous) = groups.insert(group, need) {
                assert_eq!(previous, need, "同组商品需求层级一致");
            }
        }
    }
}

#[test]
fn g01_goods_copy_and_source_recipes_match_claude_drafts() {
    let drafts = root().join("../docs/drafts");
    let draft: Vec<serde_json::Value> =
        serde_json::from_str(&read(drafts.join("goods-expansion.json"))).expect("G01 设计稿");
    let mut copy = BTreeMap::new();
    for region in ["china", "japan", "other"] {
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&read(drafts.join(format!("goods-copy-{region}.json")))).expect("Claude 文案");
        for row in rows {
            assert!(copy.insert(row["key"].as_str().unwrap().to_owned(), row).is_none());
        }
    }
    let actual = goods();
    let recipes = recipes();
    for row in &draft {
        let key = row["key"].as_str().unwrap();
        let good = actual.goods.iter().find(|good| good.key == key).expect("新货已登记");
        assert_eq!(good.name, copy[key]["name"].as_str().unwrap(), "{key} 名称逐字照抄");
        assert_eq!(good.description, copy[key]["description"].as_str().unwrap(), "{key} 文案逐字照抄");
        assert_eq!(good.category, row["category"].as_str().unwrap());
        assert_eq!(i64::from(good.tier), row["tier"].as_i64().unwrap());
        assert_eq!(good.base_price, row["base_price"].as_i64().unwrap());
        assert_eq!(good.need.as_deref(), row["need"].as_str());
        assert_eq!(good.group.as_deref(), row["group"].as_str());
        assert_eq!(good.crop, row["crop"].as_bool().unwrap());
        assert_eq!(good.license, row["license"].as_bool().unwrap());
        if let Some(source) = row["source"].as_object() {
            let recipe = recipes.recipes.iter().find(|r| r.key == format!("source_{key}")).expect("采集配方");
            assert!(recipe.inputs.is_empty());
            assert_eq!(recipe.industry, source["industry"].as_str().unwrap());
            assert_eq!(recipe.outputs.len(), 1);
            assert_eq!(recipe.outputs[0].good, key);
            assert_eq!(recipe.outputs[0].qty, source["qty"].as_i64().unwrap());
        }
    }
    for (key, row) in copy.iter().filter(|(_, row)| row["existing"] == true) {
        let good = actual.goods.iter().find(|good| good.key == *key).unwrap();
        assert_eq!(good.description, row["description"].as_str().unwrap());
    }
    let chew: Vec<_> = actual.goods.iter().filter(|good| good.group.as_deref() == Some("chew")).collect();
    assert_eq!(chew.iter().map(|g| g.key.as_str()).collect::<Vec<_>>(), ["kola", "betel"]);
    assert!(chew.iter().all(|g| g.need.as_deref() == Some("comfort")));
    for name in ["07_coastal_staples.toml", "08_far_luxuries.toml", "09_new_crafts.toml"] {
        assert!(manifest().tables["goods"].contains(&format!("goods/{name}")));
        assert!(!package().join("locales/en/goods").join(name).exists(), "新货按任务单回退中文");
    }
}

#[test]
fn production_chains_are_reachable_and_have_no_consuming_cycle() {
    let g = goods();
    let r = recipes();
    let ids: BTreeMap<_, _> = g.goods.iter().enumerate().map(|(i, g)| (g.key.as_str(), GoodId::from_idx(i))).collect();
    let prices: BTreeMap<_, _> = g.goods.iter().map(|g| (g.key.as_str(), g.base_price)).collect();
    let industries: BTreeSet<_> = r.industries.iter().map(|i| i.key.as_str()).collect();
    let mut reachable = BTreeSet::new();
    let mut defs = Vec::new();
    for recipe in &r.recipes {
        assert!(industries.contains(recipe.industry.as_str()));
        assert!(!recipe.outputs.is_empty());
        for quantities in [&recipe.inputs, &recipe.outputs] {
            let mut seen = BTreeSet::new();
            for q in quantities {
                assert!(q.qty > 0 && ids.contains_key(q.good.as_str()), "{}: {}", recipe.key, q.good);
                assert!(seen.insert(&q.good), "同一侧重复商品 {}", recipe.key);
            }
        }
        if recipe.inputs.is_empty() {
            reachable.extend(recipe.outputs.iter().map(|q| q.good.as_str()));
        } else {
            let value = |qs: &[raw::GoodQty]| qs.iter().map(|q| prices[q.good.as_str()] * q.qty).sum::<i64>();
            let cost = value(&recipe.inputs);
            let revenue = value(&recipe.outputs);
            assert!(revenue * 10 >= cost * 11 && revenue * 2 <= cost * 5, "{} 的基准价投入产出比失衡", recipe.key);
        }
        let convert = |qs: &[raw::GoodQty]| qs.iter().map(|q| (ids[q.good.as_str()], q.qty)).collect();
        defs.push(RecipeDef {
            key: recipe.key.clone(),
            name: recipe.name.clone(),
            industry: IndustryTypeId(0),
            inputs: convert(&recipe.inputs),
            outputs: convert(&recipe.outputs),
        });
    }
    loop {
        let before = reachable.len();
        for recipe in &r.recipes {
            if recipe.inputs.iter().all(|q| reachable.contains(q.good.as_str())) {
                reachable.extend(recipe.outputs.iter().map(|q| q.good.as_str()));
            }
        }
        if reachable.len() == before {
            break;
        }
    }
    let discoveries = BTreeSet::from(["star_crystal", "relics", "orichalcum"]);
    for good in &g.goods {
        assert!(
            reachable.contains(good.key.as_str()) || discoveries.contains(good.key.as_str()),
            "无源商品 {}",
            good.key
        );
    }
    assert!(
        r.recipes.iter().flat_map(|r| &r.inputs).all(|q| !discoveries.contains(q.good.as_str())),
        "关键生产不依赖尚未落地的探索物品"
    );
    let rho = manifest_data::spectral_radius(&manifest_data::input_coefficients(&defs, g.goods.len()));
    assert!(rho < 1.0, "Hawkins–Simon 条件失败: {rho}");
    for (key, required) in [
        ("mix_gunpowder", vec!["saltpeter", "sulfur", "charcoal"]),
        ("cast_cannon", vec!["copper", "tin", "charcoal"]),
        ("print_books", vec!["paper", "lead", "beeswax"]),
        ("make_lacquerware", vec!["planks", "lacquer"]),
        ("press_olive_oil", vec!["olives"]),
    ] {
        let recipe = r.recipes.iter().find(|r| r.key == key).expect("关键工艺");
        assert_eq!(recipe.inputs.iter().map(|q| q.good.as_str()).collect::<Vec<_>>(), required);
    }
}

#[test]
fn workshops_reference_processing_recipes_and_respect_share_limits() {
    let r = recipes();
    let lookup: BTreeMap<_, _> = r.recipes.iter().map(|r| (r.key.as_str(), r)).collect();
    let mut seen = BTreeSet::new();
    let mut shares = BTreeMap::new();
    for (row, meta) in annotated_rows("workshops") {
        let loc = string(&row, "loc");
        let key = string(&row, "recipe");
        assert!(seen.insert((loc.to_owned(), key.to_owned())));
        let recipe = lookup[key];
        assert!(!recipe.inputs.is_empty());
        assert_eq!(recipe.outputs.len(), 1);
        let share = row["share"].as_float().expect("作坊份额");
        assert!(share > 0.0 && share <= 0.9);
        *shares.entry((loc.to_owned(), recipe.outputs[0].good.clone())).or_insert(0.0) += share;
        assert!(!string(&meta, "location_name").is_empty());
    }
    assert!(shares.values().all(|s| *s <= 0.9));
    assert!(seen.contains(&("jingdezhen".to_owned(), "fire_porcelain".to_owned())), "瓷窑挂在实际产地，不伪设广州窑场");
}

#[test]
fn faction_relations_and_company_references_are_consistent() {
    let f: raw::FactionsFile = toml::from_str(&text("factions")).expect("势力");
    let g = goods();
    let s: raw::ShipsFile = toml::from_str(&text("ships")).expect("船型");
    let c: raw::CompaniesFile = toml::from_str(&text("companies")).expect("商会");
    let factions: BTreeSet<_> = f.factions.iter().map(|f| f.key.as_str()).collect();
    let goods: BTreeSet<_> = g.goods.iter().map(|g| g.key.as_str()).collect();
    let ships: BTreeSet<_> = s.ships.iter().filter(|s| !s.unique).map(|s| s.key.as_str()).collect();
    let styles = manifest().art.styles;
    for faction in &f.factions {
        assert!((0.0..=0.5).contains(&faction.tax.value()));
        assert!(faction.license_price >= 0 && faction.marque_price >= 0);
        assert!(styles.contains(faction.style.as_ref().expect("建筑风格")));
        let color = faction.color.as_ref().expect("势力颜色");
        assert!(color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit()));
    }
    let mut pairs = BTreeMap::new();
    for rel in &f.relations {
        assert!(factions.contains(rel.a.as_str()) && factions.contains(rel.b.as_str()));
        assert!(rel.a != rel.b && (-100..=100).contains(&rel.value));
        let mut pair = [rel.a.as_str(), rel.b.as_str()];
        pair.sort();
        assert!(pairs.insert(pair, rel.value).is_none(), "双向关系重复");
    }
    assert!(pairs[&["france", "ottoman"]] > 50);
    assert!(pairs[&["ottoman", "spain"]] < -50);
    assert!(pairs[&["jianzhou", "yehe"]] < -50);
    for company in &c.companies {
        assert!(company.cash > 0 && (0.1..=0.9).contains(&company.risk.value()));
        assert!(!company.ships.is_empty() && company.ships.iter().all(|s| ships.contains(s.as_str())));
        assert!(!company.preferred.is_empty() && company.preferred.iter().all(|g| goods.contains(g.as_str())));
        assert!(matches!(company.forecast.as_deref(), Some("naive" | "trend" | "revert")));
        assert!(matches!(company.reaction.as_deref(), Some("neutral" | "follow" | "avoid")));
        assert!(!company.persona.is_empty());
    }
    for (_, meta) in annotated_rows("companies") {
        assert!(factions.contains(string(&meta, "faction")));
        assert!(factions.contains(string(&meta, "affiliation")));
    }
}

#[test]
fn ordinary_ships_keep_legacy_keys_and_document_their_physical_limits() {
    let classic: raw::ShipsFile = toml::from_str(&read(root().join("ships.toml"))).expect("经典船型");
    let ships: raw::ShipsFile = toml::from_str(&text("ships")).expect("寰宇船型");
    assert_eq!(
        ships.ships[..19].iter().map(|s| &s.key).collect::<Vec<_>>(),
        classic.ships.iter().filter(|s| !s.unique).map(|s| &s.key).collect::<Vec<_>>()
    );
    let ordinary: Vec<_> = ships.ships.iter().filter(|s| !s.unique).collect();
    assert_eq!(ordinary.len(), 35, "既有普通船的数量和物理约束不变");
    let unique: Vec<_> = ships.ships.iter().filter(|s| s.unique).map(|s| s.key.as_str()).collect();
    assert!(unique.is_empty(), "寰宇的普通船型表里没有独有船型：{unique:?}");
    for ship in ordinary {
        assert!(matches!(ship.sail.as_str(), "square" | "lateen"));
        assert!((0.5..=7.0).contains(&ship.speed.value()), "普通船不采用飞剪峰值速度");
        assert!(ship.capacity > 0 && ship.durability > 0 && ship.price > 0);
        assert!(ship.crew_min > 0 && ship.crew_max >= ship.crew_min && ship.guns >= 0);
        assert!(!ship.description.is_empty());
    }
    assert!((5.0..=7.0).contains(&ships.ships[0].speed.value()));
    let companies: raw::CompaniesFile = toml::from_str(&text("companies")).expect("商会");
    for (row, meta) in annotated_rows("ships") {
        assert!(meta["draft_cm"].as_integer().expect("设计吃水") > 0);
        assert!(matches!(string(&meta, "propulsion"), "sail" | "oar" | "mixed"));
        assert!(matches!(string(&meta, "seaworthiness"), "coastal" | "sea" | "ocean"));
        if meta.get("available_from").and_then(toml::Value::as_integer).is_some_and(|year| year > 1553) {
            assert!(
                companies.companies.iter().all(|c| !c.ships.iter().any(|k| k == string(&row, "key"))),
                "后期船型不能成为开局商会船"
            );
        }
    }
}

#[test]
fn every_record_has_a_basis_and_sources_and_every_good_has_origin_and_policy_notes() {
    for table in ["goods", "industries", "recipes", "workshops", "factions", "relations", "companies", "ships"] {
        let rows = annotated_rows(table);
        assert!(!rows.is_empty(), "{table}");
        for (row, meta) in rows {
            assert!(matches!(string(&meta, "basis"), "historical" | "literature" | "extended"), "{table}: {row:?}");
            let sources = meta["sources"].as_array().expect("出处数组");
            assert!(!sources.is_empty() && sources.iter().all(|s| s.as_str().is_some_and(|s| !s.trim().is_empty())));
            if table == "goods" {
                for key in ["origin_regions", "origin_cultures"] {
                    assert!(!meta[key].as_array().expect("产地数组").is_empty());
                }
                assert!(!string(&meta, "trade_policy").is_empty());
            }
        }
    }
}

#[test]
fn english_names_cover_exactly_the_same_keys_without_overriding_gameplay() {
    let m = manifest();
    for paths in m.tables.values() {
        for rel in paths {
            let mut base: toml::Table = toml::from_str(&read(package().join(rel))).expect("中文分片");
            if base.contains_key("key") && base.contains_key("curriculum") {
                base =
                    toml::Table::from_iter([("academies".into(), toml::Value::Array(vec![toml::Value::Table(base)]))]);
            }
            let english = package().join("locales/en").join(rel);
            if !english.exists() {
                assert!(!m.requires_english(), "双语世界缺少英文分片：{rel}");
                continue;
            }
            let overlay: toml::Table = toml::from_str(&read(&english)).expect("同名英文分片");
            let display_count = worlds::validate_story_translation_for_world(
                &m,
                rel,
                &read(package().join(rel)),
                &read(package().join("locales/en").join(rel)),
            )
            .unwrap_or_else(|error| panic!("{error}"));
            if (rel.starts_with("upbringing/") && base.contains_key("format_version"))
                || rel.starts_with("history/")
                || rel == "ideas.toml"
            {
                assert_native_display(rel, &base, &overlay, display_count);
                continue;
            }
            // B9新增的C12带元信息和严格剧本，与原条目数组形状不同；仍独立核对每个显示键。
            if rel == "regions.toml" || rel.starts_with("scenarios/") {
                if base.contains_key("start_date") {
                    assert_eq!(overlay.keys().map(String::as_str).collect::<Vec<_>>(), ["description", "name"]);
                } else {
                    let groups: &[&str] = if rel == "regions.toml" {
                        &["regions", "knowledge_groups"]
                    } else {
                        &["opening_catalog", "scenario_labels"]
                    };
                    assert_eq!(
                        overlay.keys().map(String::as_str).collect::<BTreeSet<_>>(),
                        groups.iter().copied().collect()
                    );
                    for &group in groups {
                        let originals = base[group].as_array().expect("C12条目");
                        let translations = overlay[group].as_table().expect("C12显示键");
                        assert_eq!(
                            translations.keys().map(String::as_str).collect::<BTreeSet<_>>(),
                            originals.iter().map(|r| r["key"].as_str().expect("key")).collect()
                        );
                        for row in originals {
                            assert_new_display_leaves(row, &translations[row["key"].as_str().expect("key")]);
                        }
                    }
                }
                continue;
            }
            let mut expected_tables = BTreeSet::new();
            if let Some(goods) = base.get("goods").and_then(toml::Value::as_array) {
                expected_tables.insert("categories".to_owned());
                let categories = overlay["categories"].as_table().expect("英文商品类别");
                assert_eq!(
                    categories.keys().map(String::as_str).collect::<BTreeSet<_>>(),
                    goods.iter().map(|row| row["category"].as_str().expect("商品类别")).collect(),
                    "{rel} 类别必须一一对应"
                );
                for name in categories.values() {
                    let name = name.as_str().expect("英文类别字符串");
                    assert!(!name.trim().is_empty() && name.chars().all(|c| !('\u{4e00}'..='\u{9fff}').contains(&c)));
                }
            }
            for (table, rows) in base {
                let rows = rows.as_array().expect("条目表");
                if rows.is_empty() {
                    assert!(!overlay.contains_key(&table), "{rel} 的空表不能增加英文条目");
                    continue;
                }
                // C1 的简介、人设与新增内容一样逐字段核对。
                let display_fields: Option<&[&str]> = match table.as_str() {
                    "goods" | "ships" => Some(&["name", "description"]),
                    "companies" => Some(&["name", "persona"]),
                    "mates" => Some(&["name", "bio"]),
                    "persons" => Some(&["name", "persona", "lines"]),
                    "past" => Some(&["name", "lore"]),
                    "sets" => Some(&["name", "title"]),
                    "auctions" => Some(&["name", "lore", "lots", "bidders", "specials"]),
                    "ports" => Some(&["name", "lore", "river"]),
                    "cities" | "discoveries" | "sites" | "items" => Some(&["name", "lore"]),
                    "roads" => Some(&["lore", "via"]),
                    _ => None,
                };
                if display_fields.is_none() && table != "ties" && rows.iter().all(|r| r.get("name").is_none()) {
                    continue;
                }
                expected_tables.insert(table.clone());
                let translated = overlay[&table].as_table().expect("key 形式覆盖");
                let expected: BTreeSet<_> = rows.iter().map(|r| r["key"].as_str().expect("key")).collect();
                assert_eq!(translated.keys().map(String::as_str).collect::<BTreeSet<_>>(), expected, "{rel}");
                for original in rows {
                    let key = original["key"].as_str().expect("key");
                    let row = translated[key].as_table().expect("英文条目");
                    if matches!(
                        table.as_str(),
                        "tracks"
                            | "ties"
                            | "skills"
                            | "academies"
                            | "upbringing_rules"
                            | "ratings"
                            | "activities"
                            | "crafts"
                            | "aspirations"
                            | "contests"
                            | "poem_lexicons"
                            | "endings"
                            | "vignettes"
                            | "exams"
                            | "outings"
                            | "festivals"
                    ) || (table == "persons" && original["kind"].as_str() != Some("historical"))
                    {
                        let mut covered = original.clone();
                        if table == "tracks" && !m.requires_english() {
                            let english_chapters = row["chapters"].as_table().expect("已有章覆盖");
                            covered["chapters"]
                                .as_array_mut()
                                .expect("故事章节")
                                .retain(|c| english_chapters.contains_key(c["key"].as_str().expect("章节键")));
                        }
                        assert_new_display_leaves(&covered, &translated[key]);
                        continue;
                    }
                    if let Some(fields) = display_fields {
                        let expected: BTreeSet<_> =
                            fields.iter().copied().filter(|field| original.get(*field).is_some()).collect();
                        assert_eq!(row.keys().map(String::as_str).collect::<BTreeSet<_>>(), expected, "{rel}/{key}");
                        for (field, value) in row {
                            if matches!(field.as_str(), "lines" | "lots" | "bidders" | "specials") {
                                // 生产入口逐句检查翻译，此处独立核对嵌套稳定键的集合。
                                let expected = if field == "lines" {
                                    original[field]
                                        .as_table()
                                        .expect("中文台词")
                                        .keys()
                                        .map(String::as_str)
                                        .collect::<BTreeSet<_>>()
                                } else {
                                    original[field]
                                        .as_array()
                                        .expect("中文拍卖条目")
                                        .iter()
                                        .map(|entry| {
                                            entry
                                                .get("item")
                                                .or_else(|| entry.get("person"))
                                                .and_then(toml::Value::as_str)
                                                .expect("稳定引用键")
                                        })
                                        .collect()
                                };
                                assert_eq!(
                                    value
                                        .as_table()
                                        .expect("英文嵌套条目")
                                        .keys()
                                        .map(String::as_str)
                                        .collect::<BTreeSet<_>>(),
                                    expected
                                );
                                continue;
                            }
                            let strings: Vec<&str> = if field == "via" {
                                let values = value.as_array().expect("途经点数组");
                                assert_eq!(
                                    values.len(),
                                    original[field.as_str()].as_array().expect("中文途经点").len()
                                );
                                values.iter().map(|v| v.as_str().expect("英文途经点")).collect()
                            } else {
                                vec![value.as_str().expect("英文显示字符串")]
                            };
                            for text in strings {
                                assert!(
                                    !text.trim().is_empty()
                                        && text.chars().all(|c| !('\u{4e00}'..='\u{9fff}').contains(&c)),
                                    "{rel}/{key}/{field} 缺少英文"
                                );
                            }
                        }
                    } else {
                        assert!(
                            row.keys().all(|k| matches!(k.as_str(), "name" | "description" | "persona")),
                            "英文不可覆盖数值"
                        );
                        let name = string(row, "name");
                        assert!(
                            !name.trim().is_empty() && name.chars().all(|c| !('\u{4e00}'..='\u{9fff}').contains(&c))
                        );
                    }
                }
            }
            assert_eq!(overlay.keys().cloned().collect::<BTreeSet<_>>(), expected_tables, "额外英文表 {rel}");
        }
    }
}

// 原生 C8/C10 用独立显示表；生产 schema 保证完整键集，此处独立检查所有叶子并逐文件验证反例。
fn assert_native_display(rel: &str, base: &toml::Table, overlay: &toml::Table, expected: usize) {
    let source = toml::to_string(base).unwrap();
    if rel.starts_with("history/") {
        let native: manifest_core::history::HistoryDefs = toml::from_str(&source).expect("严格原生 C10 历史");
        assert!(!native.events.is_empty());
    } else if rel == "ideas.toml" {
        let native: manifest_core::ideas::IdeasDefs = toml::from_str(&source).expect("严格原生 C10 思想");
        assert!(!native.ideas.is_empty());
        assert!(!native.ports.is_empty());
    } else {
        let native: manifest_core::upbringing::UpbringingDefs = toml::from_str(&source).expect("严格原生 C8");
        assert_eq!(native.format_version, Some(1));
    }
    // 剧情章节可以嵌套（`[tracks."<轨道>".chapters."<章>"]`，十二个自定义出身的开场轨道就是这种写法）：
    // 逐层走到每个叶子，叶子都必须是非空英文字符串，数目与运行时校验数出的显示字段一致。
    fn collect(path: &mut Vec<String>, value: &toml::Value, leaves: &mut Vec<Vec<String>>) {
        if let Some(table) = value.as_table() {
            for (key, child) in table {
                path.push(key.clone());
                collect(path, child, leaves);
                path.pop();
            }
        } else {
            let text = value.as_str().expect("英文不可覆盖玩法数值");
            assert!(!text.trim().is_empty() && !text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)));
            leaves.push(path.clone());
        }
    }
    // 叶子所在的那一层表（反例里删掉它或换成数值）。
    fn parent<'a>(table: &'a mut toml::Table, path: &[String]) -> &'a mut toml::Table {
        match path {
            [_] => table,
            [head, rest @ ..] => parent(table.get_mut(head).unwrap().as_table_mut().unwrap(), rest),
            [] => unreachable!(),
        }
    }
    let mut leaves = Vec::new();
    for (table, entries) in overlay {
        assert!(entries.is_table(), "英文显示表");
        collect(&mut vec![table.clone()], entries, &mut leaves);
    }
    assert!(leaves.iter().all(|path| path.len() >= 3), "{rel} 显示字段至少是 表 / 键 / 字段 三层");
    assert_eq!(leaves.len(), expected, "{rel} 每个生产显示字段都须独立核对");
    let reject = |broken: &toml::Table| {
        assert!(worlds::validate_draft_translation(rel, &source, &toml::to_string(broken).unwrap()).is_err());
    };
    let mut extra = overlay.clone();
    extra.insert("unknown_gameplay".into(), toml::Value::Integer(1));
    reject(&extra);
    if let Some(path) = leaves.first() {
        let field = path.last().unwrap();
        let mut missing = overlay.clone();
        parent(&mut missing, path).remove(field);
        reject(&missing);
        let mut numeric = overlay.clone();
        parent(&mut numeric, path).insert(field.clone(), toml::Value::Integer(99));
        reject(&numeric);
    }
}

// 新作者格式保留嵌套数组；逐叶确认英文只覆盖原有字符串，不能改稳定标识或数值。
fn assert_new_display_leaves(source: &toml::Value, english: &toml::Value) {
    match english {
        toml::Value::Table(fields) if source.is_array() => {
            let originals = source.as_array().expect("原始稳定键列表");
            assert_eq!(
                fields.keys().map(String::as_str).collect::<BTreeSet<_>>(),
                originals.iter().map(|r| r["key"].as_str().expect("稳定键")).collect()
            );
            for original in originals {
                assert_new_display_leaves(original, &fields[original["key"].as_str().expect("稳定键")]);
            }
        }
        toml::Value::Table(fields) => {
            for (key, value) in fields {
                let original = source.get(key).unwrap_or_else(|| panic!("额外英文字段 {key}"));
                if matches!(key.as_str(), "key" | "rank") {
                    assert_eq!(original, value, "稳定标识不可覆盖");
                } else {
                    assert_new_display_leaves(original, value);
                }
            }
        }
        toml::Value::Array(values) => {
            let originals = source.as_array().expect("原始列表");
            assert_eq!(originals.len(), values.len());
            for (original, translated) in originals.iter().zip(values) {
                assert_new_display_leaves(original, translated);
            }
        }
        toml::Value::String(text) => {
            assert!(source.is_str(), "不能用英文覆盖玩法数值");
            assert!(!text.trim().is_empty() && !text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)));
        }
        _ => panic!("英文不得包含玩法数值"),
    }
}

#[test]
fn c6_c8_register_all_native_fragments_with_matching_english() {
    let m = manifest();
    // 养成内容（2026-11-03）：人物加七份 upbringing/families/<主角>_growth_persons.toml（64 → 71），
    // 养成分片加九份 <主角>_growth.toml（96 → 105）；U02 工作包 4 的战斗练习 upbringing/common_practices.toml（105 → 106）。
    // 公开版拿掉一份只放已删人物的分片：71 → 70。
    assert_eq!(m.tables["persons"].len(), 70);
    assert_eq!(m.tables["ties"], ["cast/ties.toml"]);
    assert_eq!(m.tables["skills"], ["skills.toml"]);
    // 2026-11-04：U04 两份数据、低谷场景与三份改投学院的事件（106 → 112）。
    assert_eq!(m.tables["upbringing"].len(), 122);
    assert_eq!(m.tables["upbringing"].iter().filter(|p| p.starts_with("upbringing/academies/")).count(), 23);
    let declared: BTreeSet<_> = m.tables.values().flatten().cloned().collect();
    // 354个既有分片 + E65的港口/船型/人物/故事各1片及航海士2片（+6）+ C9 的家庭/事件/人物/文化池 71 片 + C10 六份历史分片与一份思想定义（+7）+ C11 两轮 18 片（其中故事 4 片）= 456；
    // C13 整合（2026-10-26）登记主线与模板小线 23 片、NPC 线与主角关系线 15 片、请托 269 片（+307）= 763。
    // C11 收尾（2026-11-01）：接回 C7 的 6 条关系线、新写 2 条，加人物片与关系片各 1（+10）= 773；十个亚特兰蒂斯补章接回（+10）= 783。
    // A10（2026-11-02）再登记 18 份提示词与 18 份离线模板（+36） = 819。
    // 养成内容（2026-11-03）：九份 <主角>_growth.toml 与七份 <主角>_growth_persons.toml（819 → 835）。
    // 合并 G01 的三份商品、一份配方、一份工坊：再加 5 份。
    // U02 工作包 4 的战斗练习 upbringing/common_practices.toml 登记进清单：再加 1 份（840 → 841）。
    // 2026-11-04：养成 6 份加比赛奖品 1 份（841 → 848）。
    // S01（2026-11-10）：出海后的奇遇两份（stories/encounters_sea.toml、encounters_port.toml）：848 → 850。
    // I01（2026-11-11）：新物品九个分片登记，+9；I03：寰宇船只改装 ships/09_refits.toml，+1 = 860。
    // H04（2026-11-11）：海上所见 voyage/sightings.toml 登记，+1 = 861。
    // H08（2026-11-11）：甲板闲话 voyage/banter.toml 登记，+1 = 862。
    // G02（2026-11-11）：交易品扩充的商品分片与来源配方分片，+2 = 864。
    // H02（2026-11-11）：船员情绪的三阶段 stories/voyage_crew.toml 登记，+1 = 865。
    // 公开版拿掉两个人物以后少 14 个登记分片：880 → 866。
    assert_eq!(declared.len(), 866);
    assert_eq!(m.tables["history"].len(), 6);
    assert_eq!(m.tables["ideas"], ["ideas.toml"]);
    // C7 153 片 + E65 1 片 + C11 4 片 = 158；C13 整合 +307 = 465；C11 收尾接回 6 片、新写 2 片 = 473；亚特兰蒂斯补章接回 +10 = 483。
    // S01（2026-11-10）：出海后的奇遇两份（旧式剧情文件，没有 tracks，只写中文）+2 = 485。
    // H02（2026-11-11）：船员情绪的三阶段 stories/voyage_crew.toml（旧式奇遇文件，只写中文）+1 = 486。
    // 公开版拿掉两个人物以后少 10 份故事分片：489 → 479。
    assert_eq!(m.tables["stories"].len(), 479);
    fn collect(dir: &Path, base: &Path, files: &mut BTreeSet<String>) {
        if !dir.exists() {
            assert_eq!(dir.file_name().and_then(|s| s.to_str()), Some("stories"), "只有撤销的 C7 目录可不存在");
            return;
        }
        for entry in std::fs::read_dir(dir).expect("分片目录") {
            let path = entry.expect("分片").path();
            if path.is_dir() {
                collect(&path, base, files);
            } else if path.extension().is_some_and(|ext| ext == "toml") {
                files.insert(path.strip_prefix(base).expect("相对路径").to_string_lossy().replace('\\', "/"));
            }
        }
    }
    for dir in ["cast", "upbringing", "stories", "history", "prompts", "templates"] {
        let mut delivered = BTreeSet::new();
        collect(&package().join(dir), &package(), &mut delivered);
        let mut registered: BTreeSet<_> =
            declared.iter().filter(|p| p.starts_with(&format!("{dir}/"))).cloned().collect();
        // FIX8 6ff702c3：成品世界的立绘目录由 cast_sources 自动读，不占原生玩法分片登记。
        if dir == "cast" {
            registered.insert("cast/figures.toml".into());
        }
        assert_eq!(registered, delivered);
        for rel in delivered {
            let english = package().join("locales/en").join(&rel);
            if english.exists() {
                worlds::validate_story_translation_for_world(&m, &rel, &read(package().join(&rel)), &read(&english))
                    .unwrap();
            } else {
                assert!(!m.requires_english(), "双语世界缺少英文分片：{rel}");
            }
        }
    }
}

#[test]
fn classic_simulation_hash_is_unchanged_by_the_content_package() {
    let world = manifest_data::resolve_world(&root(), "classic").expect("经典世界");
    assert_eq!(
        world.hash(false).expect("经典哈希"),
        "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35"
    );
}

#[test]
fn c5_registers_persons_past_and_the_embedded_schedules_and_requests() {
    let m = manifest();
    assert_eq!(m.tables["persons"].iter().filter(|path| path.starts_with("cast/historical_")).count(), 9);
    assert_eq!(m.tables["past"], ["cast/historical_00_past.toml"]);
    let people: toml::Table = toml::from_str(&text("persons")).expect("人物分片");
    let past: toml::Table = toml::from_str(&text("past")).expect("往事分片");
    let people: Vec<_> = people["persons"]
        .as_array()
        .expect("人物数组")
        .iter()
        .filter(|p| p["kind"].as_str() == Some("historical"))
        .collect();
    assert_eq!(people.len(), 340);
    assert_eq!(past["past"].as_array().expect("往事数组").len(), 53);
    // C13 整合（2026-10-26）把赛义达·胡拉 1553—1560 的一段日程拆成舍夫沙万与得土安两段：576 → 577。
    assert_eq!(people.iter().map(|person| person["schedule"].as_array().expect("日程").len()).sum::<usize>(), 577);
    assert_eq!(people.iter().map(|person| person["tracks"].as_array().expect("请托轨道").len()).sum::<usize>(), 113);
}

#[test]
fn c2_handoff_covers_every_location_and_its_required_market_goods() {
    let handoff = read(package().join("C1-HANDOFF.md"));
    let mut ports = BTreeMap::new();
    let split_goods = |text: &str| -> BTreeSet<String> {
        if text == "—" { BTreeSet::new() } else { text.split(", ").map(str::to_owned).collect() }
    };
    for line in handoff.lines().filter(|s| s.starts_with("| `")) {
        let fields: Vec<_> = line.split('|').map(str::trim).collect();
        assert_eq!(fields.len(), 7, "C2地点契约表应有5列");
        let key = fields[1].trim_matches('`').to_owned();
        let faction = fields[3].trim_matches('`').to_owned();
        assert!(ports.insert(key, (faction, split_goods(fields[4]), split_goods(fields[5]))).is_none());
    }
    assert_eq!(ports.len(), 29, "28港口和1内陆城市");
    // 原 C1 交接文档保持原样；以 Claude 的 G01 草稿独立追加新契约，仍逐港严格比较集合。
    let draft: Vec<serde_json::Value> =
        serde_json::from_str(&read(root().join("../docs/drafts/goods-expansion.json"))).unwrap();
    let fixes: serde_json::Value =
        serde_json::from_str(&read(root().join("../docs/drafts/goods-existing-fixes.json"))).unwrap();
    let mut actual_factions = BTreeMap::new();
    for table in ["ports", "cities"] {
        let data: toml::Value = toml::from_str(&text(table)).unwrap();
        for row in data[table].as_array().unwrap() {
            actual_factions
                .insert(row["key"].as_str().unwrap().to_owned(), row["faction"].as_str().unwrap().to_owned());
        }
    }
    for row in &draft {
        let chains = match &row["chain"] {
            serde_json::Value::Object(_) => vec![&row["chain"]],
            serde_json::Value::Array(chains) => chains.iter().collect(),
            _ => Vec::new(),
        };
        for chain in chains {
            let replacement =
                fixes["recipe_changes"].as_array().unwrap().iter().find(|r| r["recipe_key"] == chain["recipe_key"]);
            let inputs = replacement.unwrap_or(chain)["inputs"].as_array().unwrap();
            for loc in chain["workshop_ports"].as_array().unwrap() {
                let loc = loc.as_str().unwrap();
                let entry = ports
                    .entry(loc.to_owned())
                    .or_insert_with(|| (actual_factions[loc].clone(), BTreeSet::new(), BTreeSet::new()));
                entry.1.extend(inputs.iter().map(|q| q["good"].as_str().unwrap().to_owned()));
                entry.2.insert(chain["output"]["good"].as_str().unwrap().to_owned());
            }
        }
    }
    let venice = ports.get_mut("venice").unwrap();
    assert!(venice.1.remove("whale_oil"), "原交接确实以鲸油供玻璃灯");
    venice.1.insert("olive_oil".to_owned());
    assert_eq!(ports.len(), 40, "原29个工坊/商会地点，加G01的11个地点");
    let factions: raw::FactionsFile = toml::from_str(&text("factions")).expect("势力");
    let valid: BTreeSet<_> = factions.factions.iter().map(|f| &f.key).collect();
    assert!(ports.values().all(|(f, _, _)| valid.contains(f)));
    let r = recipes();
    let recipes: BTreeMap<_, _> = r.recipes.iter().map(|r| (r.key.as_str(), r)).collect();
    let mut locations = BTreeSet::new();
    let mut required: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)> = BTreeMap::new();
    for (row, _) in annotated_rows("workshops") {
        let loc = string(&row, "loc");
        locations.insert(loc.to_owned());
        let recipe = recipes[string(&row, "recipe")];
        let (inputs, outputs) = required.entry(loc.to_owned()).or_default();
        inputs.extend(recipe.inputs.iter().map(|q| q.good.clone()));
        outputs.extend(recipe.outputs.iter().map(|q| q.good.clone()));
    }
    for (row, meta) in annotated_rows("companies") {
        let loc = string(&row, "home");
        locations.insert(loc.to_owned());
        assert_eq!(ports[loc].0, string(&meta, "faction"), "商会势力与本据契约不符");
    }
    assert_eq!(locations, ports.keys().cloned().collect());
    for (loc, (_, inputs, outputs)) in ports {
        assert_eq!((inputs, outputs), required.remove(&loc).unwrap_or_default(), "{loc} 的市场交接漏货或多货");
    }
    assert!(required.is_empty());
}
