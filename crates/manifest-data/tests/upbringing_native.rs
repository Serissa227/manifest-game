//! C8 原生运行规则的真实命令、存档、重放与闭包回归。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Moves, Params, occurrence_key},
    replay::{LogEntry, Source, replay_onto},
    upbringing::*,
};
use std::{collections::BTreeMap, sync::Arc};
fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}
fn world(d: Arc<manifest_core::StaticData>) -> World {
    let s = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, s, 42).unwrap()
}
fn apply(w: &mut World, c: Command, log: &mut Vec<LogEntry>) {
    log.push(LogEntry {
        tick: w.day(),
        seq: log.len() as u64,
        source: Source::Player,
        command: c.clone(),
        minute: None,
    });
    c.apply(w).unwrap();
}
fn plan(w: &mut World, choice: AfterChoice, log: &mut Vec<LogEntry>) {
    apply(
        w,
        Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3).map(|index| PlanSlot { index, lesson: None, after: Some(choice.clone()) }).collect(),
        },
        log,
    );
}
fn days(w: &mut World, n: u32, log: &mut Vec<LogEntry>) {
    for _ in 0..n {
        while w.pending_story2().is_some() {
            apply(w, Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }, log);
        }
        w.end_day().unwrap();
    }
}
fn verify(w: &World, mut start: World, log: &[LogEntry]) {
    let saved = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(saved.state_hash(), w.state_hash());
    replay_onto(&mut start, log, w.day()).unwrap();
    assert_eq!(start.state_hash(), w.state_hash());
}
#[test]
fn crafts_consume_only_on_success_and_reject_missing_materials_atomically() {
    for failure in [0, 10_000] {
        let mut d = defs();
        let input = d.items.items[0].key.clone();
        let output = d.items.items[1].key.clone();
        let skill = d.story2.skills.iter().next().unwrap().clone();
        let attr = d.captain.attributes[0].key.clone();
        let data = Arc::make_mut(&mut d);
        let mut a = data.upbringing.activity("rest").unwrap().clone();
        a.key = "native_craft".into();
        a.kind = ActivityKind::Craft;
        a.events.clear();
        a.craft = Some("native_recipe".into());
        a.risk = Some(ActivityRisk { failure_bp: failure, ..Default::default() });
        data.upbringing.crafts.push(CraftDef {
            source: String::new(),
            key: "native_recipe".into(),
            name: "占位".into(),
            activity: "native_craft".into(),
            materials: vec![Ingredient { item: input.clone(), qty: 2 }],
            tools: vec![],
            skill,
            level: 0,
            output: Ingredient { item: output.clone(), qty: 1 },
            check: CraftCheck { attr, base: 60, per: 4 },
            consume: "on_success".into(),
            failure: "占位。".into(),
            note: "占位。".into(),
        });
        data.upbringing.activities.push(a);
        assert!(native_validation::validate(&d).is_empty());
        let mut w = world(d);
        let before = w.state_hash();
        let slots = (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("native_craft")) })
            .collect();
        assert!(Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).is_err());
        assert_eq!(before, w.state_hash());
        w.grant_item(OwnerId::Player, &input, 2).unwrap();
        let original_output = w.item_quantity(OwnerId::Player, &output);
        let start = w.clone();
        let mut log = vec![];
        plan(&mut w, AfterChoice::activity("native_craft"), &mut log);
        days(&mut w, 10, &mut log);
        assert_eq!(w.item_quantity(OwnerId::Player, &input), if failure == 0 { 0 } else { 2 });
        assert_eq!(w.item_quantity(OwnerId::Player, &output), original_output + if failure == 0 { 1 } else { 0 });
        assert_eq!(w.state.upbringing.as_ref().unwrap().last[0].success, Some(failure == 0));
        verify(&w, start, &log);
    }
}
#[test]
fn three_step_excursion_keeps_progress_and_repeats_without_first_clear_rewards() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    let attr = data.captain.attributes[0].key.clone();
    let e = &mut data.upbringing.excursions[0];
    let key = e.key.clone();
    let node = e.starts[0].clone();
    let n = e.nodes.iter_mut().find(|n| n.key == node).unwrap();
    n.steps = (0..3)
        .map(|i| ExcursionStep {
            key: format!("step_{i}"),
            name: "占位".into(),
            from: ["unseen", "seen", "prepared"][i].into(),
            to: ["seen", "prepared", "solved"][i].into(),
            text: format!("占位{i}。"),
            unlock: Default::default(),
            consume_items: false,
            gains: BTreeMap::from([(attr.clone(), [2, 2])]),
            skills: vec![],
            memory: (i == 2).then(|| "native_memory".into()),
            fame: if i == 2 { 2 } else { 0 },
            items: vec![],
        })
        .collect();
    n.risk = None;
    n.repeat = Some(ExcursionRepeat {
        state: "solved".into(),
        cooldown_days: 30,
        gains: BTreeMap::from([(attr.clone(), [1, 1])]),
        fame: 0,
        income: 0,
    });
    n.events.clear();
    let adventure = data.upbringing.activities.iter().find(|a| a.needs.contains(&Need::Excursion)).unwrap().key.clone();
    let mut w = world(d);
    let start = w.clone();
    let mut log = vec![];
    let choice =
        AfterChoice { excursion: Some(key.clone()), node: Some(node.clone()), ..AfterChoice::activity(&adventure) };
    plan(&mut w, choice.clone(), &mut log);
    for step in 1..=3 {
        days(&mut w, if step == 3 { 11 } else { 10 }, &mut log);
        let s = w.state.upbringing.as_ref().unwrap();
        assert_eq!(s.excursion_progress[&key][&node].step, step);
        assert_eq!(w.excursion_node_state(&key, &node), if step == 3 { NodeState::Solved } else { NodeState::Seen });
    }
    assert!(w.check_excursion(&key, &node).is_err());
    assert_eq!(w.state.upbringing.as_ref().unwrap().fame, 2);
    assert!(w.state.story2.memories.contains_key("native_memory"));
    verify(&w, start.clone(), &log);
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    days(&mut w, 28, &mut log);
    assert!(w.check_excursion(&key, &node).is_err());
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    days(&mut w, 2, &mut log);
    assert!(w.check_excursion(&key, &node).is_ok());
    assert_eq!(w.state.upbringing.as_ref().unwrap().fame, 2);
    let memory_day = w.state.upbringing.as_ref().unwrap().memory_days["native_memory"];
    days(&mut w, 29, &mut log);
    apply(
        &mut w,
        Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3)
                .map(|index| PlanSlot {
                    index,
                    lesson: None,
                    after: Some(if index == 0 { choice.clone() } else { AfterChoice::activity("rest") }),
                })
                .collect(),
        },
        &mut log,
    );
    days(&mut w, 10, &mut log);
    let s = w.state.upbringing.as_ref().unwrap();
    assert_eq!(s.excursion_progress[&key][&node].step, 3);
    assert!(s.excursion_progress[&key][&node].last_day.unwrap() > memory_day);
    assert_eq!(s.memory_days["native_memory"], memory_day);
    assert_eq!(s.fame, 2);
    verify(&w, start, &log);
}
#[test]
fn authored_match_points_and_multisite_dates_are_exact() {
    let mut d = defs();
    let home = d.upbringing.families[0].home.clone();
    let data = Arc::make_mut(&mut d);
    let c = &mut data.upbringing.contests[0];
    c.bindings = vec![manifest_core::contests::native::Binding { at: home, dates: c.dates.clone() }];
    c.at = data.locations.iter().find(|l| l.key != c.bindings[0].at).unwrap().key.clone();
    c.scoring.authored_kind = Some("pairs".into());
    c.scoring.points_per_pair = Some(2);
    c.scoring.max_bonus = 12;
    c.rivals.clear();
    c.rewards.iter_mut().filter(|r| r.rank == 1).for_each(|r| r.memory = Some("native_contest_memory".into()));
    let mut w = world(d.clone());
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let Params::Match(p) = w.contest_params(&key).unwrap() else { panic!("配对参数") };
    let pair = (0..p.faces.len())
        .flat_map(|i| (i + 1..p.faces.len()).map(move |j| [i as u32, j as u32]))
        .find(|[a, b]| p.faces[*a as usize] == p.faces[*b as usize])
        .unwrap();
    let start = w.clone();
    let mut log = vec![];
    apply(
        &mut w,
        Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Pairs(vec![pair]) },
        &mut log,
    );
    let score = w.state.upbringing.as_ref().unwrap().contest_results[&key].score;
    assert_eq!(w.state.story2.memories["native_contest_memory"], w.defs.upbringing.contests[0].name);
    assert_eq!(w.state.upbringing.as_ref().unwrap().memory_days["native_contest_memory"], w.day());
    let mut none = world(d);
    Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Pairs(vec![]) }
        .apply(&mut none)
        .unwrap();
    assert_eq!(score - none.state.upbringing.as_ref().unwrap().contest_results[&key].score, 2);
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    days(&mut w, 1, &mut log);
    verify(&w, start, &log);
}
#[test]
fn native_schema_and_nested_reference_closure_are_strict() {
    assert!(toml::from_str::<UpbringingDefs>("format_version=1\nunknown=[]").is_err());
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    data.upbringing
        .event_gates
        .insert("upbringing_note".into(), EventGate { festival: Some("missing".into()), ..Default::default() });
    assert!(native_validation::validate(&d).iter().any(|e| e.contains("节日")));
    Arc::make_mut(&mut d).upbringing.festivals.clear();
    assert!(native_validation::validate(&d).iter().any(|e| e.contains("节日")), "空目标表仍应拒绝悬空引用");
}

