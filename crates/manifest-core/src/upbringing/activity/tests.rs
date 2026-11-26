//! 守恒、成长边界、失败后果与事件预算的实际内核回归。
use super::*;
use crate::{Command, ScenarioId, StaticData, testkit};
use serde_json::json;
use std::sync::Arc;

fn defs() -> Arc<StaticData> {
    let mut d = (*testkit::captain_defs()).clone();
    d.scenarios[0].upbringing = true;
    d.rules.money.enabled = true;
    let at = d.locations[0].key.clone();
    d.upbringing=serde_json::from_value(json!({
        "families":[{"key":"family","name":"占位","scenario":"test","home":at,"born":[1489,6,1],"gender":"f","graduation":[1506,1,1],"stages":[{"from":[1502,1,1],"stage":"home","name":"占位","at":at}]}],
        "activities":[{"key":"rest","name":"占位","kind":"rest","fatigue":-20,"mood":8},
            {"key":"work","name":"占位","kind":"job","income":30,"gains":{"commerce":[7,13]},"fatigue":8},
            {"key":"tuition","name":"占位","kind":"lesson","cost":3},
            {"key":"read","name":"占位","kind":"reading","needs":["book"]}]
    })).unwrap();
    Arc::new(d)
}
fn world() -> World {
    World::new(defs(), ScenarioId(0), 42).unwrap()
}
fn run(w: &mut World, key: &str, index: u8) -> SlotResult {
    let a = w.defs.upbringing.activity(key).unwrap().clone();
    let mut result = SlotResult::default();
    w.settle_upbringing_activity(&a, index, 0, &mut result).unwrap();
    result
}
#[test]
fn tuition_and_short_purse_income_conserve_money_without_hinterland_top_up() {
    let mut w = world();
    let loc = w.upbringing_location().unwrap();
    let purse = w.state.circulation.towns.get_mut(&loc).unwrap();
    let moved = purse.money - 7;
    purse.money = 7;
    w.state.circulation.hinterland += moved;
    let total = w.all_money();
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    let reserve = w.state.circulation.hinterland;
    assert_eq!(run(&mut w, "tuition", 0).cash, -3);
    assert_eq!(w.purse(loc).unwrap().money, 10);
    assert_eq!(run(&mut w, "work", 1).cash, 10);
    assert_eq!(w.purse(loc).unwrap().money, 0);
    assert_eq!(run(&mut w, "work", 2).cash, 0);
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash + 7);
    assert_eq!(w.state.circulation.hinterland, reserve);
    assert_eq!(w.all_money(), total);
    assert!(w.money_conserved());
    testkit::check_invariants(&w).unwrap();
}
#[test]
fn insufficient_fee_is_a_failed_activity_without_partial_world_changes() {
    let mut w = world();
    let mut a = w.defs.upbringing.activity("tuition").unwrap().clone();
    a.cost = w.agent(OwnerId::Player).unwrap().cash + 1;
    let before = w.state.clone();
    let mut result = SlotResult::default();
    w.settle_upbringing_activity(&a, 0, 0, &mut result).unwrap();
    assert_eq!(w.state, before);
    assert_eq!(result.success, Some(false));
    assert_eq!(result.cash, 0);
}
#[test]
fn gain_preview_encloses_seeded_success_failure_fatigue_and_mood_results() {
    let mut d = defs();
    let a = &mut Arc::make_mut(&mut d).upbringing.activities[1];
    a.risk = Some(ActivityRisk { failure_bp: 5000, ..Default::default() });
    a.failure = ActivityFailure { income_pct: 25, gains_pct: 50, extra_fatigue: 2, mood: -2, events: vec![] };
    let mut seen = BTreeSet::new();
    for seed in 0..32 {
        for (fatigue, mood) in [(0, 50), (60, 0), (80, -50)] {
            let mut w = World::new(d.clone(), ScenarioId(0), seed).unwrap();
            let s = w.state.upbringing.as_mut().unwrap();
            s.fatigue = fatigue;
            s.mood = mood;
            let a = w.defs.upbringing.activity("work").unwrap();
            let range = w.upbringing_gain_range(a, "commerce");
            let out = run(&mut w, "work", 0);
            let actual = out.growth["commerce"];
            assert!((range[0]..=range[1]).contains(&actual), "{seed}: {range:?} / {actual}");
            seen.insert(out.success.unwrap());
            let mut same = World::new(d.clone(), ScenarioId(0), seed).unwrap();
            let s = same.state.upbringing.as_mut().unwrap();
            s.fatigue = fatigue;
            s.mood = mood;
            assert_eq!(run(&mut same, "work", 0), out);
            assert_eq!(same.state, w.state);
        }
    }
    assert_eq!(seen, BTreeSet::from([false, true]));
}
#[test]
fn fatigue_illness_and_rest_have_bounded_persistent_effects() {
    let mut d = defs();
    Arc::make_mut(&mut d).upbringing.rules.illness_bp = 10000;
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    w.state.upbringing.as_mut().unwrap().fatigue = 89;
    let a = w.defs.upbringing.activity("work").unwrap().clone();
    let efficiency = w.upbringing_efficiency(&a);
    run(&mut w, "work", 0);
    assert_eq!(w.state.upbringing.as_ref().unwrap().ill_until, Some(10));
    assert!(w.upbringing_efficiency(&a) < efficiency);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
    for _ in 0..10 {
        run(&mut w, "rest", 1);
    }
    let s = w.state.upbringing.as_ref().unwrap();
    assert_eq!(s.fatigue, 0);
    assert_eq!(s.stamina, 100);
    assert!(s.mood <= 100);
}
#[test]
fn every_attribute_projects_with_conduct_fortune_arcana_and_annual_caps() {
    let mut d = defs();
    let dmut = Arc::make_mut(&mut d);
    let names = [
        "constitution",
        "might",
        "agility",
        "intellect",
        "perception",
        "resolve",
        "charm",
        "seamanship",
        "commerce",
        "arms",
        "stewardship",
        "numeracy",
        "eloquence",
        "astronomy",
        "gunnery",
        "command",
        "etiquette",
        "intrigue",
        "medicine",
        "learning",
        "arcana",
        "morality",
        "honor",
        "piety",
        "sensibility",
        "fortune",
    ];
    dmut.captain.attributes = names
        .iter()
        .map(|key| crate::captain::AttributeDef {
            key: (*key).into(),
            name: "占位".into(),
            desc: String::new(),
            group: if ["morality", "honor", "piety", "sensibility"].contains(key) { "conduct" } else { "classic" }
                .into(),
            hidden: *key == "arcana",
            hooks: vec![],
        })
        .collect();
    let mut conduct = dmut.captain.groups[0].clone();
    conduct.key = "conduct".into();
    conduct.range = [0, 100];
    dmut.captain.groups.push(conduct);
    dmut.captain.ratings =
        vec![crate::captain::RatingDef { key: "mixed".into(), name: "占位".into(), weights: vec![(0, 1), (22, 1)] }];
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let fortune = w.upbringing_growth("fortune");
    assert!((1..=10).contains(&fortune));
    assert_eq!(w.gain_upbringing_growth("fortune", 1000), 0);
    assert_eq!(w.upbringing_projected("fortune"), fortune);
    assert_eq!(w.gain_upbringing_growth("arcana", 100), 0);
    assert_eq!(w.upbringing_projected("arcana"), 0);
    w.state.story2.flags.insert("arcana_awakened".into());
    for key in names.iter().take(21) {
        for (growth, projected) in [(0, 1), (99, 1), (100, 2), (999, 10), (1000, 10)] {
            w.state.upbringing.as_mut().unwrap().growth.insert((*key).into(), growth);
            assert_eq!(w.upbringing_projected(key), projected);
        }
    }
    assert_eq!(w.upbringing_growth("honor"), 50);
    assert_eq!(w.gain_upbringing_growth("honor", 500), 50);
    assert_eq!(w.upbringing_projected("honor"), 100);
    assert_eq!(w.upbringing_rating("mixed"), 1000);
    {
        let s = w.state.upbringing.as_mut().unwrap();
        s.growth.insert("commerce".into(), 0);
        s.year_growth.clear();
    }
    assert_eq!(w.gain_upbringing_growth("commerce", 500), 300);
    assert_eq!(w.gain_upbringing_growth("commerce", 1), 0);
    assert_eq!(w.gain_upbringing_growth("commerce", -100), -100);
    assert_eq!(w.gain_upbringing_growth("commerce", 100), 0);
    w.state.day += 360;
    assert_eq!(w.gain_upbringing_growth("commerce", 200), 200);
    assert_eq!(w.upbringing_growth("commerce"), 400);
}
#[test]
fn job_tiers_count_experience_and_lock_the_selected_professional_branch() {
    let mut d = defs();
    let a = Arc::make_mut(&mut d).upbringing.activities[1].clone();
    for (key, level, after, next, branch) in [
        ("begin", 1, 0, 2, None),
        ("responsible", 2, 2, 4, None),
        ("steady", 3, 4, 4, Some("steady")),
        ("bold", 3, 4, 4, Some("bold")),
    ] {
        let mut activity = a.clone();
        activity.key = key.into();
        activity.tier = Some(JobTier {
            group: "job".into(),
            name: "占位".into(),
            level,
            after,
            next,
            branch: branch.map(str::to_owned),
        });
        Arc::make_mut(&mut d).upbringing.activities.push(activity);
    }
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(
        w.upbringing_activity_available(w.defs.upbringing.activity("responsible").unwrap(), w.cast_date()).is_err()
    );
    run(&mut w, "begin", 0);
    run(&mut w, "begin", 1);
    run(&mut w, "responsible", 2);
    run(&mut w, "responsible", 0);
    run(&mut w, "steady", 1);
    assert_eq!(w.state.upbringing.as_ref().unwrap().job_progress["job"], 5);
    assert!(w.upbringing_flag("steady"));
    assert!(w.upbringing_activity_available(w.defs.upbringing.activity("bold").unwrap(), w.cast_date()).is_err());
    let loaded = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    assert!(loaded.upbringing_flag("steady"));
    assert!(
        loaded
            .upbringing_activity_available(loaded.defs.upbringing.activity("bold").unwrap(), loaded.cast_date())
            .is_err()
    );
}
#[test]
fn activity_skill_experience_survives_save_without_an_item_catalog() {
    let mut d = defs();
    Arc::make_mut(&mut d).story2.skills.insert("rigging".into());
    Arc::make_mut(&mut d).upbringing.activities[1].skills = vec![ActivitySkill { skill: "rigging".into(), xp: 12 }];
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let result = run(&mut w, "work", 0);
    assert_eq!(result.skills["rigging"], 12);
    assert_eq!(w.upbringing_skill_xp("rigging"), 12);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}
