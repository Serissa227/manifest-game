//! 殖民相关的组合事件接入游戏会话（真实数据、“新大陆开拓者”剧本）：
//! 建立殖民地后，模型（Mock，按脚本输出）提出的殖民地事件经裁决与内核校验后执行；
//! 离线模板在有殖民地之后会组合出殖民地事件与发现物传闻；关闭 AI 只用命令日志重放一致。
//! 全部使用 Mock LLM 或离线模板，不访问任何真实服务。

mod common;

use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest};
use manifest_core::defs::EffectKind;
use manifest_core::ids::*;
use manifest_core::replay::Source;
use manifest_core::testkit::check_invariants;
use manifest_core::warehouse::Holder;
use manifest_core::{Command, CommandOutcome};
use manifest_sim::{AiDriver, GameSession};

const P: OwnerId = OwnerId::Player;

fn ok(s: &mut GameSession, c: Command) -> CommandOutcome {
    s.submit(c.clone()).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

/// 从诺瓦马尔出发，在可可海岸建立殖民地并开工农庄；返回会话、殖民地与殖民点。
/// 玩家之后不再行动，起始资金放宽到 30 万金币，免得两年的船员工资让商号破产、殖民地被清算。
fn colony_session(seed: u64) -> (GameSession, ColonyId, LocId) {
    let mut d = (*common::defs()).clone();
    let colonist = d.find_scenario("colonist").expect("新大陆开拓者剧本");
    d.scenarios[colonist.idx()].cash = 300_000;
    // 第三批给剧本加了开局货物与粮水、船员减到 70 人；这里仍按原来的开局（150 名船员、空货舱）
    let sc = &mut d.scenarios[colonist.idx()];
    sc.crew = 150;
    sc.cargo.clear();
    (sc.food, sc.water) = (0, 0);
    let defs = std::sync::Arc::new(d);
    let scenario = defs.find_scenario("colonist").expect("新大陆开拓者剧本");
    let mut s = GameSession::new(defs.clone(), scenario, seed).unwrap();
    let f = s.world.fleets_of(P).next().unwrap().id;
    let site = defs.find_loc("cacao_coast").unwrap();
    let (timber, grain) = (defs.find_good("timber").unwrap(), defs.find_good("grain").unwrap());
    ok(&mut s, Command::Resupply { owner: P, fleet: f, food: 60, water: 60 });
    ok(&mut s, Command::Buy { owner: P, fleet: f, good: timber, qty: 70, max_total: None });
    ok(&mut s, Command::Buy { owner: P, fleet: f, good: grain, qty: 140, max_total: None });
    ok(&mut s, Command::SetSail { owner: P, fleet: f, dest: site });
    for _ in 0..30 {
        if s.world.fleet(f).unwrap().docked_at() == Some(site) {
            break;
        }
        s.advance_day().unwrap();
    }
    assert_eq!(s.world.fleet(f).unwrap().docked_at(), Some(site), "抵达可可海岸");
    let crew = s.world.fleet(f).unwrap().crew;
    let min = s.world.fleet(f).unwrap().crew_min(&defs);
    let CommandOutcome::ColonyFounded { colony } = ok(
        &mut s,
        Command::FoundColony {
            owner: P,
            fleet: f,
            site,
            name: "可可垦地".into(),
            settlers: (crew - min - 10).min(100),
        },
    ) else {
        panic!("建立殖民地");
    };
    for (g, q) in s.world.fleet(f).unwrap().cargo.clone() {
        ok(
            &mut s,
            Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(site), good: g, qty: q },
        );
    }
    ok(&mut s, Command::BuildColony { owner: P, colony, building: defs.find_colony_building("farm").unwrap() });
    for _ in 0..25 {
        s.advance_day().unwrap();
    }
    check_invariants(&s.world).unwrap();
    (s, colony, site)
}

fn scripted(outputs: &[String]) -> AiDriver {
    let settings = AiSettings { mode: AiMode::Mock, ..AiSettings::default() };
    let provider = Provider::Mock(MockLlm::scripted(outputs.to_vec()));
    AiDriver::new(AiPipeline::new(common::ai_content(), &settings, Some(provider))).unwrap()
}

