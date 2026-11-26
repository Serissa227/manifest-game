//! 同一份结构化结果供 Markdown 与 JSON 使用；总评、落档、资本均由内核给出。
use super::*;
use serde::Serialize;
use std::sync::Arc;

#[path = "opening.rs"]
mod opening;
#[path = "shuttle.rs"]
mod shuttle;

const CAPITAL_KINDS: [&str; 12] =
    ["cash", "ship", "crew", "food", "water", "cargo", "item", "license", "mate", "ally", "rumor", "known_good"];

#[derive(Debug, Serialize)]
pub struct Spread {
    pub min: f64,
    pub median: f64,
    pub max: f64,
}
impl Spread {
    fn of(mut values: Vec<f64>) -> Self {
        values.sort_by(f64::total_cmp);
        let n = values.len();
        Self { min: values[0], median: (values[(n - 1) / 2] + values[n / 2]) / 2.0, max: values[n - 1] }
    }
    fn cell(&self) -> String {
        fn number(v: f64) -> String {
            if v.fract() == 0.0 { format!("{v:.0}") } else { format!("{v:.2}") }
        }
        [self.min, self.median, self.max].map(number).join("/")
    }
}

#[derive(Debug, Serialize)]
pub struct Counts {
    pub exams: u32,
    pub contests: u32,
    pub duties: u32,
    pub voyages: u32,
}

#[derive(Debug, Serialize)]
pub struct Run {
    pub seed: u64,
    pub score: i64,
    pub band: String,
    pub items: BTreeMap<String, i64>,
    pub capital: CapitalPreview,
    pub capital_values: BTreeMap<String, i64>,
    pub counts: Counts,
    pub weeks: u32,
    pub unused_points: u32,
    pub mean_unused_points: f64,
    pub limits: BTreeMap<String, Option<i64>>,
    pub savings_score: i64,
    pub detail: ScoreDetail,
    pub merit: i64,
    pub rank: u8,
    pub missions: BTreeMap<String, MissionState>,
    pub reviews: Vec<ReviewRecord>,
    pub lines: BTreeMap<String, LineState>,
    pub cash: i64,
    pub actions: BTreeMap<String, u32>,
    pub score_sources: BTreeMap<String, BTreeMap<String, i64>>,
    pub contests: Vec<ContestObservation>,
    pub max_fatigue: i64,
    pub(super) omen: super::omen::OmenTrace,
}

#[derive(Debug, Serialize)]
pub struct ContestObservation {
    pub result: manifest_core::contests::ContestResult,
    pub attr: String,
    pub base: i64,
    pub coefficient: i64,
    pub strength: i64,
    pub rival_range: [i64; 2],
    pub rivals: Vec<(String, i64, u64)>,
    pub tiebreak: u64,
}

#[derive(Serialize)]
pub struct SailingProbe {
    pub path: Option<String>,
    pub band: String,
    pub capital: CapitalPreview,
    pub guarantee: bool,
    pub seed: u64,
    pub days: u32,
    pub curve: Vec<i64>,
    pub start: i64,
    pub minimum: i64,
    pub minimum_day: u32,
    pub end: i64,
    pub bankrupt: bool,
    pub reorganizations: u32,
    pub trades: usize,
    pub departures: usize,
    pub cash_end: i64,
    pub costs: BTreeMap<String, i64>,
    pub opening_failures: BTreeMap<String, u32>,
}

#[derive(Serialize)]
pub struct PathProbe {
    pub requested_path: String,
    pub run: Run,
    pub sailing: Option<SailingProbe>,
    pub reason: Option<&'static str>,
}

#[derive(Serialize)]
pub struct FloorProbe {
    pub run: Run,
    pub sailing: Option<SailingProbe>,
    pub paths: Vec<PathProbe>,
}

#[derive(Serialize)]
pub struct StrategyReport {
    pub strategy: String,
    pub metrics: BTreeMap<String, Spread>,
    pub bands: BTreeMap<String, Vec<u64>>,
    pub runs: Vec<Run>,
}

