//! H06 喊话、结伴与甩掉追击的测试：每个选项各一条，加“被追 → 进雾 → 甩掉”的整段脚本。
//! “被追 → 抛货 → 甩掉”的一段由甲线 H02 补上（`chased_then_jettison_cargo_you_pull_away_and_the_pirate_gives_up`）。
use super::*;
use crate::battle::PirateFleet;
use crate::navigation::pursuit::PirateChase;
use crate::navigation::{CoursePoint, ManualVoyage, Sail};
use crate::testkit::tiny_defs;
use crate::world::RouteVoyage;
use crate::{Cell, Command, Fx, LocId, RegionId, ScenarioId, StaticData};
use std::sync::Arc;

/// 小世界：手动航行、喊话与按分钟追击打开、天天晴（`fog` 为真时天天雾）、风不变、没有海盗自己生成。
fn defs(fog: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.manual_navigation = true;
    d.rules.hail.enabled = true;
    d.rules.pursuit.enabled = true;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.disease_bp_per_30_days = 0;
    d.rules.weather.wind_dir_weights = [0, 0, 1, 0, 0];
    d.rules.weather.wind_strength_weights = [0, 0, 0, 1, 0, 0, 0];
    for c in &mut d.rules.weather.climates {
        c.skies = if fog { [[0, 0, 0, 1]; 4] } else { [[1, 0, 0, 0]; 4] };
        c.storm = [Fx::ZERO; 4];
    }
    for r in &mut d.regions {
        for s in &mut r.seasons {
            s.storm_bp = 0;
        }
    }
    Arc::new(d)
}

