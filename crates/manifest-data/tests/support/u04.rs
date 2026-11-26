#![allow(dead_code)]
//! U04 工作包 3–5：用缺省策略跑养成整局的共用部分（真实寰宇、真实日结算）。
//!
//! 旧月/周程用 `auto_plan("balanced")`，行动制用内核缺省 bot；剧情在可选选项里按日子轮挑，全锁住就作罢。
//! 每天日结之后把世界交给观察者，测试自己记录心情、目标、解锁通知等。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest, WorldDate},
    story2::Status,
    upbringing::{FamilyDef, Phase},
};
use std::sync::{Arc, OnceLock};

pub const HEROES: [&str; 9] =
    ["mio", "lieve", "najma", "lin_wandeng", "ix_nikte", "noel", "tariq", "kaicili", "baraka"];

pub fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

pub fn start(d: Arc<StaticData>, f: &FamilyDef, seed: u64) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut p = StartParams::new(sid, seed);
    p.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        seed: Some(seed),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U04".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &p, |_| {}).unwrap()
}

/// 回应一个待回应的剧情：没被锁的选项里按日子轮着挑；全锁住就作罢。
pub fn answer(w: &mut World, ordinal: u64) {
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

/// 用“均衡”从开局跑到 `until`（不含）或养成结束；每天日结之后调用一次 `observe`。返回最后的世界。
pub fn run_balanced(family: &str, seed: u64, until: WorldDate, mut observe: impl FnMut(&World)) -> World {
    let d = defs();
    let f = d.upbringing.family(family).unwrap_or_else(|| panic!("没有家庭 {family}")).clone();
    let mut w = start(d.clone(), &f, seed);
    let end = manifest_core::scenario::day_of(&d, until).unwrap();
    let mut ordinal = 0;
    let mut planned_week: Option<[u32; 3]> = None;
    while w.day() < end && w.upbringing_active() {
        let mut guard = 0;
        while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
            ordinal += 1;
            guard += 1;
            assert!(guard < 10_000, "{family}：同一天的剧情回应不收敛");
            answer(&mut w, ordinal);
        }
        if w.upbringing_graduation_ready() {
            break;
        }
        // U05 按周：常设课表每周一自动铺开；与按旬时“每月排一次”对齐，每换一周按预设重排一次。
        let today = w.cast_date();
        let week = [today[0], today[1], u32::from(manifest_core::upbringing::weekly::week_of(today[2]))];
        let weekly_due = w.upbringing_weekly()
            && w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Running)
            && planned_week != Some(week);
        // U06K：行动制按当前阶段提交正式命令，旧月/周程预设只用于其余家庭。
        if w.act_running() && w.act_bot_step().unwrap() {
            continue;
        }
        if !w.act_running() && (w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) || weekly_due) {
            planned_week = Some(week);
            let date = w.cast_date();
            let slots = w.auto_plan("balanced").unwrap_or_else(|e| panic!("{family} {date:?} 软锁：{e}"));
            w.upbringing_plan_command(slots)
                .apply(&mut w)
                .unwrap_or_else(|e| panic!("{family} {date:?} 月程被拒：{e}"));
        }
        let before = w.day();
        w.end_day().unwrap_or_else(|e| panic!("{family} {:?} 时钟停住：{e}", w.cast_date()));
        assert!(w.day() > before, "{family}：时钟没有前进");
        observe(&w);
    }
    w
}
