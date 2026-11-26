//! 西幻扩展的会话层测试：殖民地全流程（建立 → 生产 → 缺粮 → 袭击 → 税收）每天不变量成立；
//! 带殖民与发现命令的对局只用命令日志重放一致；v4 存读档；旧的 v1 样例存档在扩展后的大地图上读取。

mod common;

use manifest_core::defs::StaticData;
use manifest_core::ids::*;
use manifest_core::log::LogKind;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::treasury::Flow;
use manifest_core::warehouse::Holder;
use manifest_core::{Command, CommandOutcome, Fx};
use manifest_sim::{GameSession, storage};
use std::path::PathBuf;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const GAMMA: LocId = LocId(2);
const SIGMA: LocId = LocId(4);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);

/// 小型世界：关闭海盗舰队；殖民地袭击概率调高，让一年内必然遭袭。
fn defs() -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.colony.raid_scale = Fx::from_int(20);
    Arc::new(d)
}

fn ok(s: &mut GameSession, c: Command) -> CommandOutcome {
    s.submit(c.clone()).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn day(s: &mut GameSession) {
    s.advance_day().unwrap();
    if let Err(e) = check_invariants(&s.world) {
        panic!("{e}");
    }
}

fn fleet(s: &GameSession) -> FleetId {
    s.world.fleets_of(P).next().unwrap().id
}

fn sail(s: &mut GameSession, dest: LocId) {
    let f = fleet(s);
    ok(s, Command::SetSail { owner: P, fleet: f, dest });
    for _ in 0..40 {
        if s.world.fleet(f).unwrap().docked_at() == Some(dest) {
            return;
        }
        day(s);
    }
    panic!("没有抵达 {dest:?}");
}

fn logged(s: &GameSession, pred: impl Fn(&LogKind) -> bool) -> bool {
    s.world.state.log.iter().any(|e| pred(&e.kind))
}

/// 走一遍殖民地全流程，返回会话与殖民地编号。
fn colony_game(seed: u64) -> (GameSession, ColonyId) {
    let mut s = GameSession::new(defs(), ScenarioId(0), seed).unwrap();
    let f = fleet(&s);
    let crew = s.world.fleet(f).unwrap().crew;
    ok(&mut s, Command::HireCrew { owner: P, fleet: f, count: 24 - crew });
    ok(&mut s, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    ok(&mut s, Command::Buy { owner: P, fleet: f, good: GRAIN, qty: 60, max_total: None });
    ok(&mut s, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 20, max_total: None });
    sail(&mut s, SIGMA);
    let CommandOutcome::ColonyFounded { colony } =
        ok(&mut s, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "拂晓港".into(), settlers: 12 })
    else {
        panic!("建立殖民地");
    };
    for g in [GRAIN, CLOTH] {
        let q = s.world.fleet(f).unwrap().cargo.get(&g).copied().unwrap_or(0);
        ok(
            &mut s,
            Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: g, qty: q },
        );
    }
    // 先不建农庄：粮食吃完后断粮
    for _ in 0..25 {
        day(&mut s);
    }
    assert!(s.world.colony(colony).unwrap().starving_days > 0, "只靠带来的粮食，一段时间后断粮");
    assert!(logged(&s, |k| matches!(k, LogKind::ColonyStarving { .. })));
    ok(&mut s, Command::BuildColony { owner: P, colony, building: ColonyBuildingId(0) });
    ok(&mut s, Command::SetColonyTax { owner: P, colony, rate: 2 });
    for _ in 0..10 {
        day(&mut s);
    }
    ok(&mut s, Command::BuildColony { owner: P, colony, building: ColonyBuildingId(1) });
    for _ in 0..10 {
        day(&mut s);
    }
    ok(&mut s, Command::BuildColony { owner: P, colony, building: ColonyBuildingId(4) });
    (s, colony)
}

