//! U04：报名、少年组、题意计分和年度奖励使用真实定义及命令路径。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Moves, occurrence_key},
    upbringing::{AfterChoice, OUTING_PERMISSION_FLAG, PlanSlot},
};
use std::sync::Arc;

fn testbed() -> Arc<manifest_core::StaticData> {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let c = &mut Arc::make_mut(&mut defs).upbringing.contests[0];
    c.registration_required = true;
    c.age_groups = true;
    c.open_days = 30;
    defs
}
fn world(defs: Arc<manifest_core::StaticData>) -> World {
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(defs, sid, 42).unwrap()
}
fn plan(activity: &str) -> Command {
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity(activity)) })
            .collect(),
    }
}
fn register(key: &str) -> Command {
    Command::PlayContest { owner: OwnerId::Player, contest: key.into(), moves: Moves::Register { register: true } }
}

#[test]
fn absent_registration_does_not_settle_and_explicit_registration_survives_save() {
    let defs = testbed();
    let mut unregistered = world(defs.clone());
    let mut registered = unregistered.clone();
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let command = register(&key);
    let command: Command = serde_json::from_str(&serde_json::to_string(&command).unwrap()).unwrap();
    command.apply(&mut registered).unwrap();
    let before = registered.state.clone();
    assert!(command.apply(&mut registered).is_err());
    assert_eq!(registered.state, before);
    registered = World::from_snapshot(defs.clone(), registered.state).unwrap();
    assert!(registered.contest_registered(&key));
    for w in [&mut registered, &mut unregistered] {
        plan("rest").apply(w).unwrap();
        for _ in 0..5 {
            w.end_day().unwrap();
        }
    }
    assert!(!unregistered.state.upbringing.as_ref().unwrap().contest_results.contains_key(&key));
    assert!(registered.state.upbringing.as_ref().unwrap().contest_results.contains_key(&key));
    let mut old = serde_json::to_value(&before).unwrap();
    old["upbringing"].as_object_mut().unwrap().remove("contest_registrations");
    let old = serde_json::from_value(old).unwrap();
    assert!(!World::from_snapshot(defs, old).unwrap().contest_registered(&key));
}

#[test]
fn practice_in_the_plan_registers_only_before_the_contest() {
    let mut defs = testbed();
    Arc::make_mut(&mut defs).upbringing.contests[0].prep.activities = vec!["rest".into()];
    let mut later = world(defs.clone());
    let mut w = world(defs);
    let key = occurrence_key("test_match", [1553, 1, 5]);
    plan("rest").apply(&mut w).unwrap();
    assert!(w.contest_registered(&key));
    assert!(w.state.upbringing.as_ref().unwrap().contest_results.is_empty());
    let mut slots = match plan("rest") {
        Command::PlanMonth { slots, .. } => slots,
        _ => unreachable!(),
    };
    slots[0].after = Some(AfterChoice::activity("lesson_numbers"));
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut later).unwrap();
    assert!(!later.contest_registered(&key));
}

#[test]
fn registration_is_logged_and_replayed_without_client_scores() {
    use manifest_core::replay::{LogEntry, Source, StartParams, replay};
    let defs = testbed();
    let mut w = world(defs.clone());
    let first = w.day();
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let commands = [register(&key), plan("rest")];
    let mut log = Vec::new();
    for (seq, command) in commands.into_iter().enumerate() {
        command.apply(&mut w).unwrap();
        log.push(LogEntry { tick: first, seq: seq as u64, source: Source::Player, command, minute: None });
    }
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    let replayed = replay(defs, StartParams::new(w.state.scenario, 42), &log, w.day()).unwrap();
    assert_eq!(replayed.state, w.state);
}

