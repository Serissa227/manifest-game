//! P04：以冻结的原实现逐项比较命令、计划、随机流和执行后的完整世界。

#[path = "support/npc_before_p04.rs"]
mod before;

use manifest_core::defs::{ForecastMethod, Reaction};
use manifest_core::info::InfoMode;
use manifest_core::nav::{NavTable, Terrain};
use manifest_core::npc::{self, PlannerParams};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::tiny_defs;
use manifest_core::{Command, FleetId, Fx, GoodId, LocId, OwnerId, ScenarioId, World};
use std::sync::Arc;

fn compare_load(world: &World, fid: FleetId, params: &PlannerParams, seed: u64) -> usize {
    let mut actual_rng = Rng::derive(seed, world.day(), Domain::Company, u64::from(fid.0), 0);
    let mut old_rng = Rng::derive(seed, world.day(), Domain::Company, u64::from(fid.0), 0);
    let actual = npc::plan_load(world, fid, params, &mut actual_rng);
    let old = before::plan_load(world, fid, params, &mut old_rng);
    assert_eq!(
        serde_json::to_vec(&(&actual.commands, &actual.hedge, &actual.plan)).expect("新计划"),
        serde_json::to_vec(&(&old.commands, &old.hedge, &old.plan)).expect("原计划"),
        "day={} fleet={fid:?} seed={seed}",
        world.day()
    );
    for _ in 0..4 {
        assert_eq!(actual_rng.next_u64(), old_rng.next_u64(), "随机流后继值");
    }
    let buys = actual.commands.iter().filter(|c| matches!(c, Command::Buy { .. })).count();
    let mut actual_world = world.clone();
    let mut old_world = world.clone();
    for (a, b) in actual.commands.iter().zip(&old.commands).chain(actual.hedge.iter().zip(&old.hedge)) {
        let a = a.apply(&mut actual_world);
        let b = b.apply(&mut old_world);
        assert_eq!(format!("{a:?}"), format!("{b:?}"), "逐项命令结果");
        assert_eq!(actual_world.state.log, old_world.state.log, "逐项事件日志");
        assert_eq!(actual_world.state_hash(), old_world.state_hash(), "逐项世界哈希");
    }
    assert_eq!(actual_world.state, old_world.state, "执行后全部字段");
    buys
}

fn compare_stages(world: &World, fid: FleetId, params: &PlannerParams, seed: u64) {
    let saved = world.state.clone();
    let actual = npc::stage_unload(world, fid, params);
    let old = before::stage_unload(world, fid, params);
    assert_eq!(serde_json::to_vec(&actual).expect("卸货"), serde_json::to_vec(&old).expect("原卸货"));
    compare_load(world, fid, params, seed);
    let mut after = world.clone();
    for cmd in actual {
        let _ = cmd.apply(&mut after);
    }
    // 修船、换船、补员以后必须重新计算本阶段航程，不能复用卸货阶段的舰队条件。
    compare_load(&after, fid, params, seed);
    assert_eq!(world.state, saved, "两个规划入口都只读世界");
}

#[test]
fn fixed_seed_trajectories_keep_each_command_plan_rng_log_and_hash() {
    for seed in [7, 42] {
        for v2 in [false, true] {
            for mode in [InfoMode::Live, InfoMode::Carried] {
                let mut defs = (*tiny_defs()).clone();
                defs.rules.npc.v2.enabled = v2;
                defs.rules.open_market.enabled = seed == 42;
                let mut world = World::new(Arc::new(defs), ScenarioId(0), seed).expect("开局");
                Command::SetInfoMode { owner: OwnerId::Player, mode }.apply(&mut world).expect("信息模式");
                for _ in 0..120 {
                    for fleet in world.state.fleets.values().filter(|f| f.docked_at().is_some()) {
                        let params = PlannerParams::for_owner(&world, fleet.owner);
                        compare_stages(&world, fleet.id, &params, seed);
                    }
                    world.end_day().expect("完整日结算");
                }
            }
        }
    }
}

