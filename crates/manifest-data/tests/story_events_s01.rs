//! S01：数据加载器认得奇遇的四种新出场条件与行情事件的三种限定，写错了的拒绝加载。
//!
//! 夹具是经典世界数据的一份临时拷贝：在 `stories/encounters.toml` 或 `events.toml` 末尾接上一段再加载。
//! 经典世界自己的数据不用这些新字段（它的两条金样因此不变）；寰宇的真实内容另见 `terra16_encounters_s01`。
//!
//! 另有一项：严格草稿检查认得登记在 `stories` 表里的旧式故事文件（奇遇），用的是生产加载器的 schema，写错的照样拒绝。
use manifest_core::defs::EffectKind;
use manifest_core::story::{Cond, Place};
use manifest_core::weather::Sky;
use manifest_core::{RegionId, StaticData};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

/// 复制经典世界的数据（不带 `worlds/` 与 `maps/`：这里只加载经典世界）。
fn copy_classic(from: &Path, to: &Path, top: bool) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let (p, dest) = (e.path(), to.join(e.file_name()));
        if p.is_dir() {
            if !(top && (e.file_name() == "worlds" || e.file_name() == "maps")) {
                copy_classic(&p, &dest, false);
            }
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 一份经典数据的临时拷贝（放在临时目录的 `data/` 下，航线缓存落在它旁边，随临时目录一起删掉）。
struct Fixture {
    _tmp: tempfile::TempDir,
    data: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        copy_classic(&data_dir(), &data, true);
        Self { _tmp: tmp, data }
    }

    /// 经典世界的港口没有写文化圈：给头一座港口补上一个，`when.culture` 才有东西可认。
    fn with_port_culture(self, culture: &str) -> Self {
        let path = self.data.join("world/ports.toml");
        let text = std::fs::read_to_string(&path).unwrap();
        let marked = text.replacen("\nfaction = ", &format!("\nculture = \"{culture}\"\nfaction = "), 1);
        assert_ne!(marked, text, "港口表里找不到 faction 一行");
        std::fs::write(path, marked).unwrap();
        self
    }

    /// 在 `file` 的原文末尾接上 `section` 再加载；每次都从原文接起。
    fn load_with(&self, file: &str, section: &str) -> Result<Arc<StaticData>, String> {
        let original = std::fs::read_to_string(data_dir().join(file)).unwrap();
        std::fs::write(self.data.join(file), format!("{original}\n{section}\n")).unwrap();
        let loaded = manifest_data::load(&self.data).map_err(|e| e.to_string());
        std::fs::write(self.data.join(file), original).unwrap();
        loaded
    }
}

const ENCOUNTERS: &str = "stories/encounters.toml";

/// 一条最小的奇遇：`head` 是 place 与 when 等字段，带两个选项（第二个不花钱）。
fn encounter(key: &str, head: &str) -> String {
    format!(
        r#"
[[encounters]]
key = "{key}"
title = "占位"
text = "占位"
{head}
[[encounters.choices]]
text = "花钱"
cost = 10
[[encounters.choices]]
text = "不花钱"
"#
    )
}