#[test]
fn colony_lifecycle_keeps_invariants_and_replays() {
    let (mut s, colony) = colony_game(31);
    // 殖民地没有码头，不能补给；先回到港口
    let f = fleet(&s);
    sail(&mut s, GAMMA);
    ok(&mut s, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    if s.world.unreported_discoveries().next().is_some() {
        let d = s.world.unreported_discoveries().next().unwrap();
        ok(&mut s, Command::ReportDiscovery { owner: P, discovery: d, loc: GAMMA });
    }
    for _ in 0..330 {
        day(&mut s);
    }
    let c = s.world.colony(colony).expect("殖民地存续");
    assert!(c.level(ColonyBuildingId(0)) == 1 && c.level(ColonyBuildingId(1)) == 1);
    assert!(c.stats.raids >= 1, "一年内遭到海盗袭击");
    assert!(logged(&s, |k| matches!(k, LogKind::ColonyRaided { .. })));
    assert!(s.world.state.money.sources.get(&Flow::Colony).copied().unwrap_or(0) > 0, "税收入账");
    assert!(s.world.state.money.sinks.get(&Flow::Colony).copied().unwrap_or(0) > 0, "建立费、建筑费与维护费");
    assert!(s.world.money_conserved());
    // 只用命令日志重放
    let replayed = s.replay().unwrap();
    assert_eq!(replayed.state_hash(), s.world.state_hash());
    assert_eq!(replayed.state.colonies, s.world.state.colonies);
}

#[test]
fn colony_game_saves_as_v4_and_resumes_identically() {
    let (s, _) = colony_game(32);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("colony.mfsave.zst");
    storage::write(&path, &s.to_save(), true).unwrap();
    let back = storage::read(&path).unwrap();
    assert_eq!(back.version, manifest_core::save::SAVE_VERSION);
    assert_eq!(back.version, 5);
    let json = back.to_json().unwrap();
    assert!(json.contains("\"colonies\"") && json.contains("\"width\":40"), "v4 存档含殖民地与迷雾宽高");
    let mut loaded = GameSession::from_save(defs(), back).unwrap();
    assert_eq!(loaded.world.state, s.world.state);
    let mut original = GameSession::from_save(defs(), s.to_save()).unwrap();
    for _ in 0..60 {
        loaded.advance_day().unwrap();
        original.advance_day().unwrap();
    }
    assert_eq!(loaded.world.state_hash(), original.world.state_hash());
    assert_eq!(loaded.replay().unwrap().state_hash(), loaded.world.state_hash());
    check_invariants(&loaded.world).unwrap();
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("save_v1.mfsave.zst")
}

/// 旧的 v1 样例存档（240×120 地图）在扩展成 400×170 的世界上读取：已揭开的格子位置不变，可以继续运行。
#[test]
fn legacy_save_loads_on_the_expanded_400x170_map() {
    let tmp = tempfile::tempdir().unwrap();
    let data = manifest_data::find_data_dir().unwrap();
    manifest_data::bench::write_synthetic_world(&data, tmp.path(), Default::default()).unwrap();
    let big = manifest_data::load_shared(tmp.path()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!((big.map.width, big.map.height), (400, 170));
    let bytes = std::fs::read(fixture()).unwrap();

    let small = GameSession::from_save(common::defs(), storage::decode(&bytes).unwrap()).unwrap();
    let (w0, h0) = (common::defs().map.width as usize, common::defs().map.height as usize);
    let revealed: Vec<(usize, usize)> = (0..h0)
        .flat_map(|y| (0..w0).map(move |x| (x, y)))
        .filter(|(x, y)| small.world.state.explore.is_revealed(y * w0 + x))
        .collect();
    assert!(!revealed.is_empty());

    let save = storage::decode(&bytes).unwrap();
    save.check_compatible(&big).expect("旧存档的键表是新数据的前缀");
    let mut session = GameSession::from_save(big.clone(), save).expect("在大地图上读取旧存档");
    let e = &session.world.state.explore;
    assert_eq!((e.width, e.height), (400, 170));
    for (x, y) in &revealed {
        assert!(e.is_revealed(y * 400 + x), "({x}, {y}) 应保持已揭开");
    }
    assert_eq!(e.revealed_count() as usize, revealed.len());
    assert_eq!(session.world.state.locations.len(), big.locations.len(), "新地点补上了状态");
    for _ in 0..30 {
        session.advance_day().unwrap();
    }
    check_invariants(&session.world).unwrap();
    // 再存一次就是 v4，读回后状态一致
    let again = storage::decode(&storage::encode(&session.to_save(), true).unwrap()).unwrap();
    let reloaded = GameSession::from_save(big, again).unwrap();
    assert_eq!(reloaded.world.state, session.world.state);
}