#[derive(Serialize)]
pub struct CapitalRatio {
    pub min: i64,
    pub max: i64,
    pub multiple: Option<f64>,
}

#[derive(Serialize)]
pub struct BestScore {
    pub strategy: String,
    pub seed: u64,
    pub score: i64,
    pub limits: BTreeMap<String, Option<i64>>,
    pub gaps: BTreeMap<String, Option<i64>>,
}

#[derive(Serialize)]
pub struct ActReport {
    pub family: String,
    pub seeds: Vec<u64>,
    pub strategies: Vec<StrategyReport>,
    pub bands: BTreeMap<String, BTreeMap<String, Vec<u64>>>,
    pub capital_ratio: CapitalRatio,
    pub best: BestScore,
    pub floor_probe: Option<FloorProbe>,
    pub capital_bands: BTreeMap<String, CapitalRatio>,
    #[serde(skip)]
    pub graduation_saves: Vec<GraduationSave>,
    pub shuttle: Vec<shuttle::ShuttleProbe>,
}

pub struct GraduationSave {
    pub slot: String,
    pub save: manifest_core::SaveFile,
}

fn score_limits(w: &World) -> BTreeMap<String, Option<i64>> {
    let r = w.act_rules().cloned().unwrap_or_default();
    let score = w.act_score();
    let max_level = w.defs.upbringing.rules.growth_table.iter().map(|b| b.value).max().unwrap_or(1);
    let craft = score
        .detail
        .craft
        .iter()
        .map(|row| (0..(max_level - row.from).max(0)).map(|n| r.score.craft[(n as usize).min(4)]).sum::<i64>())
        .sum();
    let root = score.detail.root.iter().map(|row| (max_level - row.from).max(0) * r.score.root).sum();
    let missions = w
        .defs
        .upbringing
        .missions
        .iter()
        .filter(|m| {
            w.upbringing_family().is_some_and(|f| {
                m.family == f.key
                    && f.stages
                        .iter()
                        .rev()
                        .find(|s| s.from <= [m.month[0], m.month[1], 1])
                        .is_some_and(|s| s.stage == m.stage && s.academy.as_deref().unwrap_or("") == m.academy)
            })
        })
        .map(|m| m.month)
        .collect::<BTreeSet<_>>()
        .len() as i64
        * r.score.mission;
    let person_score = |level: u8| level.checked_sub(1).map_or(0, |n| r.score.people[usize::from(n)]);
    let people = score.detail.people.iter().map(|p| r.score.people[3] - person_score(p.from)).sum();
    [
        ("craft", Some(craft)),
        ("root", Some(root)),
        ("skill", None),
        ("rank", r.score.rank.iter().max().copied()),
        ("mission", Some(missions)),
        ("exam", Some(score.detail.exams.len() as i64 * (r.score.exam_pass + r.score.exam_honor))),
        ("contest", Some(r.score.contest_cap)),
        ("people", Some(people)),
        // 这两项内核没有总分硬上限，不能拿样本最大值冒充上限。
        ("deeds", None),
        ("savings", Some(r.savings.score_max)),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v))
    .collect()
}

fn score_items(w: &World) -> BTreeMap<String, i64> {
    w.state
        .upbringing
        .as_ref()
        .and_then(|s| s.graduation.as_ref())
        .and_then(|g| g.act.as_ref())
        .map_or_else(|| w.act_score().items, |g| g.items.clone())
}

fn source_score(
    sources: &mut BTreeMap<String, BTreeMap<String, i64>>,
    key: &str,
    before: BTreeMap<String, i64>,
    w: &World,
) {
    let source = sources.entry(key.into()).or_default();
    for (item, value) in score_items(w) {
        *source.entry(item.clone()).or_default() += value - before.get(&item).copied().unwrap_or(0);
    }
}