#[test]
fn terra_contests_have_local_juniors_quarterly_home_dates_and_small_rewards() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    for c in &defs.upbringing.contests {
        assert!(c.registration_required && c.age_groups);
        assert_eq!(c.open_days, 30);
        assert!(c.rewards.iter().all(|r| r.fame == 1));
        assert!(c.rewards.iter().filter(|r| r.rank > 2).all(|r| r.memory.is_none()));
        let winner = c.rewards.iter().find(|r| r.rank == 1).unwrap();
        assert!(!winner.items.is_empty() && !winner.growth.is_empty() && winner.memory.is_some());
    }
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    let w = World::new(defs.clone(), sid, 42).unwrap();
    let c = defs.upbringing.contests.iter().find(|c| c.key == "contest_waka").unwrap();
    let home = c.dates.iter().filter(|d| d[0] == 1553 && w.contest_here(c, **d) && w.contest_scheduled(c, **d)).count();
    assert_eq!(home, 4);
    // 审查补：澪的歌合不是少年组；纳吉玛的采珠少年场是（视图列表项的 junior 字段读这里）。
    assert!(!w.contest_junior(c, [1553, 1, 9]));
    assert_eq!(w.contest_rival_range(c, [1553, 1, 1]), [20, 60]);
    assert_eq!(w.contest_rival_range(c, [1554, 1, 1]), [30, 70]);
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "najma_1553").unwrap());
    let mut w = World::new(defs.clone(), sid, 42).unwrap();
    // 阶段按入学旗标生效（开局剧情设家乡旗标、1554-01-10 的入学事件设学院旗标）；刚开局两个都还没设，
    // 任何日子都回退到第一阶段（家乡）。照真实进度把两个旗标设上，问的才是“那一天在哪个阶段”。
    let stages = &w.upbringing_family().unwrap().stages;
    let entry: Vec<String> = stages.iter().filter_map(|s| s.entry_flag.clone()).collect();
    assert_eq!(stages.iter().map(|s| s.from).collect::<Vec<_>>(), [[1553, 1, 1], [1554, 1, 10]]);
    w.state.upbringing.as_mut().unwrap().flags.extend(entry);
    let c = defs.upbringing.contests.iter().find(|c| c.key == "contest_pearls").unwrap();
    assert!(c.dates.contains(&[1553, 9, 20]));
    assert!(w.contest_here(c, [1553, 9, 20]));
    assert!(w.contest_junior(c, [1553, 9, 20]));
    assert!(!w.contest_junior(c, [1554, 5, 20]));
}

#[test]
fn every_selectable_poem_line_distinguishes_choices_and_random_choice_loses_bonus() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    let w = World::new(defs.clone(), sid, 42).unwrap();
    let mut count = 0;
    for c in &defs.upbringing.contests {
        if c.poem.is_none() {
            continue;
        }
        count += 1;
        for date in &c.dates {
            let points = w.contest_poem_points(c, *date);
            let mut best = 0;
            let mut random_milli = 0;
            for line in points {
                let hi = *line.iter().max().unwrap();
                let lo = *line.iter().min().unwrap();
                if line.len() > 1 {
                    assert!(hi - lo >= 2, "{} {date:?} {line:?}", c.key);
                }
                best += hi;
                random_milli += line.iter().sum::<i64>() * 1000 / line.len() as i64;
            }
            // U04 审查：每句减去最低分后，乱选的期望不超过满分的 60%（改前 80%，班顿实测 74%）。
            assert!(random_milli * 100 <= best * 1000 * 60, "{} {date:?}", c.key);
        }
    }
    assert_eq!(count, 6);
    // 季语与韵脚确实进了分值：把一个词改成不合季、不押韵，它离本句最高分远了 4 分。
    let mut changed = (*defs).clone();
    let c = changed.upbringing.contests.iter().find(|c| c.key == "contest_pantun").unwrap().clone();
    let key = &c.poem.as_ref().unwrap().word_choices[0][0];
    let behind = |w: &World| {
        let line = &w.contest_poem_points(&c, c.dates[0])[0];
        line.iter().max().unwrap() - line[0]
    };
    let expected = behind(&w);
    let word = changed.upbringing.poem_lexicons.iter_mut().flat_map(|l| &mut l.words).find(|v| &v.key == key).unwrap();
    word.season = "different_season".into();
    word.rhyme = "different_rhyme".into();
    let mut different = w.clone();
    different.defs = Arc::new(changed);
    assert_eq!(behind(&different), expected + 4);
}

