//! E71a：模型只提供文字或模板参数，所有收益再次经过内核限制。
use manifest_ai::{AiMode, AiPipeline, AiSettings, MockLlm, Proposal, Provider, TaskRequest};
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    cast::{AudienceDef, PersonKind, RomanceDef, ScheduleDef},
    scenario::{Gender, ProtagonistIdentity},
    summary::ai,
};
use manifest_data::ProposalKind;
use serde_json::json;
use std::sync::Arc;

fn fixture() -> (World, String) {
    let root = manifest_data::find_data_dir().unwrap();
    let mut world = World::new(manifest_data::load_world(&root, "testbed").unwrap(), ScenarioId(0), 42).unwrap();
    let loc = world.cast_player_place().unwrap().loc;
    let date = world.cast_date();
    let d = Arc::make_mut(&mut world.defs);
    let key = d.cast.persons[0].key.clone();
    let p = &mut d.cast.persons[0];
    p.kind = PersonKind::Story;
    p.born = [date[0] - 18, 1, 1];
    p.role.clear();
    p.tags.clear();
    p.audience = AudienceDef::default();
    p.cameo = None;
    p.romance = RomanceDef { with: vec!["any".into()] };
    p.schedule = vec![ScheduleDef {
        from: [1, 1, 1],
        to: None,
        at: d.locations[loc.idx()].key.clone(),
        venue: String::new(),
        seasons: Vec::new(),
    }];
    world.state.cast.persons.entry(key.clone()).or_default().met = true;
    world.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [date[0] - 18, 1, 1], gender: Gender::F });
    world.state.cast.academy = false;
    (world, key)
}
fn pipeline(mode: AiMode) -> AiPipeline {
    let content = Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap());
    let provider = (mode == AiMode::Mock).then(|| Provider::Mock(MockLlm::plausible()));
    AiPipeline::new(content, &AiSettings { mode, ..Default::default() }, provider)
}

#[tokio::test]
async fn test9_persona_and_daily_generate_offline_and_obey_shared_caps() {
    let (mut world, person) = fixture();
    let pipeline = pipeline(AiMode::Offline);
    let request =
        TaskRequest::Persona {
            owner: OwnerId::Player, person: person.clone(), player_text: "佩服你的本领".into()
        };
    let task = pipeline.prepare(&world, request).unwrap();
    let outcome = pipeline.process(task).await;
    assert_eq!(outcome.accepted().unwrap().kind(), ProposalKind::Persona);
    let commands = pipeline.finalize(&world, &outcome);
    assert_eq!(commands.len(), 1);
    let cash = world.agent(OwnerId::Player).unwrap().cash;
    let before = world.affection(&person).unwrap().affinity;
    commands[0].apply(&mut world).unwrap();
    assert!((0..=2).contains(&(world.affection(&person).unwrap().affinity - before)));
    assert_eq!(world.agent(OwnerId::Player).unwrap().cash, cash);
    let after = world.state.clone();
    assert!(commands[0].apply(&mut world).is_err());
    assert_eq!(world.state, after);
    let task = pipeline.prepare(&world, TaskRequest::Daily { owner: OwnerId::Player, person: person.clone() }).unwrap();
    let outcome = pipeline.process(task).await;
    assert_eq!(outcome.accepted().unwrap().kind(), ProposalKind::Daily);
    let commands = pipeline.finalize(&world, &outcome);
    assert_eq!(commands.len(), 1);
    commands[0].apply(&mut world).unwrap();
    let after = world.state.clone();
    assert!(commands[0].apply(&mut world).is_err());
    assert_eq!(world.state, after);
    let mut next = world.clone();
    next.state.day += 1;
    let before = next.state.clone();
    assert!(commands[0].apply(&mut next).is_err());
    assert_eq!(next.state, before);
    assert!(pipeline.prepare(&world, TaskRequest::Daily { owner: OwnerId::Player, person }).is_none());
    assert_eq!(World::from_snapshot(world.defs.clone(), world.state.clone()).unwrap().state, world.state);
}

#[test]
fn test7_model_cannot_supply_money_items_heart_or_intent() {
    assert!(Proposal::from_body(ProposalKind::Persona, json!({"reply":"占位。"})).is_err());
    for field in ["money", "cash", "item", "heart", "affinity", "intent"] {
        let mut body = json!({"reply":"占位。","topic":null});
        body[field] = json!(100);
        assert!(Proposal::from_body(ProposalKind::Persona, body).is_err());
        let mut body = json!({"template":"port_chat","person":"mentor","loc":"test_west","season":0});
        body[field] = json!(100);
        assert!(Proposal::from_body(ProposalKind::Daily, body).is_err());
    }
}