fn play(
    defs: Arc<StaticData>,
    family: &str,
    strategy: Strategy,
    seed: u64,
    floor: bool,
    floor_path: Option<&str>,
) -> Result<(Run, World), ReportError> {
    let start =
        crate::upbringing_runs::start_params(&defs, family, seed).ok_or(ReportError::Unavailable("start_params"))?;
    let mut w = World::from_start(defs, &start, |_| {})?;
    let mut cursor = 0;
    let mut answered = 0;
    let mut weekly_fee = 0;
    let mut weeks = 0;
    let mut unused_points = 0;
    let mut actions = BTreeMap::<String, u32>::new();
    let mut score_sources = BTreeMap::from([("opening".into(), score_items(&w))]);
    let mut max_fatigue = 0;
    let mut omen = super::omen::OmenTrace::default();
    while w.state.upbringing.as_ref().is_some_and(|s| !matches!(s.phase, Phase::Graduation | Phase::Done)) {
        omen.observe(&w);
        max_fatigue = max_fatigue.max(w.state.upbringing.as_ref().map_or(0, |s| s.fatigue));
        if !w.act_running() {
            return Err(ReportError::Unavailable("act_running"));
        }
        if !w.state.story2.pending.is_empty() || w.state.story.pending.is_some() {
            let command =
                policy::answer_story(&w, strategy, answered).ok_or(ReportError::Unavailable("story_answer"))?;
            let before = score_items(&w);
            let key = if let Some(pending) = w.pending_story2() {
                format!("story:{}", pending.track)
            } else {
                "story:legacy".into()
            };
            command.apply(&mut w)?;
            source_score(&mut score_sources, &key, before, &w);
            *actions.entry("story_answer".into()).or_default() += 1;
            answered += 1;
            continue;
        }
        if let Some(path) = floor_path {
            let command = Command::ChoosePath { owner: OwnerId::Player, path: path.into() };
            if w.state.upbringing.as_ref().is_some_and(|s| s.path.as_deref() != Some(path))
                && command.validate(&w).is_ok()
            {
                command.apply(&mut w)?;
            }
        }
        let command = match w.act_phase() {
            ActPhase::Plan => {
                if floor {
                    opening::plan_floor(&mut w, floor_path)?;
                    continue;
                } else if let Some(c) = policy::plan_opportunity(&w, strategy) {
                    Some(c)
                } else {
                    let before = score_items(&w);
                    weekly_fee = if strategy == Strategy::Ace {
                        policy::ace_plan_week(&mut w)?
                    } else {
                        plan_week(&mut w, strategy, &mut cursor)?
                    };
                    source_score(&mut score_sources, "plan", before, &w);
                    continue;
                }
            }
            ActPhase::Moment => {
                let candidates = [MomentPick::Steady, MomentPick::Risky, MomentPick::Clever]
                    .map(|pick| Command::AnswerMoment { owner: OwnerId::Player, pick });
                Some(if strategy == Strategy::Greedy {
                    policy::greedy(&w, candidates.to_vec()).ok_or(ReportError::Unavailable("moment"))?
                } else {
                    candidates[0].clone()
                })
            }
            ActPhase::Free => {
                let c = policy::free_command(&w, strategy, weekly_fee)?;
                if matches!(c, Command::EndFree { .. }) {
                    weeks += 1;
                    unused_points += w.state.upbringing.as_ref().map_or(0, |s| u32::from(s.act.points));
                }
                Some(c)
            }
            ActPhase::Summary => Some(Command::CloseWeek { owner: OwnerId::Player }),
            _ => {
                let calendar = if strategy == Strategy::Idle { Vec::new() } else { policy::calendar_commands(&w) };
                if strategy == Strategy::Greedy {
                    // 没有即时增分的报名仍可做；收费而不增分的补考留给下一日。
                    policy::greedy(&w, calendar).filter(|c| {
                        let mut trial = w.clone();
                        c.apply(&mut trial).is_ok()
                            && (trial.act_score().total > w.act_score().total || trial.act_cash() >= w.act_cash())
                    })
                } else {
                    calendar.into_iter().next()
                }
            }
        };
        if let Some(c) = command {
            let before = score_items(&w);
            let kind = match &c {
                Command::DoAction { action, .. } => action.kind(),
                Command::FamilyDuty { .. } => "family_duty",
                Command::BuyItem { .. } => "buy_item",
                _ => "control",
            };
            *actions.entry(kind.into()).or_default() += 1;
            c.apply(&mut w)?;
            source_score(&mut score_sources, kind, before, &w);
        } else {
            let before = score_items(&w);
            w.end_day()?;
            source_score(&mut score_sources, "day", before, &w);
        }
    }
    let state = w.state.upbringing.as_ref().ok_or(ReportError::Unavailable("graduation"))?;
    let (score, items, band) = if let Some(record) = state.graduation.as_ref().and_then(|g| g.act.as_ref()) {
        (record.score, record.items.clone(), record.band.clone())
    } else {
        let score = w.act_score();
        (score.total, score.items, score.band)
    };
    // 在待结业阶段也直接用 act_build_capital，避免预览的“跳过养成”投影。
    let capital = w.act_capital_preview();
    let capital_values = CAPITAL_KINDS
        .into_iter()
        .map(|kind| (kind.into(), capital.rows.iter().filter(|r| r.kind == kind).map(|r| r.value).sum()))
        .collect();
    let counts = Counts {
        exams: state.exams.values().map(|e| e.attempts).sum(),
        contests: state.contest_results.len() as u32,
        duties: state.act.family_duty.values().sum(),
        voyages: state.act.voyages.values().filter(|v| matches!(v, VoyageStatus::Done { .. })).count() as u32,
    };
    let contests = state
        .contest_results
        .iter()
        .filter_map(|(key, result)| {
            let c = w.defs.upbringing.contests.iter().find(|c| c.key == result.contest)?;
            // 只在名次已经落定后重建同一场的对手骰，用于调查；不传回打法。
            let draws = w.contest_draws(c, result.date, key);
            Some(ContestObservation {
                result: result.clone(),
                attr: c.check.attr.clone(),
                base: c.check.base,
                coefficient: c.check.coef,
                strength: result.score - draws.jitter,
                rival_range: w.contest_rival_range(c, result.date),
                rivals: draws.rivals,
                tiebreak: draws.tiebreak,
            })
        })
        .collect();
    let cash = capital.savings.cash;
    let mut detail = w.act_score().detail;
    detail.deeds.savings = capital.savings.score;
    let run = Run {
        seed,
        score,
        band,
        items,
        capital_values,
        counts,
        weeks,
        unused_points,
        mean_unused_points: if weeks == 0 { 0.0 } else { f64::from(unused_points) / f64::from(weeks) },
        limits: score_limits(&w),
        savings_score: capital.savings.score,
        capital,
        detail,
        merit: state.act.merit,
        rank: w.act_rank(),
        missions: state.act.missions.clone(),
        reviews: state.act.reviews.clone(),
        lines: state.act.lines.clone(),
        cash,
        actions,
        score_sources,
        contests,
        max_fatigue,
        omen,
    };
    Ok((run, w))
}

