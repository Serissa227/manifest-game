//! A11：真实家庭定义在里程碑前的夹具，仍由逐日调度和正式命令处理事件。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest, WorldDate, day_of},
    story2::{Status, TrackState},
    upbringing::{AfterChoice, FamilyDef, Phase, PlanSlot},
};
use std::sync::{Arc, OnceLock};
#[path = "support/u03.rs"]
mod u03;

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn near(f: &FamilyDef, date: WorldDate, seed: u64) -> World {
    let d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut start = StartParams::new(sid, seed);
    start.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        seed: Some(seed),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "测试".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    let mut w = World::from_start(d, &start, |_| {}).unwrap();
    w.state.day = day_of(&w.defs, date).unwrap();
    // 夹具表示此前已完成普通轨道，保留本卡三个事件供真实调度。
    for t in &w.defs.story2.tracks {
        if !t.key.starts_with("c9_family_graduation_") && t.key != "c9_aspiration_placeholder" {
            w.state.story2.tracks.insert(
                t.key.clone(),
                TrackState {
                    chapter: t.start.clone(),
                    visited: Default::default(),
                    entered: w.state.day,
                    status: Status::Done,
                    failure: None,
                },
            );
        }
    }
    w.state.story2.pending.clear();
    for stage in &f.stages {
        w.state.story2.flags.extend(stage.entry_flag.clone());
    }
    let stage = w.upbringing_stage_on(date).unwrap().clone();
    let lesson = stage
        .academy
        .as_deref()
        .and_then(|key| w.defs.upbringing.academy(key))
        .and_then(|a| a.curriculum.first())
        .map(|a| a.key.clone());
    let rest = w
        .defs
        .upbringing
        .activities
        .iter()
        .find(|a| a.kind == manifest_core::upbringing::ActivityKind::Rest)
        .unwrap()
        .key
        .clone();
    let s = w.state.upbringing.as_mut().unwrap();
    s.month = [date[0], date[1]];
    s.phase = Phase::Running;
    s.next_slot = 3;
    s.stage_from = Some(stage.from);
    s.plan = (0..3)
        .map(|index| PlanSlot { index, lesson: lesson.clone(), after: Some(AfterChoice::activity(&rest)) })
        .collect();
    w
}

fn answer(w: &mut World) {
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(w).unwrap();
}

fn advance(w: &mut World) {
    while w.act_bot_step().unwrap() {}
    w.end_day().unwrap();
}

#[test]
fn all_21_family_farewells_queue_once_on_their_academy_day_before_capital() {
    let d = defs();
    assert_eq!(d.upbringing.families.len(), 21);
    for f in &d.upbringing.families {
        let c = f.completion.as_ref().unwrap();
        let key = c.family_event.as_ref().unwrap();
        let academy = f.stages.iter().rev().find_map(|s| s.academy.as_deref()).unwrap();
        let date = d.upbringing.academy(academy).unwrap().graduation.as_ref().unwrap().date;
        assert_eq!(date, [1556, 12, 31]);
        let mut w = near(f, [1556, 12, 30], 42);
        // 旧档已有志向，不能因新增谈话撤回选择或补发谈话。
        w.state.upbringing.as_mut().unwrap().path = c.paths.first().cloned();
        assert!(!w.state.story2.tracks.contains_key(key));
        advance(&mut w);
        assert_eq!(w.cast_date(), date);
        assert_eq!(w.pending_story2().unwrap().track, *key, "{}", f.key);
        assert!(!w.upbringing_graduation_ready());
        assert_eq!(w.fleets_of(OwnerId::Player).count(), 0);
        assert!(w.state.upbringing.as_ref().unwrap().graduation.is_none());
        for other in &d.upbringing.families {
            let other_key = other.completion.as_ref().unwrap().family_event.as_ref().unwrap();
            if other.key != f.key {
                assert!(!w.state.story2.tracks.contains_key(other_key));
                let t = d.story2.track(other_key).unwrap();
                assert!(!w.story2_conditions(&t.chapters[0].when, w.day()));
            }
        }
        assert!(!w.state.story2.tracks.contains_key(c.choose_event.as_ref().unwrap()));
        let saved = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
        assert_eq!(saved.pending_story2(), w.pending_story2());
        answer(&mut w);
        assert_eq!(w.state.story2.tracks[key].status, Status::Done);
        assert_eq!(w.state.story2.tracks[key].visited.len(), 1);
        advance(&mut w);
        assert_eq!(w.cast_date(), f.graduation);
        assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Done, "{}", f.key);
        let record = w.state.upbringing.as_ref().unwrap().graduation.clone();
        advance(&mut w);
        assert_eq!(w.state.upbringing.as_ref().unwrap().graduation, record);
        assert_eq!(w.state.story2.tracks[key].visited.len(), 1);
        assert!(!w.state.story2.pending.iter().any(|p| p.track == *key));
        assert!(w.money_conserved());
    }
}