#[test]
fn the_new_encounter_conditions_load_and_nonsense_is_rejected() {
    let f = Fixture::new().with_port_culture("harbor_folk");
    let base = manifest_data::load(&f.data).expect("经典数据（头一座港口补了文化圈）");
    assert!(base.stories.encounters.iter().all(|e| {
        e.when.iter().all(|c| !matches!(c, Cond::Season(_) | Cond::Sky(_) | Cond::Wind(..) | Cond::Culture(_)))
    }));
    let region = base.regions[2].key.clone();
    let culture = base.port_ids().map(|l| base.loc(l).culture.clone()).find(|c| !c.is_empty()).expect("港口的文化圈");
    assert_eq!(culture, "harbor_folk");

    // 写对了的：季节、天况、风力与海区可以一起写；文化圈写在港口的奇遇上。
    let sea = encounter(
        "s01_sea",
        &format!(
            "place = \"sea\"\nwhen = {{ at_sea = [\"{region}\"], season = [\"summer\", \"winter\"], sky = [\"fog\", \"storm\"], wind = [0, 3] }}"
        ),
    );
    let port = encounter(
        "s01_port",
        &format!("place = \"port\"\nwhen = {{ culture = [\"{culture}\"], season = [\"spring\"] }}"),
    );
    let d = f.load_with(ENCOUNTERS, &format!("{sea}{port}")).expect("新条件");
    let e = d.stories.encounter("s01_sea").unwrap();
    assert_eq!(e.place, Place::Sea);
    assert_eq!(
        e.when,
        [
            Cond::AtSea(vec![RegionId(2)]),
            Cond::Season(vec![1, 3]),
            Cond::Sky(vec![Sky::Fog, Sky::Storm]),
            Cond::Wind(0, 3)
        ]
    );
    assert_eq!(
        d.stories.encounter("s01_port").unwrap().when,
        [Cond::Season(vec![0]), Cond::Culture(vec![culture.clone()])]
    );
    assert_eq!(d.stories.encounters.len(), base.stories.encounters.len() + 2);

    // 写错了的：逐条拒绝，报在那一条上。
    let cases: Vec<(&str, String, &str)> = vec![
        ("bad_season", "place = \"sea\"\nwhen = { season = [\"monsoon\"] }".into(), "when.season“monsoon”无效"),
        ("bad_sky", "place = \"sea\"\nwhen = { sky = [\"hail\"] }".into(), "when.sky“hail”无效"),
        ("wind_order", "place = \"sea\"\nwhen = { wind = [5, 2] }".into(), "when.wind 须为"),
        ("wind_range", "place = \"sea\"\nwhen = { wind = [0, 11] }".into(), "when.wind 须为"),
        ("bad_culture", "place = \"port\"\nwhen = { culture = [\"nowhere\"] }".into(), "不是本世界任何港口的文化圈"),
        ("empty_list", "place = \"sea\"\nwhen = { season = [] }".into(), "when.season 不能是空列表"),
        ("twice", "place = \"sea\"\nwhen = { sky = [\"fog\", \"fog\"] }".into(), "when.sky 里有重复的条目"),
        ("port_sky", "place = \"port\"\nwhen = { sky = [\"fog\"] }".into(), "港口的奇遇不能写 when.sky / when.wind"),
        ("port_wind", "place = \"port\"\nwhen = { wind = [0, 2] }".into(), "港口的奇遇不能写 when.sky / when.wind"),
        (
            "sea_culture",
            format!("place = \"sea\"\nwhen = {{ culture = [\"{culture}\"] }}"),
            "海上的奇遇不能写 when.culture",
        ),
    ];
    for (key, head, expect) in cases {
        let err = f.load_with(ENCOUNTERS, &encounter(key, &head)).err().unwrap_or_else(|| panic!("{key} 应当被拒绝"));
        assert!(err.contains(expect) && err.contains(&format!("encounters[{key}]")), "{key}：{err}");
    }
    // 每条奇遇至少一个不花钱、不交货的选项（带检定不算门槛）。
    let all_paid = r#"
[[encounters]]
key = "all_paid"
title = "占位"
text = "占位"
place = "port"
[[encounters.choices]]
text = "花钱"
cost = 10
[[encounters.choices]]
text = "交货"
give = { good = "grain", qty = 1 }
"#;
    let err = f.load_with(ENCOUNTERS, all_paid).err().unwrap_or_else(|| panic!("全是门槛的奇遇应当被拒绝"));
    assert!(err.contains("奇遇至少要有一个不花钱、不交货的选项"), "{err}");
    let with_check = all_paid.replace(
        "give = { good = \"grain\", qty = 1 }",
        "check = { attr = \"seamanship\", base = 50, per = 0 }\nfail_reply = \"没成\"",
    );
    f.load_with(ENCOUNTERS, &with_check).expect("带检定的选项不算门槛");
}

/// 一条最小的事件类型：`body` 是 effect 与范围、限定等字段。
fn event(key: &str, body: &str) -> String {
    format!(
        "\n[[events]]\nkey = \"{key}\"\nname = \"占位\"\ndescription = \"占位\"\ncooldown_days = 30\nmax_per_year = 2\n{body}\n"
    )
}

