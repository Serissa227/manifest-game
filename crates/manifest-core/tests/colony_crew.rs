//! 在自己的殖民地请殖民者上船（小型世界）：减员后船员低于最低船员的舰队不会困在殖民地——
//! 殖民点没有酒馆，但自己的殖民地可以招募殖民者当船员（照付招募费，殖民地至少留下 1 人）；
//! 没有殖民地的殖民点仍然不能招募。每一步都检查不变量。

use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const SIGMA: LocId = LocId(4);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);

fn world(seed: u64) -> World {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    World::new(Arc::new(d), ScenarioId(0), seed).expect("开局")
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    let out = c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"));
    check_invariants(w).unwrap();
    out
}

fn err(w: &mut World, c: Command) -> String {
    match c.apply(w) {
        Ok(o) => panic!("{c:?} 应被拒绝，却得到 {o:?}"),
        Err(e) => e.to_string(),
    }
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家舰队").id
}

fn sail(w: &mut World, dest: LocId) {
    let f = fleet(w);
    ok(w, Command::SetSail { owner: P, fleet: f, dest });
    for _ in 0..40 {
        if w.fleet(f).unwrap().docked_at() == Some(dest) {
            return;
        }
        w.end_day().unwrap();
        check_invariants(w).unwrap();
    }
    panic!("40 天内没有抵达 {dest:?}");
}

#[test]
fn a_short_handed_fleet_can_take_colonists_aboard() {
    let mut w = world(8);
    let f = fleet(&w);
    let crew = w.fleet(f).unwrap().crew;
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 24 - crew });
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: GRAIN, qty: 60, max_total: None });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 10, max_total: None });
    sail(&mut w, SIGMA);
    // 没有殖民地时，殖民点不能招募
    assert!(err(&mut w, Command::HireCrew { owner: P, fleet: f, count: 1 }).contains("没有可招募的船员"));
    let out = ok(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "新晨港".into(), settlers: 12 });
    let CommandOutcome::ColonyFounded { colony } = out else { panic!("{out:?}") };

    // 减员到最低船员以下：出不了港
    let min = w.fleet(f).unwrap().crew_min(&w.defs);
    let crew = w.fleet(f).unwrap().crew;
    ok(&mut w, Command::DismissCrew { owner: P, fleet: f, count: crew - (min - 2) });
    assert!(matches!(
        Command::SetSail { owner: P, fleet: f, dest: LocId(0) }.apply(&mut w),
        Err(CommandError::CrewBelowMinimum { .. })
    ));

    // 请两名殖民者上船：照付招募费，殖民地少两人，船员回到最低船员
    let cash0 = w.agent(P).unwrap().cash;
    let pop0 = w.colony(colony).unwrap().population;
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 2 });
    assert_eq!(w.fleet(f).unwrap().crew, min);
    assert_eq!(w.colony(colony).unwrap().population, pop0 - 2);
    assert_eq!(w.agent(P).unwrap().cash, cash0 - 2 * w.defs.rules.crew_hire_cost);
    assert!(w.money_conserved());

    // 殖民地至少留下 1 人
    let pop = w.colony(colony).unwrap().population;
    let msg = err(&mut w, Command::HireCrew { owner: P, fleet: f, count: pop });
    assert!(msg.contains("至少要留下 1 人"), "{msg}");
    assert_eq!(w.colony(colony).unwrap().population, pop);

    // 现在可以出港了
    sail(&mut w, LocId(0));
    check_invariants(&w).unwrap();
}