/// 玩家舰队收着帆停在 (5, 4)；一支商会舰队停在旁边 (6, 4) 的海上（走航线去 0 号港）。
fn world(d: Arc<StaticData>, seed: u64) -> (World, FleetId, FleetId) {
    let mut w = World::new(d, ScenarioId(0), seed).unwrap();
    let me = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Resupply { owner: OwnerId::Player, fleet: me, food: 10, water: 10 }.apply(&mut w).unwrap();
    let mut manual = ManualVoyage::new(Cell::new(5, 4), 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(me).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    let other = w.state.fleets.values().find(|f| f.owner != OwnerId::Player).map(|f| f.id).expect("有商会舰队");
    w.fleet_mut(other).unwrap().location = FleetLocation::AtSea(Voyage::Route(RouteVoyage {
        dest: LocId(0),
        path: vec![Cell::new(6, 4), Cell::new(7, 4)],
        step: 0,
        leg_progress: Fx::ZERO,
    }));
    (w, me, other)
}

fn pirate(w: &mut World, id: u32, cell: Cell, guns: i64) {
    let kind = crate::ShipTypeId(0);
    let mut ship = crate::fleet::new_ship(&w.defs, kind);
    ship.guns = guns;
    w.state.battles.pirates.insert(
        id,
        PirateFleet { id, region: RegionId(0), cell, ships: vec![ship], crew: 20, until: 999, engaged: false },
    );
}

fn hail(w: &mut World, fleet: FleetId, target: HailTarget, action: HailAction) -> Result<(), CommandError> {
    Command::Hail { owner: OwnerId::Player, fleet, target, action }.apply(w).map(|_| ())
}

/// 一整天停着不动的航迹（第 i 项是第 i 分钟）。
fn still(at: Cell) -> Vec<CoursePoint> {
    (0..=1440).map(|m| CoursePoint { pos: SubCell::center(at), minute: m }).collect()
}

#[test]
fn hailing_needs_the_switch_range_and_the_right_kind_of_target() {
    let (mut w, me, other) = world(defs(false), 3);
    assert_eq!(w.hail_targets(me), vec![HailTarget::Fleet(other)]);
    // 对商船不能买路，对海盗不能换消息
    assert!(hail(&mut w, me, HailTarget::Fleet(other), HailAction::Bribe).is_err());
    pirate(&mut w, 1, Cell::new(5, 5), 2);
    assert!(hail(&mut w, me, HailTarget::Pirate(1), HailAction::News).is_err());
    // 远了喊不到
    pirate(&mut w, 2, Cell::new(12, 4), 2);
    assert!(!w.hail_targets(me).contains(&HailTarget::Pirate(2)));
    assert!(hail(&mut w, me, HailTarget::Pirate(2), HailAction::Fight).is_err());
    // 开关关着：没有对象、命令被拒、状态里没有这一节
    let mut raw = (*defs(false)).clone();
    raw.rules.hail.enabled = false;
    let (mut off, me, other) = world(Arc::new(raw), 3);
    assert!(off.hail_targets(me).is_empty());
    let before = off.state_hash();
    assert!(hail(&mut off, me, HailTarget::Fleet(other), HailAction::News).is_err());
    assert_eq!(off.state_hash(), before);
    assert!(!serde_json::to_string(&off.state).unwrap().contains("\"hail\""));
}

#[test]
fn trading_news_learns_a_market_and_a_rumor_once_a_day() {
    let (mut w, me, other) = world(defs(false), 4);
    let rumors = w.state.explore.rumors.len();
    hail(&mut w, me, HailTarget::Fleet(other), HailAction::News).unwrap();
    assert!(
        w.state.info.known.get(&OwnerId::Player).is_some_and(|k| k.contains_key(&LocId(0))),
        "记下了它要去的港口的行情"
    );
    assert!(w.state.explore.rumors.len() >= rumors, "传闻（有没讲过的发现物时 +1）");
    assert!(hail(&mut w, me, HailTarget::Fleet(other), HailAction::News).is_err(), "同一天不能再换");
    assert_eq!(w.state.hail.last.map(|l| (l.action, l.ok)), Some((HailAction::News, true)));
}

#[test]
fn buying_supplies_costs_the_emergency_price() {
    let (mut w, me, other) = world(defs(false), 5);
    let (food, water) = (w.fleet(me).unwrap().food, w.fleet(me).unwrap().water);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    let cost = w.hail_supply_cost(me, 3);
    assert!(cost > 0);
    hail(&mut w, me, HailTarget::Fleet(other), HailAction::Supplies(3)).unwrap();
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash - cost);
    assert!(w.fleet(me).unwrap().food > food && w.fleet(me).unwrap().water > water);
    // 天数越界、同一天再买、钱不够都不行
    let (mut w2, me2, other2) = world(defs(false), 5);
    assert!(hail(&mut w2, me2, HailTarget::Fleet(other2), HailAction::Supplies(9)).is_err());
    w2.agent_mut(OwnerId::Player).unwrap().cash = 0;
    assert!(matches!(
        hail(&mut w2, me2, HailTarget::Fleet(other2), HailAction::Supplies(1)),
        Err(CommandError::InsufficientCash { .. })
    ));
    assert!(hail(&mut w, me, HailTarget::Fleet(other), HailAction::Supplies(1)).is_err());
}

#[test]
fn sailing_in_convoy_halves_how_far_pirates_see_you() {
    // 海盗在 5 格外：平时（视野 6）看得见、开追；结伴后视野只剩 3，看不见
    let (mut w, me, other) = world(defs(false), 6);
    pirate(&mut w, 7, Cell::new(5, 9), 2);
    let fleet = w.fleet(me).unwrap().clone();
    let points = still(Cell::new(5, 4));
    assert!(w.pursuit_tracks(&fleet, &points, &Default::default()).iter().any(|t| t.pirate == 7));
    hail(&mut w, me, HailTarget::Fleet(other), HailAction::Convoy).unwrap();
    assert!(w.convoy_active(me));
    assert!(w.pursuit_tracks(&fleet, &points, &Default::default()).iter().all(|t| t.pirate != 7));
    // 过了结伴的天数就失效
    w.state.day += w.defs.rules.hail.convoy_days;
    w.hail_day();
    assert!(!w.convoy_active(me));
}