#[test]
fn model_proposed_colony_event_is_adjudicated_applied_and_replayed() {
    let (mut s, colony, site) = colony_session(21);
    let key = s.world.defs.loc(site).key.clone();
    let raw = serde_json::json!({
        "title": "可可垦地风调雨顺",
        "narrative": "据拓荒者寄回内海的书信所述，可可海岸今年雨水充足，垦地上的人们在栅栏里点起篝火庆祝。",
        "effects": [
            {"effect": "colony_output", "loc": key, "building": "farm", "mult": 1.25, "days": 45},
            {"effect": "colony_morale", "loc": key, "delta": 6},
        ]
    })
    .to_string();
    let driver = scripted(&[raw]);
    let morale0 = s.world.colony(colony).unwrap().morale;
    let (outcome, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
    assert!(outcome.is_some_and(|o| o.accepted().is_some()), "{:?}", driver.pipeline().audit_log());
    assert_eq!(cmds.len(), 1, "{:?}", driver.pipeline().audit_log());
    let tick = s.day() + 1;
    for c in cmds {
        s.schedule(tick, Source::Ai, c);
    }
    s.advance_day().unwrap();
    let c = s.world.colony(colony).unwrap();
    assert!(c.morale > morale0 || c.morale == 100, "士气上升：{morale0} → {}", c.morale);
    let farm = s.world.defs.find_colony_building("farm").unwrap();
    assert_eq!(s.world.colony_output_mult(c, farm), manifest_core::Fx(12_500));
    assert!(
        s.world
            .state
            .events
            .composed
            .last()
            .is_some_and(|r| r.effects.iter().any(|e| e.effect == EffectKind::ColonyOutput))
    );
    // 同一殖民地上已有进行中的产量效果：裁决器看不到，由内核拒绝
    for _ in 0..15 {
        s.advance_day().unwrap();
    }
    let again = serde_json::json!({
        "title": "又一个丰年",
        "narrative": "据拓荒者寄回内海的书信所述，可可海岸的收成仍然很好。",
        "effects": [{"effect": "colony_output", "loc": key, "building": "all", "mult": 1.1, "days": 30}]
    })
    .to_string();
    let driver = scripted(&[again]);
    let (_, cmds) = driver.run_request(&s.world, TaskRequest::Composed);
    assert!(cmds.is_empty(), "进行中的同类效果不叠加");
    assert!(driver.pipeline().audit_log().iter().any(|a| a.stage == "内核校验" && a.detail.contains("进行中")));
    // 只用命令日志重放
    for _ in 0..30 {
        s.advance_day().unwrap();
    }
    assert_eq!(s.replay().unwrap().state_hash(), s.world.state_hash());
}

#[test]
fn offline_templates_compose_colony_events_and_rumors_once_there_is_a_colony() {
    let (mut s, colony, site) = colony_session(22);
    let driver = AiDriver::with_mode(common::ai_content(), AiMode::Offline).unwrap().expect("离线 AI");
    for _ in 0..(2 * 360) {
        driver.run_due(&mut s);
        s.advance_day().unwrap();
    }
    check_invariants(&s.world).unwrap();
    assert!(s.world.colony(colony).is_some(), "殖民地存续");
    let composed = &s.world.state.events.composed;
    let colony_events: Vec<_> =
        composed.iter().filter(|r| r.effects.iter().any(|e| e.effect.targets_colony())).collect();
    assert!(!colony_events.is_empty(), "两年里应有离线模板组合的殖民地事件");
    for r in &colony_events {
        for e in r.effects.iter().filter(|e| e.effect.targets_colony()) {
            assert_eq!(e.params.loc, Some(site), "殖民地事件只作用于现有的殖民地");
        }
    }
    // 建立殖民地得到的名声达到门槛后，会听到发现物的传闻（只给海区，不算发现）
    assert!(s.world.state.agents[&P].fame >= s.world.defs.rules.discovery.rumor_min_fame);
    assert!(!s.world.state.explore.rumors.is_empty(), "两年里应有发现物传闻");
    for (d, r) in &s.world.state.explore.rumors {
        assert_eq!(Some(r.region), manifest_core::explore::discovery_region(&s.world.defs, *d));
    }
    assert_eq!(s.replay().unwrap().state_hash(), s.world.state_hash(), "关闭 AI 只用命令日志重放一致");
}
