//! 矩阵分批、注册分片扩展、普通命令重放与隐藏分支的年龄门禁。
use manifest_core::{
    replay::{StartParams, replay},
    scenario::{Gender, ProtagonistIdentity},
    story2::Story2Defs,
    *,
};
use manifest_sim::story_bot::{matrix, walk};
use std::sync::Arc;

fn fixture() -> (Arc<StaticData>, ScenarioId) {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let data = Arc::make_mut(&mut d);
    let sid = ScenarioId::from_idx(data.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    data.upbringing.families[0].graduation = [1553, 1, 4];
    data.upbringing.families[0].stages.truncate(1);
    (d, sid)
}

#[test]
fn registered_identities_expand_into_two_hero_and_four_template_batches() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let cases = matrix::cases(&d);
    assert_eq!(cases.iter().filter(|c| !c.template).count(), 9);
    assert_eq!(cases.iter().filter(|c| c.template).count(), 24);
    for batch in 0..8 {
        let group: Vec<_> = cases.iter().filter(|c| c.batch == batch).collect();
        assert!(!group.is_empty());
        if batch < 5 {
            assert!(group.len() <= 2);
            assert!(group.iter().all(|c| !c.template));
        } else {
            assert_eq!(group.len(), 8);
            assert!(group.iter().all(|c| c.template));
        }
    }
    let case = &cases[0];
    let w = World::from_start(d.clone(), &matrix::start(&d, case).unwrap(), |_| {}).unwrap();
    let mut extra = d.story2.tracks[0].clone();
    extra.key = "new_registered_fragment".into();
    extra.source = "stories/new_registered_fragment.toml".into();
    extra.chapters[0].when.clear();
    assert!(matrix::relevant(&w, &extra));
    let mut other = extra.clone();
    other.chapters[0].when = vec![story2::Condition::Protagonist { protagonist: "never_this_identity".into() }];
    other.start = other.chapters[0].key.clone();
    assert!(!matrix::relevant(&w, &other));
    let mut fortune_trial = w.clone();
    manifest_sim::story_bot::Cheat::Satisfy(story2::Condition::Growth { attr: "fortune".into(), ge: 1000 })
        .apply(&mut fortune_trial, w.day())
        .unwrap();
    assert_eq!(fortune_trial.upbringing_growth("fortune"), w.upbringing_growth("fortune"));
    assert_eq!(fortune_trial.state.protagonist, w.state.protagonist);
    // 真实寰宇首月跨月排程，不用合成活动或 SkipUpbringing 解锁。
    let (after, report) = matrix::ordinary(w, 35);
    assert!(report.blocked.is_none(), "{:?}", report.blocked);
    assert_eq!(report.until - report.from, 35);
    assert!(after.money_conserved());
    assert!(World::from_snapshot(d, after.state).is_ok());
}

#[test]
fn ordinary_bot_uses_replayable_commands_without_skip_or_cheats() {
    let (d, sid) = fixture();
    let initial = World::new(d.clone(), sid, 42).unwrap();
    let (w, report) = matrix::ordinary(initial, 8);
    assert!(report.blocked.is_none(), "{:?}", report.blocked);
    assert!(report.graduated);
    assert!(report.commands.iter().any(|e| matches!(e.command, Command::PlanMonth { .. })));
    assert!(report.commands.iter().all(|e| !matches!(e.command, Command::SkipUpbringing { .. })));
    assert_eq!(report.until - report.from, 8);
    assert_eq!(replay(d.clone(), StartParams::new(sid, 42), &report.commands, w.day()).unwrap().state, w.state);
    assert!(World::from_snapshot(d, w.state).is_ok());
}