#[test]
fn period_boundaries_unreachable_ports_cargo_and_no_trade_match() {
    for disconnected in [false, true] {
        let mut defs = (*tiny_defs()).clone();
        if disconnected {
            defs.map.terrain.fill(Terrain::Land);
            let ports: Vec<_> = defs.port_ids().map(|p| (p, defs.loc(p).cell)).collect();
            for &(_, cell) in &ports {
                let index = defs.map.idx(cell);
                defs.map.terrain[index] = Terrain::Deep;
            }
            defs.nav = Arc::new(NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &ports));
        }
        let mut world = World::new(Arc::new(defs), ScenarioId(0), 42).expect("航线夹具");
        let fid = world.flagship(OwnerId::Player).expect("舰队");
        let params = PlannerParams::for_owner(&world, OwnerId::Player);
        for day in [0, 89, 90, 179, 180, 269, 270, 359] {
            world.state.day = day;
            for cargo in [vec![], vec![(GoodId(0), 5)], vec![(GoodId(0), 5), (GoodId(1), 7)]] {
                let fleet = world.fleet_mut(fid).expect("舰队");
                fleet.cargo = cargo.into_iter().collect();
                fleet.idle_days = 5;
                compare_stages(&world, fid, &params, 42);
            }
        }
        // 无候选时仍按原权重换港；不可达时保持原地。没有可买商品也不建立无用的常驻状态。
        for location in &mut world.state.locations {
            for entry in location.market.values_mut() {
                entry.stock = 0;
            }
        }
        world.fleet_mut(fid).expect("舰队").cargo.clear();
        compare_stages(&world, fid, &params, 7);
    }
}

#[test]
fn tied_candidates_secondary_cargo_and_forecast_parameters_match() {
    let mut defs = (*tiny_defs()).clone();
    defs.rules.open_market.enabled = false;
    for good in &mut defs.goods {
        good.license = false;
    }
    let mut world = World::new(Arc::new(defs), ScenarioId(0), 42).expect("候选夹具");
    let fid = world.flagship(OwnerId::Player).expect("舰队");
    let here = world.fleet(fid).expect("舰队").docked_at().expect("停港");
    for (index, location) in world.state.locations.iter_mut().enumerate() {
        for entry in location.market.values_mut() {
            entry.base_price = 100;
            entry.target = 100;
            entry.stock = if index == here.idx() { 1000 } else { 1 };
            entry.price = if index == here.idx() { 20 } else { 500 };
            entry.history = std::iter::repeat_n(entry.price, 30).collect();
            entry.extra = false;
        }
    }
    let mut params = PlannerParams::for_owner(&world, OwnerId::Player);
    params.v2 = true;
    params.max_stock_share = Fx::from_pct(1);
    params.preferred.clear();
    let mut secondary = 0;
    for method in [ForecastMethod::Naive, ForecastMethod::Trend, ForecastMethod::Revert] {
        params.method = method;
        for reaction in [Reaction::Neutral, Reaction::Follow, Reaction::Avoid] {
            params.reaction = reaction;
            for seed in 0..32 {
                secondary = secondary.max(compare_load(&world, fid, &params, seed));
            }
        }
    }
    assert!(secondary >= 2, "夹具必须确实覆盖同目的地的次要货物");
    params.bias = vec![(GoodId(0), Fx::from_pct(15)), (GoodId(1), -Fx::from_pct(15))];
    compare_stages(&world, fid, &params, 42);
    world.agent_mut(OwnerId::Player).expect("玩家").cash = 0;
    compare_stages(&world, fid, &params, 42);
}

#[test]
fn invalid_undercrewed_and_sailing_fleets_keep_early_returns() {
    let mut world = World::new(tiny_defs(), ScenarioId(0), 7).expect("开局");
    let params = PlannerParams::for_owner(&world, OwnerId::Player);
    compare_stages(&world, FleetId(u32::MAX), &params, 7);
    let fid = world.flagship(OwnerId::Player).expect("舰队");
    world.fleet_mut(fid).expect("舰队").crew = 0;
    compare_stages(&world, fid, &params, 7);
    world.fleet_mut(fid).expect("舰队").location = manifest_core::world::FleetLocation::AtSea(
        manifest_core::world::Voyage::Route(manifest_core::world::RouteVoyage {
            dest: LocId(1),
            path: vec![world.defs.loc(LocId(0)).cell, world.defs.loc(LocId(1)).cell],
            step: 0,
            leg_progress: Fx::ZERO,
        }),
    );
    compare_stages(&world, fid, &params, 7);
}
