//! E71b：文字绑定已发生事实，不能借书信改变玩法或披露未来结果。
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Proposal, Provider, TaskRequest};
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    summary::text::{self, TextTarget},
};
use manifest_data::ProposalKind;
use serde_json::json;
use std::sync::{Arc, OnceLock};

fn world() -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let s = &mut Arc::make_mut(&mut d).scenarios[0];
    s.start_date = [1558, 1, 1];
    s.control_date = s.start_date;
    World::new(d, ScenarioId(0), 42).unwrap()
}
fn pipeline(responses: Option<Vec<String>>) -> AiPipeline {
    static CONTENT: OnceLock<Arc<manifest_data::AiContent>> = OnceLock::new();
    let content = CONTENT
        .get_or_init(|| Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap()))
        .clone();
    let mode = if responses.is_some() { AiMode::Mock } else { AiMode::Offline };
    AiPipeline::new(
        content,
        &AiSettings { mode, ..Default::default() },
        responses.map(|r| Provider::Mock(MockLlm::scripted(r))),
    )
}
fn letter(w: &mut World) -> String {
    w.state.cast.persons.entry("mentor".into()).or_default().met = true;
    let id = format!("request_letters:{}", w.defs.story2.track("request_letters").unwrap().start);
    let n=serde_json::from_value(json!({"id":id,"day":w.day(),"text":"占位。","persons":["mentor"],"kind":"letter","loc":null,"track":"request_letters","known":true,"read":false,"rumor_days":30})).unwrap();
    w.state.story2.news.insert(id.clone(), n);
    id
}
fn diary_world() -> World {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d, sid, 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| manifest_core::upbringing::PlanSlot {
                index,
                lesson: None,
                after: Some(manifest_core::upbringing::AfterChoice::activity("rest")),
            })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    while w.cast_date()[1] == 1 {
        while w.pending_story2().is_some() {
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    assert!(!w.state.upbringing.as_ref().unwrap().journal.is_empty());
    w
}
async fn record(w: &mut World, request: TaskRequest, kind: ProposalKind) {
    let p = pipeline(None);
    let task = p.prepare(w, request).unwrap();
    assert_eq!(task.kind, kind);
    let out = p.process(task).await;
    let commands = p.finalize(w, &out);
    assert_eq!(commands.len(), 1);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    commands[0].apply(w).unwrap();
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash);
    let before = w.state_hash();
    assert!(commands[0].apply(w).is_err());
    assert_eq!(w.state_hash(), before);
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state_hash(), before);
}

#[tokio::test]
async fn test9_four_text_kinds_produce_bounded_offline_records() {
    let mut w = world();
    record(
        &mut w,
        TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() },
        ProposalKind::Narration,
    )
    .await;
    let id = letter(&mut w);
    record(&mut w, TaskRequest::Letter { id, purpose: "help".into() }, ProposalKind::Letter).await;
    while w.cast_date()[0] == 1558 {
        w.end_day().unwrap();
    }
    record(&mut w, TaskRequest::AltChronicle { year: 1558 }, ProposalKind::AltChronicle).await;
    let mut w = diary_world();
    record(&mut w, TaskRequest::Diary { year: 1553, month: 1 }, ProposalKind::Diary).await;
}

#[test]
fn unresolved_history_and_unfinished_months_have_no_future_text() {
    let w = world();
    let opening =
        text::snapshot(&w, &TextTarget::Narration { event: "sample_opening".into(), phase: "opening".into() }).unwrap();
    let facts: serde_json::Value = serde_json::from_str(&opening.facts).unwrap();
    assert!(facts["outcome"].is_null());
    assert!(
        text::snapshot(&w, &TextTarget::Narration { event: "sample_opening".into(), phase: "ending".into() }).is_none()
    );
    assert!(text::snapshot(&w, &TextTarget::AltChronicle { year: 1558 }).is_none());
    assert!(text::snapshot(&w, &TextTarget::Diary { year: 1558, month: 1 }).is_none());
}

