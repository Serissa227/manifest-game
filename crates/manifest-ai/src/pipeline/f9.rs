//! 第九批任务的上下文与封闭参数，独立于经典管线的日程和 RNG。
pub mod guard;
pub mod ripple;
pub mod runtime;
pub mod text;
use super::*;
use manifest_core::summary::{ai, context};
use schemars::JsonSchema;
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PersonaProposal {
    pub reply: String,
    #[serde(deserialize_with = "nullable_string")]
    pub topic: Option<String>,
}

fn nullable_string<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DailyProposal {
    pub template: String,
    pub person: String,
    pub loc: String,
    pub season: u32,
}

#[derive(Clone, Debug)]
pub enum RequestContext {
    Ripple {
        event: String,
        outcome: String,
        resolved: u32,
        budget: u32,
        locs: Vec<String>,
        defs: Arc<manifest_core::StaticData>,
    },
    Text {
        target: manifest_core::summary::text::TextTarget,
        proof: String,
        requests: Vec<String>,
        section: String,
        variant_seed: u32,
    },
    Persona {
        owner: OwnerId,
        person: String,
        player_text: String,
        seq: u64,
        topics: Vec<String>,
    },
    Daily {
        owner: OwnerId,
        options: Vec<DailyProposal>,
    },
}

#[derive(Clone, Debug)]
pub struct F9Context {
    pub binding: String,
    pub guard: guard::Guard,
    pub request: RequestContext,
    pub params: BTreeMap<String, String>,
    pub templates: BTreeMap<String, Vec<String>>,
}

