//! U02 工作包 3：寰宇打开掷骰规则、经典与测试世界保持关闭；`hard` 标记、通用失败语句池与
//! `copy-needed-u02.json` 一致；养成期的通用失败按规则扣疲劳与心情。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::NewGameRequest,
    story2::{Choice, Condition, Status, TrackDef},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn choices(d: &StaticData) -> impl Iterator<Item = (&TrackDef, &str, &Choice)> {
    d.story2
        .tracks
        .iter()
        .flat_map(|t| t.chapters.iter().flat_map(move |c| c.choices.iter().map(move |o| (t, c.key.as_str(), o))))
}

fn copy_needed() -> Value {
    let root = manifest_data::find_data_dir().unwrap();
    serde_json::from_str(&std::fs::read_to_string(root.parent().unwrap().join("copy-needed-u02.json")).unwrap())
        .unwrap()
}

#[test]
fn only_terra16_turns_the_dice_rule_on() {
    let root = manifest_data::find_data_dir().unwrap();
    let t = terra();
    let r = &t.rules.story;
    assert!(r.soft_requires);
    assert_eq!(r.attr_curve, vec![[0, 80], [25, 45], [50, 10], [100, 5]]);
    assert_eq!(r.skill_curve, vec![[0, 75], [25, 40], [50, 8], [100, 5]]);
    assert_eq!((r.fail_fatigue, r.fail_mood), (3, -2));
    for world in ["classic", "testbed"] {
        let d = manifest_data::load_world(&root, world).unwrap();
        assert_eq!(d.rules.story, manifest_core::story2::dice::StoryRules::default(), "{world}");
    }
    assert!(!manifest_data::load(&root).unwrap().rules.story.soft_requires, "经典世界不开掷骰");
}

#[test]
fn hard_marks_are_the_audited_written_language_gates() {
    let d = terra();
    let mut marked = BTreeSet::new();
    for (t, chapter, o) in choices(&d) {
        for i in &o.hard {
            let Some(Condition::Skill { skill, .. }) = o.requires.get(*i) else {
                panic!("{}:{chapter}:{} 的 hard 不在技能门槛上", t.key, o.key);
            };
            assert!(skill.starts_with("lang_") || skill == "quipu", "{}:{}", t.key, o.key);
            assert!(!t.source.contains("upbringing"), "养成期的语言门槛按熟练度掷骰，不标 hard：{}", t.key);
            marked.insert(format!("{}:{chapter}:{}:{skill}", t.key, o.key));
        }
    }
    assert_eq!(marked.len(), 52, "{marked:#?}");
    for key in [
        "request_musa:dig:read_stone:lang_latin",
        "request_yi_hwang:handover:hanmun:lang_chinese",
        "c11_trial_kokin_denju_1:trial:finish:lang_japanese",
        "request_mayta_qipu:persuade:translate_knots:quipu",
    ] {
        assert!(marked.contains(key), "{key}");
    }
    // 说话、打听仍可碰运气；同一选项里没标的门槛仍是软的。
    assert!(!marked.iter().any(|k| k.starts_with("request_khadija_rihla:")));
    let kokin = choices(&d).find(|(t, _, o)| t.key == "c11_trial_kokin_denju_1" && o.key == "finish").unwrap().2;
    // requires：结社、诗、名声、诗、日语；只有日语标 hard，诗仍掷骰，结社与名声本来就是硬条件。
    assert_eq!(kokin.hard.iter().copied().collect::<Vec<_>>(), vec![4]);
    assert!(kokin.soft_condition(1) && kokin.soft_condition(3));
    assert!(!kokin.soft_condition(0) && !kokin.soft_condition(2) && !kokin.soft_condition(4));
}