fn metrics(run: &Run) -> BTreeMap<String, f64> {
    let mut metrics = BTreeMap::from([
        ("score".into(), run.score as f64),
        ("capital.total".into(), run.capital.value as f64),
        ("exams".into(), f64::from(run.counts.exams)),
        ("contests".into(), f64::from(run.counts.contests)),
        ("duties".into(), f64::from(run.counts.duties)),
        ("voyages".into(), f64::from(run.counts.voyages)),
        ("unused_points".into(), run.mean_unused_points),
        ("savings".into(), run.savings_score as f64),
    ]);
    metrics.extend(run.items.iter().map(|(k, v)| (k.clone(), *v as f64)));
    metrics.extend(run.capital_values.iter().map(|(k, v)| (format!("capital.{k}"), *v as f64)));
    metrics
}

fn graduate(mut w: World) -> Result<World, ReportError> {
    let mut answered = 0;
    while w.upbringing_active() {
        if !w.state.story2.pending.is_empty() || w.state.story.pending.is_some() {
            let command = policy::answer_story(&w, Strategy::Ace, answered)
                .ok_or(ReportError::Unavailable("floor_graduation_story"))?;
            command.apply(&mut w)?;
            answered += 1;
        } else {
            w.end_day()?;
        }
    }
    Ok(w)
}