#[test]
fn scheduled_reading_and_story_rewards_share_the_same_annual_cap() {
    let mut d = defs();
    Arc::make_mut(&mut d).items=serde_json::from_value(json!({"book_categories":[{"key":"study","name":"占位"}],"items":[{"key":"book","name":"占位","kind":"book","rarity":1,"price":30,"read":{"days":2,"category":"study","gains":{"commerce":100},"skills":[]}}]})).unwrap();
    Arc::make_mut(&mut d).story2=serde_json::from_value(json!({"tracks":[{"key":"growth","name":"占位","kind":"main","start":"first","auto":false,"upbringing":true,"chapters":[{"key":"first","title":"占位","text":"占位","when":[{"kind":"attr","attr":"commerce","ge":4}],"choices":[{"key":"ok","text":"继续","next":"done","effects":[{"kind":"growth","attr":"commerce","value":999}]}]}]}]})).unwrap();
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    w.grant_item(OwnerId::Player, "book", 1).unwrap();
    assert_eq!(w.gain_upbringing_growth("commerce", 250), 250);
    w.start_story2("growth").unwrap();
    assert!(w.pending_story2().is_none());
    let slots = (0..3)
        .map(|index| {
            let mut after = AfterChoice::activity("read");
            after.book = Some("book".into());
            PlanSlot { index, lesson: None, after: Some(after) }
        })
        .collect();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
    w.end_day().unwrap();
    assert!(!w.has_read_work(OwnerId::Player, "book"));
    w.end_day().unwrap();
    assert!(w.has_read_work(OwnerId::Player, "book"));
    assert_eq!(w.upbringing_growth("commerce"), 300);
    assert!(w.inventory(OwnerId::Player).unwrap().attr_xp.is_empty());
    assert_eq!(w.pending_story2().unwrap().track, "growth");
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert_eq!(w.upbringing_growth("commerce"), 300);
    let mut loaded = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    for _ in 2..30 {
        w.end_day().unwrap();
        loaded.end_day().unwrap();
    }
    assert_eq!(loaded.state, w.state);
    assert_eq!(w.upbringing_growth("commerce"), 300);
    assert_eq!(w.inventory(OwnerId::Player).unwrap().bibliography.len(), 1);
}
#[test]
fn each_slot_selects_one_focus_and_alternate_slots_select_short_events_without_losing_the_rest() {
    let mut d = defs();
    let tracks=[("focus_a","main"),("focus_b","main"),("short_a","encounter"),("short_b","encounter")].into_iter().map(|(key,kind)|json!({"key":key,"name":"占位","kind":kind,"start":"first","auto":false,"chapters":[{"key":"first","title":"占位","text":"占位","choices":[{"key":"ok","text":"继续","next":"done"}]}]})).collect::<Vec<_>>();
    Arc::make_mut(&mut d).story2 = serde_json::from_value(json!({"tracks":tracks})).unwrap();
    Arc::make_mut(&mut d).upbringing.activities[0].events = vec!["focus_*".into(), "short_*".into()];
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.story2.pending.len(), 2);
    assert_eq!(w.state.story2.pending.iter().filter(|p| p.track.starts_with("focus_")).count(), 1);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
    for _ in 0..2 {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    }
    assert!(w.pending_story2().is_none());
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.story2.pending.len(), 1);
    assert!(w.state.story2.pending[0].track.starts_with("focus_"));
    assert!(w.state.upbringing.as_ref().unwrap().event_backlog.iter().any(|key| key.starts_with("short_")));
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert_eq!(w.state.story2.tracks.values().filter(|s| s.status == crate::story2::Status::Done).count(), 3);
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.story2.pending.len(), 1);
    assert!(w.state.story2.pending[0].track.starts_with("short_"));
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert_eq!(w.state.story2.tracks.values().filter(|s| s.status == crate::story2::Status::Done).count(), 4);
    assert!(w.pending_story2().is_none());
    assert_eq!(w.state.upbringing.as_ref().unwrap().settled.len(), 3);
}

