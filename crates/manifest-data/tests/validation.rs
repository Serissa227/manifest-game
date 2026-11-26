//! 测试 12：data/ 全部通过校验；故意损坏的样例数据会被拒绝并给出可读错误。

use std::path::{Path, PathBuf};

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 复制一份 data/，对某个文件做替换后加载，返回错误文本。
fn corrupt(rel: &str, from: &str, to: &str) -> String {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().to_path_buf(), |p, part| p.join(part));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    match manifest_data::load(tmp.path()) {
        Ok(_) => panic!("损坏的数据（{rel}：{from} → {to}）应被拒绝"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn real_data_passes_validation() {
    let defs = manifest_data::load(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    let ports = defs.locations.iter().filter(|l| l.is_port()).count();
    assert!(ports >= 8, "M1 至少 8 个港口");
    assert!(defs.goods.len() >= 12, "M1 至少 12 种商品");
    assert!(defs.ships.len() >= 4, "M1 至少 4 种船型");
    assert!(defs.companies.len() >= 3, "M1 至少 3 家商会");
    assert_eq!(defs.meta.hash.len(), 64);
    // M2 内容量
    let cities = defs.locations.len() - ports;
    assert!(ports >= 14, "M2 至少 14 个港口");
    assert!(cities >= 5, "M2 至少 5 个内陆城市");
    assert!(defs.goods.len() >= 20, "M2 至少 20 种商品");
    assert!(defs.exchanges.len() >= 2, "M2 至少 2 个期货交易所");
    assert!(defs.factions.len() >= 4, "M2 至少 4 个势力");
    assert!(three_level_chains(&defs) >= 2, "M2 至少 2 条三级生产链");
    // 第 5 节最终内容量（M5）
    let processed = defs.goods.iter().filter(|g| g.tier >= 1).count();
    assert!(ports >= 20, "至少 20 个港口");
    assert!(cities >= 8, "至少 8 个内陆城市");
    assert!(defs.goods.len() >= 30 && processed >= 8, "至少 30 种商品，其中至少 8 种加工品");
    assert!(three_level_chains(&defs) >= 3, "至少 3 条三级生产链");
    assert!(defs.ships.len() >= 8, "至少 8 种船型");
    assert!(defs.factions.len() >= 4, "至少 4 个势力");
    assert!(defs.companies.len() >= 6, "至少 6 家 NPC 商会");
    assert!(defs.mates.len() >= 12, "至少 12 名航海士");
    assert!(defs.events.len() >= 20, "至少 20 种事件类型");
    assert!(defs.scenarios.len() >= 3, "至少 3 个开局剧本");
    assert!(defs.exchanges.len() >= 2, "至少 2 个期货交易所");
    assert!(!defs.rules.pirates.ships.is_empty());
    assert!(defs.scenarios.iter().any(|s| s.goal.kind == manifest_core::defs::GoalKind::Sandbox));
    assert!(defs.scenarios.iter().any(|s| !s.mates.is_empty()));
}

/// 统计三级生产链：原料 →（配方）→ 一级 → 二级 → 三级加工品。
fn three_level_chains(defs: &manifest_core::StaticData) -> usize {
    use manifest_core::ids::GoodId;
    let made_from = |out: GoodId, input_tier: u8| -> Vec<GoodId> {
        defs.recipes
            .iter()
            .filter(|r| r.outputs.iter().any(|(g, _)| *g == out))
            .flat_map(|r| r.inputs.iter().map(|(g, _)| *g))
            .filter(|g| defs.good(*g).tier == input_tier)
            .collect()
    };
    defs.good_ids()
        .filter(|g| defs.good(*g).tier == 3)
        .filter(|g3| {
            made_from(*g3, 2).iter().any(|g2| made_from(*g2, 1).iter().any(|g1| !made_from(*g1, 0).is_empty()))
        })
        .count()
}

#[test]
fn corrupted_samples_are_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &str, &[&str])] = &[
        ("goods.toml", "base_price = 12", "base_price = -12", &["goods.toml", "goods[grain]", "base_price"]),
        ("goods.toml", "key = \"timber\"", "key = \"grain\"", &["goods.toml", "key 重复"]),
        ("world/ports.toml", "faction = \"cuilan\"", "faction = \"atlantis\"", &["ports.toml", "atlantis", "势力"]),
        ("world/ports.toml", "good = \"grain\"", "good = \"unobtainium\"", &["ports.toml", "unobtainium", "商品"]),
        ("companies.toml", "home = \"chenggang\"", "home = \"lancheng\"", &["companies.toml", "lancheng", "港口"]),
        ("ships.toml", "sail = \"lateen\"", "sail = \"oars\"", &["ships.toml", "oars"]),
        ("rules.toml", "price_floor = 0.2", "price_floor = 9.0", &["rules.toml", "price_floor"]),
        ("world/regions.toml", "wind = \"E\"", "wind = \"UP\"", &["regions.toml", "UP"]),
        ("goods.toml", "tier = 0", "tier = 0\ncolour = \"red\"", &["goods.toml", "colour"]),
        // 本地生产者（ECONOMY.md 6.3）：系数越界、作物标记的类型不对
        ("rules.toml", "kappa = 0.2", "kappa = 3", &["rules.toml", "producers.kappa"]),
        ("rules.toml", "max_ratio = 2.5", "max_ratio = 0.5", &["rules.toml", "producers.max_ratio"]),
        // （文件头的注释里也写着 crop = true，替换目标带上前一行）
        ("goods.toml", "tier = 0\ncrop = true", "tier = 0\ncrop = \"yes\"", &["goods.toml", "crop"]),
        ("scenarios/01_newcomer.toml", "crew = 14", "crew = 999", &["01_newcomer.toml", "crew"]),
        ("world/roads.toml", "from = \"lancheng\"", "from = \"nowhere\"", &["roads.toml", "nowhere", "地点"]),
        ("futures.toml", "good = \"tea\"", "good = \"cotton\"", &["futures.toml", "jinsuigang", "cotton"]),
        (
            "recipes.toml",
            "industry = \"workshop\"",
            "industry = \"shipyard\"",
            &["recipes.toml", "shipyard", "产业类型"],
        ),
        ("caravans.toml", "capacity = 4", "capacity = 0", &["caravans.toml", "animals[mule]"]),
        ("rules.toml", "tension_below = -30", "tension_below = -80", &["rules.toml", "diplomacy"]),
        ("factions.toml", "value = 10", "value = 500", &["factions.toml", "relations[cuilan-jinsui]"]),
        ("mates.toml", "home = \"chenggang\"", "home = \"lancheng\"", &["mates.toml", "mates[lin_haiyan]", "港口"]),
        ("mates.toml", "navigation = 62", "navigation = 162", &["mates.toml", "navigation"]),
        (
            "mates.toml",
            "methods = [\"linear\", \"ar1\"]",
            "methods = [\"linear\", \"crystal_ball\"]",
            &["mates.toml", "mates[karim_alnajmi]", "crystal_ball", "算学奇才"],
        ),
        (
            "mates.toml",
            "methods = [\"ses\", \"holt\", \"hw\"]",
            "methods = [\"ses\", \"ses\"]",
            &["mates.toml", "mates[shen_zhiwei]", "重复"],
        ),
        (
            "mates.toml",
            "loyalty = 70",
            "loyalty = 70
mood = 1",
            &["mates.toml", "mood"],
        ),
        (
            "scenarios/01_newcomer.toml",
            "mates = [\"lin_haiyan\"]",
            "mates = [\"nobody\"]",
            &["01_newcomer.toml", "航海士", "nobody"],
        ),
        ("scenarios/01_newcomer.toml", "kind = \"net_worth\"", "kind = \"fame\"", &["01_newcomer.toml", "goal.kind"]),
        ("scenarios/02_heir.toml", "jinsui = 20", "atlantis = 20", &["02_heir.toml", "atlantis", "势力"]),
        (
            "rules.toml",
            "sight = 6                    # 发现商船",
            "sight = 60                   # 发现商船",
            &["rules.toml", "pirates"],
        ),
        (
            "rules.toml",
            "ships = [\"swallow\", \"silvergull\", \"tradewind\"]",
            "ships = [\"kraken\"]",
            &["rules.toml", "pirates.ships", "kraken"],
        ),
        // 第八批 E4（ECONOMY.md 6.4、6.5）：需求层级与替代组、人口与工坊的规则、口粮商品、城镇工坊、投入产出
        ("goods.toml", "need = \"essential\"", "need = \"vital\"", &["goods.toml", "goods[grain]", "vital"]),
        (
            "goods.toml",
            "need = \"comfort\"
group = \"brew\"",
            "need = \"luxury\"
group = \"brew\"",
            &["goods.toml", "brew", "层级不一致"],
        ),
        ("goods.toml", "group = \"smoke\"", "group = \"pipe\"", &["goods.toml", "pipe", "至少要有两种商品"]),
        ("rules.toml", "weights = [0.5, 0.3, 0.2]", "weights = [0.5, 0.3, 0.3]", &["rules.toml", "population.weights"]),
        ("rules.toml", "boom = [62, 58]", "boom = [58, 62]", &["rules.toml", "population.boom"]),
        ("rules.toml", "restart_above = 1.05", "restart_above = 0.9", &["rules.toml", "workshops.restart_above"]),
        (
            "rules.toml",
            "goods = [\"grain\", \"maize\", \"potato\", \"fish\"]",
            "goods = [\"grain\", \"ambrosia\"]",
            &["rules.toml", "provisions.goods", "ambrosia"],
        ),
        ("workshops.toml", "loc = \"chenggang\"", "loc = \"atlantis\"", &["workshops.toml", "atlantis", "地点"]),
        (
            "workshops.toml",
            "recipe = \"make_wine\"",
            "recipe = \"tailor\"",
            &["workshops.toml", "chenggang", "产出须在当地交易"],
        ),
        ("workshops.toml", "recipe = \"make_wine\"", "recipe = \"grow_grain\"", &["workshops.toml", "采集类配方"]),
        ("workshops.toml", "share = 0.5", "share = 1.5", &["workshops.toml", "share"]),
        // 第八批 E5（ECONOMY.md 6.6、6.7）：本地商人的系数、商会 2.0 的上限、商会的预测方法与反应
        ("rules.toml", "hoard_base = 0.1", "hoard_base = 0.5", &["rules.toml", "merchants.hoard_base"]),
        ("rules.toml", "intensity = 0.4", "intensity = 40", &["rules.toml", "merchants.intensity"]),
        ("rules.toml", "max_fleets_cap = 8", "max_fleets_cap = 2", &["rules.toml", "npc.v2.max_fleets_cap"]),
        ("companies.toml", "forecast = \"trend\"", "forecast = \"tea_leaves\"", &["companies.toml", "tea_leaves"]),
        ("companies.toml", "reaction = \"follow\"", "reaction = \"sulk\"", &["companies.toml", "sulk"]),
        // 织布改成用棉布织棉布（8 件换 5 件）：生产网络净消耗自己的产出
        (
            "recipes.toml",
            "inputs = [{ good = \"yarn\", qty = 8 }]",
            "inputs = [{ good = \"cloth\", qty = 8 }]",
            &["recipes.toml", "Hawkins–Simon"],
        ),
    ];
    for (rel, from, to, needles) in cases {
        let msg = corrupt(rel, from, to);
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
}

#[test]
fn input_output_check_finds_the_spectral_radius() {
    use manifest_data::spectral_radius;
    // 链状（有向无环）的配方网络：幂零矩阵，谱半径为 0
    assert_eq!(spectral_radius(&[vec![0.0, 2.0], vec![0.0, 0.0]]), 0.0);
    // 两种商品互为原料：谱半径 = √(a × b)
    let rho = spectral_radius(&[vec![0.0, 0.5], vec![0.5, 0.0]]);
    assert!((rho - 0.5).abs() < 1e-6, "{rho}");
    let rho = spectral_radius(&[vec![0.0, 2.0], vec![0.72, 0.0]]);
    assert!((rho - 1.2).abs() < 1e-6, "{rho}");
    // 自己的产出作原料
    let rho = spectral_radius(&[vec![0.3, 0.0, 0.0], vec![1.0, 0.0, 0.0], vec![0.0, 4.0, 0.9]]);
    assert!((rho - 0.9).abs() < 1e-3, "{rho}");
}

#[test]
fn processing_recipes_add_value_at_base_prices() {
    // 对偶价格检查（ECONOMY.md 6.5）：正式数据里每个加工配方按基准价的产出价值 / 原料价值都在 1–2.5 倍之间（validate-data 没有警告）
    let defs = manifest_data::load(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    let mut checked = 0;
    for r in &defs.recipes {
        let Some(v) = manifest_data::recipe_value_ratio(r, &defs.goods) else { continue };
        assert!((1.0..=2.5).contains(&v), "配方 {}：产出价值 / 原料价值 = {v:.2}", r.key);
        checked += 1;
    }
    assert!(checked >= 25, "加工配方 {checked} 个");
    // 需求层级：三层都有商品；替代组的商品同层
    let tiers = manifest_data::need_counts(&defs.goods);
    assert!(tiers.iter().all(|n| *n >= 5), "{tiers:?}");
    let shops: usize = defs.locations.iter().map(|l| l.workshops.len()).sum();
    assert!(shops >= 20, "城镇工坊 {shops} 座");
}

#[test]
fn broken_map_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = tmp.path().join("world").join("map.txt");
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str("..X..\n");
    std::fs::write(&path, text).unwrap();
    let msg = manifest_data::load(tmp.path()).unwrap_err().to_string();
    assert!(msg.contains("map.txt"), "{msg}");
    assert!(msg.contains("宽度"), "{msg}");
}

/// 地图上按行扫描的第一个陆格。
fn first_land_cell(data: &Path) -> (usize, usize) {
    let text = std::fs::read_to_string(data.join("world").join("map.txt")).unwrap();
    text.lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .enumerate()
        .find_map(|(y, row)| row.chars().position(|c| c == '#').map(|x| (x, y)))
        .expect("地图上至少有一个陆格")
}

#[test]
fn port_on_land_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = tmp.path().join("world").join("ports.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    // 把第一个港口搬到地图上第一个陆格（按行扫描；地图重做后左上角不一定是陆地）
    let (x, y) = first_land_cell(tmp.path());
    let start = text.find("pos = [").unwrap();
    let end = start + text[start..].find(']').unwrap() + 1;
    let broken = format!("{}pos = [{x}, {y}]{}", &text[..start], &text[end..]);
    std::fs::write(&path, broken).unwrap();
    let msg = manifest_data::load(tmp.path()).unwrap_err().to_string();
    assert!(msg.contains("ports[chenggang]"), "{msg}");
    assert!(msg.contains("必须是海格"), "{msg}");
}

/// M3：每种提案类型都有提示词模板（带版本号、输出 schema）与离线模板。
#[test]
fn every_proposal_kind_has_prompt_and_offline_template() {
    use manifest_data::ProposalKind;
    let content = manifest_data::load_ai_content(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    for kind in ProposalKind::ALL {
        let p = content.prompts.get(&kind).unwrap_or_else(|| panic!("缺少 {} 的提示词模板", kind.key()));
        assert_eq!(p.kind, kind);
        assert!(p.version >= 1);
        assert!(p.user.contains("{schema}"), "{} 的提示词应包含输出 schema", kind.key());
    }
    // 7 种 M3 的类型 + 第八批 E7 的商会展望、市场月报、复盘点评、身世序章
    assert_eq!(content.prompts.len(), 18);
    let t = &content.templates;
    assert!(t.director.count_weights.iter().sum::<u32>() > 0);
    for key in ["price_high", "price_low", "shortage", "relation", "event_active"] {
        assert!(t.rumor.get(key).is_some_and(|v| !v.is_empty()), "传闻模板缺少 {key}");
    }
    for key in ["discount", "threat", "bribe", "rapport", "irrelevant"] {
        assert!(t.bargain.get(key).is_some_and(|v| !v.is_empty()), "议价模板缺少 {key}");
    }
    assert!(t.strategy.risk_step_pct > 0);
    assert!(t.contract.reward_pct[0] <= t.contract.reward_pct[1] && t.contract.days[0] <= t.contract.days[1]);
    assert!(!t.chronicle.is_empty() && t.chronicle.values().all(|v| !v.is_empty()));
    // 第八批 E7 的文字模板：每段都有
    for (name, sections) in manifest_data::ai_content::TEXT_TEMPLATES {
        let file = match name {
            "outlook" => &t.outlook,
            "market_report" => &t.market_report,
            "review" => &t.review,
            _ => &t.prologue,
        };
        for (section, _) in sections {
            assert!(file.get(*section).is_some_and(|v| !v.is_empty()), "{name} 模板缺少 {section}");
        }
    }
}

/// 复制一份 data/，对某个 AI 内容文件做替换后加载，返回错误文本。
fn corrupt_ai(rel: &str, from: &str, to: &str) -> String {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().to_path_buf(), |p, part| p.join(part));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    match manifest_data::load_ai_content(tmp.path()) {
        Ok(_) => panic!("损坏的 AI 内容（{rel}：{from} → {to}）应被拒绝"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn corrupted_ai_content_is_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &str, &[&str])] = &[
        ("prompts/rumor.toml", "事实：{fact}", "事实：{fact} {api_key}", &["rumor.toml", "api_key", "不允许的变量"]),
        ("prompts/rumor.toml", "{schema}\"\"\"", "（略）\"\"\"", &["rumor.toml", "schema", "缺少必需的变量"]),
        ("prompts/director.toml", "version = 2", "version = 0", &["director.toml", "version"]),
        ("prompts/contract.toml", "kind = \"contract\"", "kind = \"rumor\"", &["contract.toml", "kind"]),
        ("templates/bargain.toml", "irrelevant = [", "unrelated = [", &["bargain.toml", "irrelevant"]),
        ("templates/bargain.toml", "就便宜{discount}吧", "就便宜{price}吧", &["bargain.toml", "price"]),
        // 第八批 E7 的文字模板：段落缺失、多出的段落、用了别的段的变量
        (
            "templates/market_report.toml",
            "shortage = [",
            "scarcity = [",
            &["market_report.toml", "shortage", "scarcity"],
        ),
        ("templates/outlook.toml", "{company}按兵不动", "{company}按兵不动，{good}", &["outlook.toml", "flat", "good"]),
        ("prompts/outlook.toml", "商会：{company}", "商会：", &["outlook.toml", "company", "缺少必需的变量"]),
    ];
    for (rel, from, to, needles) in cases {
        let msg = corrupt_ai(rel, from, to);
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
}

/// 第五批：regions.toml 的海区标记（seas.txt 用）必须是单个、不是地图字符，且各海区互不相同。
#[test]
fn region_marks_are_validated() {
    let msg = corrupt("world/regions.toml", "mark = \"a\"", "mark = \"~\"");
    assert!(msg.contains("regions[frost_west]") && msg.contains("mark"), "{msg}");
    let msg = corrupt("world/regions.toml", "mark = \"b\"", "mark = \"a\"");
    assert!(msg.contains("regions[icespring]") && msg.contains("重复"), "{msg}");
    let msg = corrupt("world/regions.toml", "mark = \"c\"", "mark = \"cc\"");
    assert!(msg.contains("regions[pine_sea]") && msg.contains("一个字符"), "{msg}");
}