fn graduation_save(w: World, family: &str, seed: u64) -> Result<manifest_core::SaveFile, ReportError> {
    let w = graduate(w)?;
    let start = crate::upbringing_runs::start_params(&w.defs, family, seed)
        .ok_or(ReportError::Unavailable("graduation_start"))?;
    Ok(manifest_core::SaveFile::new(&w.defs, start, w.state.clone(), Vec::new()))
}

fn sail_floor(w: World, family: &str, seed: u64) -> Result<SailingProbe, ReportError> {
    let w = graduate(w)?;
    let mut answered = 0;
    let capital = w.act_capital_preview();
    let band = capital.band.clone();
    let path = capital.aspiration.clone();
    let guarantee = w.state.story2.flags.contains("family_guarantee");
    let start =
        crate::upbringing_runs::start_params(&w.defs, family, seed).ok_or(ReportError::Unavailable("floor_start"))?;
    let save = manifest_core::SaveFile::new(&w.defs, start, w.state.clone(), Vec::new());
    let probe_error = |e: crate::SimError| ReportError::Run { strategy: "floor_sailing", seed, detail: e.to_string() };
    let mut session = crate::session::GameSession::from_save(w.defs.clone(), save).map_err(probe_error)?;
    let mut bot = crate::bots::Bot::new(crate::bots::BotKind::Arbitrage);
    let mut curve = vec![crate::stats::net_worth(&session.world, OwnerId::Player)];
    let before = opening::costs(&session.world);
    let mut opening = opening::Opening::new(&mut session)?;
    for _ in 0..120 {
        while !session.world.state.story2.pending.is_empty() || session.world.state.story.pending.is_some() {
            let command = policy::answer_story(&session.world, Strategy::Ace, answered)
                .ok_or(ReportError::Unavailable("floor_sailing_story"))?;
            session.submit(command)?;
            answered += 1;
        }
        if !opening.act(&mut session)? {
            bot.act(&mut session);
        }
        session.advance_day().map_err(probe_error)?;
        curve.push(crate::stats::net_worth(&session.world, OwnerId::Player));
    }
    let (minimum_day, minimum) =
        curve.iter().copied().enumerate().min_by_key(|(_, v)| *v).ok_or(ReportError::Unavailable("floor_curve"))?;
    let player = session.world.state.agents.get(&OwnerId::Player).ok_or(ReportError::Unavailable("floor_player"))?;
    Ok(SailingProbe {
        path,
        band,
        capital,
        guarantee,
        seed,
        days: 120,
        start: curve[0],
        minimum,
        minimum_day: minimum_day as u32,
        end: curve[120],
        curve,
        bankrupt: player.bankrupt,
        reorganizations: player.reorganizations,
        trades: session
            .log()
            .iter()
            .filter(|e| matches!(e.command, Command::Buy { .. } | Command::Sell { .. }))
            .count(),
        departures: session
            .log()
            .iter()
            .filter(|e| {
                matches!(e.command, Command::SetSail { .. } | Command::Autopilot { .. } | Command::Depart { .. })
            })
            .count(),
        cash_end: player.cash,
        costs: opening::costs(&session.world)
            .into_iter()
            .map(|(key, value)| {
                let delta = value - before.get(&key).copied().unwrap_or(0);
                (key, delta)
            })
            .collect(),
        opening_failures: opening.failures,
    })
}