#[test]
fn annual_flag_advances_work_without_lowering_or_repeatedly_adding_progress() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "lieve_1553").unwrap());
    let mut w = World::new(defs, sid, 42).unwrap();
    let group = "c9_lieve_bourse_runner";
    assert_eq!(w.upbringing_job_progress(group), 0);
    // U04 审查：二阶“交易所跑单·担责”真的能排了。一阶作对照（同一天、同一地点能排），二阶只差这个旗标。
    w.state.story2.flags.insert("c9_family_lieve".into());
    let date = w.cast_date();
    let tier = |key: &str| w.defs.upbringing.activity(key).unwrap().clone();
    let (first, second) = (tier("c9_lieve_bourse_runner_1"), tier("c9_lieve_bourse_runner_2"));
    w.upbringing_activity_available(&first, date).unwrap();
    assert!(w.upbringing_activity_available(&second, date).is_err());
    w.state.story2.flags.insert("u04_lieve_mayday_won".into());
    assert_eq!(w.upbringing_job_progress(group), 3);
    w.upbringing_activity_available(&second, date).unwrap();
    assert_eq!(w.upbringing_job_progress(group), 3);
    w.state.upbringing.as_mut().unwrap().job_progress.insert(group.into(), 9);
    assert_eq!(w.upbringing_job_progress(group), 9);
    let mut bad = (*w.defs).clone();
    bad.upbringing.job_progress_flags.values_mut().next().unwrap().group = "absent".into();
    assert!(!manifest_core::upbringing::native_validation::validate(&bad).is_empty());
}

#[test]
fn cacao_festival_and_contest_keep_independent_participation() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "ix_nikte_1553").unwrap());
    let mut w = World::new(defs, sid, 42).unwrap();
    let date = [1553, 4, 29];
    // 同日边界夹具：保留真实节庆与比赛定义，只定位到该日。
    w.state.day = manifest_core::scenario::day_of(&w.defs, date).unwrap();
    // 直接跳到四月底时，家乡期满 30 天该发的远足许可（U03）还没发，下一条命令会顺手补发、改了剧情旗标；
    // 照真实进度先设上，下面比较的才只是报名本身。
    w.state.story2.flags.insert(OUTING_PERMISSION_FLAG.into());
    w.state.upbringing.as_mut().unwrap().flags.insert(OUTING_PERMISSION_FLAG.into());
    let festival = w.defs.upbringing.festivals.iter().find(|f| f.key == "festival_ma_cacao").unwrap();
    assert!(festival.dates.contains(&date));
    assert!(festival.contests.iter().any(|key| key == "contest_cacao"));
    let key = occurrence_key("contest_cacao", date);
    assert!(!w.contest_registered(&key));
    let track = "c9_ix_nikte_festival_festival_ma_cacao_1553";
    assert_eq!(w.defs.upbringing.event_gates[track].from, Some(date));
    w.state.story2.flags.insert("c9_family_ix_nikte".into());
    w.state.upbringing.as_mut().unwrap().event_permits.insert(track.into());
    w.start_story2(track).unwrap();
    assert!(w.state.story2.pending.iter().any(|p| p.track == track));
    assert!(!w.contest_registered(&key));
    let story = w.state.story2.clone();
    register(&key).apply(&mut w).unwrap();
    assert!(w.contest_registered(&key));
    assert_eq!(w.state.story2, story);
    assert!(w.state.upbringing.as_ref().unwrap().contest_results.is_empty());
}
