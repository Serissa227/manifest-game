//! 第八批 E7：势力的经济政策（docs/ECONOMY.md 6.10、8.4）在小型世界里的检查。
//! - 规则触发：本国港口的主食月均价居高不下 → 出口禁令（买不走、商会不再运、到期解除）；特产被大量运走 → 出口税上调；
//!   记为来源“规则”的组合事件，不占模型组合事件的冷却；规则关闭时什么也不发生；
//! - 模型提议的政策走组合事件的校验：势力或地点不交易这种商品时拒绝；进口关税只加在卖出上，补贴让产量上升。

use manifest_core::composed::{ComposedEffect, ComposedSource};
use manifest_core::defs::{EffectKind, PolicyRules};
use manifest_core::events::EventParams;
use manifest_core::market::{Side, quote};
use manifest_core::npc::{PlannerParams, plan_load};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
/// alpha 与 gamma 属于 0 号势力，beta 属于 1 号势力
const CROWN: FactionId = FactionId(0);
const LEAGUE: FactionId = FactionId(1);
const PLAYER: OwnerId = OwnerId::Player;
const GULL: OwnerId = OwnerId::Company(CompanyId(0));

fn defs(enabled: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    d.rules.policies =
        PolicyRules { enabled, staples: vec![GRAIN], staple_ratio: Fx::from_pct(130), ..PolicyRules::default() };
    Arc::new(d)
}

fn code(r: Result<CommandOutcome, CommandError>) -> &'static str {
    r.expect_err("应被拒绝").code()
}

/// 别处（beta、gamma）的粮食充足。
fn plenty_elsewhere(w: &mut World) {
    for l in [BETA, GAMMA] {
        let e = w.state.locations[l.idx()].market.get_mut(&GRAIN).unwrap();
        e.stock = e.target * 3;
    }
}

/// 先过六个平常的月份（攒下往常的价格），再过一个 alpha 的粮食整个月卖空（价格居高不下）的月份；别处的粮食一直充足。
fn a_dear_month(w: &mut World) {
    for _ in 0..(30 * 6) {
        let e = w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap();
        e.stock = e.target;
        plenty_elsewhere(w);
        w.end_day().unwrap();
    }
    assert!(!w.export_banned(ALPHA, GRAIN), "平常的月份不禁运");
    for _ in 0..30 {
        w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().stock = 0;
        plenty_elsewhere(w);
        w.end_day().unwrap();
        check_invariants(w).unwrap();
    }
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(PLAYER).next().unwrap().id
}

#[test]
fn a_dear_staple_brings_an_export_ban_that_blocks_buying_until_it_expires() {
    let mut w = World::new(defs(true), ScenarioId(0), 1).unwrap();
    a_dear_month(&mut w);
    // 月末：0 号势力禁止运出粮食 30 天，记为来源“规则”的组合事件（小型世界里商会大量买走特产，同时也可能触发出口税）
    let rec = w
        .state
        .events
        .composed
        .iter()
        .find(|r| r.effects[0].effect == EffectKind::ExportBan)
        .expect("规则触发了禁运")
        .clone();
    assert_eq!(rec.source, ComposedSource::Rule);
    assert_eq!(rec.effects.len(), 1);
    assert_eq!(rec.effects[0].effect, EffectKind::ExportBan);
    assert_eq!((rec.effects[0].params.faction_a, rec.effects[0].params.good), (Some(CROWN), Some(GRAIN)));
    assert!(rec.title.contains("禁运") && rec.text.contains("30 天"));
    assert_eq!(rec.day, 30 * 7 - 1, "第七个月的月末");
    assert!(w.export_banned(ALPHA, GRAIN) && w.export_banned(GAMMA, GRAIN), "0 号势力的地点都禁运");
    assert!(!w.export_banned(BETA, GRAIN), "别国照常");
    // 不占模型组合事件的冷却与年度上限
    assert!(w.check_composed_schedule().is_ok());
    // 买不走粮食；别的货照买
    w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().stock = 500;
    let f = player_fleet(&w);
    let before = w.state.clone();
    let r = Command::Buy { owner: PLAYER, fleet: f, good: GRAIN, qty: 5, max_total: None }.apply(&mut w);
    assert_eq!(code(r), "policy.export_ban");
    assert_eq!(w.state, before);
    Command::Buy { owner: PLAYER, fleet: f, good: CLOTH, qty: 1, max_total: None }.apply(&mut w).unwrap();
    // 商会不再打算从这里运粮食
    for (g, e) in w.state.locations[ALPHA.idx()].market.iter_mut() {
        if *g != GRAIN {
            e.stock = 0;
        }
    }
    let gf = w.fleets_of(GULL).find(|x| x.docked_at() == Some(ALPHA)).map(|x| x.id);
    if let Some(gf) = gf {
        let params = PlannerParams::for_owner(&w, GULL);
        let mut rng = Rng::derive(1, 0, Domain::Company, gf.0 as u64, 0);
        let load = plan_load(&w, gf, &params, &mut rng);
        assert!(!load.commands.iter().any(|c| matches!(c, Command::Buy { good, .. } if *good == GRAIN)));
    }
    // 30 天后解除（这个月粮价回落，不再触发）
    for _ in 0..31 {
        w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().stock = 2_000;
        plenty_elsewhere(&mut w);
        w.end_day().unwrap();
    }
    assert!(!w.export_banned(ALPHA, GRAIN), "禁令到期解除");
    let f = player_fleet(&w);
    Command::Buy { owner: PLAYER, fleet: f, good: GRAIN, qty: 1, max_total: None }.apply(&mut w).unwrap();
}