/// 默认种子由 CLI 指定；逐种子保留明细，多种子在同一字段上取最小／中位／最大。
pub fn report(
    defs: Arc<StaticData>,
    family: &str,
    seeds: &[u64],
    selected: &[String],
    save_graduations: bool,
    use_shuttle: bool,
) -> Result<ActReport, ReportError> {
    defs.upbringing.family(family).ok_or_else(|| crate::upbringing_curve::CurveError::UnknownFamily(family.into()))?;
    if seeds.is_empty() {
        return Err(ReportError::Unavailable("seeds"));
    }
    let mut strategies = Vec::new();
    let mut graduation_saves = Vec::new();
    let mut shuttles = Vec::new();
    for strategy in Strategy::ALL.into_iter().filter(|s| selected.is_empty() || selected.iter().any(|k| k == s.key())) {
        let runs = seeds
            .iter()
            .map(|seed| {
                eprintln!("upbringing-act-report: strategy={} seed={seed}", strategy.key());
                play(defs.clone(), family, strategy, *seed, false, None)
                    .and_then(|(run, world)| {
                        if *seed == 42 {
                            if save_graduations && ["idle", "casual", "steady", "ace"].contains(&strategy.key()) {
                                graduation_saves.push(GraduationSave {
                                    slot: format!("mio-{}-{}-s42", run.band, strategy.key()),
                                    save: graduation_save(world.clone(), family, *seed)?,
                                });
                            }
                            if use_shuttle && strategy == Strategy::Idle {
                                for port in ["shimizu_tosa", "sakai"] {
                                    shuttles.push(shuttle::run(world.clone(), family, *seed, port)?);
                                }
                            }
                        }
                        Ok(run)
                    })
                    .map_err(|e| ReportError::Run { strategy: strategy.key(), seed: *seed, detail: e.to_string() })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let rows: Vec<_> = runs.iter().map(metrics).collect();
        let metrics = rows[0]
            .keys()
            .map(|key| (key.clone(), Spread::of(rows.iter().map(|r| r.get(key).copied().unwrap_or(0.0)).collect())))
            .collect();
        let mut bands = BTreeMap::<String, Vec<u64>>::new();
        for run in &runs {
            bands.entry(run.band.clone()).or_default().push(run.seed);
        }
        strategies.push(StrategyReport { strategy: strategy.key().into(), metrics, bands, runs });
    }
    let floor_probe = if selected.is_empty() || selected.iter().any(|key| key == "idle") {
        eprintln!("upbringing-act-report: floor_probe seed={}", seeds[0]);
        let (run, world) = play(defs.clone(), family, Strategy::Idle, seeds[0], true, None)?;
        if save_graduations && seeds[0] == 42 {
            graduation_saves.push(GraduationSave {
                slot: format!("mio-{}-minimum-s42", run.band),
                save: graduation_save(world.clone(), family, seeds[0])?,
            });
        }
        if use_shuttle {
            for port in ["shimizu_tosa", "sakai"] {
                shuttles.push(shuttle::run(world.clone(), family, seeds[0], port)?);
            }
        }
        let sailing =
            if run.band == "ding" && !use_shuttle { Some(sail_floor(world, family, seeds[0])?) } else { None };
        let paths = defs
            .upbringing
            .family(family)
            .and_then(|f| f.completion.as_ref())
            .map(|c| c.paths.clone())
            .unwrap_or_default();
        let mut probes = Vec::new();
        for path in paths.into_iter().filter(|path| !use_shuttle || path == "mio_path_4") {
            eprintln!("upbringing-act-report: floor_path={path} seed=42");
            let (run, world) = play(defs.clone(), family, Strategy::Idle, 42, true, Some(&path))?;
            let reason = if run.band != "ding" {
                Some("not_ding")
            } else if run.capital.aspiration.as_deref() != Some(path.as_str()) || !run.capital.fulfilled {
                Some("path_unfulfilled")
            } else {
                None
            };
            let sailing = if reason.is_none() && !use_shuttle { Some(sail_floor(world, family, 42)?) } else { None };
            probes.push(PathProbe { requested_path: path, run, sailing, reason });
        }
        Some(FloorProbe { run, sailing, paths: probes })
    } else {
        None
    };
    let all: Vec<_> = strategies
        .iter()
        .flat_map(|s| s.runs.iter().map(move |r| (s.strategy.as_str(), r)))
        .chain(floor_probe.iter().map(|probe| ("minimum", &probe.run)))
        .collect();
    let min = all.iter().map(|(_, r)| r.capital.value).min().ok_or(ReportError::Unavailable("capital_min"))?;
    let max = all.iter().map(|(_, r)| r.capital.value).max().ok_or(ReportError::Unavailable("capital_max"))?;
    let (strategy, run) =
        all.iter().copied().max_by_key(|(_, r)| r.score).ok_or(ReportError::Unavailable("best_score"))?;
    let best = BestScore {
        strategy: strategy.into(),
        seed: run.seed,
        score: run.score,
        limits: run.limits.clone(),
        gaps: run
            .limits
            .iter()
            .map(|(k, limit)| {
                let value = if k == "savings" { run.savings_score } else { run.items.get(k).copied().unwrap_or(0) };
                (k.clone(), limit.map(|n| n - value))
            })
            .collect(),
    };
    let bands = ["ding", "bing", "yi", "jia", "te"]
        .into_iter()
        .map(|band| {
            (
                band.into(),
                strategies
                    .iter()
                    .filter_map(|s| s.bands.get(band).map(|seeds| (s.strategy.clone(), seeds.clone())))
                    .chain(
                        floor_probe
                            .iter()
                            .filter(|probe| probe.run.band == band)
                            .map(|probe| ("minimum".into(), vec![probe.run.seed])),
                    )
                    .collect(),
            )
        })
        .collect();
    let capital_bands = ["ding", "bing", "yi", "jia", "te"]
        .into_iter()
        .map(|band| {
            let rules = defs.rules.upbringing.act.clone().unwrap_or_default();
            let values: Vec<_> = defs
                .upbringing
                .act_capital
                .iter()
                .filter(|c| c.family == family && c.band == band)
                .map(|c| manifest_core::upbringing::act::capital::definition_value(&defs, &rules, c))
                .collect();
            let min = values.iter().copied().min().unwrap_or(0);
            let max = values.iter().copied().max().unwrap_or(0);
            (band.into(), CapitalRatio { min, max, multiple: (min != 0).then(|| max as f64 / min as f64) })
        })
        .collect();
    Ok(ActReport {
        family: family.into(),
        seeds: seeds.to_vec(),
        strategies,
        bands,
        capital_ratio: CapitalRatio { min, max, multiple: (min != 0).then(|| max as f64 / min as f64) },
        best,
        floor_probe,
        capital_bands,
        graduation_saves,
        shuttle: shuttles,
    })
}

impl ActReport {
    pub fn markdown(&self) -> String {
        let mut columns: Vec<String> = [
            "score",
            "craft",
            "root",
            "skill",
            "rank",
            "mission",
            "exam",
            "contest",
            "people",
            "deeds",
            "savings",
            "capital.total",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        columns.extend(CAPITAL_KINDS.map(|k| format!("capital.{k}")));
        columns.extend(["exams", "contests", "duties", "voyages", "unused_points"].map(String::from));
        let mut out = format!(
            "family={}; seeds={:?}; cells=min/median/max; capital.*=value; unused_points=mean/week; null=no_hard_cap\n\n| strategy | band(seed) | {} |\n|---|---|{}\n",
            self.family,
            self.seeds,
            columns.join(" | "),
            "---:|".repeat(columns.len())
        );
        for strategy in &self.strategies {
            let bands =
                strategy.bands.iter().map(|(band, seeds)| format!("{band}{seeds:?}")).collect::<Vec<_>>().join(";");
            let values = columns
                .iter()
                .map(|key| strategy.metrics.get(key).map_or_else(|| "0/0/0".into(), Spread::cell))
                .collect::<Vec<_>>()
                .join(" | ");
            let _ = writeln!(out, "| {} | {bands} | {values} |", strategy.strategy);
        }
        if let Some(probe) = &self.floor_probe {
            let row = metrics(&probe.run);
            let values = columns
                .iter()
                .map(|key| {
                    let value = row.get(key).copied().unwrap_or(0.0);
                    Spread { min: value, median: value, max: value }.cell()
                })
                .collect::<Vec<_>>()
                .join(" | ");
            let _ = writeln!(out, "| minimum | {}[{}] | {values} |", probe.run.band, probe.run.seed);
        }
        let _ = writeln!(out, "\nbands={}", serde_json::to_string(&self.bands).unwrap_or_default());
        let _ = writeln!(out, "capital_ratio={}", serde_json::to_string(&self.capital_ratio).unwrap_or_default());
        let _ = writeln!(out, "capital_bands={}", serde_json::to_string(&self.capital_bands).unwrap_or_default());
        let _ = writeln!(out, "best={}", serde_json::to_string(&self.best).unwrap_or_default());
        if let Some(ace) = self.strategies.iter().find(|s| s.strategy == "ace") {
            let _ = writeln!(out, "\n| seed | item | ace | limit | gap | ace-social |\n|---:|---|---:|---:|---:|---:|");
            for run in &ace.runs {
                let social = self
                    .strategies
                    .iter()
                    .find(|s| s.strategy == "social")
                    .and_then(|s| s.runs.iter().find(|r| r.seed == run.seed));
                for (item, limit) in &run.limits {
                    let value =
                        if item == "savings" { run.savings_score } else { run.items.get(item).copied().unwrap_or(0) };
                    let other = social.map_or(0, |r| {
                        if item == "savings" { r.savings_score } else { r.items.get(item).copied().unwrap_or(0) }
                    });
                    let _ = writeln!(
                        out,
                        "| {} | {item} | {value} | {} | {} | {} |",
                        run.seed,
                        limit.map_or_else(|| "null".into(), |n| n.to_string()),
                        limit.map_or_else(|| "null".into(), |n| (n - value).to_string()),
                        value - other
                    );
                }
            }
        }
        if let Some(probe) = &self.floor_probe {
            let _ = writeln!(out, "\nfloor_probe_score={}; band={}", probe.run.score, probe.run.band);
            if let Some(s) = &probe.sailing {
                let _ = writeln!(
                    out,
                    "floor_sailing: band={}; path={:?}; seed={}; days={}; start={}; minimum={}@{}; end={}; bankrupt={}; reorganizations={}; trades={}; departures={}",
                    s.band,
                    s.path,
                    s.seed,
                    s.days,
                    s.start,
                    s.minimum,
                    s.minimum_day,
                    s.end,
                    s.bankrupt,
                    s.reorganizations,
                    s.trades,
                    s.departures
                );
            }
            for probe in &probe.paths {
                let _ = writeln!(
                    out,
                    "floor_path={}; score={}; band={}; fulfilled={}; reason={:?}",
                    probe.requested_path, probe.run.score, probe.run.band, probe.run.capital.fulfilled, probe.reason
                );
                if let Some(s) = &probe.sailing {
                    let _ = writeln!(out, "floor_path_sailing={}", serde_json::to_string(s).unwrap_or_default());
                }
            }
        }
        let _ = writeln!(out, "\nshuttle={}", serde_json::to_string(&self.shuttle).unwrap_or_default());
        for strategy in &self.strategies {
            for run in &strategy.runs {
                let _ = writeln!(
                    out,
                    "omen strategy={} seed={}: {}",
                    strategy.strategy,
                    run.seed,
                    serde_json::to_string(&run.omen).unwrap_or_default()
                );
            }
        }
        if let Some(probe) = &self.floor_probe {
            let _ = writeln!(
                out,
                "omen strategy=minimum seed={}: {}",
                probe.run.seed,
                serde_json::to_string(&probe.run.omen).unwrap_or_default()
            );
            for path in &probe.paths {
                let _ = writeln!(
                    out,
                    "omen strategy=minimum path={} seed={}: {}",
                    path.requested_path,
                    path.run.seed,
                    serde_json::to_string(&path.run.omen).unwrap_or_default()
                );
            }
        }
        out
    }
}