#[test]
fn monthly_group_limit_rejects_overbooked_plan_without_mutation() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    let mut limited = data.upbringing.activity("rest").unwrap().clone();
    limited.key = "limited_a".into();
    limited.monthly_limit = Some(2);
    limited.monthly_limit_group = Some("shared_limit".into());
    data.upbringing.activities.push(limited.clone());
    limited.key = "limited_b".into();
    data.upbringing.activities.push(limited);
    let mut w = world(d);
    let before = w.state_hash();
    let slots = (0..3)
        .map(|index| PlanSlot {
            index,
            lesson: None,
            after: Some(AfterChoice::activity(if index == 1 { "limited_b" } else { "limited_a" })),
        })
        .collect();
    assert!(Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).is_err());
    assert_eq!(before, w.state_hash());
}

#[test]
fn native_translation_rejects_numeric_override_and_missing_display() {
    let source = "format_version=1\n[[notes]]\nkey='note'\ntext='占位。'\nsource='author:note'\n";
    let file = "upbringing/native.toml";
    assert_eq!(
        manifest_data::worlds::validate_draft_translation(file, source, "[notes.note]\ntext='Placeholder.'\n").unwrap(),
        1
    );
    for wrong in [
        "",
        "[notes.note]\ntext='Placeholder.'\nsource='changed'\n",
        "format_version=2\n[notes.note]\ntext='Placeholder.'\n",
    ] {
        assert!(manifest_data::worlds::validate_draft_translation(file, source, wrong).is_err());
    }
}

