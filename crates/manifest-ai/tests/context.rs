//! E70：提示词只接受当前世界的已知事实；经典内容不改写。
use manifest_ai::{AiPipeline, AiSettings, TaskRequest};
use manifest_core::{World, ids::ScenarioId, summary::context};
use manifest_data::ai_content::{AiLore, LORE_SUMMARY_CHARS, LORE_TABOOS_CHARS, LORE_TERMS_CHARS};
use std::sync::Arc;

#[test]
fn terra_content_is_complete_and_has_no_classic_prompt_names() {
    let root = manifest_data::find_data_dir().unwrap();
    let world = manifest_data::resolve_world(&root, "terra16").unwrap();
    let content = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    assert_eq!(content.lore.world, "terra16");
    for prompt in content.prompts.values() {
        assert!(!prompt.system.contains("维斯塔"));
        for slot in ["world_lore", "world_terms", "world_taboos", "calendar"] {
            assert!(prompt.system.contains(&format!("{{{slot}}}")));
        }
    }
}

#[test]
fn lore_limits_reject_each_oversized_field() {
    let root = manifest_data::find_data_dir().unwrap();
    let world = manifest_data::resolve_world(&root, "terra16").unwrap();
    assert!(AiLore::from_world(&world).unwrap().strict);
    for (field, max) in [("summary", LORE_SUMMARY_CHARS), ("terms", LORE_TERMS_CHARS), ("taboos", LORE_TABOOS_CHARS)] {
        let mut world = world.clone();
        let value = match field {
            "summary" => &mut world.manifest.lore.summary,
            "terms" => &mut world.manifest.lore.terms,
            _ => &mut world.manifest.lore.taboos,
        };
        *value = "字".repeat(max + 1);
        let error = AiLore::from_world(&world).unwrap_err();
        assert_eq!(error.issues.len(), 1);
        assert_eq!(error.issues[0].item, format!("lore.{field}"));
    }
}

