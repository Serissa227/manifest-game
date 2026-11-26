//! 目标交付、限期、条件效果、检定、变体与冷却的真实命令回归。
use manifest_core::{story2::*, *};
use serde_json::{Value, json};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;

fn world(chapters: Value) -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    defs.scenarios[0].start_date = [1553, 1, 1];
    defs.scenarios[0].control_date = [1553, 1, 1];
    defs.story2.tracks = vec![
        serde_json::from_value(
            json!({"key":"test","name":"试航","kind":"request","start":"start","chapters":chapters}),
        )
        .unwrap(),
    ];
    World::new(d, ScenarioId(0), 42).unwrap()
}
fn answer(w: &mut World) {
    Command::StoryAnswer { owner: O, choice: 0 }.apply(w).unwrap();
}
fn reject(w: &mut World) {
    let before = w.state.clone();
    assert!(Command::StoryAnswer { owner: O, choice: 0 }.apply(w).is_err());
    assert_eq!(before, w.state);
}

#[test]
fn aggregate_delivery_is_atomic_consumed_once_and_balanced() {
    let mut w = world(json!([{"key":"start","title":"交货","text":"送粮到港。","objectives":[
        {"kind":"goods","good":"grain","qty":2,"at":"test_west"},
        {"kind":"goods","good":"grain","qty":3,"at":"test_west"}],
        "choices":[{"key":"deliver","text":"交货","next":"done","effects":[{"kind":"cash","value":10}]}]}]));
    let fleet = w.flagship(O).unwrap();
    let good = GoodId::from_idx(w.defs.goods.iter().position(|g| g.key == "grain").unwrap());
    // 用真实交易取得五件货，不能把同三件货同时算进两个目标。
    Command::Buy { owner: O, fleet, good, qty: 3, max_total: None }.apply(&mut w).unwrap();
    w.refresh_story2();
    reject(&mut w);
    Command::Buy { owner: O, fleet, good, qty: 2, max_total: None }.apply(&mut w).unwrap();
    w.refresh_story2();
    answer(&mut w);
    assert_eq!(w.fleet(fleet).unwrap().cargo.get(&good), None);
    assert_eq!(w.state.story2.tracks["test"].status, Status::Done);
    reject(&mut w);
    manifest_core::testkit::check_invariants(&w).unwrap();
}

#[test]
fn failed_effect_rolls_back_delivery_and_all_earlier_effects() {
    let mut w = world(
        json!([{"key":"start","title":"交付","text":"带上一件礼物。","objectives":[{"kind":"item","item":"sabre","qty":1}],
        "choices":[{"key":"give","text":"交付","next":"done","effects":[{"kind":"item","item":"sabre","qty":-1},{"kind":"item","item":"dagger","qty":-1}]}]}]),
    );
    w.grant_item(O, "sabre", 1).unwrap();
    w.refresh_story2();
    reject(&mut w);
    assert_eq!(w.item_quantity(O, "sabre"), 1);
    w.grant_item(O, "dagger", 1).unwrap();
    answer(&mut w);
    assert_eq!(w.item_quantity(O, "sabre"), 0);
    assert_eq!(w.item_quantity(O, "dagger"), 0);
}

#[test]
fn unreachable_objectives_expire_even_when_event_never_entered_the_queue() {
    let mut w = world(json!([{"key":"start","title":"限期","text":"等待不可能及时到达的信。","deadline_days":2,
        "objectives":[{"kind":"wait","days":10}],"when":[{"kind":"flag","flag":"never"}],
        "timeout":{"next":"failed","effects":[{"kind":"flag","flag":"expired"}]},
        "choices":[{"key":"ok","text":"继续","next":"done"}]}]));
    assert!(w.pending_story2().is_none());
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["test"].status, Status::Active);
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["test"].status, Status::Active);
    w.end_day().unwrap();
    assert_eq!(w.state.story2.tracks["test"].status, Status::Failed);
    assert!(w.state.story2.flags.contains("expired"));
    assert!(w.pending_story2().is_none());
}