#[test]
fn heavy_specialty_exports_raise_the_export_duty() {
    let mut w = World::new(defs(true), ScenarioId(0), 2).unwrap();
    // beta 的棉布（1 号势力的特产，均衡日产 14）：这个月已被买走 500 件，超过一个月的正常产量（420 件）
    for _ in 0..28 {
        w.state.locations[ALPHA.idx()].market.get_mut(&GRAIN).unwrap().stock = 5_000;
        w.end_day().unwrap();
    }
    w.state.locations[BETA.idx()].market.get_mut(&CLOTH).unwrap().month_out = 500;
    let q0 = quote(&w, PLAYER, BETA, CLOTH, Side::Buy, 5).unwrap();
    let s0 = quote(&w, PLAYER, BETA, CLOTH, Side::Sell, 5).unwrap();
    for _ in 0..2 {
        w.end_day().unwrap();
    }
    let rec = w
        .state
        .events
        .composed
        .iter()
        .find(|r| r.effects[0].effect == EffectKind::ExportTariff && r.effects[0].params.good == Some(CLOTH))
        .expect("规则触发了棉布的出口税")
        .clone();
    assert_eq!((rec.source, rec.effects[0].params.faction_a), (ComposedSource::Rule, Some(LEAGUE)));
    assert_eq!(rec.effects[0].params.days, Some(w.defs.rules.policies.export_tax_days));
    assert_eq!(w.tariff_mult(BETA, CLOTH, Side::Buy), Fx::from_pct(200));
    assert_eq!(w.tariff_mult(BETA, CLOTH, Side::Sell), Fx::ONE, "出口税只管买走");
    let q1 = quote(&w, PLAYER, BETA, CLOTH, Side::Buy, 5).unwrap();
    let s1 = quote(&w, PLAYER, BETA, CLOTH, Side::Sell, 5).unwrap();
    assert_eq!(q1.tax_rate, q0.tax_rate.mul(Fx::from_pct(200)));
    assert_eq!(s1.tax_rate, s0.tax_rate);
    // 月末清零，新的一个月重新计数
    assert!(w.state.locations.iter().all(|l| l.market.values().all(|e| e.month_out == 0 || e.specialty)));
    check_invariants(&w).unwrap();
}

#[test]
fn switched_off_no_rule_policies_are_made() {
    let mut w = World::new(defs(false), ScenarioId(0), 3).unwrap();
    a_dear_month(&mut w);
    for _ in 0..40 {
        w.end_day().unwrap();
    }
    assert!(w.state.events.composed.is_empty());
    assert!(!w.export_banned(ALPHA, GRAIN));
    let json = serde_json::to_string(&w.state).unwrap();
    for field in ["\"export_ban\"", "\"import_tariff\"", "\"export_tariff\"", "\"month_out\""] {
        assert!(!json.contains(field), "关闭时存档里没有 {field}");
    }
}

fn composed(effects: Vec<ComposedEffect>) -> Command {
    Command::ApplyComposedEvent {
        title: "议会通过新税则".into(),
        text: "议会为保护本国作坊，通过了新的税则。".into(),
        effects,
        source: ComposedSource::Model,
    }
}

#[test]
fn policies_proposed_by_the_model_are_validated_and_take_effect() {
    let mut w = World::new(defs(false), ScenarioId(0), 4).unwrap();
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    let before = w.state.clone();
    // 势力不交易这种商品：拒绝
    let mut d = (*w.defs).clone();
    d.goods.push(d.goods[0].clone());
    let ghost = GoodId::from_idx(d.goods.len() - 1);
    let w2 = World { defs: Arc::new(d), state: w.state.clone() };
    let bad = ComposedEffect {
        effect: EffectKind::ExportBan,
        params: EventParams { faction_a: Some(CROWN), good: Some(ghost), days: Some(30), ..EventParams::default() },
    };
    assert_eq!(w2.validate_composed_effect(&bad, &[]).unwrap_err().code(), "not_traded");
    // 进口关税：1 号势力对运进来的粮食征 1.5 倍；补贴：gamma 的铁产量 1.3 倍
    let tariff = ComposedEffect {
        effect: EffectKind::ImportTariff,
        params: EventParams {
            faction_a: Some(LEAGUE),
            good: Some(GRAIN),
            mult: Some(Fx::from_pct(150)),
            days: Some(40),
            ..EventParams::default()
        },
    };
    let subsidy = ComposedEffect {
        effect: EffectKind::Subsidy,
        params: EventParams {
            loc: Some(GAMMA),
            good: Some(GoodId(3)),
            mult: Some(Fx::from_pct(130)),
            days: Some(40),
            ..EventParams::default()
        },
    };
    assert_eq!(w.state, before);
    composed(vec![tariff, subsidy]).apply(&mut w).unwrap();
    assert_eq!(w.tariff_mult(BETA, GRAIN, Side::Sell), Fx::from_pct(150));
    assert_eq!(w.tariff_mult(BETA, GRAIN, Side::Buy), Fx::ONE);
    assert_eq!(w.market(GAMMA, GoodId(3)).unwrap().event_supply, Fx::from_pct(130));
    check_invariants(&w).unwrap();
}
