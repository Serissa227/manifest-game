//! U04 审查：九位主角按自动安排的预设跑完整个养成期，统计比赛（报名、胜负）与结局。
//!
//! 跑法：
//! - 月程一律用内核的 `auto_plan(preset)`；
//! - 剧情在没被锁的选项里按日子轮着挑，全锁住就作罢（与 U03 的自动安排测试相同）；
//! - 比赛按 `register_every` 显式报名：每遇到一场新开放、还没报名的比赛记一次数，第 1、1+n、1+2n… 场点“报名”；
//!   月程里排了备赛活动而被内核登记的，单独计数；
//! - 志向：每月排程前试一次，按预设的偏好（门槛看的评价或属性）先后试，均衡先试评价最高的；最后一年起任何能选的都选。
//!
//! 整局经命令与日结推进；只有剧情全被锁住时直接作罢（U03 测试同法），旧式剧情交不上选项时清掉。同一组参数结果固定。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    contests::occurrence_key,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest, WorldDate, day_of},
    story2::Status,
    upbringing::{EndingNearMiss, Phase},
};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Arc};

/// 一局的参数。
#[derive(Clone, Debug)]
pub struct RunConfig {
    pub family: String,
    pub preset: String,
    pub seed: u64,
    /// 每 n 场新开放的比赛显式报名一场；0 表示从不点报名。
    pub register_every: u32,
}

/// 一场结算了的比赛。
#[derive(Clone, Debug, Serialize)]
pub struct ContestEntry {
    pub key: String,
    pub date: WorldDate,
    pub age: u32,
    pub rank: u32,
    pub total: u32,
    pub score: i64,
    /// explicit：点了报名；plan：月程排了备赛被登记。
    pub via: &'static str,
}

/// 一局的结果。
#[derive(Clone, Debug, Serialize)]
pub struct RunReport {
    pub family: String,
    pub preset: String,
    pub seed: u64,
    pub graduated: bool,
    pub end: WorldDate,
    pub path: Option<String>,
    pub ending: Option<String>,
    pub supplementary: Vec<String>,
    pub near_miss: Vec<EndingNearMiss>,
    pub ratings: BTreeMap<String, i64>,
    /// 养成期出现过、可报名的比赛实例数。
    pub offered: u32,
    pub contests: Vec<ContestEntry>,
    pub errors: Vec<String>,
}

impl RunReport {
    /// 每个日历年：参加场数、第一名场数。
    pub fn by_year(&self) -> BTreeMap<u32, (u32, u32)> {
        let mut out = BTreeMap::<u32, (u32, u32)>::new();
        for c in &self.contests {
            let e = out.entry(c.date[0]).or_default();
            e.0 += 1;
            e.1 += u32::from(c.rank == 1);
        }
        out
    }
}

/// 这一家这颗种子的开局参数（养成剧本、主角或自创模板）；没有这个家庭或剧本时为 None。
pub(crate) fn start_params(d: &StaticData, family: &str, seed: u64) -> Option<StartParams> {
    let f = d.upbringing.family(family)?.clone();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario)?);
    let mut p = StartParams::new(sid, seed);
    p.opening = Some(NewGameRequest {
        world: d.world_key.clone(),
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
    Some(p)
}

fn start(d: Arc<StaticData>, family: &str, seed: u64) -> Option<World> {
    let p = start_params(&d, family, seed)?;
    World::from_start(d, &p, |_| {}).ok()
}

/// 一次回应的去向（只给观察者看，不影响跑法）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answered {
    /// 提交了一个选项：章节结算，或者掷骰失败留在原处。
    Submitted,
    /// 旧式剧情或奇遇没有能提交的选项，直接清掉。
    Cleared,
    /// story2 章节没有一个选项交得上，轨道就此作罢。
    Abandoned,
    /// 没有可回应的剧情（例如只剩怪异遭遇）。
    Nothing,
}

/// 整局跑法的观察者：只读世界，不改变跑法；缺省什么都不做。事件节奏审计（`pacing_audit`）用它记账。
pub trait Observer {
    /// 开局之后、第一天之前改一次世界（量具用，如 `u05_growth --kit` 先给主角穿戴装备）。缺省什么都不做，结果与 [`run`] 逐位相同。
    fn prepare(&mut self, _w: &mut World) {}
    /// 回应一件待决的事之前。
    fn before_answer(&mut self, _w: &World) {}
    /// 回应之后。
    fn after_answer(&mut self, _w: &World, _outcome: Answered) {}
    /// 提交月程之前（月程已经排好）。
    fn before_plan(&mut self, _w: &World) {}
    /// 日结之前：当天能回应的都回应完了。
    fn before_day(&mut self, _w: &World) {}
    /// 日结成功之后。
    fn after_day(&mut self, _w: &World) {}
    /// 同一天的回应不收敛，放弃继续回应。
    fn diverged(&mut self, _w: &World) {}
}