#[test]
fn native_event_date_gate_and_family_cooldown_apply_before_repeat_selection() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    for a in &mut data.upbringing.activities {
        a.events.clear();
    }
    data.story2.tracks = vec![toml::from_str(
        "key='native_repeat'\nname='占位'\nkind='encounter'\nstart='event'\nauto=false\nacademy=true\n\
         [[chapters]]\nkey='event'\ntitle='占位'\ntext='占位。'\nonce=false\nfamily='native_cooldown'\nfamily_cooldown_days=25\n\
         [[chapters.choices]]\nkey='ok'\ntext='继续'\nnext='done'\n"
    ).unwrap()];
    data.upbringing.event_gates.insert(
        "native_repeat".into(),
        EventGate { from: Some([1553, 1, 15]), stage: ActivityStage::Home, ..Default::default() },
    );
    let mut w = world(d);
    let start = w.clone();
    let mut log = vec![];
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    days(&mut w, 10, &mut log);
    assert!(w.pending_story2().is_none());
    days(&mut w, 10, &mut log);
    // 日期门槛已满足，但普通短事件隔旬排期，一月中旬仍不能入队。
    assert!(w.pending_story2().is_none());
    days(&mut w, 11, &mut log);
    assert_eq!(w.cast_date(), [1553, 2, 1]);
    assert_eq!(w.pending_story2().unwrap().track, "native_repeat");
    apply(&mut w, Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }, &mut log);
    let first = w.state.story2.families["native_cooldown"];
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    // 二月中旬是允许的旬，但距首次仅 20 天；冷却必须独立阻止它。
    days(&mut w, 20, &mut log);
    assert_eq!(w.cast_date(), [1553, 2, 21]);
    assert!(w.pending_story2().is_none());
    assert_eq!(w.state.story2.families["native_cooldown"], first);
    days(&mut w, 8, &mut log);
    plan(&mut w, AfterChoice::activity("rest"), &mut log);
    days(&mut w, 10, &mut log);
    assert_eq!(w.cast_date(), [1553, 3, 11]);
    assert_eq!(w.pending_story2().unwrap().track, "native_repeat");
    apply(&mut w, Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }, &mut log);
    assert!(w.state.story2.families["native_cooldown"] >= first + 25);
    days(&mut w, 1, &mut log);
    verify(&w, start, &log);
}