#[test]
fn paying_off_a_pirate_stops_the_chase() {
    let (mut w, me, _) = world(defs(false), 7);
    pirate(&mut w, 3, Cell::new(5, 5), 2);
    w.state.battles.chases.insert(
        3,
        PirateChase {
            fleet: me,
            pos: SubCell::center(Cell::new(5, 5)),
            seen: SubCell::center(Cell::new(5, 4)),
            unseen: 0,
        },
    );
    let cost = w.bribe_cost(me);
    assert!(cost >= w.defs.rules.hail.bribe_min);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    hail(&mut w, me, HailTarget::Pirate(3), HailAction::Bribe).unwrap();
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash - cost);
    assert!(!w.state.battles.chases.contains_key(&3) && w.pirate_truce(3, me));
    let fleet = w.fleet(me).unwrap().clone();
    assert!(w.pursuit_tracks(&fleet, &still(Cell::new(5, 4)), &Default::default()).is_empty(), "休战期间不追");
}

#[test]
fn bluffing_either_scares_them_off_or_starts_the_fight() {
    let (mut seen_ok, mut seen_fail) = (false, false);
    for seed in 1..60u64 {
        let (mut w, me, _) = world(defs(false), seed);
        pirate(&mut w, 4, Cell::new(5, 5), 4);
        let morale = w.fleet(me).unwrap().morale;
        hail(&mut w, me, HailTarget::Pirate(4), HailAction::Bluff).unwrap();
        let last = w.state.hail.last.unwrap();
        if last.ok {
            assert!(w.pirate_truce(4, me) && !w.fleet_in_battle(me));
            assert_eq!(w.fleet(me).unwrap().morale, morale);
            seen_ok = true;
        } else {
            assert!(w.fleet_in_battle(me), "输了当场开战");
            assert_eq!(w.fleet(me).unwrap().morale, (morale - w.defs.rules.hail.bluff_morale).max(0));
            seen_fail = true;
        }
        // 同样的种子与日子结果相同
        let (mut again, me2, _) = world(defs(false), seed);
        pirate(&mut again, 4, Cell::new(5, 5), 4);
        hail(&mut again, me2, HailTarget::Pirate(4), HailAction::Bluff).unwrap();
        assert_eq!(again.state.hail.last.map(|l| l.ok), Some(last.ok));
        if seen_ok && seen_fail {
            break;
        }
    }
    assert!(seen_ok && seen_fail, "成与不成都出现过");
}

#[test]
fn choosing_to_fight_starts_a_pending_battle() {
    let (mut w, me, _) = world(defs(false), 8);
    pirate(&mut w, 5, Cell::new(4, 4), 2);
    hail(&mut w, me, HailTarget::Pirate(5), HailAction::Fight).unwrap();
    assert!(w.fleet_in_battle(me));
    assert!(w.state.battles.pirates[&5].engaged);
    assert!(w.state.battles.pending.values().any(|p| p.fleet == me && p.pirate == 5));
}

#[test]
fn chased_then_hidden_in_fog_the_pirate_gives_up_and_you_earn_fame() {
    // 整段脚本（不含抛货）：海盗在 4.5 格外追着你。晴天（视野 6）它一直看得见、追着不放；
    // 雾里（视野 3）一整天看不见，放弃——日结时你甩掉了它，名声 +escape_fame。
    let chase_state = |me| PirateChase {
        fleet: me,
        pos: SubCell { x: 5 * 256 + 128, y: 8 * 256 + 256 },
        seen: SubCell::center(Cell::new(5, 4)),
        unseen: 0,
    };
    // 晴天：照追
    let (mut clear, me, _) = world(defs(false), 9);
    pirate(&mut clear, 6, Cell::new(5, 8), 0);
    clear.state.battles.pirates.get_mut(&6).unwrap().ships.clear();
    clear.state.battles.chases.insert(6, chase_state(me));
    let fleet = clear.fleet(me).unwrap().clone();
    let t = clear.pursuit_tracks(&fleet, &still(Cell::new(5, 4)), &Default::default());
    assert!(t.iter().any(|t| t.pirate == 6 && (t.end.is_some() || t.contact.is_some())), "晴天里一直追着");
    // 雾里：放弃
    let (mut fog, me, _) = world(defs(true), 9);
    pirate(&mut fog, 6, Cell::new(5, 8), 0);
    fog.state.battles.pirates.get_mut(&6).unwrap().ships.clear();
    // 这支海盗没有船（航速按保底算，一天走不到一格半），一整天都在雾里 3 格之外
    fog.state.battles.chases.insert(6, chase_state(me));
    let fleet = fog.fleet(me).unwrap().clone();
    let tracks = fog.pursuit_tracks(&fleet, &still(Cell::new(5, 4)), &Default::default());
    let t = tracks.iter().find(|t| t.pirate == 6).expect("日初就在追");
    assert!(t.end.is_none() && t.contact.is_none(), "一整天看不见，放弃了");
    // 日结：甩掉了，名声 +2、日志一条
    let fame = fog.agent(OwnerId::Player).unwrap().fame;
    fog.state.battles.pursued = vec![crate::navigation::pursuit::PursuitOutcome {
        pirate: 6,
        fleet: me,
        contact: None,
        cell: t.points.last().unwrap().cell(),
        end: None,
    }];
    fog.battle_day().unwrap();
    assert_eq!(fog.agent(OwnerId::Player).unwrap().fame, fame + fog.defs.rules.hail.escape_fame);
    assert!(fog.state.log.iter().any(|e| matches!(e.kind, crate::log::LogKind::ShookOff { .. })));
    assert!(!fog.state.battles.chases.contains_key(&6));
}

