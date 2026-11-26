//! P12：待决队列的刷新改成“轨道定义与状态表按 key 并排走、主角所在一轮只取一次”之后，
//! 与原来“每条轨道按 key 线性查定义、每一章现取主角所在”的做法逐项对照。
//!
//! 原来的刷新冻结在本文件里（[`refresh_before_p12`]）。对照覆盖：出海与养成两种剧本、节奏的闸开与关、
//! 平常的刷新与新一天的头一次刷新；状态随机扰动——立旗标、撤旗标、删掉轨道的状态（自动轨道要补回来）、
//! 轨道结束或作罢、手动开始的轨道、主角换地方或不在任何地方、过一天。每一步比较整份世界状态。
use super::tests::{base, track, world};
use super::*;
use crate::cast::CastPlace;
use crate::defs::PacingRules;
use crate::rng::{Domain, Rng};
use crate::story2::{Status, TrackDef, TrackState};
use crate::{LocId, StaticData};
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// P12 之前的候选判定：章节按轨道定义现查，主角所在每一章现取。
fn candidate_before_p12(w: &World, t: &TrackDef, key: &str, state: &TrackState) -> Option<Option<String>> {
    let c = t.chapter(&state.chapter)?;
    if !w.story2_chapter_available(c, state.entered) || !w.upbringing_story_allowed(key) {
        return None;
    }
    let variant = match w.state.story2.pending.iter().find(|p| p.track == key && p.chapter == c.key) {
        Some(p) => p.variant.clone(),
        None => c
            .variants
            .iter()
            .filter(|v| {
                w.story2_conditions(&v.when, state.entered)
                    && !w.state.story2.variants_seen.contains(&(key.to_owned(), c.key.clone(), v.key.clone()))
            })
            .min_by_key(|v| &v.key)
            .map(|v| v.key.clone()),
    };
    (c.once || c.variants.is_empty() || variant.is_some()).then_some(variant)
}

/// P12 之前的刷新，冻结作对照：轨道定义一律按 key 线性查找。
fn refresh_before_p12(w: &mut World, mode: Refresh) {
    let defs = w.defs.clone();
    let find = |key: &str| defs.story2.tracks.iter().find(|t| t.key == key);
    let day = w.day();
    let excluded = w.excluded_protagonist_tracks();
    for key in &excluded {
        w.state.story2.tracks.remove(key);
    }
    for t in &defs.story2.tracks {
        if t.auto && !excluded.contains(&t.key) {
            w.state.story2.tracks.entry(t.key.clone()).or_insert_with(|| TrackState {
                visited: BTreeSet::new(),
                chapter: t.start.clone(),
                entered: day,
                status: Status::Active,
                failure: None,
            });
        }
    }
    let mut pending = Vec::new();
    for (key, state) in &w.state.story2.tracks {
        if state.status != Status::Active || excluded.contains(key) {
            continue;
        }
        let Some(variant) = find(key).and_then(|t| candidate_before_p12(w, t, key, state)) else {
            continue;
        };
        let appeared = w
            .state
            .story2
            .pending
            .iter()
            .find(|p| p.track == *key && p.chapter == state.chapter)
            .map_or(day, |p| p.day);
        pending.push(Pending { track: key.clone(), chapter: state.chapter.clone(), day: appeared, variant });
    }
    if w.upbringing_active() && !w.upbringing_skipping() {
        let locked: Vec<(String, String)> = pending
            .iter()
            .filter(|p| {
                let entered = w.state.story2.tracks.get(&p.track).map_or(day, |s| s.entered);
                find(&p.track).and_then(|t| t.chapter(&p.chapter)).is_some_and(|c| w.story2_choices_locked(c, entered))
            })
            .map(|p| (p.track.clone(), p.chapter.clone()))
            .collect();
        for (track, chapter) in locked {
            pending.retain(|p| p.track != track);
            if let Some(s) = w.state.story2.tracks.get_mut(&track) {
                s.status = Status::Failed;
                s.failure = Some("养成期待回应的章节选项全部锁住，自动作罢".into());
            }
            if let Some(s) = &mut w.state.upbringing {
                s.event_permits.remove(&track);
            }
            w.push_log(crate::log::LogEvent { day, kind: crate::log::LogKind::Story2Abandoned { track, chapter } });
        }
    }
    let gated = w.pacing_active();
    if gated {
        pending = w.pacing_gate(pending, mode);
    }
    let rank = |p: &Pending| find(&p.track).map(|t| t.kind);
    if gated && !w.upbringing_active() {
        let mut ranked: Vec<(bool, Pending)> = pending
            .into_iter()
            .map(|p| {
                let locked = w.state.story2.tracks.get(&p.track).is_some_and(|s| {
                    find(&p.track)
                        .and_then(|t| t.chapter(&p.chapter))
                        .is_some_and(|c| w.story2_choices_locked(c, s.entered))
                });
                (locked, p)
            })
            .collect();
        ranked
            .sort_by(|(la, a), (lb, b)| (la, rank(a), &a.track, &a.chapter).cmp(&(lb, rank(b), &b.track, &b.chapter)));
        pending = ranked.into_iter().map(|(_, p)| p).collect();
    } else {
        pending.sort_by(|a, b| (rank(a), &a.track, &a.chapter).cmp(&(rank(b), &b.track, &b.chapter)));
    }
    w.state.story2.pending = pending;
}

