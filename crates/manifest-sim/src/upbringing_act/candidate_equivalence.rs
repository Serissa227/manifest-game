//! P15：旧判定由改前已有的逐项诊断重建；该接口仍走原章节归属扫描，不调用新判定。
use manifest_core::{World, upbringing::activity_validation::event_matches};
use std::collections::{BTreeMap, BTreeSet};

fn legacy_keys(w: &World) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    if let Some(s) = &w.state.upbringing {
        keys.extend(s.activity_tracks.iter().cloned());
        keys.extend(s.cadence.deferred.keys().cloned());
        keys.extend(w.defs.upbringing.event_gates.keys().cloned());
        for t in &w.defs.story2.tracks {
            if s.event_backlog.iter().any(|p| event_matches(p, &t.key))
                || w.defs
                    .upbringing
                    .festivals
                    .iter()
                    .any(|f| f.event.iter().chain(&f.events).any(|p| p.contains('*') && event_matches(p, &t.key)))
            {
                keys.insert(t.key.clone());
            }
        }
    }
    keys
}

fn legacy_candidate_now(w: &World, key: &str, triggered: bool) -> (bool, BTreeMap<String, bool>) {
    // 这块前置没有改规则，两边共用；未通过时原函数也还没走到章节归属反查。
    if w.cadence_candidate_chapter(key, triggered).is_none() {
        return (false, BTreeMap::from([("prerequisites".into(), false)]));
    }
    let checks = w.cadence_candidate_checks(key, triggered);
    let accepted = checks.values().all(|value| *value);
    (accepted, checks)
}

#[test]
fn p15_candidates_match_legacy_every_day_through_four_stages() {
    let root = manifest_data::find_data_dir().expect("data_root");
    let defs = manifest_data::load_world(&root, "terra16").expect("terra16");
    let start = crate::upbringing_runs::start_params(&defs, "mio", 42).expect("mio_start");
    let mut w = World::from_start(defs, &start, |_| {}).expect("new_world");
    let mut answered = 0;
    let mut days = 0;
    let mut stages = BTreeSet::new();
    let mut through = None;
    while w.act_running() && through.is_none_or(|day| w.day() < day) {
        if !w.state.story2.pending.is_empty() || w.state.story.pending.is_some() {
            assert!(!matches!(
                crate::upbringing_runs::answer(&mut w, answered),
                crate::upbringing_runs::Answered::Nothing
            ));
            answered += 1;
            continue;
        }
        if w.act_bot_step().expect("bot_step") {
            continue;
        }
        let stage = w.state.upbringing.as_ref().and_then(|s| s.stage_from);
        if let Some(stage) = stage {
            stages.insert(stage);
        }
        // 任务单允许覆盖四阶段：第四段继续逐日走满七天，不改日期、不跳过中间任何一天。
        if stages.len() >= 4 && through.is_none() {
            through = Some(w.day() + 7);
        }
        let keys = legacy_keys(&w);
        let mut truths = BTreeMap::<String, [usize; 2]>::new();
        for triggered in [false, true] {
            let mut old = Vec::new();
            let mut new = Vec::new();
            for key in &keys {
                let state = w.state.story2.tracks.get(key);
                let chapter = w.defs.story2.track(key).and_then(|t| {
                    let restart = state.is_some_and(|s| {
                        matches!(s.status, manifest_core::story2::Status::Done | manifest_core::story2::Status::Failed)
                    });
                    let entered = if restart { w.day() } else { state.map_or(w.day(), |s| s.entered) };
                    t.chapter(if restart { &t.start } else { state.map_or(t.start.as_str(), |s| s.chapter.as_str()) })
                        .map(|c| (t, c, entered))
                });
                let same_entered = chapter.is_some_and(|(_, _, entered)| state.is_some_and(|s| s.entered == entered));
                let same_reference = chapter.is_some_and(|(t, c, _)| {
                    state.and_then(|s| t.chapter(&s.chapter)).is_some_and(|at| std::ptr::eq(at, c))
                });
                for (name, value) in [
                    ("context_state", state.is_some()),
                    ("context_entered", same_entered),
                    ("context_reference", same_reference),
                ] {
                    truths.entry(name.into()).or_default()[usize::from(value)] += 1;
                }
                let (accepted, checks) = legacy_candidate_now(&w, key, triggered);
                for (condition, value) in checks {
                    truths.entry(condition).or_default()[usize::from(value)] += 1;
                }
                if accepted {
                    old.push(key);
                }
                if w.cadence_candidate_now(key, triggered) {
                    new.push(key);
                }
            }
            assert_eq!(new, old, "day={} stage={stage:?} triggered={triggered}", w.day());
            println!(
                "day={} stage={stage:?} triggered={triggered} keys={} candidates={} order_equal=true",
                w.day(),
                keys.len(),
                new.len()
            );
        }
        println!("day={} conditions_false_true={truths:?}", w.day());
        w.end_day().expect("end_day");
        days += 1;
        assert!(days <= 1461, "bot_must_finish");
    }
    assert!(stages.len() >= 4, "stages={stages:?}");
    println!("days={days} stages={stages:?}");
}