#[test]
fn chased_then_jettison_cargo_you_pull_away_and_the_pirate_gives_up() {
    // 整段脚本（抛货，H02）：雾里（海盗视野 3 格）一支海盗在正西 3 格多一点追着你，你满载往东跑。
    // 满载慢 10%（H02 的载重），比海盗慢：它一点点追近、又看见你；抛掉一半的货，载重回到六成以下，
    // 比海盗快：一整天都在 3 格开外，它放弃。
    let mut d = (*defs(true)).clone();
    d.rules.voyage_wear.enabled = true;
    let (mut w, me, _) = world(Arc::new(d), 9);
    pirate(&mut w, 6, Cell::new(2, 4), 0);
    w.state.battles.pirates.get_mut(&6).unwrap().ships.clear();
    let start = SubCell::center(Cell::new(5, 4));
    let chase =
        PirateChase { fleet: me, pos: SubCell { x: start.x - 3 * 256 - 4, y: start.y }, seen: start, unseen: 0 };
    // 海盗的航速（每分钟几个 1/256 格）：让它朝一个不动的目标走一阵量出来
    w.state.battles.chases.insert(6, chase);
    let fleet = w.fleet(me).unwrap().clone();
    let probe = w.pursuit_tracks(&fleet, &still(Cell::new(5, 4)), &Default::default());
    let p = probe.iter().find(|t| t.pirate == 6).unwrap();
    let pirate_per_day = (p.points[120].x - p.points[0].x) * 12;
    assert!(pirate_per_day > 0);
    // 满载：H02 的载重减速 10%
    let cap = fleet.capacity();
    w.fleet_mut(me).unwrap().cargo.insert(crate::GoodId(1), cap);
    let loaded = w.wear_speed_bp(me);
    assert_eq!(loaded, 9_000);
    // 你的航速（不计载重时）定在海盗的 1/0.95 倍：满载时比它慢、抛货后比它快
    let base = pirate_per_day * 100 / 95;
    let run = |w: &World, bp: i64| {
        let fleet = w.fleet(me).unwrap().clone();
        let points: Vec<CoursePoint> = (0..=1440)
            .map(|m| CoursePoint {
                pos: SubCell { x: start.x + base * bp / 10_000 * m / 1440, y: start.y },
                minute: m as u16,
            })
            .collect();
        w.pursuit_tracks(&fleet, &points, &Default::default()).into_iter().find(|t| t.pirate == 6).unwrap()
    };
    let t = run(&w, loaded);
    assert!(t.end.is_some() || t.contact.is_some(), "满载时它追近、又看见了你");
    // 抛掉一半的货（最不值钱的那一种），载重减轻、航速变快
    Command::Voyage {
        owner: OwnerId::Player,
        fleet: me,
        order: crate::seafaring::VoyageOrder::Jettison { good: crate::GoodId(1), qty: cap / 2 },
    }
    .apply(&mut w)
    .unwrap();
    let light = w.wear_speed_bp(me);
    assert_eq!(light, 10_000);
    let t = run(&w, light);
    assert!(t.end.is_none() && t.contact.is_none(), "一整天都在雾里 3 格开外，放弃了");
}