#[tokio::test]
async fn test7_illegal_letter_request_and_unexpected_rewards_are_rejected_without_mutation() {
    let mut w = world();
    let id = letter(&mut w);
    for body in [
        json!({"text":"占位。","request":"give_unregistered_ship"}),
        json!({"text":"占位。","request":null,"cash":10000}),
        json!({"text":"占位。"}),
    ] {
        let p = pipeline(Some(vec![body.to_string()]));
        let task = p.prepare(&w, TaskRequest::Letter { id: id.clone(), purpose: "help".into() }).unwrap();
        let before = w.state_hash();
        let out = p.process(task).await;
        assert!(out.accepted().is_none());
        assert!(p.finalize(&w, &out).is_empty());
        assert_eq!(w.state_hash(), before);
    }
    for kind in [ProposalKind::Narration, ProposalKind::AltChronicle, ProposalKind::Diary] {
        assert!(Proposal::from_body(kind, json!({"text":"占位。","effects":[]})).is_err());
    }
}

#[tokio::test]
async fn changed_facts_expired_tasks_and_forged_record_parameters_are_atomic() {
    let mut w = world();
    let p = pipeline(None);
    let task =
        p.prepare(&w, TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() }).unwrap();
    let out = p.process(task).await;
    let command = p.finalize(&w, &out).remove(0);
    let Command::RecordAiText { mut record } = command.clone() else { panic!() };
    record.params.insert("event".into(), "invented".into());
    let before = w.state_hash();
    assert!(Command::RecordAiText { record }.apply(&mut w).is_err());
    assert_eq!(w.state_hash(), before);
    w.end_day().unwrap();
    w.end_day().unwrap();
    let before = w.state_hash();
    assert!(p.finalize(&w, &out).is_empty());
    assert!(command.apply(&mut w).is_err());
    assert_eq!(w.state_hash(), before);
}

#[test]
fn annual_snapshot_retains_the_actual_and_historical_comparison() {
    let mut w = world();
    let event = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
    event.history.outcome = "closed".into();
    while w.cast_date()[0] == 1558 {
        w.end_day().unwrap();
    }
    let facts = text::snapshot(&w, &TextTarget::AltChronicle { year: 1558 }).unwrap();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&facts.facts).unwrap();
    assert_eq!(rows.len(), w.state.history.chronicle.len());
    for (row, actual) in rows.iter().zip(&w.state.history.chronicle) {
        let e = w.defs.history.event(&actual.event).unwrap();
        assert_eq!(row["actual"], e.outcomes.iter().find(|o| o.key == actual.outcome).unwrap().chronicle);
        assert_eq!(row["history"], e.outcomes.iter().find(|o| o.key == e.history.outcome).unwrap().chronicle);
        assert_eq!(row["deviates"], actual.deviates);
    }
    assert!(rows.iter().any(|r| r["deviates"] == true));
}

#[test]
fn terra16_diary_has_three_variants_for_every_protagonist_and_template() {
    let root = manifest_data::find_data_dir().unwrap();
    let effective = manifest_data::resolve_world(&root, "terra16").unwrap();
    let content = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let defs = manifest_data::load_world(&root, "terra16").unwrap();
    let sections = &content.templates.f9["diary"];
    let voices: std::collections::BTreeSet<_> = defs
        .scenarios
        .iter()
        .flat_map(|s| s.protagonists.iter().chain(&s.templates))
        .map(|k| format!("voice_{k}"))
        .chain(std::iter::once("voice_generic".into()))
        .collect();
    assert_eq!(voices.len(), 22);
    for voice in voices {
        assert_eq!(sections[&voice].len(), 3, "{voice}");
        for line in &sections[&voice] {
            for slot in ["{protagonist}", "{year}", "{month}", "{facts}"] {
                assert!(line.contains(slot), "{voice}: {slot}");
            }
        }
    }
}

