//! 自由对话复用既有 AI 准入和换局取消；等待模型时不占用游戏锁。
use super::*;
use manifest_core::summary::ai;
use serde_json::json;

pub(super) const PENDING_CHAT: &str = "a10:chat:pending";
pub(super) const FALLBACK_CHAT: &str = "a10:chat:fallback";

#[derive(Clone, Debug, Serialize)]
pub struct PersonaChatReply {
    pub reply: String,
    pub source: String,
    pub accepted_intent: String,
    pub topics: Vec<String>,
    pub budget: BudgetStatus,
    pub accepted: bool,
}

pub(super) const BUSY_TEXT: &str = "上一句话还没有回音，稍等一下再说。";
pub(super) const BUDGET_TEXT: &str = "今天的 AI 对话额度用完了，明天再来。";

fn unavailable(key: &'static str) -> AppError {
    let text = match key {
        "ai.busy" => BUSY_TEXT,
        "ai.budget" => BUDGET_TEXT,
        "ai.switched" => "存档已经换过，这句话没有送出去。",
        _ => "眼下不便和这个人攀谈。",
    };
    AppError::Invalid(Msg::new(key, text))
}

/// 已经裁决的对话效果，写成人物页上的一行小字。
fn effect_text(world: &manifest_core::World, e: &ai::ChatEffect) -> String {
    let key = e.key.as_deref().unwrap_or_default();
    match e.kind.as_str() {
        "affinity" if e.value > 0 => format!("好感 +{}", e.value),
        "affinity" if e.value < 0 => format!("好感 −{}", e.value.unsigned_abs()),
        "affinity" => "好感没有变化".into(),
        "heart" => format!("心动 +{}", e.value.max(0)),
        "topic" if key == "gossip" => "聊起了近来的传闻".into(),
        "topic" => "聊了聊家常".into(),
        "request" => match key.strip_prefix("ask:").and_then(|track| world.defs.story2.track(track)) {
            Some(track) => format!("提起了“{}”", track.name),
            None => "谈到了一项条款".into(),
        },
        _ => String::new(),
    }
}

fn publish(st: &AppState, game: &Game) {
    let overview = read_overview(st, game);
    st.emit("tick", serde_json::to_value(overview).unwrap_or_default());
}

pub fn persona_chat(st: &AppState, person: String, text: String) -> Result<PersonaChatReply, AppError> {
    let (generation, pipeline, task, mut lease) = with_game(st, |g| {
        if g.notes.contains_key(PENDING_CHAT) {
            return Err(unavailable("ai.busy"));
        }
        if let Some(runner) = &g.ai
            && runner.pipeline.mode() == AiMode::Live
        {
            let budget = runner.pipeline.budget_in(g.session.day(), &g.session.world.defs.calendar);
            if budget.calls_used >= budget.calls_limit || budget.tokens_used >= budget.tokens_limit {
                return Err(unavailable("ai.budget"));
            }
        }
        g.notes.remove(FALLBACK_CHAT);
        let lease = g.ai.as_ref().map(|runner| runner.foreground(&mut g.session)).transpose()?.flatten();
        let pipeline = g.ai.as_ref().map(|runner| runner.pipeline.clone()).unwrap_or_else(|| st.offline_pipeline());
        let world = g.view_world();
        ai::check_free(&world, PLAYER, &person, &text).map_err(AppError::Command)?;
        let task = pipeline
            .prepare(&world, TaskRequest::Persona { owner: PLAYER, person: person.clone(), player_text: text.clone() })
            .ok_or_else(|| unavailable("ai.unavailable"))?;
        let seq = world.state.cast.ai.seq.checked_add(1).ok_or_else(|| unavailable("ai.sequence"))?;
        let pending = json!({"person":person,"seq":seq,"turns":[
            {"seq":seq,"who":"you","text":text,"status":"done","effects":[]},
            {"seq":seq,"who":"them","text":"","status":"pending","effects":[]}
        ]});
        g.notes.insert(PENDING_CHAT.into(), pending.to_string());
        publish(st, g);
        Ok((st.generation(), pipeline, task, lease))
    })?;
    let processed = process_admitted(st, &pipeline, task, &mut lease);
    with_game(st, |g| {
        if st.generation() != generation || lease.as_ref().is_some_and(crate::state::AiLease::cancelled) {
            return Err(unavailable("ai.switched"));
        }
        g.notes.remove(PENDING_CHAT);
        let outcome = processed?;
        let cmds = pipeline.finalize(&g.view_world(), &outcome);
        let mut accepted = false;
        for command in cmds {
            // 人物响应即时进入命令日志；之后的重放只执行已裁决的命令。
            let minute = clock::since_day_start(g.minute) as u16;
            g.session.submit_from_at(minute, manifest_core::replay::Source::Ai, command).map_err(AppError::Command)?;
            accepted = true;
        }
        let reply = if accepted {
            manifest_ai::pipeline::f9::text_result(&outcome).unwrap_or_default()
        } else {
            match outcome.task.offline.as_ref() {
                Some(manifest_ai::Proposal::Persona(p)) => p.reply.clone(),
                _ => String::new(),
            }
        };
        let source = if accepted
            && matches!(
                outcome.source,
                Some(manifest_ai::pipeline::ProposalSource::Llm | manifest_ai::pipeline::ProposalSource::Cache)
            ) {
            "model"
        } else {
            "template"
        };
        if !accepted {
            let seq = g.session.world.state.cast.ai.seq.saturating_add(1);
            g.notes.insert(
                FALLBACK_CHAT.into(),
                json!({"person":person,"seq":seq,"turns":[
                    {"seq":seq,"who":"you","text":text,"status":"done","effects":[]},
                    {"seq":seq,"who":"them","text":reply,"status":"fallback","effects":[]}
                ]})
                .to_string(),
            );
        }
        let topics = ai::topics(&g.view_world(), &person);
        let budget = pipeline.budget_in(g.session.day(), &g.session.world.defs.calendar);
        publish(st, g);
        Ok(PersonaChatReply {
            reply,
            source: source.into(),
            accepted_intent: ai::PersonaIntent::classify(&text).key().into(),
            topics,
            budget,
            accepted,
        })
    })
}

pub(super) fn chat_view(world: &manifest_core::World) -> Option<Value> {
    let chat = world.state.cast.ai.chat.as_ref()?;
    Some(json!({"person":chat.person,"seq":chat.seq,"turns":chat.turns.iter().map(|t|json!({
        "seq":t.seq,"who":t.who,"text":t.text,"status":t.status,
        "effects":t.effects.iter().map(|e|json!({"kind":e.kind,"text":effect_text(world,e)})).collect::<Vec<_>>()
    })).collect::<Vec<_>>() }))
}
