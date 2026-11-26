//! 真实 C2 转换及休眠港边界，不用 testbed 替代寰宇。
use manifest_core::{
    calendar::Date,
    market::{self, Side},
    *,
};
use std::sync::{Arc, OnceLock};

#[test]
fn effect_translation_uses_effect_key_and_rejects_gameplay_fields() {
    let source = "[[effects]]\neffect='good_supply'\nname='供给'\ndescription='效果说明。'\nmult=[0.8,1.2]\n";
    let english = "[effects.good_supply]\nname='Supply'\ndescription='The supply effect.'\n";
    assert_eq!(crate::worlds::validate_draft_translation("effects.toml", source, english).unwrap(), 2);
    for bad in [format!("{english}mult=[0.1,2.0]\n"), english.replace("good_supply", "unknown")] {
        assert!(crate::worlds::validate_draft_translation("effects.toml", source, &bad).is_err());
    }
}

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let effective = crate::resolve_world(&root, "terra16").expect("寰宇有效文件");
        Arc::new(super::super::load_effective(&effective).expect("寰宇完整转换"))
    })
    .clone()
}

fn opening() -> World {
    // 数据边界测试共享同一份真实四年预推演夹具，每项从独立快照开始。
    // 一年航海和四年确定性验收另由 manifest-sim 完整逐日执行。
    static OPENING: OnceLock<World> = OnceLock::new();
    let initial = OPENING.get_or_init(|| {
        let d = defs();
        let scenario = d.find_scenario("free_1557").unwrap();
        World::new(d, scenario, 42).unwrap()
    });
    World::from_snapshot(initial.defs.clone(), initial.state.clone()).unwrap()
}

#[test]
fn real_c2_preserves_runtime_tables_conditions_and_provenance() {
    let d = defs();
    assert_eq!(d.locations.len(), 240);
    assert_eq!(d.locations.iter().filter(|p| p.is_port()).count(), 194);
    assert_eq!(d.roads.len(), 56);
    assert_eq!(d.discoveries.len(), 99);
    assert_eq!(d.geography.landmarks.len(), 32);
    assert_eq!(d.geography.places.offstage.len(), 174);
    let a = &d.geography.places.authored;
    assert_eq!(a.locations.len(), 240);
    assert_eq!(a.locations.values().filter(|p| p.dormant.is_some()).count(), 18);
    assert_eq!(a.roads.len(), 56);
    assert_eq!(a.discoveries.len(), 99);
    assert_eq!(a.sites.len(), 32);
    assert_eq!(a.locations["macao"].dormant.as_ref().unwrap().until, 1557);
    assert_eq!(a.locations["macao"].dormant.as_ref().unwrap().by, "H13");
    assert!(a.locations.values().all(|p| !p.provenance.sources.is_empty() && p.provenance.lonlat_e5.is_some()));
    assert!(d.roads.iter().all(|r| a.roads.contains_key(&r.key)));
    assert_eq!(a.discoveries["ruin_pharos"].requires.mode, manifest_core::geo::authored::DiscoveryMode::Dive);
    assert_eq!(a.discoveries["mark_emerald_buddha"].moves[0].from_year, 1564);
    assert_eq!(a.discoveries["phantom_antillia"].requires.weather.as_deref(), Some("fog"));
    assert!(!a.discoveries["phantom_antillia"].reachable);
    for l in &d.geography.landmarks {
        assert_eq!(l.discovery.map(|id| &d.discovery(id).key), a.sites[&l.key].discovery.as_ref());
    }
    // 养成内容（2026-11-03）：九位主角的家乡玩伴与诺埃尔的看网老人，共 17 人（594 → 611）。
    // 公开版拿掉三位人物：611 → 608。
    assert_eq!(d.cast.persons.len(), 608);
    // C7 整合：166 + 拆段 15 + 新线 53；伊洛娜与柳德米拉改为知己，不再等 A6 的成年长生者叙事表示
    // 公开版拿掉与那三位人物相关的 10 条关系：237 → 227。
    assert_eq!(d.cast.ties.len() + d.cast.deferred_ties.len() + a.pending_ties.len(), 227);
    assert_eq!(a.pending_ties.iter().filter(|t| t.requires == "C11").count(), 0);
    assert_eq!(a.pending_ties.iter().filter(|t| t.requires == "A6_npc_narrative").count(), 0);
    // C11新增七岛通行物2件及专用船图20张，原C3/C4的709件全部保留。
    // 2026-11-04：辨识类比赛第 1 名的六件新奖品（items/items_gift_u04.toml），731 → 737。
    // U06C / U06C3：养成小物与剧情物品新增 19 件。
    // 公开版拿掉 9 件物品与 2 种船型：951 → 942、37 → 35。
    assert_eq!(d.items.items.len(), 942);
    assert_eq!(d.ships.len(), 35);
    assert_eq!(d.scenarios.len(), 11);
}