#[test]
fn event_limits_load_and_are_checked_against_the_effect_and_the_markets() {
    let f = Fixture::new();
    let base = manifest_data::load(&f.data).expect("原样的经典数据");
    assert!(base.events.iter().all(|e| e.locs.is_empty() && e.regions.is_empty() && e.factions.is_empty()));
    let ports: Vec<_> = base.port_ids().take(2).collect();
    let (a, b) = (base.loc(ports[0]).key.clone(), base.loc(ports[1]).key.clone());
    let city =
        base.loc_ids().find(|l| !base.loc(*l).is_port() && !base.loc(*l).is_site()).map(|l| base.loc(l).key.clone());
    let region = base.regions[1].key.clone();
    let (fa, fb) = (base.factions[0].key.clone(), base.factions[1].key.clone());
    // 第一座港口交易的一种货，与一种它不交易的货。
    let traded = base.good(base.loc(ports[0]).market[0].good).key.clone();
    let foreign = base
        .good_ids()
        .find(|g| !base.loc(ports[0]).market.iter().any(|m| m.good == *g))
        .map(|g| base.good(g).key.clone())
        .expect("总有一种货这座港口不交易");

    let ok = [
        event("s01_fair", &format!("effect = \"location_demand\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nport_only = true\nlocs = [\"{a}\", \"{b}\"]")),
        event("s01_gales", &format!("effect = \"region_storm\"\nmult = [1.5, 2.0]\ndays = [10, 20]\nregions = [\"{region}\"]")),
        event("s01_duty", &format!("effect = \"faction_tax\"\nmult = [1.2, 1.5]\ndays = [30, 60]\nfactions = [\"{fa}\"]")),
        event("s01_feud", &format!("effect = \"relation_shift\"\ndelta = [-10, -5]\nfactions = [\"{fa}\", \"{fb}\"]")),
        event(
            "s01_glut",
            &format!("effect = \"supply_shift\"\nmult = [1.2, 1.5]\ndays = [10, 20]\ngoods = [\"{traded}\"]\nlocs = [\"{a}\"]"),
        ),
    ]
    .concat();
    let d = f.load_with("events.toml", &ok).expect("写对了的限定");
    let of = |key: &str| d.events.iter().find(|e| e.key == key).unwrap();
    assert_eq!(of("s01_fair").locs, ports);
    assert_eq!((of("s01_fair").effect, of("s01_fair").port_only), (EffectKind::LocationDemand, true));
    assert_eq!(of("s01_gales").regions, [RegionId(1)]);
    assert_eq!(of("s01_duty").factions.len(), 1);
    assert_eq!(of("s01_feud").factions.len(), 2);
    assert_eq!(of("s01_glut").locs, [ports[0]]);
    assert_eq!(d.events.len(), base.events.len() + 5);
    // 事件目录（写进事件导演的提示词）把限定的 key 列出来；没有限定的条目照旧。
    let w = manifest_core::World::new(d.clone(), manifest_core::ScenarioId(0), 1).unwrap();
    let catalog = manifest_core::summary::event_catalog(&w);
    assert!(catalog.contains(&format!("- s01_fair：占位。参数：loc（{a}/{b}），")), "{catalog}");
    assert!(catalog.contains(&format!("region（{region}）")) && catalog.contains(&format!("faction_a（{fa}/{fb}）")));
    let plain = manifest_core::summary::event_catalog(
        &manifest_core::World::new(base.clone(), manifest_core::ScenarioId(0), 1).unwrap(),
    );
    assert!(catalog.starts_with(&plain), "没有限定的事件类型在目录里一字不变");

    let mut cases: Vec<(&str, String, &str)> = vec![
        (
            "locs_unused",
            format!("effect = \"good_supply\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nlocs = [\"{a}\"]"),
            "该效果不使用地点，不能设置 locs",
        ),
        (
            "regions_unused",
            format!("effect = \"location_demand\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nregions = [\"{region}\"]"),
            "该效果不使用海区，不能设置 regions",
        ),
        (
            "factions_unused",
            format!("effect = \"region_storm\"\nmult = [1.5, 2.0]\ndays = [10, 20]\nfactions = [\"{fa}\"]"),
            "该效果不使用势力，不能设置 factions",
        ),
        (
            "no_such_loc",
            "effect = \"location_demand\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nlocs = [\"atlantis\"]".into(),
            "引用了不存在的地点“atlantis”",
        ),
        (
            "no_such_region",
            "effect = \"region_storm\"\nmult = [1.5, 2.0]\ndays = [10, 20]\nregions = [\"nowhere_sea\"]".into(),
            "引用了不存在的海区“nowhere_sea”",
        ),
        (
            "no_such_faction",
            "effect = \"faction_tax\"\nmult = [1.2, 1.5]\ndays = [30, 60]\nfactions = [\"nobody\"]".into(),
            "引用了不存在的势力“nobody”",
        ),
        (
            "one_sided",
            format!("effect = \"relation_shift\"\ndelta = [-10, -5]\nfactions = [\"{fa}\"]"),
            "至少要写两个势力",
        ),
        (
            "twice",
            format!("effect = \"location_demand\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nlocs = [\"{a}\", \"{a}\"]"),
            "里有重复的条目",
        ),
        (
            "never_traded",
            format!(
                "effect = \"supply_shift\"\nmult = [1.2, 1.5]\ndays = [10, 20]\ngoods = [\"{traded}\", \"{foreign}\"]\nlocs = [\"{a}\"]"
            ),
            "这种商品永远选不出地点",
        ),
    ];
    if let Some(city) = city {
        cases.push((
            "inland_port_only",
            format!("effect = \"location_demand\"\nmult = [1.1, 1.3]\ndays = [10, 20]\nport_only = true\nlocs = [\"{city}\"]"),
            "不是港口，与 port_only 矛盾",
        ));
    }
    for (key, body, expect) in cases {
        let err = f.load_with("events.toml", &event(key, &body)).err().unwrap_or_else(|| panic!("{key} 应当被拒绝"));
        assert!(err.contains(expect) && err.contains(&format!("events[{key}]")), "{key}：{err}");
    }
}

