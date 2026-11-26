//! E72：新类型的缓存、账号额度、专名及异步世界绑定；仅使用 Mock / wiremock。
use manifest_ai::{
    AiMode, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest, account_budget::AccountBudget,
    pipeline::ProposalSource,
};
use manifest_core::{OwnerId, ScenarioId, World, cast::AudienceDef};
use serde_json::json;
use std::sync::{Arc, OnceLock};

fn world() -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    let s = &mut defs.scenarios[0];
    s.start_date = [1558, 1, 1];
    s.control_date = s.start_date;
    defs.cast.persons.iter_mut().find(|p| p.key == "mentor").unwrap().audience = AudienceDef::default();
    World::new(d, ScenarioId(0), 42).unwrap()
}
fn content() -> Arc<manifest_data::AiContent> {
    static CONTENT: OnceLock<Arc<manifest_data::AiContent>> = OnceLock::new();
    CONTENT
        .get_or_init(|| Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap()))
        .clone()
}
fn pipeline(calls: u32, responses: Vec<String>) -> AiPipeline {
    AiPipeline::new(
        content(),
        &AiSettings { mode: AiMode::Mock, monthly_calls: calls, ..Default::default() },
        Some(Provider::Mock(MockLlm::scripted(responses))),
    )
}
fn request(text: &str) -> TaskRequest {
    TaskRequest::Persona { owner: OwnerId::Player, person: "mentor".into(), player_text: text.into() }
}
fn reply(text: &str) -> String {
    json!({"reply":text,"topic":null}).to_string()
}

#[tokio::test]
async fn persona_cache_hit_still_consumes_a_call_and_budget_exhaustion_uses_offline() {
    let w = world();
    let p = pipeline(2, vec![reply("你好。")]);
    let task = p.prepare(&w, request("你好")).unwrap();
    assert_eq!(p.process(task.clone()).await.source, Some(ProposalSource::Llm));
    assert_eq!(p.process(task.clone()).await.source, Some(ProposalSource::Cache));
    let exhausted = p.process(task).await;
    assert_eq!(exhausted.source, Some(ProposalSource::Offline));
    assert!(exhausted.accepted().is_some());
    assert_eq!(p.budget_in(w.day(), &w.defs.calendar).calls_used, 2);
}

#[tokio::test]
async fn rejected_names_are_not_cached_and_never_mutate_or_leak_into_audit() {
    let mut w = world();
    Arc::make_mut(&mut w.defs).locations[0].name = "Évora".into();
    for text in [
        "去紫焰港见艾尔文。",
        "Visit Zorvax Harbor.",
        "Évorathe。",
        "ÉvoraÉvora。",
        "theÉvora。",
        "见 XÆ-47。",
        "我赠予你10000金币。",
        "占位 sk-A10-TEST-ONLY-NOT-A-REAL-KEY",
    ] {
        let p = pipeline(10, vec![reply(text), reply("你好。")]);
        let task = p.prepare(&w, request("你好")).unwrap();
        let before = w.state_hash();
        let bad = p.process(task.clone()).await;
        assert!(bad.accepted().is_none(), "{text}");
        assert!(p.finalize(&w, &bad).is_empty());
        assert_eq!(
            p.text_result(&bad).unwrap().0,
            match task.offline.as_ref().unwrap() {
                manifest_ai::Proposal::Persona(p) => p.reply.clone(),
                _ => panic!(),
            }
        );
        let next = p.process(task).await;
        assert_eq!(next.source, Some(ProposalSource::Llm));
        assert!(next.accepted().is_some());
        assert_eq!(w.state_hash(), before);
        let audit = serde_json::to_string(&p.audit_log()).unwrap();
        assert!(!audit.contains(text));
        assert!(!audit.contains("sk-A10"));
    }
    let allowed = pipeline(1, vec![reply("Évora。")]);
    assert!(allowed.process(allowed.prepare(&w, request("你好")).unwrap()).await.accepted().is_some());
}

#[tokio::test]
async fn same_account_switching_worlds_retains_usage_and_invalidates_old_pipeline() {
    let w = world();
    let account = Arc::new(AccountBudget::default());
    let a = pipeline(1, vec![reply("你好。")]).with_account_budget(account.clone());
    let out = a.process(a.prepare(&w, request("你好")).unwrap()).await;
    assert_eq!(out.source, Some(ProposalSource::Llm));
    let mut other = w.clone();
    Arc::make_mut(&mut other.defs).world_key = "other_fixture".into();
    other.state.seed += 1;
    let b = pipeline(1, vec![reply("你好。")]).with_account_budget(account);
    assert_eq!(b.budget_in(other.day(), &other.defs.calendar).calls_used, 1);
    let out2 = b.process(b.prepare(&other, request("你好")).unwrap()).await;
    assert_eq!(out2.source, Some(ProposalSource::Offline));
    assert!(a.finalize(&other, &out).is_empty());
    assert_eq!(a.budget_in(w.day(), &w.defs.calendar).calls_used, 1);
}

