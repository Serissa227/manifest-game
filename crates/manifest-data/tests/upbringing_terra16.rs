//! 真实寰宇原生养成定义、英文闭包与开局身份。
#[test]
fn terra16_native_upbringing_loads_with_complete_native_english() {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "terra16").unwrap();
    assert_eq!(defs.upbringing.families.len(), 21);
    assert_eq!(defs.upbringing.academies.len(), 23);
    assert_eq!(defs.upbringing.exams.len(), 29);
    assert_eq!(defs.upbringing.contests.len(), 30);
    assert_eq!(defs.upbringing.excursions.len(), 26);
    assert_eq!(defs.upbringing.excursions.iter().map(|e| e.nodes.len()).sum::<usize>(), 156);
    // 养成内容（2026-11-03）：九位主角的新手旬、家乡玩伴、书信、年度大事与第一次远足里带门槛的轨道（4372 → 4449）。
    // U03 / A3（2026-11-03）：黄墩与苏玛的信路原来没有入口，补一条学院短事件门槛（4449 → 4450）。
    // 改投学院（2026-11-04）：两件改投事件、能岛版 52 条、印书圈版 20 条（4450 → 4524）。
    // 剧情增写（2026-11-12，docs/STORY-REWRITE.md）：九家新增的养成人物线 60 条，各带一条门槛（4524 → 4584）。
    assert_eq!(
        defs.upbringing.tracks.iter().filter(|t| defs.upbringing.event_gates.contains_key(&t.key)).count(),
        4584
    );
    let world = manifest_data::resolve_world(&root, "terra16").unwrap();
    // 寰宇草稿尚未提供通用 UI/AI 文本；仅给语言夹具补根目录的公共文字资源。
    // 地图、条目、C8 原文和英文仍全部来自真实寰宇，养成分片逐字段检查无缺项。
    let classic = manifest_data::resolve_world(&root, "classic").unwrap();
    let ai = manifest_data::load_ai_content(&root).unwrap();
    let (english, issues) = manifest_data::locale::load_world_locale_with_common_texts_lenient(
        &world,
        &classic,
        manifest_data::Locale::En,
        &defs,
        &ai,
    );
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    let missing: Vec<_> = english
        .missing
        .iter()
        .filter(|m| {
            m.file.starts_with("locales/en/upbringing/")
                && (world.manifest.requires_english() || world.contains(&m.file))
        })
        .collect();
    println!("养成英文覆盖缺项 {} 条：{missing:?}", missing.len());
    assert_eq!(english.defs.upbringing.academies.len(), defs.upbringing.academies.len());
    assert_eq!(english.defs.upbringing.families.len(), defs.upbringing.families.len());
    assert_eq!(english.defs.upbringing.tracks.len(), defs.upbringing.tracks.len());
    for academy in &defs.upbringing.academies {
        let translated = english.defs.upbringing.academies.iter().find(|a| a.key == academy.key).unwrap();
        if world.contains(&format!("locales/en/{}", academy.source)) {
            assert_ne!(translated.name, academy.name, "{} 学院的已有英文必须实际应用", academy.key);
        } else {
            assert_eq!(translated.name, academy.name, "{} 学院缺译回退中文", academy.key);
        }
    }
    for contest in &defs.upbringing.contests {
        let manifest_core::contests::Params::Match(original) = &contest.params else { continue };
        let translated = english.defs.upbringing.contests.iter().find(|c| c.key == contest.key).unwrap();
        let manifest_core::contests::Params::Match(localized) = &translated.params else {
            panic!("比赛种类改变")
        };
        assert_eq!(localized.faces.len(), original.faces.len());
        for (before, after) in original.faces.iter().zip(&localized.faces) {
            if world.contains(&format!("locales/en/{}", contest.source)) {
                assert_ne!(before, after, "{} 作者文字牌面的已有英文必须实际应用", contest.key);
            } else {
                assert_eq!(before, after, "{} 作者文字牌面缺译回退中文", contest.key);
            }
        }
    }
    assert_eq!(english.defs.meta.hash, defs.meta.hash);
}

