//! U04 工作包 4（A12）：这一局永远排不上的活动（按 reach 的静态判定，不写白名单），以及解锁通知。
#[path = "support/u04.rs"]
mod u04;
use manifest_core::{
    ScenarioId, World,
    upbringing::{Phase, unlocks::activity_deadlines},
};

fn world(scenario: &str) -> World {
    let d = u04::defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == scenario).unwrap());
    World::new(d, sid, 42).unwrap()
}

fn day_of(w: &World, date: [u32; 3]) -> u32 {
    manifest_core::scenario::day_of(&w.defs, date).unwrap()
}

#[test]
fn other_families_activities_and_other_academies_are_never_possible() {
    let d = u04::defs();
    let dl = activity_deadlines(&d, "mio");
    let own: Vec<String> =
        d.upbringing.family("mio").unwrap().stages.iter().filter_map(|s| s.entry_flag.clone()).collect();
    let entry: std::collections::BTreeSet<&str> =
        d.upbringing.families.iter().flat_map(|f| &f.stages).filter_map(|s| s.entry_flag.as_deref()).collect();
    let mut foreign = 0;
    for a in &d.upbringing.activities {
        if let Some(flag) = &a.unlock.flag
            && entry.contains(flag.as_str())
            && !own.contains(flag)
        {
            foreign += 1;
            assert_eq!(dl[&a.key], None, "{}：别家专属却判为可能", a.key);
        }
        // 11-04 改投学院：能岛水路见习处是澪改投路线的学院，也算本家的。
        if let Some(academy) = &a.place.academy
            && academy != "kyoto_court"
            && academy != "noshima_boat_school"
        {
            assert_eq!(dl[&a.key], None, "{}：别的学院（{academy}）却判为可能", a.key);
        }
    }
    assert!(foreign > 100, "别家专属的活动只有 {foreign} 个？");
    for k in (1..=7).map(|i| format!("u04_unlock_mio_{i}")) {
        assert!(dl[&k].is_some(), "{k}：本家的解锁练习要判为可能");
    }
}

#[test]
fn languages_without_any_teacher_in_this_family_are_never_possible() {
    let d = u04::defs();
    let dl = activity_deadlines(&d, "mio");
    let langs: Vec<_> =
        d.upbringing.activities.iter().filter(|a| a.key.starts_with("lesson_languages_lang_")).collect();
    assert!(langs.len() > 20);
    assert_eq!(dl["lesson_languages_lang_nahuatl"], None, "澪身边没人教纳瓦特尔语");
    assert!(langs.iter().any(|a| dl[&a.key].is_none()));
    // 京都宫中的课教日语：家乡期的“外语 · 日语”有人教就不判死。
    let teaches = d
        .upbringing
        .academy("kyoto_court")
        .unwrap()
        .curriculum
        .iter()
        .any(|c| c.skills.iter().any(|s| s.skill == "lang_japanese"));
    if teaches {
        assert!(dl["lesson_languages_lang_japanese"].is_some());
    }
}

#[test]
fn home_only_activities_stop_being_possible_when_the_home_stage_ends() {
    let d = u04::defs();
    let dl = activity_deadlines(&d, "lieve");
    let academy_from = manifest_core::scenario::day_of(&d, [1554, 1, 10]).unwrap();
    let home_only: Vec<_> = d
        .upbringing
        .activities
        .iter()
        .filter(|a| {
            a.stage == manifest_core::upbringing::ActivityStage::Home
                && a.unlock == Default::default()
                && a.place.academy.is_none()
        })
        .collect();
    assert!(!home_only.is_empty());
    for a in home_only {
        if let Some(Some(last)) = dl.get(&a.key) {
            assert!(*last < academy_from, "{}：家乡期专用的活动在入学后（{last}）还判为能排", a.key);
        }
    }
}

#[test]
fn unlocks_open_at_the_start_are_recorded_silently_and_new_ones_are_reported() {
    let mut w = world("mio_1553");
    let s = w.state.upbringing.as_ref().unwrap();
    assert!(!s.unlocks.is_empty(), "开局已开放的要先记下");
    assert!(s.unlocks.values().all(Option::is_none));
    assert!(w.upbringing_unlocked_now().is_empty());
    let a = w.defs.upbringing.activity("u04_unlock_mio_1").unwrap().clone();
    let (attr, need) = a.unlock.growth.iter().next().map(|(k, v)| (k.clone(), *v)).unwrap();
    w.state.upbringing.as_mut().unwrap().growth.insert(attr, need);
    // 跑到第一旬结算之后。
    let mut ordinal = 0;
    // U05：寰宇按周，第一格在 1 月 2 日结算；跑到 5 日（按旬时第一旬 10 日结算，跑到 12 日）。都在开放提示的 10 天之内。
    let end = day_of(&w, if w.upbringing_weekly() { [1553, 1, 5] } else { [1553, 1, 12] });
    while w.day() < end {
        while w.pending_story2().is_some() || w.state.story.pending.is_some() {
            ordinal += 1;
            u04::answer(&mut w, ordinal);
        }
        if w.act_running() && w.act_bot_step().unwrap() {
            continue;
        }
        if !w.act_running() && w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
            let slots = w.auto_plan("balanced").unwrap();
            w.upbringing_plan_command(slots).apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    let now = w.upbringing_unlocked_now();
    assert!(now.iter().any(|(_, k)| *k == "activity:u04_unlock_mio_1"), "{now:?}");
    assert!(now.iter().all(|(d, _)| w.day() - d < manifest_core::upbringing::unlocks::UNLOCK_NOTICE_DAYS));
    // 存档往返；旧档没有这项照读。
    let back = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(back.state, w.state);
    let mut json = serde_json::to_value(&w.state).unwrap();
    json["upbringing"].as_object_mut().unwrap().remove("unlocks");
    let old: manifest_core::WorldState = serde_json::from_value(json).unwrap();
    assert!(old.upbringing.unwrap().unlocks.is_empty());
}

#[test]
fn rating_rank_ups_are_reported() {
    let mut w = world("mio_1553");
    let keys: Vec<String> = w.defs.captain.attributes.iter().map(|a| a.key.clone()).collect();
    let s = w.state.upbringing.as_mut().unwrap();
    for k in keys {
        s.growth.insert(k, 950);
    }
    let mut ordinal = 0;
    // U05：寰宇按周，第一格在 1 月 2 日结算；跑到 5 日（按旬时第一旬 10 日结算，跑到 12 日）。都在开放提示的 10 天之内。
    let end = day_of(&w, if w.upbringing_weekly() { [1553, 1, 5] } else { [1553, 1, 12] });
    while w.day() < end {
        while w.pending_story2().is_some() || w.state.story.pending.is_some() {
            ordinal += 1;
            u04::answer(&mut w, ordinal);
        }
        if w.act_running() && w.act_bot_step().unwrap() {
            continue;
        }
        if !w.act_running() && w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
            let slots = w.auto_plan("balanced").unwrap();
            w.upbringing_plan_command(slots).apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    assert!(w.upbringing_unlocked_now().iter().any(|(_, k)| k.starts_with("rating:") && k.ends_with(":S")));
}