#[test]
fn variants_are_stable_and_repeats_share_family_cooldown() {
    let mut w = world(
        json!([{"key":"start","title":"海风","text":"今天的港口。","once":false,"family":"dock","family_cooldown_days":2,
        "variants":[{"key":"z","text":"晚来的风。"},{"key":"a","text":"最先的风。"}],
        "choices":[{"key":"again","text":"明天再来","next":"start"},{"key":"end","text":"离开","next":"done"}]}]),
    );
    assert_eq!(w.pending_story2().unwrap().variant.as_deref(), Some("a"));
    let saved = w.state.clone();
    let restored = World::from_snapshot(w.defs.clone(), saved).unwrap();
    assert_eq!(restored.state, w.state);
    answer(&mut w);
    assert!(w.pending_story2().is_none());
    reject(&mut w);
    w.end_day().unwrap();
    assert!(w.pending_story2().is_none());
    w.end_day().unwrap();
    assert_eq!(w.pending_story2().unwrap().variant.as_deref(), Some("z"));
    answer(&mut w);
    assert_eq!(w.state.story2.tracks["test"].status, Status::Active);
    for _ in 0..2 {
        w.end_day().unwrap();
    }
    assert!(w.pending_story2().is_none());
}

#[test]
fn queued_repeat_variant_is_frozen_when_its_condition_changes() {
    let mut w = world(json!([{"key":"start","title":"海风","text":"今天的港口。",
        "once":false,"family":"dock","family_cooldown_days":2,
        "variants":[{"key":"a","when":[{"kind":"flag","flag":"departed","value":false}],"text":"送别。"}],
        "choices":[{"key":"end","text":"离开","next":"done"}]}]));
    assert_eq!(w.pending_story2().unwrap().variant.as_deref(), Some("a"));
    w.state.story2.flags.insert("departed".into());
    w.refresh_story2();
    assert_eq!(w.pending_story2().unwrap().variant.as_deref(), Some("a"));
    let mut restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    answer(&mut restored);
    assert_eq!(restored.state.story2.last.as_ref().unwrap().variant.as_deref(), Some("a"));
}

#[test]
fn checks_use_the_queued_day_and_restore_the_same_success_or_failure() {
    let mut w = world(
        json!([{"key":"start","title":"试航","text":"解读海图。","choices":[{"key":"try","text":"尝试","next":"done",
        "check":{"attr":"tactics","base":50,"per":1},"effects":[{"kind":"flag","flag":"success"}],
        "fail":{"next":"failed","effects":[{"kind":"flag","flag":"failure"}]}}]}]),
    );
    let mut copy = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    answer(&mut w);
    answer(&mut copy);
    assert_eq!(w.state, copy.state);
    assert!(w.state.story2.last.as_ref().unwrap().success.is_some());
    assert_ne!(w.state.story2.flags.contains("success"), w.state.story2.flags.contains("failure"));
}

#[test]
fn personal_effects_and_conditions_use_shared_real_state() {
    let mut w = world(
        json!([{"key":"start","title":"见识","text":"读书赠礼以后。","choices":[{"key":"ok","text":"记下","next":"done","effects":[
        {"kind":"affinity","person":"classmate_a","value":9},{"kind":"growth","attr":"tactics","value":30},
        {"kind":"item","item":"sabre","qty":1},{"kind":"memory","memory":"first","title":"第一次远行"},{"kind":"title","title":"旅人"}]}]}]),
    );
    answer(&mut w);
    let list: Vec<Condition> = serde_json::from_value(json!([
        {"kind":"affinity","person":"classmate_a","ge":9},{"kind":"growth","attr":"tactics","ge":30},
        {"kind":"item","item":"sabre","qty":1},{"kind":"alive","person":"classmate_a","value":true}]))
    .unwrap();
    assert!(w.story2_conditions(&list, w.day()));
    assert_eq!(w.state.story2.memories["first"], "第一次远行");
    assert!(w.state.cast.titles.contains("旅人"));
    assert_eq!(w.state.story2.last.as_ref().unwrap().outcomes.len(), 5);
}