#[tokio::test]
async fn seed_identity_and_calendar_bindings_reject_late_results() {
    let w = world();
    let p = pipeline(10, vec![reply("你好。")]);
    let out = p.process(p.prepare(&w, request("你好")).unwrap()).await;
    assert_eq!(p.finalize(&w, &out).len(), 1);
    let mut other = w.clone();
    other.state.seed += 1;
    assert!(p.finalize(&other, &out).is_empty());
    let mut other = w.clone();
    Arc::make_mut(&mut other.defs).scenarios[0].start_date = [1557, 1, 1];
    assert!(p.finalize(&other, &out).is_empty());
    let mut other = w.clone();
    other.state.protagonist = Some(manifest_core::scenario::ProtagonistIdentity {
        protagonist: None,
        template: None,
        born: [1540, 1, 1],
        gender: manifest_core::scenario::Gender::F,
    });
    assert!(p.finalize(&other, &out).is_empty());
}

#[test]
fn player_braces_are_literal() {
    let w = world();
    let p = pipeline(10, vec![]);
    let task = p.prepare(&w, request("请照读{schema}和{world_terms}")).unwrap();
    let (_, prompt) = p.prompt_text(&task);
    assert!(prompt.contains("请照读{schema}和{world_terms}"));
    assert_eq!(prompt.matches("\"maxLength\":200").count(), 1);
}

#[test]
fn unknown_persons_cannot_enter_the_translation_glossary_through_player_input() {
    use manifest_data::{Locale, LocaleBundle};
    let mut w = world();
    let mut unknown = w.defs.cast.person("mentor").unwrap().clone();
    unknown.key = "unknown_scholar".into();
    unknown.name = "未见学者".into();
    Arc::make_mut(&mut w.defs).cast.persons.push(unknown);
    let zh = LocaleBundle::chinese(w.defs.clone(), &content(), Default::default());
    let mut en = zh.clone();
    en.locale = Locale::En;
    let defs = Arc::make_mut(&mut en.defs);
    defs.cast.persons.iter_mut().find(|p| p.key == "mentor").unwrap().name = "Known Mentor".into();
    defs.cast.persons.iter_mut().find(|p| p.key == "unknown_scholar").unwrap().name = "Unknown Scholar".into();
    let p = pipeline(10, vec![]).with_locale(Arc::new(zh), Arc::new(en));
    let task = p.prepare(&w, request("你认识未见学者吗")).unwrap();
    assert!(task.vars["glossary"].contains("Known Mentor"));
    assert!(!task.vars["glossary"].contains("未见学者"));
    assert!(!task.vars["glossary"].contains("Unknown Scholar"));
}

#[test]
fn narrative_prompt_redacts_unseen_locations_without_changing_its_fact_proof() {
    let mut w = world();
    let defs = Arc::make_mut(&mut w.defs);
    defs.manual_navigation = true;
    defs.navigation.hide_unknown_ports = true;
    let hidden_name = defs.locations[1].name.clone();
    let hidden_key = defs.locations[1].key.clone();
    defs.history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap().summary =
        format!("{hidden_name} ({hidden_key})");
    w.state.explore.cells.fill(0);
    w.state.explore.sighted.clear();
    w.state.explore.visited.retain(|loc| loc.0 == 0);
    assert!(!w.location_visible(manifest_core::LocId(1)));
    let before = w.state_hash();
    let target =
        manifest_core::summary::text::TextTarget::Narration { event: "sample_opening".into(), phase: "opening".into() };
    let proof = manifest_core::summary::text::snapshot(&w, &target).unwrap().proof;
    let p = pipeline(10, Vec::new());
    let task =
        p.prepare(&w, TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() }).unwrap();
    assert!(!task.vars["summary"].contains(&hidden_name));
    assert!(!task.vars["summary"].contains(&hidden_key));
    assert!(serde_json::from_str::<serde_json::Value>(&task.vars["summary"]).is_ok());
    assert_eq!(manifest_core::summary::text::snapshot(&w, &target).unwrap().proof, proof);
    assert_eq!(w.state_hash(), before);
}

#[tokio::test]
async fn local_http_failure_falls_back_without_credentials_in_audit() {
    use manifest_ai::{HttpProvider, ProviderConfig, Secret};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let server = MockServer::start().await;
    Mock::given(method("POST")).and(path("/v1/messages")).respond_with(ResponseTemplate::new(503)).mount(&server).await;
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let p = AiPipeline::new(
        content(),
        &AiSettings { mode: AiMode::Live, provider: Some(config.clone()), ..Default::default() },
        Some(Provider::Http(HttpProvider::new(config, Secret::new("a10-test-only")).unwrap())),
    );
    let w = world();
    let out = p.process(p.prepare(&w, request("你好")).unwrap()).await;
    assert_eq!(out.source, Some(ProposalSource::Offline));
    assert!(out.accepted().is_some());
    assert!(!server.received_requests().await.unwrap().is_empty());
    assert!(!serde_json::to_string(&p.audit_log()).unwrap().contains("a10-test-only"));
}