#[test]
fn repeated_activity_events_obey_family_cooldown_and_exhaust_unseen_variants() {
    let mut d = defs();
    Arc::make_mut(&mut d).story2=serde_json::from_value(json!({"tracks":[{"key":"repeat","name":"占位","kind":"encounter","start":"first","auto":false,"chapters":[{"key":"first","title":"占位","text":"占位","once":false,"family":"family_visit","family_cooldown_days":90,"variants":[{"key":"a","text":"占位"},{"key":"b","text":"占位"}],"choices":[{"key":"ok","text":"继续","next":"first"}]}]}]})).unwrap();
    Arc::make_mut(&mut d).upbringing.activities[0].events = vec!["repeat".into()];
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let mut appearances = Vec::new();
    for _ in 0..220 {
        if w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
            Command::PlanMonth {
                owner: OwnerId::Player,
                slots: (0..3)
                    .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
                    .collect(),
            }
            .apply(&mut w)
            .unwrap();
        }
        while let Some(p) = w.pending_story2() {
            appearances.push((w.day(), p.variant.clone().unwrap()));
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    assert_eq!(appearances.len(), 2);
    assert!(appearances[1].0 - appearances[0].0 >= 90);
    assert_eq!(appearances.iter().map(|p| p.1.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert!(w.pending_story2().is_none());
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}

#[test]
fn zero_skill_rewards_leave_no_empty_inventory_to_reconcile() {
    let mut d = defs();
    Arc::make_mut(&mut d).story2.skills.insert("rigging".into());
    Arc::make_mut(&mut d).upbringing.activities[0].skills = vec![ActivitySkill { skill: "rigging".into(), xp: 0 }];
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    run(&mut w, "rest", 0);
    assert!(w.state.items.is_empty());
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}