#[test]
fn every_soft_gate_has_a_registered_fail_pool_and_the_copy_list_matches_the_data() {
    let d = terra();
    let w = World::new(d.clone(), ScenarioId::from_idx(0), 42).unwrap();
    let mut used: BTreeMap<String, usize> = BTreeMap::new();
    let mut parts = BTreeMap::<String, BTreeMap<&str, usize>>::new();
    let mut examples = BTreeMap::<String, BTreeMap<String, Value>>::new();
    for (t, chapter, o) in choices(&d).filter(|(_, _, o)| o.fail.is_none()) {
        for (_, c) in o.requires.iter().enumerate().filter(|(i, _)| o.soft_condition(*i)) {
            let pool = w.story2_fail_pool(c);
            *used.entry(pool.clone()).or_default() += 1;
            let key = match c {
                Condition::Attr { attr, .. } | Condition::Growth { attr, .. } => attr,
                Condition::Skill { skill, .. } => skill,
                _ => unreachable!("soft_condition 只接受属性、成长与技能"),
            };
            *parts.entry(pool.clone()).or_default().entry(key).or_default() += 1;
            examples
                .entry(pool)
                .or_default()
                .entry(format!("{}:{}:{chapter}:{}", t.source, t.key, o.key))
                .or_insert_with(|| {
                    json!({
                        "file": t.source.strip_prefix("worlds/terra16/").unwrap_or(&t.source),
                        "track": t.key, "chapter": chapter, "choice": o.key, "text": o.text,
                    })
                });
        }
    }
    let examples: BTreeMap<_, _> =
        examples.into_iter().map(|(key, rows)| (key, rows.into_values().take(6).collect::<Vec<_>>())).collect();
    println!("copy-needed-u02 actual: {}", json!({"uses": &used, "parts": parts, "examples": examples}));
    let lines = &d.rules.story.fail_lines;
    assert_eq!(used.keys().collect::<Vec<_>>(), lines.keys().collect::<Vec<_>>(), "每个用得到的池子都要登记");
    let needed = copy_needed();
    assert_eq!(needed["task"], "U02");
    let pools = needed["pools"].as_array().unwrap();
    let listed: BTreeMap<String, usize> =
        pools.iter().map(|p| (p["key"].as_str().unwrap().to_owned(), p["lines"].as_u64().unwrap() as usize)).collect();
    assert_eq!(listed, lines.iter().map(|(k, v)| (k.clone(), v.len())).collect::<BTreeMap<_, _>>());
    let total: usize = listed.values().sum();
    assert_eq!(needed["counts"]["lines"], json!(total));
    assert_eq!(needed["counts"]["pools"], json!(listed.len()));
    assert_eq!(needed["counts"]["total"], json!(total + 1), "另有一条通用语");
    assert_eq!(needed["fallback"]["key"], "fail_line");
    for p in pools {
        assert_eq!(p["uses"], json!(used[p["key"].as_str().unwrap()]), "{p}");
        assert_eq!(p["values"].as_array().unwrap().len(), p["lines"].as_u64().unwrap() as usize);
    }
}

#[test]
fn exam_floors_are_already_five_percent() {
    let d = terra();
    assert_eq!(d.upbringing.exams.len(), 29);
    assert!(d.upbringing.exams.iter().all(|e| e.check.min >= 5 && e.check.max <= 95), "考试下限不低于 5%");
}

#[test]
fn a_generic_failure_during_upbringing_costs_a_little_fatigue_and_mood() {
    let mut d = (*terra()).clone();
    let track: TrackDef = serde_json::from_value(json!({
    "key":"aaaa_u02_dice","name":"掷骰","kind":"main","upbringing":true,"start":"a","chapters":[{"key":"a","title":"掷骰","text":"测试。",
    "choices":[
        {"key":"try","text":"凭本事","next":"done","requires":[{"kind":"skill","skill":"rigging","ge":60}]},
        {"key":"safe","text":"稳妥","next":"done"}
    ]}]}))
    .unwrap();
    d.story2.tracks.push(track);
    let d = Arc::new(d);
    let f = d.upbringing.family("mio").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let found = (1..300).find_map(|seed| {
        let mut p = StartParams::new(sid, seed);
        p.opening = Some(NewGameRequest {
            world: "terra16".into(),
            scenario: f.scenario.clone(),
            seed: Some(seed),
            protagonist: Some("mio".into()),
            ..Default::default()
        });
        let mut w = World::from_start(d.clone(), &p, |_| {}).unwrap();
        w.refresh_story2();
        (w.pending_story2().map(|p| p.track.as_str()) == Some("aaaa_u02_dice")).then_some(())?;
        let mut trial = w.clone();
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut trial).ok()?;
        trial.state.story2.last.as_ref()?.soft_fail.is_some().then_some((w, trial))
    });
    let (before, after) = found.expect("三百个种子里总有掷骰失败的");
    let (b, a) = (before.state.upbringing.as_ref().unwrap(), after.state.upbringing.as_ref().unwrap());
    let fail = after.state.story2.last.as_ref().unwrap().soft_fail.clone().unwrap();
    assert_eq!(fail.pool, "skill_navigation");
    assert_eq!(a.fatigue, (b.fatigue + 3).clamp(0, 100));
    assert_eq!(a.mood, (b.mood - 2).clamp(-100, 100));
    assert_eq!((fail.fatigue, fail.mood), (a.fatigue - b.fatigue, a.mood - b.mood));
    assert_eq!(a.stamina, 100 - a.fatigue);
    assert_eq!(after.state.story2.tracks["aaaa_u02_dice"].status, Status::Active);
    assert!(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.validate(&after).is_err());
    assert!(Command::StoryAnswer { owner: OwnerId::Player, choice: 1 }.validate(&after).is_ok());
}