/// 什么都不看的观察者。
pub struct Unobserved;
impl Observer for Unobserved {}

/// 回应一个待回应的剧情：没被锁的选项里按日子轮着挑；全锁住就作罢。
pub(crate) fn answer(w: &mut World, ordinal: u64) -> Answered {
    if !w.story2_is_front() {
        for choice in 0..manifest_core::story::MAX_CHOICES as u32 {
            if (Command::StoryAnswer { owner: OwnerId::Player, choice }).apply(w).is_ok() {
                return Answered::Submitted;
            }
        }
        // 旧式剧情或奇遇没有能提交的选项：清掉，让时钟走下去。
        let cleared = w.state.story.pending.is_some();
        w.state.story.pending = None;
        return if cleared { Answered::Cleared } else { Answered::Nothing };
    }
    let Some(p) = w.pending_story2().cloned() else { return Answered::Nothing };
    let Some(c) = w.defs.story2.track(&p.track).and_then(|t| t.chapter(&p.chapter)).cloned() else {
        return Answered::Nothing;
    };
    let entered = w.state.story2.tracks.get(&p.track).map_or(w.day(), |s| s.entered);
    let visible = c.choices.iter().filter(|o| w.story2_choice_visible(o, entered)).collect::<Vec<_>>();
    let mut open: Vec<u32> = visible
        .iter()
        .enumerate()
        .filter(|(_, o)| {
            w.story2_choice_open(o, entered)
                && (w.story2_soft_gaps(o).is_empty() || !w.story2_choice_failed(&p.track, &p.chapter, entered, &o.key))
        })
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
            return Answered::Submitted;
        }
    }
    if let Some(s) = w.state.story2.tracks.get_mut(&p.track) {
        s.status = Status::Failed;
    }
    w.state.story2.pending.retain(|q| q.track != p.track);
    Answered::Abandoned
}

/// 预设看重的志向门槛，按先后：评价键，或 `attr:属性`（门槛是属性的志向）。
fn preferences(w: &World, preset: &str) -> Vec<String> {
    let fixed: &[&str] = match preset {
        "navigation" => &["attr:seamanship", "attr:astronomy", "naval"],
        "combat" => &["naval", "attr:arms"],
        "trade" => &["mercantile", "attr:numeracy", "attr:commerce"],
        "learning" => &["scholarship", "attr:astronomy", "attr:learning"],
        "social" => &["social_rating"],
        _ => &[],
    };
    if !fixed.is_empty() {
        return fixed.iter().map(|s| (*s).to_owned()).collect();
    }
    // 均衡：评价从高到低。
    let mut ratings: Vec<(i64, String)> =
        w.defs.captain.ratings.iter().map(|r| (-w.upbringing_rating(&r.key), r.key.clone())).collect();
    ratings.sort();
    ratings.into_iter().map(|(_, k)| k).collect()
}

/// 一条志向的门槛落在哪些“偏好”上：评价门槛记评价键；属性门槛记 `attr:属性`，再记权重最大的那项评价。
fn path_tags(w: &World, p: &manifest_core::upbringing::PathDef) -> Vec<String> {
    let mut tags = Vec::new();
    if let Some(r) = &p.requirements.rating {
        tags.push(r.key().to_owned());
    }
    if let Some(attr) = &p.requirements.attr {
        tags.push(format!("attr:{attr}"));
        if let Some(index) = w.defs.captain.attribute_index(attr)
            && let Some((_, r)) = w
                .defs
                .captain
                .ratings
                .iter()
                .filter_map(|r| r.weights.iter().find(|(i, _)| *i == index).map(|(_, weight)| (*weight, r)))
                .max_by_key(|(weight, _)| *weight)
        {
            tags.push(r.key.clone());
        }
    }
    tags
}

fn choose_path(w: &mut World, family: &str, preset: &str, last_year: bool) {
    if w.state.upbringing.as_ref().is_none_or(|s| s.path.is_some()) {
        return;
    }
    let prefix = format!("{family}_path");
    let prefs = preferences(w, preset);
    let mut paths: Vec<(usize, String)> = w
        .defs
        .upbringing
        .paths
        .iter()
        .filter(|p| p.key.starts_with(&prefix))
        .map(|p| {
            let tags = path_tags(w, p);
            let rank = prefs.iter().position(|k| tags.contains(k)).unwrap_or(usize::MAX);
            (rank, p.key.clone())
        })
        .collect();
    paths.sort();
    for (rank, key) in paths {
        // 最后一年以前只等合心意的志向；最后一年起能选哪条选哪条。
        if rank == usize::MAX && !last_year {
            break;
        }
        if (Command::ChoosePath { owner: OwnerId::Player, path: key }).apply(w).is_ok() {
            return;
        }
    }
}