#[test]
fn native_extra_excursion_step_is_rejected_without_panicking() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    let node = &mut data.upbringing.excursions[0].nodes[0];
    let step: ExcursionStep =
        toml::from_str("key='step'\nname='占位'\nfrom='unseen'\nto='seen'\ntext='占位。'\nunlock={}").unwrap();
    node.steps = vec![step; 4];
    assert!(native_validation::validate(&d).iter().any(|e| e.contains("必须三步")));
}

#[test]
fn graduation_grants_estate_caravan_and_memento_once_with_balanced_books() {
    let mut d = defs();
    let recipe = d.recipes.iter().find(|r| r.inputs.is_empty()).unwrap();
    let industry = &d.industry_types[recipe.industry.idx()];
    let animal = &d.animals[0];
    let loc = d.upbringing.families[0].home.clone();
    let item = d.items.items[0].key.clone();
    let region = d.regions[0].key.clone();
    let estate = capital::Estate {
        kind: "plantation".into(),
        industry: industry.key.clone(),
        loc: loc.clone(),
        good: d.good(recipe.outputs[0].0).key.clone(),
        level: 1,
        workers: industry.workers,
        source: "family_capital".into(),
        grant_once: "native_estate".into(),
    };
    let caravan = capital::CaravanCapital {
        loc,
        animal: animal.key.clone(),
        capacity: animal.capacity * 3,
        guards: 2,
        cargo: BTreeMap::new(),
        cash: 0,
        source: "family_capital".into(),
        grant_once: "native_caravan".into(),
    };
    let f = &mut Arc::make_mut(&mut d).upbringing.families[0];
    f.stages.truncate(1);
    f.graduation = [1553, 1, 2];
    let completion = f.completion.as_mut().unwrap();
    completion.event = None;
    completion.defaults.path = None;
    completion.capital.estate = Some(estate);
    completion.capital.caravan = Some(caravan);
    completion.capital.items.insert(item.clone(), 1);
    completion.capital.known = vec![capital::KnowledgeArea {
        key: "native_known".into(),
        name: "占位".into(),
        regions: vec![region.clone()],
        clip_arcmin: None,
    }];
    completion.capital.rumored = vec![capital::KnowledgeArea {
        key: "native_rumor".into(),
        name: "占位".into(),
        regions: vec![region],
        clip_arcmin: None,
    }];
    completion.capital.mementos = vec![capital::Memento {
        key: "native_keepsake".into(),
        name: "占位".into(),
        description: "占位。".into(),
        kind: "story_keepsake".into(),
        transferable: false,
        consumable: false,
        item: Some(item.clone()),
    }];
    let mut w = world(d);
    let start = w.clone();
    let mut log = vec![];
    apply(&mut w, Command::SkipUpbringing { owner: OwnerId::Player }, &mut log);
    days(&mut w, 1, &mut log);
    assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Done);
    assert_eq!(w.state.industries.values().filter(|i| i.owner == OwnerId::Player).count(), 1);
    let owned = w.state.caravans.values().filter(|c| c.owner == OwnerId::Player).collect::<Vec<_>>();
    assert_eq!(owned.len(), 1);
    assert_eq!((owned[0].count, owned[0].guards), (3, 2));
    assert_eq!(w.item_quantity(OwnerId::Player, &item), 1, "信物说明不能额外复制实物");
    assert!(w.state.story2.memories.contains_key("native_keepsake"));
    assert!(w.state.story2.flags.contains("known_region_native_known"));
    assert!(w.state.story2.memories.contains_key("rumored_region_native_rumor"));
    assert!(w.money_conserved());
    assert!(w.agent(OwnerId::Player).unwrap().ledger.is_balanced());
    let before = w.state_hash();
    assert!(Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).is_err());
    assert_eq!(w.state_hash(), before);
    verify(&w, start, &log);
}

