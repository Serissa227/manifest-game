//! I10 文本视图：开关与模板语言只影响显示，事实、日志和原始史实不变。
use super::*;
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest};
use manifest_core::{ScenarioId, World};
use std::sync::Arc;

fn fixture() -> (World, Arc<manifest_data::AiContent>) {
    let root = manifest_data::find_data_dir().unwrap();
    let mut d = manifest_data::load_world(&root, "testbed").unwrap();
    let s = &mut Arc::make_mut(&mut d).scenarios[0];
    s.start_date = [1558, 1, 1];
    s.control_date = s.start_date;
    (World::new(d, ScenarioId(0), 42).unwrap(), Arc::new(manifest_data::load_ai_content(&root).unwrap()))
}
#[tokio::test]
async fn stored_model_text_switches_to_current_language_template_without_mutating_world() {
    let (mut w, content) = fixture();
    let p = AiPipeline::new(
        content,
        &AiSettings { mode: AiMode::Mock, ..Default::default() },
        Some(Provider::Mock(MockLlm::scripted(vec![serde_json::json!({"text":"占位。"}).to_string()]))),
    );
    let task =
        p.prepare(&w, TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() }).unwrap();
    let out = p.process(task).await;
    let c = p.finalize(&w, &out).remove(0);
    c.apply(&mut w).unwrap();
    let target = TextTarget::Narration { event: "sample_opening".into(), phase: "opening".into() };
    let model = get(Ctx::plain(&w.defs), &w, &target).unwrap();
    assert!(model.1);
    let hash = w.state_hash();
    let templates = manifest_data::locale::TemplateText {
        texts: std::collections::BTreeMap::from([(
            "narration".into(),
            std::collections::BTreeMap::from([("opening".into(), vec!["{event}: {balance}; {outcome}".into(); 3])]),
        )]),
        ..Default::default()
    };
    let ctx = Ctx { model_text: false, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
    let (text, ai) = get(ctx, &w, &target).unwrap();
    assert!(!ai);
    assert!(text.contains(&w.defs.history.event("sample_opening").unwrap().title));
    assert!(!text.contains("{event}"));
    assert_eq!(w.state_hash(), hash);
}

#[test]
fn no_runner_still_renders_offline_narration_and_hides_future_ending() {
    let (w, content) = fixture();
    let templates = manifest_data::locale::TemplateText { texts: content.templates.f9.clone(), ..Default::default() };
    let ctx = Ctx { model_text: false, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
    let opening = TextTarget::Narration { event: "sample_opening".into(), phase: "opening".into() };
    let ending = TextTarget::Narration { event: "sample_opening".into(), phase: "ending".into() };
    assert!(!get(ctx, &w, &opening).unwrap().1);
    assert!(get(ctx, &w, &ending).is_none());
}

#[test]
fn stored_and_offline_text_preserve_the_existing_hidden_location_filter() {
    let (mut w, _) = fixture();
    let defs = Arc::make_mut(&mut w.defs);
    defs.manual_navigation = true;
    defs.navigation.hide_unknown_ports = true;
    w.state.explore.cells.fill(0);
    w.state.explore.sighted.clear();
    w.state.explore.visited.retain(|loc| loc.0 == 0);
    let hidden = &w.defs.locations[1];
    let (name, key) = (hidden.name.clone(), hidden.key.clone());
    assert!(!w.location_visible(manifest_core::LocId(1)));
    let target = TextTarget::Narration { event: "sample_opening".into(), phase: "opening".into() };
    let snapshot = text::snapshot(&w, &target).unwrap();
    let line = format!("{name} ({key})");
    let record = text::TextRecord {
        target: target.clone(),
        proof: snapshot.proof,
        day: w.day(),
        text: line.clone(),
        request: None,
        source: AiSource::Model,
        fallback: line.clone(),
        section: snapshot.section,
        variant: 0,
        params: snapshot.params,
    };
    w.state.cast.ai.texts.insert(target.key(), record);
    let templates = manifest_data::locale::TemplateText {
        texts: std::collections::BTreeMap::from([(
            "narration".into(),
            std::collections::BTreeMap::from([("opening".into(), vec![line; 3])]),
        )]),
        ..Default::default()
    };
    for model_text in [true, false] {
        let hash = w.state_hash();
        let ctx = Ctx { model_text, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
        let shown = get(ctx, &w, &target).unwrap().0;
        assert!(!shown.contains(&name) && !shown.contains(&key));
        assert_eq!(w.state_hash(), hash);
    }
    w.state.cast.ai.texts.clear();
    let hash = w.state_hash();
    let ctx = Ctx { model_text: false, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
    let shown = get(ctx, &w, &target).unwrap().0;
    assert!(!shown.contains(&name) && !shown.contains(&key));
    assert_eq!(w.state_hash(), hash);
}

#[test]
fn annual_and_event_views_use_explicit_history_instead_of_the_default_outcome() {
    let (mut w, content) = fixture();
    let event =
        Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|event| event.key == "sample_opening").unwrap();
    event.history.outcome = "closed".into();
    let expected = event.outcomes.iter().find(|outcome| outcome.key == "closed").unwrap().chronicle.clone();
    assert_ne!(event.default_outcome().unwrap().chronicle, expected);
    w.end_day().unwrap();
    w.end_day().unwrap();
    let templates = manifest_data::locale::TemplateText { texts: content.templates.f9.clone(), ..Default::default() };
    let ctx = Ctx { model_text: false, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
    let before = w.state_hash();
    let timeline = crate::history_view::timeline(ctx, &w);
    let event = timeline["events"].as_array().unwrap().iter().find(|event| event["key"] == "sample_opening").unwrap();
    assert_eq!(event["outcome"]["history"], expected);
    assert_eq!(w.state_hash(), before);
    while w.cast_date()[0] == 1558 {
        w.end_day().unwrap();
    }
    let before = w.state_hash();
    let ctx = Ctx { model_text: false, ai_templates: Some(&templates), ..Ctx::plain(&w.defs) };
    let chronicle = crate::history_view::chronicle(ctx, &w);
    let annual = chronicle["entries"].as_array().unwrap().iter().find(|entry| entry["annual"] == true).unwrap();
    assert!(annual["history"].as_str().unwrap().contains(&expected));
    assert_eq!(annual["deviates"], true);
    assert_eq!(w.state_hash(), before);
}