#[test]
fn semantic_validation_rejects_missing_timeouts_checks_and_bad_references() {
    let w = world(json!([{"key":"start","title":"坏数据","text":"拒绝隐式跳过。","deadline_days":1,
        "objectives":[{"kind":"goods","good":"missing","qty":-1,"at":"missing"}],
        "choices":[{"key":"bad","text":"不能通过","next":"done","check":{"attr":"missing","base":500,"per":1},"effects":[{"kind":"item","item":"missing","qty":1}]}]}]));
    let errors = validation::validate(&w.defs).join("\n");
    for expected in ["timeout", "fail", "目标引用", "效果引用", "检定引用", "系数越界"] {
        assert!(errors.contains(expected), "{errors}");
    }
}

#[test]
fn world_effects_obey_composed_bounds_and_do_not_partially_grant_rewards() {
    let mut w = world(
        json!([{"key":"start","title":"市集","text":"一场港口活动。","choices":[{"key":"ok","text":"参与","next":"done"}]}]),
    );
    let effect = manifest_core::composed::ComposedEffect {
        effect: manifest_core::defs::EffectKind::Development,
        params: manifest_core::events::EventParams { loc: Some(LocId(0)), delta: Some(9999), ..Default::default() },
    };
    Arc::make_mut(&mut w.defs).story2.tracks[0].chapters[0].choices[0].effects = vec![
        Effect::Item { item: "sabre".into(), qty: 1 },
        Effect::World { title: "市集".into(), text: "码头附近修葺一新。".into(), effects: vec![effect] },
    ];
    reject(&mut w);
    assert_eq!(w.item_quantity(O, "sabre"), 0);
    let c = &mut Arc::make_mut(&mut w.defs).story2.tracks[0].chapters[0].choices[0];
    if let Effect::World { effects, .. } = &mut c.effects[1] {
        effects[0].params.delta = Some(1);
    }
    answer(&mut w);
    assert_eq!(w.item_quantity(O, "sabre"), 1);
    assert_eq!(w.state.events.composed.last().unwrap().source, manifest_core::composed::ComposedSource::Rule);
    manifest_core::testkit::check_invariants(&w).unwrap();
}

#[test]
fn actual_affinity_outcome_is_clamped_and_tie_removal_is_persistent() {
    let mut w = world(
        json!([{"key":"start","title":"朋友","text":"一段相处。","choices":[{"key":"ok","text":"继续","next":"done","effects":[
        {"kind":"affinity","person":"classmate_a","value":10},
        {"kind":"tie","a":"classmate_a","b":"classmate_b","relation":"friends","remove":true}]}]}]),
    );
    w.change_affinity("classmate_a", 98).unwrap();
    w.change_tie("classmate_a", "classmate_b", manifest_core::cast::relations::Relation::Friends).unwrap();
    answer(&mut w);
    assert!(matches!(&w.state.story2.last.as_ref().unwrap().outcomes[0], Effect::Affinity { value: 2, .. }));
    assert!(!w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b"));
    let copy = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(copy.active_ties(), w.active_ties());
}

#[test]
fn shared_family_suppresses_other_tracks_and_forged_cooldowns_are_rejected() {
    let mut w =
        world(json!([{"key":"start","title":"家族","text":"相似的一幕。","family":"dock","family_cooldown_days":3,
        "choices":[{"key":"ok","text":"继续","next":"done"}]}]));
    let mut track = w.defs.story2.tracks[0].clone();
    track.key = "z_other".into();
    Arc::make_mut(&mut w.defs).story2.tracks.push(track);
    w.refresh_story2();
    assert_eq!(w.state.story2.pending.len(), 2);
    answer(&mut w);
    assert!(w.pending_story2().is_none());
    for _ in 0..3 {
        w.end_day().unwrap();
    }
    assert_eq!(w.pending_story2().unwrap().track, "z_other");
    let mut state = w.state.clone();
    state.story2.families.insert("dock".into(), w.day() + 1);
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
}