#[test]
fn hidden_identity_and_romance_choices_are_excluded_before_resource_cheats() {
    let (mut d, sid) = fixture();
    let tracks: Story2Defs = manifest_data::story2::parse_story_tracks(r#"
[[tracks]]
key = "matrix_hidden"
name = "测试"
kind = "encounter"
auto = false
upbringing = true
start = "start"
[[tracks.chapters]]
key = "start"
title = "测试"
text = "测试。"
choices = [
 { key = "other", text = "测试。", next = "done", requires = [{ protagonist = "other" }] },
 { key = "mentor", text = "测试。", next = "done", requires = [{ romance_open = "mentor" }, { kind = "heart", person = "mentor", ge = 50 }] },
 { key = "okay", text = "测试。", next = "done" }
]
"#, "stories/matrix_test.toml").unwrap();
    Arc::make_mut(&mut d).story2 = tracks;
    let mut w = World::new(d, sid, 42).unwrap();
    w.state.protagonist = Some(ProtagonistIdentity {
        protagonist: Some("test_hero".into()),
        template: None,
        born: [1540, 6, 1],
        gender: Gender::F,
    });
    let before = w.state.clone();
    let report = walk(&w, "matrix_hidden", 64);
    assert!(report.done);
    assert_eq!(report.steps.iter().filter(|s| s.excluded).count(), 2);
    assert!(report.steps.iter().all(|s| s.error.is_none()));
    assert_eq!(before, w.state);
}

#[test]
fn matrix_cheats_preserve_birthdays_and_do_not_rewrite_internal_branch_flags() {
    let (mut d, sid) = fixture();
    let tracks: Story2Defs = manifest_data::story2::parse_story_tracks(
        r#"
[[tracks]]
key = "matrix_flags"
name = "测试"
kind = "encounter"
auto = false
upbringing = true
start = "start"
[[tracks.chapters]]
key = "start"
title = "测试"
text = "测试。"
when = [{ kind = "flag", flag = "external" }]
choices = [{ key = "choose", text = "测试。", next = "last", effects = [{ kind = "flag", flag = "internal", value = false }] }]
[[tracks.chapters]]
key = "last"
title = "测试"
text = "测试。"
choices = [
 { key = "impossible", text = "测试。", next = "done", requires = [{ kind = "flag", flag = "internal" }] },
 { key = "okay", text = "测试。", next = "done" }
]
"#,
        "stories/matrix_test.toml",
    )
    .unwrap();
    Arc::make_mut(&mut d).story2 = tracks;
    let w = World::new(d, sid, 42).unwrap();
    let (seed, prerequisites) = matrix::cheat_seed(&w, "matrix_flags").unwrap();
    assert_eq!(w.state.protagonist, seed.state.protagonist);
    assert!(seed.state.story2.flags.contains("external"));
    assert!(!seed.state.story2.flags.contains("internal"));
    assert_eq!(prerequisites.len(), 1);
    let report = walk(&seed, "matrix_flags", 64);
    assert!(report.done);
    assert!(report.steps.iter().any(|s| s.branch == "impossible" && s.error.is_some()));
}

#[test]
fn native_defaults_use_kernel_deadlines_without_claiming_a_normal_month_plan() {
    let (mut d, sid) = fixture();
    let tracks = manifest_data::story2::parse_story_tracks(
        r#"
[[tracks]]
key = "matrix_default"
name = "测试"
kind = "encounter"
auto = false
start = "start"
[[tracks.chapters]]
key = "start"
title = "测试"
text = "测试。"
stage = "witness"
window = [[1553, 1, 1], [1553, 1, 2]]
default = { next = "done" }
"#,
        "stories/matrix_default.toml",
    )
    .unwrap();
    Arc::make_mut(&mut d).story2 = tracks;
    let w = World::new(d, sid, 42).unwrap();
    assert!(w.upbringing_waiting());
    let before = w.state.clone();
    let report = walk(&w, "matrix_default", 64);
    assert!(report.done);
    let default = report.steps.iter().find(|s| s.branch == "default").unwrap();
    assert!(default.error.is_none(), "{:?}", default.error);
    assert_eq!(default.next.as_deref(), Some("done"));
    assert_eq!(w.state, before);
}

#[test]
fn native_cheat_resources_target_growth_and_fame_without_changing_birth_or_fortune() {
    use manifest_sim::story_bot::Cheat;
    let (d, sid) = fixture();
    let mut w = World::new(d, sid, 42).unwrap();
    let identity = w.state.protagonist.clone();
    let fortune = w.upbringing_growth("fortune");
    for condition in [
        story2::Condition::Growth { attr: "navigation".into(), ge: 350 },
        story2::Condition::Attr { attr: "navigation".into(), ge: 5 },
        story2::Condition::Fame { ge: 60 },
    ] {
        Cheat::Satisfy(condition.clone()).apply(&mut w, 0).unwrap();
        assert!(w.story2_conditions(&[condition], 0));
    }
    Cheat::Satisfy(story2::Condition::Growth { attr: "fortune".into(), ge: 1000 }).apply(&mut w, 0).unwrap();
    assert_eq!(w.upbringing_growth("fortune"), fortune);
    assert_eq!(w.state.protagonist, identity);
}

#[test]
fn satisfied_age_minimum_before_epoch_keeps_current_date_and_birthdays() {
    use manifest_sim::story_bot::Cheat;
    let (mut defs, sid) = fixture();
    let data = Arc::make_mut(&mut defs);
    data.rules.world.start_year = 1553;
    data.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().born = [1540, 1, 1];
    let mut initial = World::new(defs, sid, 42).unwrap();
    initial.state.protagonist = Some(ProtagonistIdentity {
        protagonist: Some("test_hero".into()),
        template: None,
        born: [1540, 1, 1],
        gender: Gender::F,
    });
    assert_eq!(initial.cast_date(), [1553, 1, 1]);
    assert!(initial.story2_day([1552, 1, 1]).is_none());
    for person in [None, Some("classmate_a")] {
        let mut trial = initial.clone();
        let satisfied = story2::Condition::Age { person: person.map(str::to_owned), ge: Some(12), le: Some(17) };
        assert!(trial.story2_conditions(std::slice::from_ref(&satisfied), 0));
        Cheat::Satisfy(satisfied.clone()).apply(&mut trial, 0).unwrap();
        assert_eq!(trial.day(), initial.day());
        assert_eq!(trial.state.protagonist, initial.state.protagonist);
        assert_eq!(trial.defs.cast.person("classmate_a").unwrap().born, [1540, 1, 1]);
        assert!(trial.story2_conditions(&[satisfied], 0));

        // 尚未满足的最低年龄仍须正常推进日期，不能改生日。
        let future = story2::Condition::Age { person: person.map(str::to_owned), ge: Some(14), le: Some(17) };
        Cheat::Satisfy(future.clone()).apply(&mut trial, 0).unwrap();
        assert_eq!(trial.cast_date(), [1554, 1, 1]);
        assert_eq!(trial.state.protagonist, initial.state.protagonist);
        assert!(trial.story2_conditions(&[future], 0));
    }
}

#[test]
fn matrix_pre_epoch_age_minimum_allows_manual_and_default_paths() {
    use serde_json::json;
    let (base, sid) = fixture();
    for person in [None, Some("classmate_a")] {
        let mut defs = base.clone();
        let data = Arc::make_mut(&mut defs);
        data.rules.world.start_year = 1553;
        data.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().born = [1540, 1, 1];
        data.story2.tracks = vec![
            serde_json::from_value(json!({
                "key":"matrix_past_birthday","name":"测试","kind":"encounter","auto":false,"start":"start","upbringing":true,
                "chapters":[{"key":"start","title":"测试","text":"测试。","window":[[1554,1,1],[1554,1,2]],
                    "when":[{"kind":"age","person":person,"ge":12,"le":17}],
                    "choices":[{"key":"answer","text":"测试。","next":"done"}],
                    "default":{"next":"done"}}]
            }))
            .unwrap(),
        ];
        let mut world = World::new(defs, sid, 42).unwrap();
        world.state.protagonist = Some(ProtagonistIdentity {
            protagonist: Some("test_hero".into()),
            template: None,
            born: [1540, 1, 1],
            gender: Gender::F,
        });
        let before = world.state.clone();
        let report = walk(&world, "matrix_past_birthday", 64);
        assert!(report.done && !report.failed && !report.truncated, "{report:?}");
        for branch in ["answer", "default"] {
            assert!(
                report.steps.iter().any(|step| {
                    step.branch == branch
                        && step.error.is_none()
                        && !step.excluded
                        && step.next.as_deref() == Some("done")
                }),
                "{report:?}"
            );
        }
        assert_eq!(world.state, before);
    }
}

#[test]
fn matrix_manual_and_default_paths_keep_heart_and_relationship_age_gates() {
    use serde_json::json;
    let (base, sid) = fixture();
    for gender in [Gender::F, Gender::M] {
        for effect in [
            json!({"kind":"heart","person":"mentor","value":1}),
            json!({"kind":"relation","person":"classmate_a","relation":"dating"}),
            json!({"kind":"relation","person":"classmate_a","relation":"lovers"}),
            json!({"kind":"relation","person":"classmate_a","relation":"partners"}),
        ] {
            let mut defs = base.clone();
            Arc::make_mut(&mut defs).story2.tracks = vec![
                serde_json::from_value(json!({
                    "key":"matrix_age_paths","name":"测试","kind":"encounter","auto":false,"start":"start","upbringing":true,
                    "chapters":[{"key":"start","title":"测试","text":"测试。","window":[[1553,1,1],[1553,1,2]],
                        "choices":[{"key":"answer","text":"测试。","next":"done","effects":[effect.clone()]}],
                        "default":{"next":"done","effects":[effect]}}]
                }))
                .unwrap(),
            ];
            let mut w = World::new(defs, sid, 42).unwrap();
            w.state.protagonist = Some(ProtagonistIdentity {
                protagonist: Some("test_hero".into()),
                template: None,
                born: [1540, 1, 1],
                gender,
            });
            let before = w.state.clone();
            let report = walk(&w, "matrix_age_paths", 64);
            assert!(!report.done && !report.truncated);
            for branch in ["answer", "default"] {
                assert!(report.steps.iter().any(|step| step.branch == branch && step.error.is_some()), "{report:?}");
            }
            assert_eq!(w.state, before);
        }
    }
}

fn ordinary_evidence_world(block_plan: bool) -> (Arc<StaticData>, ScenarioId, World) {
    use serde_json::json;
    let (mut defs, sid) = fixture();
    Arc::make_mut(&mut defs).story2.tracks = vec![
        serde_json::from_value(json!({
            "key":"matrix_seen","name":"测试","kind":"encounter","start":"start","auto":true,"upbringing":true,
            "chapters":[{"key":"start","title":"测试","text":"测试。","at":"test_west",
                "choices":[{"key":"answer","text":"测试。","next":"done"}]}]
        }))
        .unwrap(),
        serde_json::from_value(json!({
            "key":"matrix_unseen","name":"测试","kind":"encounter","start":"start","auto":true,"upbringing":true,
            "chapters":[{"key":"start","title":"测试","text":"测试。","at":"test_east",
                "window":[[1553,1,1],[1553,1,1]],"default":{"next":"done"},
                "choices":[{"key":"answer","text":"测试。","next":"done"}]}]
        }))
        .unwrap(),
    ];
    if block_plan {
        for activity in &mut Arc::make_mut(&mut defs).upbringing.activities {
            activity.unlock.flag = Some("matrix_no_activity".into());
        }
    }
    let world = World::new(defs.clone(), sid, 42).unwrap();
    (defs, sid, world)
}

#[test]
fn ordinary_report_does_not_count_offstage_defaults_as_player_completion() {
    let (_, _, w) = ordinary_evidence_world(false);
    let (_, report) = matrix::ordinary(w, 2);
    assert!(report.blocked.is_none(), "{:?}", report.blocked);
    assert!(report.done.contains("matrix_seen"));
    assert!(report.done.contains("matrix_unseen"));
    assert_eq!(report.completed_by_answer, ["matrix_seen".to_owned()].into());
    assert_eq!(report.answered_chapters["matrix_seen"], ["start".to_owned()].into());
    assert!(!report.answered_chapters.contains_key("matrix_unseen"));
}

#[test]
fn ordinary_replay_includes_accepted_commands_on_the_blocked_final_day() {
    let (defs, sid, w) = ordinary_evidence_world(true);
    let (w, report) = matrix::ordinary(w, 2);
    assert_eq!(report.until, report.from);
    assert!(report.blocked.is_some());
    assert!(report.commands.iter().any(|entry| entry.tick == report.until));
    assert_eq!(matrix::replay_ordinary(defs, StartParams::new(sid, 42), &report).unwrap().state, w.state);
}

#[test]
fn ordinary_bot_preserves_tuition_and_earns_fees_through_normal_jobs() {
    use manifest_core::upbringing::{ActivityKind, AmountRange, Stage};
    use serde_json::json;
    let (mut defs, sid) = fixture();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[sid.idx()].cash = 36;
    let family = &mut d.upbringing.families[0];
    family.graduation = [1553, 4, 1];
    family.stages[0].stage = Stage::Academy;
    family.stages[0].academy = Some("test_academy".into());
    d.upbringing.activities.retain(|a| ["lesson", "rest", "job_begin"].contains(&a.key.as_str()));
    let lesson = d.upbringing.activities.iter_mut().find(|a| a.key == "lesson").unwrap();
    lesson.cost = 6;
    d.upbringing.academies[0].curriculum = vec![lesson.clone()];
    let job = d.upbringing.activities.iter_mut().find(|a| a.kind == ActivityKind::Job).unwrap();
    job.income = AmountRange::Fixed(20);
    job.risk = None;
    job.events.clear();
    let mut risky = job.clone();
    risky.key = "risky_job".into();
    risky.income = AmountRange::Fixed(200);
    risky.risk = Some(serde_json::from_value(json!({"failure_bp":10000})).unwrap());
    risky.failure.income_pct = 0;
    d.upbringing.activities.push(risky);
    d.story2.tracks = vec![
        serde_json::from_value(json!({
            "key":"tuition_choice","name":"测试","kind":"encounter","start":"start","auto":true,"upbringing":true,
            "chapters":[{"key":"start","title":"测试","text":"测试。","at":"test_west","choices":[
                {"key":"spend","text":"测试。","next":"done","effects":[{"kind":"cash","value":-36}]},
                {"key":"keep","text":"测试。","next":"done"}]}]
        }))
        .unwrap(),
    ];
    let initial = World::new(defs.clone(), sid, 42).unwrap();
    let (w, report) = matrix::ordinary(initial, 91);
    assert!(report.blocked.is_none(), "{:?}", report.blocked);
    assert!(report.graduated);
    assert!(matches!(report.commands[0].command, Command::StoryAnswer { choice: 1, .. }));
    let slots = report
        .commands
        .iter()
        .find_map(|e| match &e.command {
            Command::PlanMonth { slots, .. } => Some(slots),
            _ => None,
        })
        .unwrap();
    assert_eq!(slots[0].after.as_ref().unwrap().activity, "job_begin");
    assert!(w.state.upbringing.as_ref().unwrap().activity_counts.get("job_begin").copied().unwrap_or(0) > 0);
    assert!(w.money_conserved());
    assert_eq!(matrix::replay_ordinary(defs, StartParams::new(sid, 42), &report).unwrap().state, w.state);
}
