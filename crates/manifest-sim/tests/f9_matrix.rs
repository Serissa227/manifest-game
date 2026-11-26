//! test7 / test9 的七类型矩阵：结构非法全部拒绝，预算耗尽仍有离线结果。
mod common;
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest, pipeline::ProposalSource};
use manifest_core::{OwnerId, World, cast::AudienceDef};
use manifest_data::ProposalKind;
use std::sync::Arc;

fn cases() -> Vec<(World, TaskRequest)> {
    let mut texts = common::f9::text_cases();
    let mut w = texts[0].0.clone();
    Arc::make_mut(&mut w.defs).cast.persons.iter_mut().find(|p| p.key == "mentor").unwrap().audience =
        AudienceDef::default();
    w.state.cast.place = w.person_place("mentor");
    w.state.cast.persons.entry("mentor".into()).or_default().met = true;
    let mut out = vec![
        (
            w.clone(),
            TaskRequest::Persona { owner: OwnerId::Player, person: "mentor".into(), player_text: "你好".into() },
        ),
        (w, TaskRequest::Daily { owner: OwnerId::Player, person: "mentor".into() }),
    ];
    out.append(&mut texts);
    out
}
fn pipeline(calls: u32, llm: MockLlm) -> AiPipeline {
    let root = manifest_data::find_data_dir().unwrap();
    AiPipeline::new(
        Arc::new(manifest_data::load_ai_content(&root).unwrap()),
        &AiSettings { mode: AiMode::Mock, monthly_calls: calls, monthly_tokens: 1_000_000, ..Default::default() },
        Some(Provider::Mock(llm)),
    )
}

#[tokio::test]
async fn test7_all_new_types_reject_bad_json_and_ungranted_fields_without_state_changes() {
    let mut seen = Vec::new();
    for (w, request) in cases() {
        let p = pipeline(10, MockLlm::plausible());
        let task = p.prepare(&w, request.clone()).unwrap();
        let kind = task.kind;
        seen.push(kind);
        let valid = task.offline.unwrap().body_json();
        let mut forged = valid.clone();
        forged.as_object_mut().unwrap().insert("money".into(), serde_json::json!(10000));
        let mut unknown = valid;
        let field = match kind {
            ProposalKind::Persona => "reply",
            ProposalKind::Daily => "person",
            ProposalKind::Ripple => "summary",
            _ => "text",
        };
        unknown[field] = serde_json::json!("紫焰港的艾尔文");
        for raw in ["{".into(), forged.to_string(), unknown.to_string()] {
            let p = pipeline(10, MockLlm::scripted(vec![raw]));
            let before = w.state_hash();
            let out = p.process(p.prepare(&w, request.clone()).unwrap()).await;
            assert!(out.accepted().is_none(), "{kind:?}");
            assert!(p.finalize(&w, &out).is_empty(), "{kind:?}");
            assert_eq!(w.state_hash(), before, "{kind:?}");
        }
    }
    assert_eq!(seen, ProposalKind::ALL.into_iter().filter(|k| k.is_f9()).collect::<Vec<_>>());
}

#[tokio::test]
async fn test9_all_new_types_are_budgeted_and_fall_back_to_valid_offline_commands() {
    let mut seen = Vec::new();
    for (mut w, request) in cases() {
        let p = pipeline(1, MockLlm::plausible());
        let task = p.prepare(&w, request).unwrap();
        seen.push(task.kind);
        let schema = manifest_ai::pipeline::f9::task_schema(&task);
        manifest_ai::schema::check_strict(&schema.schema).unwrap();
        let first = p.process(task.clone()).await;
        assert_eq!(first.source, Some(ProposalSource::Llm), "{:?}", task.kind);
        assert!(first.accepted().is_some(), "{:?}", task.kind);
        let offline = p.process(task).await;
        assert_eq!(offline.source, Some(ProposalSource::Offline));
        let commands = p.finalize(&w, &offline);
        assert_eq!(commands.len(), 1, "{:?}", offline.task.kind);
        for command in commands {
            command.apply(&mut w).unwrap();
        }
        assert_eq!(p.budget_in(w.day(), &w.defs.calendar).calls_used, 1);
    }
    assert_eq!(seen, ProposalKind::ALL.into_iter().filter(|k| k.is_f9()).collect::<Vec<_>>());
}