#[test]
fn fixed_poem_stock_must_be_the_only_option_of_the_last_line() {
    use manifest_core::contests::{
        Kind,
        native::{PoemLexicon, PoemMetadata},
        poem,
    };
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    data.upbringing.poem_lexicons.push(
        toml::from_str::<PoemLexicon>(
            "key='lex'\nname='占位'\nwords=[{key='word',text='占位',source='占位',image='x',rhyme='x',season='x'}]",
        )
        .unwrap(),
    );
    let c = &mut data.upbringing.contests[0];
    c.kind = Kind::Poem;
    c.params = Params::Poem(poem::Params {
        theme: "占位".into(),
        hints: vec![],
        lines: vec![
            poem::Line { prompt: "占位".into(), options: vec!["占位".into()] },
            poem::Line { prompt: "占位".into(), options: vec!["叠句占位。".into()] },
        ],
    });
    c.scoring.line_points = vec![vec![3], vec![4]];
    c.poem = Some(
        toml::from_str::<PoemMetadata>("lexicon='lex'\nword_choices=[['word'],[]]\ncompose={stock='叠句占位。'}")
            .unwrap(),
    );
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    Arc::make_mut(&mut d).upbringing.contests[0].poem.as_mut().unwrap().compose.stock = Some("不同占位。".into());
    assert!(manifest_core::contests::validation::validate(&d).iter().any(|e| e.contains("诗词选项行数")));
}

#[test]
fn academy_excursion_requires_enrollment_and_rejects_unknown_binding() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    let academy = data.upbringing.academies[0].key.clone();
    let e = &mut data.upbringing.excursions[0];
    e.at.clear();
    e.place.academies = vec![academy];
    e.place.bind = Some("enrolled_academy".into());
    assert!(native_validation::validate(&d).is_empty());
    let w = world(d.clone());
    assert!(!w.excursion_available(&w.defs.upbringing.excursions[0]));
    let data = Arc::make_mut(&mut d);
    let f = &mut data.upbringing.families[0];
    f.stages.remove(0);
    f.stages[0].from = [1553, 1, 1];
    f.stages[0].entry_event = None;
    f.stages[0].entry_flag = None;
    let w = world(d.clone());
    assert!(w.excursion_available(&w.defs.upbringing.excursions[0]));
    Arc::make_mut(&mut d).upbringing.excursions[0].place.bind = Some("unknown".into());
    assert!(native_validation::validate(&d).iter().any(|e| e.contains("远足地点绑定")));
}

#[test]
fn unspecified_authored_chart_award_reveals_only_the_family_departure_region() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    let f = &mut data.upbringing.families[0];
    f.stages.truncate(1);
    f.graduation = [1553, 1, 2];
    let c = f.completion.as_mut().unwrap();
    c.event = None;
    c.defaults.path = None;
    c.defaults.exams.clear();
    c.capital.regions.clear();
    let at = c.capital.at.as_ref().unwrap_or(&f.home);
    let region = data.map.region_of(data.locations.iter().find(|l| &l.key == at).unwrap().cell).unwrap();
    data.upbringing.endings.truncate(1);
    data.upbringing.endings[0].requirements = Default::default();
    data.upbringing.endings[0].award = Award { departure_chart: true, ..Default::default() };
    let mut w = world(d);
    w.state.explore.charts.clear();
    let start = w.clone();
    let mut log = vec![];
    apply(&mut w, Command::SkipUpbringing { owner: OwnerId::Player }, &mut log);
    days(&mut w, 1, &mut log);
    assert_eq!(w.state.explore.charts.iter().copied().collect::<Vec<_>>(), vec![region]);
    verify(&w, start, &log);
}