#[test]
fn dormant_port_opens_on_its_authored_year_and_keeps_state_compatible() {
    let mut w = opening();
    let macao = w.defs.locations.iter().position(|p| p.key == "macao").map(LocId::from_idx).unwrap();
    // T01：货档下新来的人只买得到一部分货（澳门的头一种特产是珍货，要商誉 60）；这里查的是港口开没开，
    // 所以挑一种这里出售、眼下商誉够买的货（原来取清单里第一种特产）。
    let good = manifest_core::open_market::sale_list(&w.defs, macao)
        .into_iter()
        .find(|g| w.rank_gate(OwnerId::Player, macao, *g).is_none())
        .unwrap();
    let fleet = w.fleets_of(OwnerId::Player).next().unwrap().clone();
    w.state.day = w.defs.calendar.day_of(Date { year: 4, month: 12, day: 31 }).unwrap();
    assert_eq!(w.cast_date(), [1556, 12, 31]);
    assert!(!w.port_is_open(macao));
    let before = w.state.clone();
    assert!(market::quote(&w, OwnerId::Player, macao, good, Side::Buy, 1).is_err());
    assert!(market::quote(&w, OwnerId::Player, macao, good, Side::Sell, 1).is_err());
    assert!(w.check_navigation(&fleet, macao).is_err());
    assert_eq!(w.state, before);
    w.state.day += 1;
    assert_eq!(w.cast_date(), [1557, 1, 1]);
    assert!(w.port_is_open(macao));
    // C10 接线后，作者开放年份与 H13 的动态开放必须同时满足。
    assert!(!w.location_open(macao));
    assert_eq!(w.history_outcome("h13_guangzhou_agreement"), None);
    assert!(market::quote(&w, OwnerId::Player, macao, good, Side::Buy, 1).is_err());
    assert!(market::quote(&w, OwnerId::Player, macao, good, Side::Sell, 1).is_err());
    // 此查询只检查作者年份与航路；市场还要等待时间线开放。
    assert!(w.check_navigation(&fleet, macao).is_ok());
    while w.cast_date() < [1558, 1, 1] {
        w.end_day().unwrap();
    }
    assert_eq!(w.history_outcome("h13_guangzhou_agreement"), Some("macao_settlement"));
    assert!(w.location_open(macao));
    let quote = market::quote(&w, OwnerId::Player, macao, good, Side::Buy, 1);
    assert!(quote.is_ok(), "H13开放后应可交易：{quote:?}");
    assert!(w.check_navigation(&fleet, macao).is_ok());
    let restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert!(restored.port_is_open(macao));
    assert!(restored.location_open(macao));
    assert!(serde_json::to_value(&restored.state).unwrap().get("dormant").is_none());
}

#[test]
fn real_book_records_are_awarded_once_and_survive_snapshot_restore() {
    let d = defs();
    let book = "plato_ficino";
    let read = d.items.item(book).unwrap().read.as_ref().unwrap().clone();
    assert_eq!(read.records, ["topic_atlantis"]);
    assert!(read.reveals.is_empty());
    let mut world = opening();
    world.grant_item(OwnerId::Player, book, 1).unwrap();
    if let Some(lang) = &read.lang {
        world.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.insert(lang.clone(), 1);
    }
    Command::ReadBook { owner: OwnerId::Player, book: book.into(), interpreter: None }.apply(&mut world).unwrap();
    for day in 0..read.days {
        assert!(!world.has_knowledge_record("topic_atlantis"), "第 {day} 日不能提前获得见闻");
        world.end_day().unwrap();
    }
    assert!(world.has_knowledge_record("topic_atlantis"));
    assert_eq!(world.books_read(OwnerId::Player, None), 1);
    let restored = World::from_snapshot(world.defs.clone(), world.state.clone()).unwrap();
    assert_eq!(world.state, restored.state);
    assert!(restored.has_knowledge_record("topic_atlantis"));
    let before = world.state.clone();
    assert!(
        Command::ReadBook { owner: OwnerId::Player, book: book.into(), interpreter: None }.apply(&mut world).is_err()
    );
    assert_eq!(world.state, before);
}