/// 单次插值，不递归解释玩家输入或数据文字里出现的花括号。
pub fn fill(text: &str, vars: &BTreeMap<String, String>) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let Some(end) = tail.find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let key = &tail[..end];
        if let Some(value) = vars.get(key) {
            out.push_str(value);
        } else {
            out.push_str(&rest[start..start + end + 2]);
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

impl F9Context {
    fn line(&self, section: &str, day: u32) -> Option<String> {
        let lines = self.templates.get(section)?;
        let line = lines.get(day as usize % lines.len().max(1))?;
        Some(fill(line, &self.params))
    }
    pub fn check(&self, proposal: &Proposal) -> Result<(), String> {
        match (&self.request, proposal) {
            (RequestContext::Ripple { locs, budget, defs, .. }, Proposal::Ripple(p)) => {
                ripple::check_context(p, locs, *budget, defs)
            }
            (RequestContext::Text { target, requests, .. }, p) => text::check(p, target, requests),
            (RequestContext::Persona { topics, .. }, Proposal::Persona(p)) => {
                if p.topic.as_ref().is_some_and(|t| !topics.contains(t)) {
                    return Err("ai.topic".into());
                }
                ai::check_text(&p.reply, ai::REPLY_CHARS).map_err(|_| "ai.text".into())
            }
            (RequestContext::Daily { options, .. }, Proposal::Daily(p)) => {
                if options.contains(p) {
                    Ok(())
                } else {
                    Err("ai.daily_context".into())
                }
            }
            _ => Err("ai.task_kind".into()),
        }
    }
}

fn object(properties: Value) -> Value {
    let required = properties.as_object().map(|p| p.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
    json!({"type":"object","additionalProperties":false,"properties":properties,"required":required})
}

pub fn schema(kind: ProposalKind, defs: &manifest_core::StaticData) -> Value {
    match kind {
        ProposalKind::Ripple => ripple::schema(defs),
        ProposalKind::Narration | ProposalKind::AltChronicle | ProposalKind::Diary => {
            object(json!({"text":{"type":"string","maxLength":manifest_core::summary::text::TEXT_CHARS}}))
        }
        ProposalKind::Letter => object(
            json!({"text":{"type":"string","maxLength":manifest_core::summary::text::TEXT_CHARS},"request":{"type":["string","null"]}}),
        ),
        ProposalKind::Persona => {
            object(json!({"reply":{"type":"string","maxLength":ai::REPLY_CHARS},"topic":{"type":["string","null"]}}))
        }
        ProposalKind::Daily => object(json!({
            "template":{"type":"string","enum":ai::DAILY_TEMPLATES.iter().map(|t|t.key).collect::<Vec<_>>()},
            "person":{"type":"string","enum":defs.cast.persons.iter().map(|p|&p.key).collect::<Vec<_>>()},
            "loc":{"type":"string","enum":defs.locations.iter().map(|p|&p.key).collect::<Vec<_>>()},
            "season":{"type":"integer","minimum":0,"maximum":3}
        })),
        _ => object(json!({})),
    }
}

pub fn task_schema(task: &AiTask) -> crate::schema::OutputSchema {
    let mut output = output_schema(task.kind, &task.ctx.defs);
    let TaskExtra::F9(ctx) = &task.extra else { return output };
    match &ctx.request {
        RequestContext::Ripple { locs, .. } => ripple::narrow_schema(&mut output.schema, locs),
        RequestContext::Text { requests, .. } => {
            if task.kind == ProposalKind::Letter {
                let mut values: Vec<Value> = requests.iter().map(|r| json!(r)).collect();
                values.push(Value::Null);
                output.schema["properties"]["request"]["enum"] = json!(values);
            }
        }
        RequestContext::Persona { topics, .. } => {
            let mut values: Vec<Value> = topics.iter().map(|t| json!(t)).collect();
            values.push(Value::Null);
            output.schema["properties"]["topic"]["enum"] = json!(values);
        }
        RequestContext::Daily { options, .. } => {
            for key in ["template", "person", "loc", "season"] {
                let mut values = options
                    .iter()
                    .filter_map(|p| serde_json::to_value(p).ok().and_then(|v| v.get(key).cloned()))
                    .collect::<Vec<_>>();
                values.sort_by_key(Value::to_string);
                values.dedup();
                output.schema["properties"][key]["enum"] = json!(values);
            }
        }
    }
    output
}

impl AiPipeline {
    pub(super) fn prepare_f9(&self, world: &World, request: TaskRequest) -> Option<AiTask> {
        let day = world.day();
        let defs = &world.defs;
        let (kind, person) = match &request {
            TaskRequest::Persona { person, .. } => (ProposalKind::Persona, person.as_str()),
            TaskRequest::Daily { person, .. } => (ProposalKind::Daily, person.as_str()),
            _ => return None,
        };
        let d = defs.cast.person(person)?;
        let at = world.cast_player_place()?;
        let mut params = BTreeMap::from([
            ("person".into(), d.name.clone()),
            ("loc".into(), defs.loc(at.loc).name.clone()),
            ("season".into(), ["春", "夏", "秋", "冬"][defs.calendar.season_of(day) as usize].into()),
        ]);
        let templates = self.content.templates.f9.get(kind.key())?.clone();
        let mut vars = BTreeMap::from([
            ("summary".into(), context::known_summary(world, 1800)),
            ("world_lore".into(), self.content.lore.summary.clone()),
            ("world_terms".into(), format!("{}\n{}", self.content.lore.terms, context::known_catalog(world, 3000))),
            ("world_taboos".into(), self.content.lore.taboos.clone()),
            ("calendar".into(), manifest_core::summary::world_date_text_in(&defs.rules.world, &defs.calendar, day)),
        ]);
        let (ctx, offline) = match request {
            TaskRequest::Persona { owner, person, player_text } => {
                ai::check_free(world, owner, &person, &player_text).ok()?;
                vars.insert("persona".into(), context::public_persona(world, &person)?);
                vars.insert("memory".into(), context::person_memory(world, &person)?);
                vars.insert("player_text".into(), player_text.clone());
                let topics = ai::topics(world, &person);
                vars.insert("topics".into(), serde_json::to_string(&topics).ok()?);
                let intent = ai::PersonaIntent::classify(&player_text);
                let ctx = F9Context {
                    binding: runtime::binding(world),
                    guard: guard::Guard::new(world),
                    request: RequestContext::Persona {
                        owner,
                        person,
                        player_text,
                        seq: world.state.cast.ai.seq.checked_add(1)?,
                        topics,
                    },
                    params,
                    templates,
                };
                let offline = Proposal::Persona(PersonaProposal { reply: ctx.line(intent.key(), day)?, topic: None });
                (ctx, offline)
            }
            TaskRequest::Daily { owner, person } => {
                let mut options = Vec::new();
                for t in ai::DAILY_TEMPLATES {
                    let p = DailyProposal {
                        template: t.key.into(),
                        person: person.clone(),
                        loc: defs.loc(at.loc).key.clone(),
                        season: defs.calendar.season_of(day) as u32,
                    };
                    let text = templates.get(t.key)?.first().map(|line| fill(line, &params))?;
                    let result = ai::DailyResult {
                        owner,
                        template: p.template.clone(),
                        person: person.clone(),
                        loc: p.loc.clone(),
                        season: p.season,
                        day,
                        text,
                        source: ai::AiSource::Template,
                    };
                    if ai::check_daily(world, &result).is_ok() {
                        options.push(p);
                    }
                }
                let offline = Proposal::Daily(options.get(day as usize % options.len().max(1))?.clone());
                vars.insert("options".into(), serde_json::to_string(&options).ok()?);
                (
                    F9Context {
                        binding: runtime::binding(world),
                        guard: guard::Guard::new(world),
                        request: RequestContext::Daily { owner, options },
                        params: std::mem::take(&mut params),
                        templates,
                    },
                    offline,
                )
            }
            _ => return None,
        };
        vars.insert("date".into(), vars.get("calendar")?.clone());
        self.f9_language_vars(world, &mut vars);
        Some(AiTask {
            kind,
            day,
            vars,
            offline: Some(offline),
            offline_tpl: None,
            ctx: AdjudicationContext {
                defs: defs.clone(),
                relations: world.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
            },
            extra: TaskExtra::F9(Box::new(ctx)),
        })
    }

    pub(super) fn finalize_f9(&self, world: &World, outcome: &AiOutcome) -> Vec<Command> {
        let TaskExtra::F9(ctx) = &outcome.task.extra else { return Vec::new() };
        if ctx.binding != runtime::binding(world) {
            return Vec::new();
        }
        if outcome.task.kind == ProposalKind::Ripple {
            return self.finalize_ripple(world, outcome);
        }
        if matches!(
            outcome.task.kind,
            ProposalKind::Narration | ProposalKind::Letter | ProposalKind::AltChronicle | ProposalKind::Diary
        ) {
            return self.finalize_text(world, outcome);
        }
        let Some(proposal) = outcome.accepted() else { return Vec::new() };
        let TaskExtra::F9(ctx) = &outcome.task.extra else { return Vec::new() };
        if ctx.check(proposal).is_err() {
            return Vec::new();
        }
        let source = if matches!(outcome.source, Some(ProposalSource::Llm | ProposalSource::Cache)) {
            ai::AiSource::Model
        } else {
            ai::AiSource::Template
        };
        let command = match (&ctx.request, proposal) {
            (RequestContext::Persona { owner, person, player_text, seq, .. }, Proposal::Persona(p)) => {
                Command::ApplyPersona {
                    result: ai::PersonaResult {
                        owner: *owner,
                        person: person.clone(),
                        seq: *seq,
                        day: outcome.task.day,
                        player_text: player_text.clone(),
                        reply: p.reply.clone(),
                        topic: p.topic.clone(),
                        source,
                    },
                }
            }
            (RequestContext::Daily { owner, .. }, Proposal::Daily(p)) => {
                let Some(text) = ctx.line(&p.template, outcome.task.day) else { return Vec::new() };
                Command::ApplyDaily {
                    result: ai::DailyResult {
                        owner: *owner,
                        template: p.template.clone(),
                        person: p.person.clone(),
                        loc: p.loc.clone(),
                        season: p.season,
                        day: outcome.task.day,
                        text,
                        source,
                    },
                }
            }
            _ => return Vec::new(),
        };
        if command.validate(world).is_ok() { vec![command] } else { Vec::new() }
    }
}

pub fn text_result(outcome: &AiOutcome) -> Option<String> {
    let p = outcome.accepted().or(outcome.task.offline.as_ref())?;
    match p {
        Proposal::Ripple(p) => Some(p.summary.clone()),
        Proposal::Narration(_) | Proposal::Letter(_) | Proposal::AltChronicle(_) | Proposal::Diary(_) => {
            text::body(p).map(str::to_owned)
        }
        Proposal::Persona(p) => Some(p.reply.clone()),
        Proposal::Daily(p) => {
            let TaskExtra::F9(ctx) = &outcome.task.extra else { return None };
            ctx.line(&p.template, outcome.task.day)
        }
        _ => None,
    }
}

pub fn static_check(proposal: &Proposal, defs: &manifest_core::StaticData) -> Result<(), String> {
    match proposal {
        Proposal::Ripple(p) => ai::check_text(&p.summary, 240).map_err(|_| "ai.text".into()),
        Proposal::Narration(_) | Proposal::Letter(_) | Proposal::AltChronicle(_) | Proposal::Diary(_) => {
            ai::check_text(text::body(proposal).unwrap_or(""), manifest_core::summary::text::TEXT_CHARS)
                .map_err(|_| "ai.text".into())
        }
        Proposal::Persona(p) => ai::check_text(&p.reply, ai::REPLY_CHARS).map_err(|_| "ai.text".into()),
        Proposal::Daily(p) => {
            if !ai::DAILY_TEMPLATES.iter().any(|t| t.key == p.template)
                || defs.cast.person(&p.person).is_none()
                || defs.find_loc(&p.loc).is_none()
                || p.season > 3
            {
                Err("ai.daily_context".into())
            } else {
                Ok(())
            }
        }
        _ => Err("ai.task_kind".into()),
    }
}