#[test]
fn daily_heart_uses_the_existing_age_orientation_and_authority_gate() {
    let (mut world, person) = fixture();
    world.state.cast.academy = true;
    Arc::make_mut(&mut world.defs).scenarios[0].upbringing = true;
    world.state.upbringing = Some(manifest_core::upbringing::UpbringingState {
        family: world.defs.upbringing.families[0].key.clone(),
        ..Default::default()
    });
    let current = world.cast_date()[0];
    let loc = world.defs.loc(world.cast_player_place().unwrap().loc).key.clone();
    for (player_age, target_age, allowed) in
        [(13, 13, true), (13, 17, false), (17, 18, false), (18, 17, false), (18, 20, true), (18, 22, false)]
    {
        world.state.protagonist.as_mut().unwrap().born = [current - player_age, 1, 1];
        Arc::make_mut(&mut world.defs).cast.persons[0].born = [current - target_age, 1, 1];
        let result = ai::DailyResult {
            owner: OwnerId::Player,
            template: "academy_moment".into(),
            person: person.clone(),
            loc: loc.clone(),
            season: world.defs.calendar.season_of(world.day()) as u32,
            day: world.day(),
            text: "占位。".into(),
            source: ai::AiSource::Template,
        };
        let command = Command::ApplyDaily { result };
        let before = world.state.clone();
        assert_eq!(command.validate(&world).is_ok(), allowed, "{player_age}/{target_age}");
        assert_eq!(world.state, before);
    }
    world.state.protagonist.as_mut().unwrap().born = [current - 13, 1, 1];
    let defs = Arc::make_mut(&mut world.defs);
    defs.cast.persons[0].born = [current - 13, 1, 1];
    defs.cast.persons[0].kind = PersonKind::Historical;
    assert!(world.validate_romance(&person, manifest_core::cast::relations::RomanceAction::Heart).is_err());
}

#[tokio::test]
async fn finalization_rechecks_presence_and_topic_against_current_world() {
    let (mut world, person) = fixture();
    let pipeline = pipeline(AiMode::Mock);
    let task = pipeline
        .prepare(
            &world,
            TaskRequest::Persona { owner: OwnerId::Player, person: person.clone(), player_text: "你好".into() },
        )
        .unwrap();
    let outcome = pipeline.process(task).await;
    assert_eq!(pipeline.finalize(&world, &outcome).len(), 1);
    world.state.cast.persons.get_mut(&person).unwrap().alive = Some(false);
    let before = world.state.clone();
    assert!(pipeline.finalize(&world, &outcome).is_empty());
    assert_eq!(world.state, before);
}

#[test]
fn free_input_is_bounded_and_model_intent_is_not_used() {
    let (world, person) = fixture();
    for text in [String::new(), "字".repeat(201)] {
        let c = Command::TalkFree { owner: OwnerId::Player, person: person.clone(), text };
        let before = world.state.clone();
        assert!(c.validate(&world).is_err());
        assert_eq!(world.state, before);
    }
    assert_eq!(ai::PersonaIntent::classify("你真值得佩服，但是我要威胁你"), ai::PersonaIntent::Threat);
    assert_eq!(ai::PersonaIntent::classify("朋友，你需要帮忙吗"), ai::PersonaIntent::Request);
    assert!(ai::requested_term("我请求开放边市", "open_frontier_markets"));
    assert!(!ai::requested_term("我请求不要开放边市", "open_frontier_markets"));
    assert!(!ai::requested_term("我不同意开放边市", "open_frontier_markets"));
}

#[test]
fn persona_negotiation_reuses_the_legal_lever_and_is_atomic() {
    let root = manifest_data::find_data_dir().unwrap();
    let mut defs = manifest_data::load_world(&root, "testbed").unwrap();
    let scenario = &mut Arc::make_mut(&mut defs).scenarios[0];
    scenario.start_date = [1558, 1, 1];
    scenario.control_date = scenario.start_date;
    let mut world = World::new(defs, ScenarioId(0), 42).unwrap();
    let person = "mentor";
    world.state.cast.place = world.person_place(person);
    world.state.cast.persons.entry(person.into()).or_default().met = true;
    world.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.insert("lang_test".into(), 1);
    Command::RequestAudience { owner: OwnerId::Player, person: person.into() }.apply(&mut world).unwrap();
    let topic = "term:sample_opening:terms:test_terms";
    assert!(ai::topics(&world, person).iter().any(|t| t == topic));
    let mut result = ai::PersonaResult {
        owner: OwnerId::Player,
        person: person.into(),
        seq: 1,
        day: world.day(),
        player_text: "你好".into(),
        reply: "占位。".into(),
        topic: Some(topic.into()),
        source: ai::AiSource::Model,
    };
    let before = world.state.clone();
    assert!(Command::ApplyPersona { result: result.clone() }.apply(&mut world).is_err());
    assert_eq!(world.state, before);
    result.player_text = "请求test_terms".into();
    let command = Command::ApplyPersona { result };
    command.apply(&mut world).unwrap();
    let diplomacy = &world.state.history.events["sample_opening"].contributions["terms"].diplomacy[&OwnerId::Player];
    assert_eq!(diplomacy.term.as_deref(), Some("test_terms"));
    let before = world.state.clone();
    assert!(command.apply(&mut world).is_err());
    assert_eq!(world.state, before);
}