/// 严格草稿检查：`stories` 表里没有 `tracks` 的旧式故事文件（奇遇）按生产加载器的 schema 检查。
/// 夹具是一个只登记了一份奇遇文件的草稿世界（不带地图）。
#[test]
fn the_draft_checker_reads_old_style_story_files_with_the_production_schema() {
    let temp = tempfile::tempdir().unwrap();
    let package = temp.path().join("worlds/probe");
    std::fs::create_dir_all(package.join("stories")).unwrap();
    std::fs::write(
        package.join("world.toml"),
        "key='probe'\nname='校验'\nmap='absent'\ndraft=true\nlanguages=['zh']\n[tables]\nstories=['stories/enc.toml']\n",
    )
    .unwrap();
    let valid = r#"
[[encounters]]
key = "probe_calm"
title = "无风"
text = "海面平得像一块铜镜，帆垂着不动。"
place = "sea"
when = { season = ["summer"], wind = [0, 2] }
cooldown_days = 365
choices = [
  { text = "等风", effects = [{ kind = "supplies", value = -1 }] },
  { text = "放小艇拖船", cost = 20, effects = [{ kind = "morale", value = -2 }] },
]
"#;
    let check = |text: &str| {
        std::fs::write(package.join("stories/enc.toml"), text).unwrap();
        manifest_data::worlds::validate_draft_world(temp.path(), "probe").map_err(|e| e.to_string())
    };
    let report = check(valid).unwrap_or_else(|e| panic!("合规的奇遇文件被草稿检查拒绝：{e}"));
    assert!(report.files.len() == 1 && report.files[0].ends_with("stories/enc.toml"), "{:?}", report.files);
    assert_eq!(report.counts.get("encounters"), Some(&1));
    assert_eq!(report.counts.get("tracks"), None);
    // 只做中文的世界、没有英文覆盖：记作只有中文的分片。
    assert_eq!((report.chinese_only_fragments, report.translated_strings), (1, 0));
    // 写错的逐条拒绝：未知字段（条目、条件、选项、效果四层）、缺必填字段、key 的写法、重名。
    for (from, to, reason) in [
        ("cooldown_days = 365", "cooldown_days = 365\nunknown_field = 1", "unknown field"),
        ("when = { season", "when = { moon = 1, season", "unknown field"),
        ("cost = 20,", "price = 20,", "unknown field"),
        ("kind = \"morale\", value", "kind = \"morale\", amount = 1, value", "unknown field"),
        ("place = \"sea\"\n", "", "missing field"),
        ("key = \"probe_calm\"", "key = \"probe calm\"", "schema"),
        ("cooldown_days = 365", "cooldown_days = \"一年\"", "旧式故事格式错误"),
    ] {
        assert!(valid.contains(from), "反例的替换目标不在原文里：{from}");
        let error = check(&valid.replacen(from, to, 1)).expect_err("写错的奇遇文件必须被草稿检查拒绝");
        assert!(error.contains(reason) && error.contains("stories/enc.toml"), "{to}：{error}");
    }
    let error = check(&format!("{valid}{valid}")).expect_err("同一个 key 写了两遍");
    assert!(error.contains("key 重复") && error.contains("probe_calm"), "{error}");
    // 表名写错（既不是 tracks，也不是 encounters / chapters）：仍按新轨道的路径拒绝。
    let error = check(&valid.replace("[[encounters]]", "[[encounter]]")).expect_err("写错的表名");
    assert!(error.contains("故事2.0格式错误"), "{error}");
    // 新轨道文件里混进奇遇：新轨道的 schema 照旧拒绝——带 tracks 的文件走的路径没有变松。
    let error = check(&format!("tracks = []\n{valid}")).expect_err("新轨道文件里不能写奇遇");
    assert!(error.contains("故事2.0格式错误") && error.contains("encounters"), "{error}");
}