/// 跑一局到结业（或出错停下）。
pub fn run(defs: Arc<StaticData>, cfg: &RunConfig) -> RunReport {
    run_observed(defs, cfg, &mut Unobserved).0
}

/// 同 [`run`]，沿途通知观察者；另外交回跑完时的世界（开局失败时为 None）。观察者只读，结果与 [`run`] 逐位相同。
pub fn run_observed(defs: Arc<StaticData>, cfg: &RunConfig, observer: &mut dyn Observer) -> (RunReport, Option<World>) {
    let mut report = RunReport {
        family: cfg.family.clone(),
        preset: cfg.preset.clone(),
        seed: cfg.seed,
        graduated: false,
        end: [0, 0, 0],
        path: None,
        ending: None,
        supplementary: Vec::new(),
        near_miss: Vec::new(),
        ratings: BTreeMap::new(),
        offered: 0,
        contests: Vec::new(),
        errors: Vec::new(),
    };
    let Some(mut w) = start(defs.clone(), &cfg.family, cfg.seed) else {
        report.errors.push("开局失败".into());
        return (report, None);
    };
    let Some(graduation) = defs.upbringing.family(&cfg.family).map(|f| f.graduation) else {
        report.errors.push("没有家庭".into());
        return (report, None);
    };
    observer.prepare(&mut w);
    let mut seen = BTreeMap::<String, &'static str>::new();
    let mut ordinal = 0_u64;
    let mut counter = 0_u32;
    // 按周时上一次排程的（年、月、周序）与上一次挑志向的（年、月）。
    let mut planned_week: Option<[u32; 3]> = None;
    let mut path_month: Option<[u32; 2]> = None;
    for _ in 0..200_000 {
        if !w.upbringing_active() {
            break;
        }
        let mut guard = 0;
        while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
            ordinal += 1;
            guard += 1;
            if guard > 10_000 {
                report.errors.push(format!("{:?} 同一天的剧情回应不收敛", w.cast_date()));
                observer.diverged(&w);
                break;
            }
            observer.before_answer(&w);
            let outcome = answer(&mut w, ordinal);
            observer.after_answer(&w, outcome);
        }
        // 新开放的比赛：按间隔显式报名；月程登记的记为 plan。
        let today = w.day();
        for c in &defs.upbringing.contests {
            for date in &c.dates {
                let Ok(due) = day_of(&defs, *date) else { continue };
                if due < today || due > today.saturating_add(c.open_days) || !w.contest_open(c, *date) {
                    continue;
                }
                let key = occurrence_key(&c.key, *date);
                if seen.contains_key(&key) {
                    continue;
                }
                if w.contest_registered(&key) {
                    seen.insert(key, "plan");
                    report.offered += 1;
                    continue;
                }
                report.offered += 1;
                counter += 1;
                let register = cfg.register_every > 0 && (counter - 1).is_multiple_of(cfg.register_every);
                if register
                    && (Command::PlayContest {
                        owner: OwnerId::Player,
                        contest: key.clone(),
                        moves: manifest_core::contests::Moves::Register { register: true },
                    })
                    .apply(&mut w)
                    .is_ok()
                {
                    seen.insert(key, "explicit");
                } else {
                    seen.insert(key, "none");
                }
            }
        }
        // U05 按周：常设周课表会在每周一自动铺开，bot 若只在“安排阶段”排程，就会把第一周的安排原样重复四年；
        // 所以按周时每换一周都按预设重排一次（运行中也收周程），与按旬时“每月排一次”的口径一致。
        if w.act_running() {
            let date = w.cast_date();
            if path_month != Some([date[0], date[1]]) {
                path_month = Some([date[0], date[1]]);
                choose_path(&mut w, &cfg.family, &cfg.preset, date[0] >= graduation[0].saturating_sub(1));
            }
            match w.act_bot_step() {
                Ok(true) => continue,
                Ok(false) => {}
                Err(e) => {
                    report.errors.push(format!("行动制命令被拒：{e}"));
                    break;
                }
            }
        }
        let date = w.cast_date();
        let week = [date[0], date[1], u32::from(manifest_core::upbringing::weekly::week_of(date[2]))];
        let phase = w.state.upbringing.as_ref().map(|s| s.phase);
        let replan_week = w.upbringing_weekly() && phase == Some(Phase::Running) && planned_week != Some(week);
        if !w.act_running() && (phase == Some(Phase::Plan) || replan_week) {
            // 志向每月试一次（按旬时就是每次排月程前）。
            if path_month != Some([date[0], date[1]]) {
                path_month = Some([date[0], date[1]]);
                choose_path(&mut w, &cfg.family, &cfg.preset, date[0] >= graduation[0].saturating_sub(1));
            }
            planned_week = Some(week);
            match w.auto_plan(&cfg.preset) {
                Ok(slots) => {
                    observer.before_plan(&w);
                    let command = w.upbringing_plan_command(slots);
                    if let Err(e) = command.apply(&mut w) {
                        report.errors.push(format!("{date:?} 日程被拒：{e}"));
                        break;
                    }
                }
                Err(e) => {
                    report.errors.push(format!("{date:?} 排不出月程：{e}"));
                    break;
                }
            }
            // 月程登记了的比赛（备赛）此刻已经在报名表里。
            for (key, via) in seen.iter_mut() {
                if *via == "none" && w.contest_registered(key) {
                    *via = "plan";
                }
            }
            continue;
        }
        observer.before_day(&w);
        if let Err(e) = w.end_day() {
            report.errors.push(format!("{:?} 日结失败：{e}", w.cast_date()));
            break;
        }
        observer.after_day(&w);
    }
    report.end = w.cast_date();
    if let Some(s) = w.state.upbringing.as_ref() {
        report.graduated = s.phase == Phase::Done;
        report.path = s.path.clone();
        if let Some(g) = &s.graduation {
            report.ending = g.ending.clone();
            report.supplementary = g.supplementary.clone();
            report.near_miss = g.near_miss.clone();
        }
        for (key, r) in &s.contest_results {
            let age = w.state.protagonist.as_ref().and_then(|p| p.age_on(r.date)).unwrap_or(0);
            report.contests.push(ContestEntry {
                key: key.clone(),
                date: r.date,
                age,
                rank: r.rank,
                total: r.total,
                score: r.score,
                via: seen.get(key).copied().unwrap_or("game"),
            });
        }
    }
    report.contests.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.key.cmp(&b.key)));
    report.ratings = w.defs.captain.ratings.iter().map(|r| (r.key.clone(), w.upbringing_rating(&r.key))).collect();
    (report, Some(w))
}