#[tokio::test]
async fn saved_text_records_cannot_predate_the_facts_they_describe() {
    let mut annual = world();
    let beginning = annual.day();
    while annual.cast_date()[0] == 1558 {
        annual.end_day().unwrap();
    }
    record(&mut annual, TaskRequest::AltChronicle { year: 1558 }, ProposalKind::AltChronicle).await;
    let mut state = annual.state.clone();
    state.cast.ai.texts.values_mut().next().unwrap().day = beginning;
    assert!(World::from_snapshot(annual.defs.clone(), state).is_err());

    let mut diary = diary_world();
    record(&mut diary, TaskRequest::Diary { year: 1553, month: 1 }, ProposalKind::Diary).await;
    let mut state = diary.state.clone();
    state.cast.ai.texts.values_mut().next().unwrap().day -= 1;
    assert!(World::from_snapshot(diary.defs.clone(), state).is_err());

    let mut ending = world();
    let beginning = ending.day();
    ending.end_day().unwrap();
    ending.end_day().unwrap();
    record(
        &mut ending,
        TaskRequest::Narration { event: "sample_opening".into(), phase: "ending".into() },
        ProposalKind::Narration,
    )
    .await;
    let mut state = ending.state.clone();
    state.cast.ai.texts.values_mut().next().unwrap().day = beginning;
    assert!(World::from_snapshot(ending.defs.clone(), state).is_err());

    let mut arrived = world();
    let id = letter(&mut arrived);
    record(&mut arrived, TaskRequest::Letter { id, purpose: "help".into() }, ProposalKind::Letter).await;
    let mut state = arrived.state.clone();
    state.cast.ai.texts.values_mut().next().unwrap().day -= 1;
    assert!(World::from_snapshot(arrived.defs.clone(), state).is_err());
}

#[tokio::test]
async fn changed_balances_schedule_progress_instead_of_rewriting_the_opening_forever() {
    let mut w = world();
    let event = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
    event.date = Some([1558, 1, 31]);
    event.window = Some([[1558, 1, 1], [1558, 1, 31]]);
    record(
        &mut w,
        TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() },
        ProposalKind::Narration,
    )
    .await;
    w.end_day().unwrap();
    w.state.history.known_events.get_mut("sample_opening").unwrap().balance += 20;
    let due = text::due_targets(&w);
    assert!(!due.iter().any(|t| matches!(t,TextTarget::Narration {phase,..} if phase=="opening")));
    assert!(
        due.iter()
            .any(|t| matches!(t,TextTarget::Narration {event,phase} if event=="sample_opening" && phase=="progress"))
    );
}

#[tokio::test]
async fn rewriting_one_target_consumes_the_daily_write_limit_and_persists_it() {
    let mut w = world();
    let event = Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap();
    event.date = Some([1558, 1, 31]);
    event.window = Some([[1558, 1, 1], [1558, 1, 31]]);
    w.end_day().unwrap();
    for index in 0..text::RECORDS_PER_DAY {
        w.state.history.known_events.get_mut("sample_opening").unwrap().balance = index as i64 * 20;
        record(
            &mut w,
            TaskRequest::Narration { event: "sample_opening".into(), phase: "progress".into() },
            ProposalKind::Narration,
        )
        .await;
    }
    assert_eq!(w.state.cast.ai.texts.len(), 1);
    assert_eq!(w.state.cast.ai.text_writes.as_ref().unwrap().count, text::RECORDS_PER_DAY);
    let mut w = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    w.state.history.known_events.get_mut("sample_opening").unwrap().balance += 20;
    let mut candidate = w.state.cast.ai.texts.values().next().unwrap().clone();
    let fresh = text::snapshot(&w, &candidate.target).unwrap();
    candidate.proof = fresh.proof;
    candidate.params = fresh.params;
    let before = w.state_hash();
    assert!(Command::RecordAiText { record: candidate }.apply(&mut w).is_err());
    assert_eq!(w.state_hash(), before);
    let mut missing = w.state.clone();
    missing.cast.ai.text_writes = None;
    assert!(World::from_snapshot(w.defs.clone(), missing).is_err());
    let mut excessive = w.state.clone();
    excessive.cast.ai.text_writes.as_mut().unwrap().count += 1;
    assert!(World::from_snapshot(w.defs.clone(), excessive).is_err());
    w.end_day().unwrap();
    record(
        &mut w,
        TaskRequest::Narration { event: "sample_opening".into(), phase: "progress".into() },
        ProposalKind::Narration,
    )
    .await;
    assert_eq!(w.state.cast.ai.text_writes.as_ref().unwrap().count, 1);
    World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
}