#[test]
fn terra16_native_fragments_parse_and_translations_close_individually() {
    let root = manifest_data::find_data_dir().unwrap();
    let world = manifest_data::resolve_world(&root, "terra16").unwrap();
    let mut errors = Vec::new();
    for file in world.files_in("upbringing").into_iter().filter(|f| f != "upbringing/templates.toml") {
        let text = world.read(&file).unwrap();
        if let Err(error) = toml::from_str::<manifest_core::upbringing::UpbringingDefs>(&text) {
            errors.push(format!("{file}: {error}"));
            continue;
        }
        let overlay = format!("locales/en/{file}");
        if !world.contains(&overlay) {
            assert!(!world.manifest.requires_english(), "双语世界缺少英文分片：{file}");
            continue;
        }
        let english = world.read(&overlay).unwrap();
        if let Err(error) = manifest_data::worlds::validate_draft_translation(&file, &text, &english) {
            errors.push(error.to_string());
        }
    }
    assert!(errors.is_empty(), "{}", errors.join("\n"));
}

#[test]
fn all_terra16_families_start_with_their_own_identity_home_and_childhood_assets() {
    use manifest_core::{OwnerId, ScenarioId, World, replay::StartParams, scenario::NewGameRequest};
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    for f in &d.upbringing.families {
        let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
        let mut start = StartParams::new(sid, 42);
        start.opening = Some(NewGameRequest {
            world: "terra16".into(),
            scenario: f.scenario.clone(),
            protagonist: f.protagonists.first().cloned(),
            template: f.templates.first().cloned(),
            captain: (!f.templates.is_empty()).then(|| manifest_core::scenario::CustomCaptain {
                name: "占位".into(),
                look: 0,
                gender: f.gender,
                birthday: [f.born[1], f.born[2]],
            }),
            ..Default::default()
        });
        let w = World::from_start(d.clone(), &start, |_| {}).unwrap_or_else(|e| panic!("{}: {e}", f.key));
        assert_eq!(w.upbringing_family().unwrap().key, f.key);
        assert_eq!(d.loc(w.agent(OwnerId::Player).unwrap().home).key, f.home);
        assert_eq!(w.agent(OwnerId::Player).unwrap().cash, 200);
        assert_eq!(w.fleets_of(OwnerId::Player).count(), 0);
        assert_eq!(w.cast_date(), [1553, 1, 1]);
        assert!(w.upbringing_active());
        assert!(w.money_conserved());
    }
}

#[test]
fn terra16_actual_four_year_upbringing_skip_hands_over_family_capital_and_replays() {
    use manifest_core::{
        Command, OwnerId, ScenarioId, World,
        replay::{LogEntry, Source, StartParams, replay},
    };
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "kaicili_1553").unwrap());
    let mut w = World::new(d.clone(), sid, 42).unwrap();
    let capital = w.upbringing_family().unwrap().completion.as_ref().unwrap().capital.clone();
    let first = w.day();
    let command = Command::SkipUpbringing { owner: OwnerId::Player };
    command.apply(&mut w).unwrap();
    let log = vec![LogEntry { tick: first, seq: 0, source: Source::Player, command, minute: None }];
    for day in 1..=1460 {
        w.end_day().unwrap();
        assert_eq!(w.day(), first + day);
        assert!(w.money_conserved(), "第 {day} 日货币不守恒");
        assert!(w.agent(OwnerId::Player).unwrap().ledger.is_balanced());
        if day < 1460 {
            assert_eq!(w.fleets_of(OwnerId::Player).count(), 0);
        }
    }
    assert_eq!(w.cast_date(), [1557, 1, 1]);
    assert!(!w.upbringing_active());
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, capital.cash + 200);
    let fleet = w.fleets_of(OwnerId::Player).next().unwrap();
    assert_eq!(fleet.ships.len(), capital.ships.len());
    assert_eq!(fleet.crew, capital.crew);
    assert_eq!(w.state.industries.values().filter(|i| i.owner == OwnerId::Player).count(), 1);
    assert!(w.state.story2.flags.contains(capital.grant_once.as_ref().unwrap()));
    for m in &capital.mementos {
        assert_eq!(w.state.story2.memories[&m.key], m.name);
    }
    manifest_core::testkit::check_invariants(&w).unwrap();
    let saved = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    assert_eq!(saved.state_hash(), w.state_hash());
    let replayed = replay(d, StartParams::new(sid, 42), &log, w.day()).unwrap();
    assert_eq!(replayed.state_hash(), w.state_hash());
}