/// 多局并行跑；结果按参数顺序返回。
pub fn run_many(defs: Arc<StaticData>, configs: &[RunConfig], threads: usize) -> Vec<RunReport> {
    let threads = threads.max(1);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..threads.min(configs.len().max(1)) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(cfg) = configs.get(i) else { break };
                    let r = run(defs.clone(), cfg);
                    if let Ok(mut v) = results.lock() {
                        v.push((i, r));
                    }
                }
            });
        }
    });
    let mut v = results.into_inner().unwrap_or_default();
    v.sort_by_key(|(i, _)| *i);
    v.into_iter().map(|(_, r)| r).collect()
}

/// 养成期里至少拿过一次第一名的年数，与养成期的总年数。
/// 只计在养成期里过了至少半年的日历年（1 月初结业的那一年不计）。
pub fn years_with_win(reports: &[RunReport]) -> (u32, u32) {
    let mut years = 0;
    let mut won = 0;
    for r in reports {
        let by_year = r.by_year();
        for year in START_YEAR..=r.end[0] {
            if year == r.end[0] && r.end[1] < 7 {
                continue;
            }
            years += 1;
            won += u32::from(by_year.get(&year).is_some_and(|y| y.1 > 0));
        }
    }
    (won, years)
}

/// 九位主角的养成期都从 1553 年开始。
const START_YEAR: u32 = 1553;

/// 一局的一行 JSON 摘要。
pub fn report_json(r: &RunReport) -> String {
    serde_json::json!({"family":r.family,"preset":r.preset,"seed":r.seed,"graduated":r.graduated,
        "end":r.end,"path":r.path,"ending":r.ending,"supplementary":r.supplementary,"near_miss":r.near_miss,
        "ratings":r.ratings,"offered":r.offered,
        "entered":r.contests.len(),"won":r.contests.iter().filter(|c|c.rank==1).count(),
        "via_plan":r.contests.iter().filter(|c|c.via=="plan").count(),
        "via_explicit":r.contests.iter().filter(|c|c.via=="explicit").count(),
        "by_year":r.by_year(),"contests":r.contests,"errors":r.errors})
    .to_string()
}

/// 多局汇总：每年至少赢一次的年数、结局分布。
pub fn summary_json(reports: &[RunReport], seconds: u64) -> String {
    let (won, years) = years_with_win(reports);
    let mut endings = BTreeMap::<String, u32>::new();
    for r in reports {
        *endings.entry(r.ending.clone().unwrap_or_else(|| "-".into())).or_default() += 1;
    }
    serde_json::json!({"summary":{"runs":reports.len(),"years":years,"years_with_win":won,
        "endings":endings,"seconds":seconds}})
    .to_string()
}