#[test]
fn aspiration_talk_precedes_first_choice_and_survives_reload_without_repeating() {
    let d = defs();
    let f = d.upbringing.family("mio").unwrap();
    let mut w = near(f, [1554, 6, 20], 42);
    let key = f.completion.as_ref().unwrap().choose_event.as_ref().unwrap();
    let p = &d.upbringing.paths.iter().find(|p| p.key == "mio_path_1").unwrap();
    // 本测试隔离年龄和谈话门槛，成长条件已由先前经历满足。
    for attr in ["seamanship", "command", "gunnery", "arms"] {
        w.state.upbringing.as_mut().unwrap().growth.insert(attr.into(), 800);
    }
    let choose = Command::ChoosePath { owner: OwnerId::Player, path: p.key.clone() };
    assert!(!w.path_available(p));
    assert!(choose.apply(&mut w).is_err());
    advance(&mut w);
    assert_eq!(w.cast_date(), [1554, 6, 21]);
    assert_eq!(w.pending_story2().unwrap().track, *key);
    assert!(!w.path_available(p));
    assert!(choose.apply(&mut w).is_err());
    w = World::from_snapshot(d.clone(), w.state).unwrap();
    assert_eq!(w.pending_story2().unwrap().track, *key);
    answer(&mut w);
    assert!(w.path_available(p));
    choose.apply(&mut w).unwrap();
    advance(&mut w);
    assert_eq!(w.state.story2.tracks[key].status, Status::Done);
    assert_eq!(w.state.story2.tracks[key].visited.len(), 1);
    assert!(!w.state.story2.pending.iter().any(|p| p.track == *key));
}

#[test]
fn milestone_hook_references_and_ceremony_dates_are_validated() {
    let d = defs();
    for field in ["family_event", "choose_event", "date"] {
        let mut invalid = d.as_ref().clone();
        let f = &mut invalid.upbringing.families[0];
        match field {
            "family_event" => f.completion.as_mut().unwrap().family_event = Some("missing".into()),
            "choose_event" => f.completion.as_mut().unwrap().choose_event = Some("missing".into()),
            _ => f.graduation = [1556, 12, 30],
        }
        assert!(!manifest_core::upbringing::milestone_validation::validate(&invalid).is_empty());
    }
}