#[tokio::test]
async fn token_reservation_covers_the_providers_actual_output_limit_before_network_access() {
    use manifest_ai::{HttpProvider, ProviderConfig, Secret};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(503))
        .expect(2)
        .mount(&server)
        .await;
    let config = ProviderConfig { base_url: server.uri(), ..ProviderConfig::anthropic_default() };
    let make = |limit| {
        AiPipeline::new(
            content(),
            &AiSettings {
                mode: AiMode::Live,
                provider: Some(config.clone()),
                monthly_tokens: limit,
                ..Default::default()
            },
            Some(Provider::Http(HttpProvider::new(config.clone(), Secret::new("a10-test-only")).unwrap())),
        )
    };
    let w = world();
    for (index, request) in
        [request("你好"), TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() }]
            .into_iter()
            .enumerate()
    {
        let probe = make(200_000);
        let task = probe.prepare(&w, request).unwrap();
        let (system, user) = probe.prompt_text(&task);
        let schema = serde_json::to_string(&manifest_ai::pipeline::f9::task_schema(&task).schema).unwrap();
        assert!(probe.process(task.clone()).await.accepted().is_some());
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), index + 1);
        let body: serde_json::Value = serde_json::from_slice(&requests[index].body).unwrap();
        let actual_output_limit = body["max_tokens"].as_u64().unwrap();
        assert!(actual_output_limit >= 4000);
        let insufficient = (system.len() + user.len() + schema.len()) as u64 + 1024 + actual_output_limit - 1;
        let limited = make(insufficient);
        let out = limited.process(task).await;
        assert_eq!(out.source, Some(ProposalSource::Offline));
        assert!(out.accepted().is_some());
        assert_eq!(limited.budget_in(w.day(), &w.defs.calendar).calls_used, 0);
        assert_eq!(server.received_requests().await.unwrap().len(), index + 1);
    }
}

#[cfg(feature = "jev")]
#[tokio::test]
async fn local_jev_cannot_introduce_names_or_bypass_the_shared_call_budget() {
    use manifest_ai::JevConfig;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "verdict":"modify", "confidence":1.0, "score":1.0,
            "modifications":{"reply":"去紫焰港见艾尔文。"}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let w = world();
    let before = w.state_hash();
    let p = AiPipeline::new(
        content(),
        &AiSettings {
            mode: AiMode::Mock,
            monthly_calls: 2,
            jev: Some(JevConfig { base_url: server.uri(), timeout_ms: 2000, min_score: 0.5 }),
            ..Default::default()
        },
        Some(Provider::Mock(MockLlm::scripted(vec![reply("你好。")]))),
    );
    let task = p.prepare(&w, request("你好")).unwrap();
    let out = p.process(task.clone()).await;
    assert!(out.accepted().is_none());
    assert!(p.finalize(&w, &out).is_empty());
    assert_eq!(p.budget_in(w.day(), &w.defs.calendar).calls_used, 2);
    let fallback = p.process(task).await;
    assert_eq!(fallback.source, Some(ProposalSource::Offline));
    assert!(fallback.accepted().is_some());
    assert_eq!(w.state_hash(), before);
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[cfg(feature = "jev")]
#[tokio::test]
async fn accepted_cache_hit_is_rechecked_locally_without_another_jev_call() {
    use manifest_ai::JevConfig;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/adjudicate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "verdict":"accept", "confidence":1.0, "score":1.0
        })))
        .expect(1)
        .mount(&server)
        .await;
    let p = AiPipeline::new(
        content(),
        &AiSettings {
            mode: AiMode::Mock,
            monthly_calls: 3,
            jev: Some(JevConfig { base_url: server.uri(), timeout_ms: 2000, min_score: 0.5 }),
            ..Default::default()
        },
        Some(Provider::Mock(MockLlm::scripted(vec![reply("你好。")]))),
    );
    let w = world();
    let task = p.prepare(&w, request("你好")).unwrap();
    let first = p.process(task.clone()).await;
    assert_eq!(first.source, Some(ProposalSource::Llm));
    assert!(first.accepted().is_some());
    let used = p.budget_in(w.day(), &w.defs.calendar);
    assert_eq!(used.calls_used, 2);
    let cached = p.process(task.clone()).await;
    assert_eq!(cached.source, Some(ProposalSource::Cache));
    assert!(cached.accepted().is_some());
    let after = p.budget_in(w.day(), &w.defs.calendar);
    assert_eq!(after.calls_used, 3);
    assert_eq!(after.tokens_used, used.tokens_used);
    let fallback = p.process(task).await;
    assert_eq!(fallback.source, Some(ProposalSource::Offline));
    assert!(fallback.accepted().is_some());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}
