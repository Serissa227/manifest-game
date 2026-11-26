//! E71c：历史预算一次性消费，任何一条越界都撤销整批。
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest};
use manifest_core::{
    Command, Fx, LocId, ScenarioId, World,
    composed::{ComposedEffect, ComposedSource},
    defs::EffectKind,
    events::EventParams,
    summary::ripple::{self, RippleEvent, RippleResult},
};
use std::sync::Arc;

fn world(budget: u32) -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    let s = &mut defs.scenarios[0];
    s.start_date = [1558, 1, 1];
    s.control_date = s.start_date;
    defs.history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap().ripple_budget = budget;
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.end_day().unwrap();
    w.end_day().unwrap();
    w
}
fn event(loc: LocId) -> RippleEvent {
    RippleEvent {
        title: "占位".into(),
        text: "占位。".into(),
        effects: vec![ComposedEffect {
            effect: EffectKind::LocationSupply,
            params: EventParams { loc: Some(loc), mult: Some(Fx(9500)), days: Some(15), ..Default::default() },
        }],
    }
}
fn result(w: &World, events: Vec<RippleEvent>) -> RippleResult {
    let (outcome, resolved, _) = ripple::available(w, "sample_opening").unwrap();
    RippleResult {
        event: "sample_opening".into(),
        outcome,
        resolved_day: resolved,
        requested_day: w.day(),
        summary: "占位。".into(),
        events,
        source: ComposedSource::Template,
    }
}
fn reject(w: &mut World, r: RippleResult) {
    let before = w.state_hash();
    assert!(Command::ApplyRipple { result: r }.apply(w).is_err());
    assert_eq!(w.state_hash(), before);
}
#[test]
fn two_events_share_one_budget_and_cannot_spend_it_again() {
    let mut w = world(1000);
    let r = result(&w, vec![event(LocId(0)), event(LocId(1))]);
    assert_eq!(ripple::cost(&r.events), Some(1000));
    Command::ApplyRipple { result: r.clone() }.apply(&mut w).unwrap();
    let receipt = w.state.history.events["sample_opening"].ripple.as_ref().unwrap();
    assert_eq!(receipt.spent, 1000);
    assert_eq!(w.state.events.composed.len(), 2);
    reject(&mut w, r);
    assert!(ripple::available(&w, "sample_opening").is_none());
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state_hash(), w.state_hash());
}
#[test]
fn over_budget_expired_illegal_or_duplicate_effect_batches_leave_no_partial_state() {
    let base = world(1000);
    let mut too_much = result(&base, vec![event(LocId(0)), event(LocId(1))]);
    too_much.events[1].effects[0].params.mult = Some(Fx(9000));
    reject(&mut base.clone(), too_much);
    let duplicate = result(&base, vec![event(LocId(0)), event(LocId(0))]);
    reject(&mut base.clone(), duplicate);
    let mut bad = result(&base, vec![event(LocId(0)), event(LocId(1))]);
    bad.events[1].effects[0].params.days = Some(5000);
    reject(&mut base.clone(), bad);
    let mut too_many = result(&base, vec![event(LocId(0)); 3]);
    reject(&mut base.clone(), too_many.clone());
    too_many.events.clear();
    too_many.outcome = "invented".into();
    reject(&mut base.clone(), too_many);
    let mut expired = base.clone();
    expired.state.day += ripple::RIPPLE_DAYS + 1;
    let mut stale = result(&base, vec![]);
    stale.requested_day = expired.day();
    reject(&mut expired, stale);
    let mut stale = result(&base, vec![]);
    stale.requested_day = base.day().saturating_sub(2);
    reject(&mut base.clone(), stale);
}
#[tokio::test]
async fn test9_ripple_has_offline_fallback_with_zero_or_positive_budget() {
    let content = Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap());
    for budget in [0, 20000] {
        let mut w = world(budget);
        let p = AiPipeline::new(content.clone(), &AiSettings { mode: AiMode::Offline, ..Default::default() }, None);
        let task = p.prepare(&w, TaskRequest::Ripple { event: "sample_opening".into() }).unwrap();
        let outcome = p.process(task).await;
        assert!(outcome.accepted().is_some());
        let commands = p.finalize(&w, &outcome);
        assert_eq!(commands.len(), 1);
        commands[0].apply(&mut w).unwrap();
        assert!(w.state.history.events["sample_opening"].ripple.as_ref().unwrap().spent <= budget);
    }
}
#[tokio::test]
async fn test7_model_cannot_expand_effect_bounds_or_budget() {
    let w = world(1000);
    let content = Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap());
    for body in [
        serde_json::json!({"summary":"占位。","events":[],"budget":99999}),
        serde_json::json!({"summary":"占位。","events":[{"title":"占位","narrative":"占位。","effects":[{"effect":"location_supply","loc":"test_west","mult":0.6,"days":15}]}]}),
        serde_json::json!({"summary":"占位。","events":[{"title":"占位","narrative":"占位。","effects":[{"effect":"gold_rain","cash":1000}]}]}),
    ] {
        let p = AiPipeline::new(
            content.clone(),
            &AiSettings { mode: AiMode::Mock, ..Default::default() },
            Some(Provider::Mock(MockLlm::scripted(vec![body.to_string()]))),
        );
        let before = w.state_hash();
        let task = p.prepare(&w, TaskRequest::Ripple { event: "sample_opening".into() }).unwrap();
        let outcome = p.process(task).await;
        assert!(outcome.accepted().is_none());
        assert!(p.finalize(&w, &outcome).is_empty());
        assert_eq!(w.state_hash(), before);
    }
}
#[test]
fn loader_and_save_reject_forged_ripple_receipts() {
    let mut w = world(ripple::MAX_BUDGET + 1);
    assert!(!manifest_core::history::validation::validate(&w.defs).is_empty());
    assert!(ripple::available(&w, "sample_opening").is_none());
    Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap().ripple_budget =
        100;
    w.state.history.events.get_mut("sample_opening").unwrap().ripple = Some(ripple::RippleReceipt {
        day: w.day(),
        spent: 101,
        summary: "占位。".into(),
        source: ComposedSource::Model,
    });
    assert!(World::from_snapshot(w.defs.clone(), w.state).is_err());
}

#[test]
fn schema_with_no_visible_effect_targets_allows_only_an_empty_ripple_batch() {
    for keep_supply in [false, true] {
        let mut w = world(0);
        Arc::make_mut(&mut w.defs)
            .composed
            .effects
            .retain(|effect| keep_supply && effect.effect == EffectKind::LocationSupply);
        let mut schema = manifest_ai::schema::output_schema(manifest_data::ProposalKind::Ripple, &w.defs).schema;
        manifest_ai::pipeline::f9::ripple::narrow_schema(&mut schema, &[]);
        manifest_ai::schema::check_strict(&schema).unwrap();
        assert_eq!(schema["properties"]["events"]["maxItems"], 0);
        assert!(schema.get("$defs").is_none());
        assert!(schema.pointer("/properties/events/items/properties/effects/items/anyOf").is_none());
    }
}