/// 一章、在某地才出场的轨道。
fn placed(key: &str, at: &str, venue: &str) -> Value {
    json!({"key":key,"name":"占位","kind":"request","start":"first","chapters":[
        {"key":"first","title":"占位","text":"占位","at":at,"venue":venue,
            "choices":[{"key":"ok","text":"继续","next":"done"}]}]})
}

/// 轨道的 key 故意不按字母序排（定义的先后与 key 的先后不同）。
fn tracks(d: &StaticData) -> Value {
    let (here, away) = (d.locations[0].key.as_str(), d.locations[1].key.as_str());
    let flag = |f: &str| json!([{"kind":"flag","flag":f}]);
    json!([
        track("m_side", "request", json!({}), &[("first", json!([]), "done")]),
        track("z_flagged", "request", json!({}), &[("first", flag("f1"), "done")]),
        track("a_chance", "encounter", json!({}), &[("first", json!([]), "done")]),
        placed("p_here", here, ""),
        track("k_manual", "request", json!({"auto":false}), &[("first", json!([]), "done")]),
        placed("d_away", away, ""),
        track("b_two", "request", json!({}), &[("first", flag("f2"), "second"), ("second", flag("f3"), "done")]),
        placed("q_tavern", here, "tavern"),
        track("e_bond", "request", json!({"academy":true}), &[("first", json!([]), "done")]),
        track("c_main", "main", json!({}), &[("first", flag("f3"), "done")]),
        track("y_school", "request", json!({"auto":false,"academy":true}), &[("first", json!([]), "done")]),
    ])
}

#[test]
fn refresh_matches_the_per_track_lookup_version() {
    let keys = [
        "m_side",
        "z_flagged",
        "a_chance",
        "p_here",
        "k_manual",
        "d_away",
        "b_two",
        "q_tavern",
        "e_bond",
        "c_main",
        "y_school",
    ];
    let mut compared = 0;
    let mut queued_some = 0;
    for (case, upbringing, pacing) in [(0u64, false, true), (1, false, false), (2, true, true), (3, true, false)] {
        let mut d = base(json!([]));
        d.story2 = serde_json::from_value(json!({ "tracks": tracks(&d) })).unwrap();
        d.scenarios[0].upbringing = upbringing;
        d.rules.pacing = PacingRules { enabled: pacing, ..PacingRules::default() };
        let mut w = world(d);
        let mut rng = Rng::derive(12, 0, Domain::Market, case, 0);
        for step in 0..400 {
            // 扰动：不经刷新直接改状态，让下一次刷新去理
            let key = keys[rng.below(keys.len() as u64) as usize];
            match rng.below(12) {
                0..=2 => {
                    let flag = ["f1", "f2", "f3"][rng.below(3) as usize];
                    if !w.state.story2.flags.remove(flag) {
                        w.state.story2.flags.insert(flag.into());
                    }
                }
                3 => {
                    w.state.story2.tracks.remove(key);
                    w.state.story2.pending.retain(|p| p.track != key);
                }
                4 => {
                    if let Some(s) = w.state.story2.tracks.get_mut(key) {
                        s.status = [Status::Done, Status::Failed, Status::Active][rng.below(3) as usize];
                        if s.status != Status::Active {
                            w.state.story2.pending.retain(|p| p.track != key);
                        }
                    }
                }
                5 => {
                    let day = w.day();
                    let start = w.defs.story2.track(key).map(|t| t.start.clone()).unwrap();
                    w.state.story2.tracks.entry(key.into()).or_insert_with(|| TrackState {
                        visited: BTreeSet::new(),
                        chapter: start,
                        entered: day,
                        status: Status::Active,
                        failure: None,
                    });
                }
                6 | 7 => {
                    let venue = ["", "tavern", "market"][rng.below(3) as usize];
                    w.state.cast.place = Some(CastPlace { loc: LocId(rng.below(2) as u16), venue: venue.into() });
                }
                8 => w.state.cast.place = None,
                9 => {
                    // 过一天（养成期等着玩家回应时过不了，不要紧）
                    let _ = w.end_day();
                }
                _ => {}
            }
            let mut old = w.clone();
            if step % 3 == 0 {
                refresh_before_p12(&mut old, Refresh::DayStart);
                w.refresh_story2_day_start();
            } else {
                refresh_before_p12(&mut old, Refresh::Normal);
                w.refresh_story2();
            }
            assert_eq!(w.state.story2, old.state.story2, "剧本 {case} 第 {step} 步：故事状态");
            assert_eq!(w.state, old.state, "剧本 {case} 第 {step} 步：整份世界");
            compared += 1;
            queued_some += usize::from(!w.state.story2.pending.is_empty());
        }
    }
    assert_eq!(compared, 1600);
    assert!(queued_some > 400, "队列里多数时候要有东西可比：{queued_some}");
}