#[test]
fn seasonal_daily_events_have_allowed_dates_in_the_four_real_upbringing_years() {
    use std::collections::BTreeSet;
    let d = defs();
    let seasonal: Vec<_> = d.upbringing.event_gates.iter().filter(|(_, g)| g.months.is_some()).collect();
    assert_eq!(seasonal.len(), 38);
    let expected: &[(&str, &[u32])] = &[
        ("c9_pool_american_daily_02_5", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_american_daily_03_1", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_american_daily_09_2", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_american_daily_09_3", &[9, 10]),
        ("c9_pool_chinese_daily_04_4", &[5, 6]),
        ("c9_pool_east_african_daily_04_0", &[3, 4, 5]),
        ("c9_pool_east_african_daily_04_2", &[6, 7, 8, 9, 10, 12, 1, 2]),
        ("c9_pool_japanese_daily_00_4", &[1, 12]),
        ("c9_pool_japanese_daily_01_0", &[10, 11]),
        ("c9_pool_japanese_daily_01_2", &[6, 7]),
        ("c9_pool_japanese_daily_01_3", &[10, 11]),
        ("c9_pool_japanese_daily_02_3", &[1, 2]),
        ("c9_pool_japanese_daily_02_4", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_japanese_daily_02_5", &[7, 8]),
        ("c9_pool_japanese_daily_04_4", &[8]),
        ("c9_pool_japanese_daily_05_0", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_japanese_daily_05_5", &[6, 7]),
        ("c9_pool_japanese_daily_06_4", &[10, 11]),
        ("c9_pool_japanese_daily_08_1", &[2, 3, 4]),
        ("c9_pool_japanese_daily_08_3", &[4, 5]),
        ("c9_pool_japanese_daily_08_4", &[5, 6, 7]),
        ("c9_pool_japanese_daily_09_2", &[2, 3, 4]),
        ("c9_pool_japanese_daily_09_5", &[2, 3, 4]),
        ("c9_pool_north_african_daily_01_5", &[10, 11, 12, 1, 2, 3]),
        ("c9_pool_southeast_asian_daily_01_3", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_02_0", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_02_3", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_03_2", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_05_0", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_05_2", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_05_4", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_07_2", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_07_3", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_07_4", &[11, 12, 1, 2, 3]),
        ("c9_pool_southeast_asian_daily_08_2", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_09_0", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_09_1", &[5, 6, 7, 8, 9, 10]),
        ("c9_pool_southeast_asian_daily_09_4", &[5, 6, 7, 8, 9, 10]),
    ];
    for (key, months) in expected {
        assert_eq!(d.upbringing.event_gates[*key].months.as_deref(), Some(*months), "{key}");
    }
    // U06C7 713f01b1：七夕裁纸从整月改为节前三日，仍保留在原39条的可达覆盖里。
    let tanabata_key = "c9_pool_japanese_daily_04_5";
    let tanabata = &d.upbringing.event_gates[tanabata_key];
    assert_eq!(tanabata.festival.as_deref(), Some("festival_jp_tanabata"));
    assert_eq!(tanabata.festival_window_days, Some([-3, -3]));
    let tanabata_days: BTreeSet<_> = d
        .upbringing
        .festivals
        .iter()
        .find(|f| f.key == "festival_jp_tanabata")
        .unwrap()
        .dates
        .iter()
        .map(|date| day_of(&d, *date).unwrap() - 3)
        .collect();
    let wanted: BTreeSet<_> = seasonal.iter().map(|(key, _)| (*key).clone()).chain([tanabata_key.to_owned()]).collect();
    let families: Vec<_> = d
        .upbringing
        .families
        .iter()
        .map(|family| {
            // 只取本家庭真实开场/入学效果，不逐项补事件门槛。
            let flags: BTreeSet<_> = family
                .stages
                .iter()
                .filter_map(|s| s.entry_event.as_deref())
                .filter_map(|key| d.story2.track(key))
                .flat_map(|t| &t.chapters)
                .flat_map(|c| &c.choices)
                .flat_map(|o| &o.effects)
                .filter_map(|e| {
                    if let manifest_core::story2::Effect::Flag { flag, value: true } = e {
                        Some(flag.clone())
                    } else {
                        None
                    }
                })
                .collect();
            let mut probe = near(family, [1553, 1, 1], 42);
            probe.state.story2.flags.extend(flags.iter().cloned());
            for key in &wanted {
                probe.state.story2.tracks.get_mut(key).unwrap().status = Status::Active;
            }
            (family, flags, probe)
        })
        .collect();
    for (_, _, base) in &families {
        let mut probe = base.clone();
        for year in 1553..=1556 {
            for month in 1..=12 {
                let first = day_of(&d, [year, month, 1]).unwrap();
                for day in first..first + d.calendar.month_days(first) {
                    probe.state.day = day;
                    for key in &wanted {
                        let gate = &d.upbringing.event_gates[key];
                        if gate.months.as_ref().is_some_and(|months| !months.contains(&month))
                            || (key == tanabata_key && !tanabata_days.contains(&day))
                        {
                            assert!(
                                !probe.cadence_candidate_now(key, false),
                                "{key}: {:?} 不在允许日期却能排期",
                                probe.cast_date()
                            );
                        }
                    }
                }
            }
        }
    }
    fn answer_all(w: &mut World, report: &mut u03::Report) {
        while u03::answer(w, report, None) {}
        assert!(report.errors.is_empty() && report.locked.is_empty(), "{report:?}");
    }
    fn play_day(w: &mut World, report: &mut u03::Report) {
        loop {
            answer_all(w, report);
            if w.act_bot_step().unwrap() {
                continue;
            }
            if !w.act_running() && w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
                let plan = w.auto_plan("balanced").unwrap();
                w.upbringing_plan_command(plan).apply(w).unwrap();
                continue;
            }
            w.end_day().unwrap();
            return;
        }
    }
    // U06a 每周抽选；这些固定种子已由真实排期和正式回应逐条到达，不改任何事件门槛。
    let cases: &[(&str, &str, WorldDate, u64)] = &[
        ("c9_pool_american_daily_02_5", "ix_nikte", [1553, 5, 1], 11),
        ("c9_pool_american_daily_03_1", "ix_nikte", [1553, 5, 1], 3),
        ("c9_pool_american_daily_09_2", "custom_chincha_rafts", [1553, 5, 15], 12),
        ("c9_pool_american_daily_09_3", "custom_chincha_rafts", [1553, 9, 1], 5),
        ("c9_pool_chinese_daily_04_4", "lin_wandeng", [1553, 6, 1], 10),
        ("c9_pool_east_african_daily_04_0", "baraka", [1553, 3, 8], 1),
        ("c9_pool_east_african_daily_04_2", "baraka", [1553, 7, 1], 1),
        ("c9_pool_japanese_daily_00_4", "mio", [1554, 1, 8], 12),
        ("c9_pool_japanese_daily_01_0", "mio", [1553, 10, 8], 14),
        ("c9_pool_japanese_daily_01_2", "mio", [1553, 7, 8], 4),
        ("c9_pool_japanese_daily_01_3", "mio", [1553, 10, 15], 7),
        ("c9_pool_japanese_daily_02_3", "mio", [1553, 1, 8], 9),
        ("c9_pool_japanese_daily_02_4", "mio", [1553, 8, 8], 2),
        ("c9_pool_japanese_daily_02_5", "mio", [1553, 7, 15], 0),
        ("c9_pool_japanese_daily_04_4", "mio", [1553, 8, 8], 1),
        ("c9_pool_japanese_daily_04_5", "mio", [1553, 8, 22], 0),
        ("c9_pool_japanese_daily_05_0", "mio", [1553, 5, 22], 12),
        ("c9_pool_japanese_daily_05_5", "mio", [1553, 6, 15], 7),
        ("c9_pool_japanese_daily_06_4", "mio", [1553, 10, 8], 12),
        ("c9_pool_japanese_daily_08_1", "mio", [1553, 3, 22], 3),
        ("c9_pool_japanese_daily_08_3", "mio", [1553, 5, 22], 2),
        ("c9_pool_japanese_daily_08_4", "mio", [1553, 7, 15], 2),
        ("c9_pool_japanese_daily_09_2", "mio", [1553, 4, 15], 15),
        ("c9_pool_japanese_daily_09_5", "mio", [1553, 2, 22], 5),
        ("c9_pool_north_african_daily_01_5", "custom_fez_scholar", [1553, 2, 1], 4),
        ("c9_pool_southeast_asian_daily_01_3", "kaicili", [1553, 7, 1], 13),
        ("c9_pool_southeast_asian_daily_02_0", "kaicili", [1553, 7, 22], 0),
        ("c9_pool_southeast_asian_daily_02_3", "kaicili", [1553, 5, 1], 4),
        ("c9_pool_southeast_asian_daily_03_2", "kaicili", [1553, 6, 15], 1),
        ("c9_pool_southeast_asian_daily_05_0", "kaicili", [1553, 5, 1], 15),
        ("c9_pool_southeast_asian_daily_05_2", "kaicili", [1553, 5, 1], 10),
        ("c9_pool_southeast_asian_daily_05_4", "kaicili", [1553, 7, 1], 9),
        ("c9_pool_southeast_asian_daily_07_2", "custom_tondo_datu", [1553, 5, 15], 12),
        ("c9_pool_southeast_asian_daily_07_3", "custom_tondo_datu", [1553, 5, 1], 13),
        ("c9_pool_southeast_asian_daily_07_4", "custom_tondo_datu", [1553, 2, 1], 10),
        ("c9_pool_southeast_asian_daily_08_2", "custom_tondo_datu", [1553, 5, 1], 0),
        ("c9_pool_southeast_asian_daily_09_0", "custom_tondo_datu", [1553, 5, 1], 11),
        ("c9_pool_southeast_asian_daily_09_1", "custom_tondo_datu", [1553, 5, 8], 6),
        ("c9_pool_southeast_asian_daily_09_4", "custom_tondo_datu", [1553, 5, 1], 1),
    ];
    assert_eq!(cases.iter().map(|(key, _, _, _)| (*key).to_owned()).collect::<BTreeSet<_>>(), wanted);
    let mut seen = BTreeSet::new();
    for &(target, family_key, first_date, seed) in cases {
        let (family, flags, _) = families.iter().find(|(f, _, _)| f.key == family_key).unwrap();
        let first = day_of(&d, first_date).unwrap();
        let prev = d.calendar.date_of(first - 1);
        let prev_date = [(d.rules.world.start_year + i64::from(prev.year) - 1) as u32, prev.month, prev.day];
        let week = manifest_core::upbringing::weekly::week_of(first_date[2]);
        let end_day = manifest_core::upbringing::weekly::week_bounds(d.calendar.month_days(first), week)[1];
        let last = day_of(&d, [first_date[0], first_date[1], end_day]).unwrap();
        let mut w = near(family, prev_date, seed);
        w.state.story2.flags.extend(flags.iter().cloned());
        for key in &wanted {
            w.state.story2.tracks.get_mut(key).unwrap().status = Status::Active;
        }
        let mut report = u03::Report::default();
        while w.day() < last {
            play_day(&mut w, &mut report);
        }
        answer_all(&mut w, &mut report);
        assert!(
            report.seen.iter().any(|event| event.track == target),
            "{target}: {family_key} {first_date:?} seed={seed}"
        );
        for event in &report.seen {
            if !wanted.contains(&event.track) {
                continue;
            }
            let gate = &d.upbringing.event_gates[&event.track];
            if let Some(months) = &gate.months {
                assert!(
                    months.contains(&d.calendar.date_of(event.day).month),
                    "{}: {:?}",
                    event.track,
                    d.calendar.date_of(event.day)
                );
            } else {
                assert!(tanabata_days.contains(&event.day));
            }
            seen.insert(event.track.clone());
        }
        println!("{target}: {family_key} {first_date:?} seed={seed} 可达");
    }
    assert_eq!(seen, wanted);
}
