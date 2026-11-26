//! U03 工作包 6：旧周节奏的八位主角 × 均衡与四个偏重预设，只用自动安排跑满家乡一年。
//!
//! 断言三条：不软锁（每月都排得出合法月程、时钟不停）；休息占比 ≤ 25%；
//! 领航、交易、战斗、学问在自己的评价（预设偏重属性的成长，品行乘 10）上高于“均衡”。
//! 剧情在没被锁的选项里按种子挑一个；全部锁住的章节（工作包 2 处理）按作罢跳过，只为让时钟走下去。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest},
    story2::Status,
    upbringing::{ActivityKind, FamilyDef, Phase},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

const PRESETS: [&str; 5] = ["balanced", "navigation", "trade", "combat", "learning"];

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn start(d: Arc<StaticData>, f: &FamilyDef) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut p = StartParams::new(sid, 7);
    p.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        seed: Some(7),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U03".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &p, |_| {}).unwrap()
}

/// 回应一个待回应的剧情：没被锁的选项里按日子轮着挑；全锁住就作罢。
fn answer(w: &mut World, ordinal: u64) {
    if !w.story2_is_front() {
        for choice in 0..manifest_core::story::MAX_CHOICES as u32 {
            if (Command::StoryAnswer { owner: OwnerId::Player, choice }).apply(w).is_ok() {
                return;
            }
        }
        panic!("旧式剧情或奇遇没有可提交的选项");
    }
    let p = w.pending_story2().cloned().unwrap();
    let c = w.defs.story2.track(&p.track).and_then(|t| t.chapter(&p.chapter)).unwrap().clone();
    let entered = w.state.story2.tracks.get(&p.track).map_or(w.day(), |s| s.entered);
    let visible = c.choices.iter().filter(|o| w.story2_choice_visible(o, entered)).collect::<Vec<_>>();
    let mut open: Vec<u32> = visible
        .iter()
        .enumerate()
        .filter(|(_, o)| w.story2_conditions(&o.requires, entered))
        .map(|(i, _)| i as u32)
        .collect();
    if visible.is_empty() {
        open.push(0);
    }
    if !open.is_empty() {
        let offset = (u64::from(w.day()) + ordinal) as usize % open.len();
        open.rotate_left(offset);
    }
    for choice in open {
        if (Command::StoryAnswer { owner: OwnerId::Player, choice }).apply(w).is_ok() {
            return;
        }
    }
    if let Some(s) = w.state.story2.tracks.get_mut(&p.track) {
        s.status = Status::Failed;
    }
    w.state.story2.pending.retain(|q| q.track != p.track);
}

struct Year {
    rest: usize,
    activities: usize,
    gain: BTreeMap<String, i64>,
}

/// 跑满家乡一年（1553 年）；返回休息与活动次数，以及各偏重预设属性的成长（评价刻度）。
fn one_year(d: Arc<StaticData>, f: &FamilyDef, preset: &str) -> Year {
    let mut w = start(d.clone(), f);
    let begin = w.state.upbringing.as_ref().unwrap().growth.clone();
    let end = manifest_core::scenario::day_of(&d, [1554, 1, 1]).unwrap();
    let mut ordinal = 0;
    let mut planned_week: Option<[u32; 3]> = None;
    while w.day() < end {
        let mut guard = 0;
        while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
            ordinal += 1;
            guard += 1;
            assert!(guard < 10_000, "{}/{preset}：同一天的剧情回应不收敛", f.key);
            answer(&mut w, ordinal);
        }
        // U05 按周：常设课表每周一自动铺开；与按旬时“每月排一次”对齐，每换一周按预设重排一次。
        let today = w.cast_date();
        let week = [today[0], today[1], u32::from(manifest_core::upbringing::weekly::week_of(today[2]))];
        let weekly_due = w.upbringing_weekly()
            && w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Running)
            && planned_week != Some(week);
        if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) || weekly_due {
            planned_week = Some(week);
            let date = w.cast_date();
            let slots = w.auto_plan(preset).unwrap_or_else(|e| panic!("{}/{preset} {date:?} 软锁：{e}", f.key));
            w.upbringing_plan_command(slots)
                .apply(&mut w)
                .unwrap_or_else(|e| panic!("{}/{preset} {date:?} 月程被拒：{e}", f.key));
        }
        let before = w.day();
        w.end_day().unwrap_or_else(|e| panic!("{}/{preset} {:?} 时钟停住：{e}", f.key, w.cast_date()));
        assert!(w.day() > before, "{}/{preset}：时钟没有前进", f.key);
    }
    assert!(w.money_conserved(), "{}/{preset} 货币不守恒", f.key);
    let s = w.state.upbringing.as_ref().unwrap();
    let acts: Vec<&str> = s.journal.iter().flat_map(|j| j.result.activities.iter().map(String::as_str)).collect();
    let rest =
        acts.iter().filter(|k| w.defs.upbringing.activity(k).is_some_and(|a| a.kind == ActivityKind::Rest)).count();
    let conduct = |k: &str| {
        w.defs.captain.attribute_index(k).and_then(|i| w.defs.captain.group(i)).is_some_and(|g| g.key == "conduct")
    };
    let gain = PRESETS[1..]
        .iter()
        .map(|p| {
            let attrs = &w.defs.upbringing.rules.auto_presets[*p];
            let total = attrs
                .iter()
                .map(|a| {
                    (s.growth.get(a).copied().unwrap_or(0) - begin.get(a).copied().unwrap_or(0))
                        * if conduct(a) { 10 } else { 1 }
                })
                .sum();
            ((*p).to_owned(), total)
        })
        .collect();
    Year { rest, activities: acts.len(), gain }
}

fn hero(key: &str) {
    let d = defs();
    let f = d.upbringing.family(key).unwrap().clone();
    let runs: BTreeMap<&str, Year> = PRESETS.iter().map(|p| (*p, one_year(d.clone(), &f, p))).collect();
    for (preset, y) in &runs {
        println!("{key}/{preset}：休息 {}/{}", y.rest, y.activities);
        assert!(y.activities >= 30, "{key}/{preset}：一年只排了 {} 项活动", y.activities);
        assert!(y.rest * 4 <= y.activities, "{key}/{preset}：休息 {}/{} 超过 25%", y.rest, y.activities);
    }
    let balanced = &runs["balanced"];
    for preset in &PRESETS[1..] {
        let mine = runs[preset].gain[*preset];
        let base = balanced.gain[*preset];
        assert!(mine > base, "{key}/{preset}：自己的评价 {mine} 没有高于均衡的 {base}");
        println!("{key}/{preset}：{mine} 对均衡 {base}，休息 {}/{}", runs[preset].rest, runs[preset].activities);
    }
}

#[test]
fn one_home_year_lieve() {
    hero("lieve");
}
#[test]
fn one_home_year_najma() {
    hero("najma");
}
#[test]
fn one_home_year_lin_wandeng() {
    hero("lin_wandeng");
}
#[test]
fn one_home_year_ix_nikte() {
    hero("ix_nikte");
}
#[test]
fn one_home_year_noel() {
    hero("noel");
}
#[test]
fn one_home_year_tariq() {
    hero("tariq");
}
#[test]
fn one_home_year_kaicili() {
    hero("kaicili");
}
#[test]
fn one_home_year_baraka() {
    hero("baraka");
}