#[test]
fn persona_memory_and_summary_do_not_leak_unknown_people_or_biography() {
    let root = manifest_data::find_data_dir().unwrap();
    let mut defs = manifest_data::load_world(&root, "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    let person = d.cast.persons.first_mut().unwrap();
    let key = person.key.clone();
    person.persona =
        "说话简洁。秘密身份不可说破。未来说话会变得冷淡。1560年说话不同。说话直率，自称紫焰港王位的继承者。".into();
    person.secret = "未揭示的秘密".into();
    person.after = "未来的结局".into();
    let mut world = World::new(defs, ScenarioId(0), 42).unwrap();
    world.state.cast.persons.entry(key.clone()).or_default().met = true;
    world.remember_person(&key, "一次已发生的交谈");
    let before = world.state.clone();
    let persona = context::public_persona(&world, &key).unwrap();
    assert!(persona.contains("说话简洁"));
    for forbidden in ["秘密", "未来", "1560", "结局", "紫焰港", "继承者"] {
        assert!(!persona.contains(forbidden));
    }
    let memory = context::person_memory(&world, &key).unwrap();
    assert!(memory.contains("一次已发生的交谈"));
    assert!(context::known_summary(&world, 30).chars().count() <= 30);
    assert_eq!(world.state, before);
    world.state.cast.persons.get_mut(&key).unwrap().met = false;
    assert!(context::public_persona(&world, &key).is_none());
    assert!(context::person_memory(&world, &key).is_none());
}

#[tokio::test]
async fn old_world_tasks_cannot_finalize_in_another_world() {
    let root = manifest_data::find_data_dir().unwrap();
    let content = Arc::new(manifest_data::load_ai_content(&root).unwrap());
    let pipeline = AiPipeline::new(content, &AiSettings::default(), None);
    let world = World::new(manifest_data::load_shared(&root).unwrap(), ScenarioId(0), 42).unwrap();
    let outcome = pipeline.process(pipeline.prepare(&world, TaskRequest::Director).unwrap()).await;
    let other = World::new(manifest_data::load_world(&root, "testbed").unwrap(), ScenarioId(0), 42).unwrap();
    assert!(pipeline.finalize(&other, &outcome).is_empty());
    let mut content = manifest_data::load_ai_content(&root).unwrap();
    content.lore.world = "terra16".into();
    let bound = AiPipeline::new(Arc::new(content), &AiSettings::default(), None);
    assert!(bound.prepare(&world, TaskRequest::Director).is_none());
}

#[test]
fn history_context_honors_precision_age_and_future_boundaries() {
    use manifest_core::history::Observation;
    let root = manifest_data::find_data_dir().unwrap();
    let mut world = World::new(manifest_data::load_world(&root, "testbed").unwrap(), ScenarioId(0), 42).unwrap();
    world.state.day = 100;
    let event = world.defs.history.events[0].clone();
    let day = world.day();
    world.state.history.known_events.clear();
    world
        .state
        .history
        .known_events
        .insert(event.key.clone(), Observation { day, exact: false, balance: 137, ..Default::default() });
    let state = world.state.history.events.entry(event.key.clone()).or_default();
    state.outcome = Some("future_result_not_known".into());
    state.resolved_day = Some(day + 1);
    let summary = context::known_summary(&world, 5000);
    assert!(summary.contains("120–140"));
    assert!(!summary.contains("天平=137"));
    assert!(!summary.contains("future_result_not_known"));
    assert!(!summary.contains(&format!("结果={}", event.history.outcome)));
    world.state.history.known_events.get_mut(&event.key).unwrap().exact = true;
    assert!(context::known_summary(&world, 5000).contains("天平=137"));
    world.state.history.known_events.get_mut(&event.key).unwrap().day = day - 31;
    assert!(context::known_summary(&world, 5000).contains("120–140"));
    for observed_day in [day - 91, day + 1] {
        world.state.history.known_events.get_mut(&event.key).unwrap().day = observed_day;
        assert!(!context::known_summary(&world, 5000).contains(&event.title));
    }
    world.state.history.known_events.get_mut(&event.key).unwrap().day = day;
    Arc::make_mut(&mut world.defs).history.events[0].knowledge = Some("never_revealed".into());
    assert!(!context::known_summary(&world, 5000).contains(&event.title));
}

#[test]
fn glossary_excludes_unknown_locations_and_people_without_splitting_names() {
    let root = manifest_data::find_data_dir().unwrap();
    let mut world = World::new(manifest_data::load_world(&root, "testbed").unwrap(), ScenarioId(0), 42).unwrap();
    let defs = Arc::make_mut(&mut world.defs);
    defs.manual_navigation = true;
    defs.navigation.hide_unknown_ports = true;
    world.state.explore.sighted.clear();
    world.state.explore.visited.clear();
    world.state.explore.cells.fill(0);
    for p in world.state.cast.persons.values_mut() {
        p.met = false;
    }
    let glossary = context::known_catalog(&world, 5000);
    let mut hidden = 0;
    for (index, place) in world.defs.locations.iter().enumerate() {
        if !world.location_visible(manifest_core::LocId::from_idx(index)) {
            hidden += 1;
            assert!(!glossary.contains(&format!("{}={}", place.key, place.name)));
        }
    }
    assert!(hidden > 0);
    for person in &world.defs.cast.persons {
        assert!(!glossary.contains(&format!("{}={}", person.key, person.name)));
    }
    assert!(context::known_catalog(&world, 1).is_empty());
}

/// 把数据目录整个复制一份，寰宇恢复成草稿（`hidden = true` + `draft = true`，去掉成品时才加的后端显示文字表）：
/// 寰宇已转为成品世界，草稿校验器只认草稿，严格校验仍在副本上照原样跑。
fn data_with_draft_terra16() -> std::path::PathBuf {
    fn copy(from: &std::path::Path, to: &std::path::Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            if entry.path().is_dir() {
                copy(&entry.path(), &to.join(entry.file_name()));
            } else {
                std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
            }
        }
    }
    let to = std::env::temp_dir().join(format!("manifest-ai-draft-terra16-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&to);
    copy(&manifest_data::find_data_dir().unwrap(), &to);
    let path = to.join("worlds/terra16/world.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("\nhidden = false\n"), "寰宇清单的写法变了，夹具要跟着改");
    std::fs::write(path, text.replacen("\nhidden = false\n", "\nhidden = true\ndraft = true\n", 1)).unwrap();
    std::fs::remove_file(to.join("worlds/terra16/texts.toml")).unwrap();
    std::fs::remove_file(to.join("worlds/terra16/cast/figures.toml")).unwrap();
    to
}

#[test]
fn terra_ai_files_are_registered_and_pass_the_strict_draft_validator() {
    let root = data_with_draft_terra16();
    let report = manifest_data::worlds::validate_draft_world(&root, "terra16");
    let _ = std::fs::remove_dir_all(&root);
    let report = report.unwrap();
    for directory in ["prompts", "templates"] {
        for kind in manifest_data::ProposalKind::ALL {
            let suffix = format!("/{directory}/{}.toml", kind.key());
            assert!(report.files.iter().any(|file| file.ends_with(&suffix)), "{suffix}");
        }
    }
}
