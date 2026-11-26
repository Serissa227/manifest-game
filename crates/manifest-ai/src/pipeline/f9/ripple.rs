//! 时间线涟漪复用组合事件词表；事件预算、结局与消费状态由内核再次核验。
use super::*;
use crate::proposal::ComposedEventProposal;
use manifest_core::{
    composed::ComposedSource,
    summary::ripple::{self, RippleEvent, RippleResult},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RippleProposal {
    pub summary: String,
    pub events: Vec<ComposedEventProposal>,
}

pub fn schema(defs: &manifest_core::StaticData) -> Value {
    let mut event = crate::schema::output_schema(ProposalKind::Composed, defs).schema;
    let definitions = event.as_object_mut().and_then(|object| object.remove("$defs"));
    let mut schema = object(
        json!({"summary":{"type":"string","maxLength":240},"events":{"type":"array","maxItems":ripple::MAX_RIPPLES,"items":event}}),
    );
    if let Some(definitions) = definitions {
        schema["$defs"] = definitions;
    }
    schema
}

pub fn resolve(defs: &manifest_core::StaticData, p: &RippleProposal) -> Result<Vec<RippleEvent>, String> {
    p.events
        .iter()
        .map(|event| {
            Ok(RippleEvent {
                title: event.title.clone(),
                text: event.narrative.clone(),
                effects: event
                    .effects
                    .iter()
                    .map(|effect| crate::resolve::resolve_composed_effect(defs, effect))
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect()
}

pub fn static_check(p: &RippleProposal, ctx: &AdjudicationContext) -> Result<(), String> {
    ai::check_text(&p.summary, 240).map_err(|_| "ai.text".to_string())?;
    if p.events.len() > ripple::MAX_RIPPLES {
        return Err("ai.ripple_count".into());
    }
    for event in &p.events {
        if !crate::adjudicator::check_composed(event, ctx).is_empty() {
            return Err("ai.ripple_effect".into());
        }
    }
    Ok(())
}

impl AiPipeline {
    pub(in crate::pipeline) fn prepare_ripple(&self, world: &World, event: String) -> Option<AiTask> {
        let (outcome, resolved, budget) = ripple::available(world, &event)?;
        let def = world.defs.history.event(&event)?;
        let actual = def.outcomes.iter().find(|o| o.key == outcome)?;
        let templates = self.content.templates.f9.get("ripple")?.clone();
        let outcome_text = if actual.chronicle.chars().count() <= 100 {
            actual.chronicle.clone()
        } else {
            actual
                .chronicle
                .split_inclusive(['。', '\n'])
                .find(|line| line.chars().count() <= 100)
                .unwrap_or("")
                .to_owned()
        };
        let params = BTreeMap::from([("event".into(), def.title.clone()), ("outcome".into(), outcome_text)]);
        let locs = world
            .defs
            .locations
            .iter()
            .enumerate()
            .filter(|(index, _)| world.location_visible(LocId::from_idx(*index)))
            .map(|(_, l)| l.key.clone())
            .collect::<Vec<_>>();
        let ctx = F9Context {
            binding: runtime::binding(world),
            guard: guard::Guard::new(world),
            request: RequestContext::Ripple {
                event: event.clone(),
                outcome: outcome.clone(),
                resolved,
                budget,
                locs,
                defs: world.defs.clone(),
            },
            params,
            templates,
        };
        let summary = ctx.line("result", world.day())?;
        let mut events = Vec::new();
        if budget > 0
            && let Some(candidate) = crate::offline::composed(world, &self.content.templates)
        {
            let proposal = RippleProposal { summary: summary.clone(), events: vec![candidate] };
            if ctx.check(&Proposal::Ripple(proposal.clone())).is_ok()
                && let Ok(resolved_events) = resolve(&world.defs, &proposal)
            {
                let result = RippleResult {
                    event: event.clone(),
                    outcome: outcome.clone(),
                    resolved_day: resolved,
                    requested_day: world.day(),
                    summary: summary.clone(),
                    events: resolved_events,
                    source: ComposedSource::Template,
                };
                if ripple::check(world, &result).is_ok() {
                    events = proposal.events;
                }
            }
        }
        let vars=BTreeMap::from([
            ("summary".into(),json!({"event":def.title,"date":manifest_core::summary::text::date(world,resolved),"outcome":actual.chronicle,"ripple_budget":budget}).to_string()),
            ("world_lore".into(),self.content.lore.summary.clone()),
            ("world_terms".into(),format!("{}\n{}",self.content.lore.terms,context::known_catalog(world,3000))),
            ("world_taboos".into(),self.content.lore.taboos.clone()),
            ("calendar".into(),manifest_core::summary::world_date_text_in(&world.defs.rules.world,&world.defs.calendar,world.day())),
        ]);
        let mut task = AiTask {
            kind: ProposalKind::Ripple,
            day: world.day(),
            vars,
            offline: Some(Proposal::Ripple(RippleProposal { summary, events })),
            offline_tpl: None,
            ctx: AdjudicationContext {
                defs: world.defs.clone(),
                relations: world.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
            },
            extra: TaskExtra::F9(Box::new(ctx)),
        };
        self.f9_language_vars(world, &mut task.vars);
        Some(task)
    }
    pub(super) fn finalize_ripple(&self, world: &World, outcome: &AiOutcome) -> Vec<Command> {
        let Some(Proposal::Ripple(p)) = outcome.accepted() else {
            return Vec::new();
        };
        let TaskExtra::F9(ctx) = &outcome.task.extra else {
            return Vec::new();
        };
        if ctx.check(&Proposal::Ripple(p.clone())).is_err() {
            return Vec::new();
        }
        let RequestContext::Ripple { event, outcome: actual, resolved, .. } = &ctx.request else {
            return Vec::new();
        };
        let Ok(events) = resolve(&world.defs, p) else {
            return Vec::new();
        };
        let source = if matches!(outcome.source, Some(ProposalSource::Llm | ProposalSource::Cache)) {
            ComposedSource::Model
        } else {
            ComposedSource::Template
        };
        let command = Command::ApplyRipple {
            result: RippleResult {
                event: event.clone(),
                outcome: actual.clone(),
                resolved_day: *resolved,
                requested_day: outcome.task.day,
                summary: p.summary.clone(),
                events,
                source,
            },
        };
        if command.validate(world).is_ok() { vec![command] } else { Vec::new() }
    }
}

/// 专名目录仅暴露当前可见地点；发现物不属于涟漪的可选目标。
pub fn narrow_schema(schema: &mut Value, locs: &[String]) {
    for key in ["loc", "port", "site"] {
        if let Some(values) = schema
            .get_mut("$defs")
            .and_then(|defs| defs.get_mut(key))
            .and_then(|definition| definition.get_mut("enum"))
            .and_then(Value::as_array_mut)
        {
            values.retain(|v| v.as_str().is_some_and(|k| locs.iter().any(|known| known == k)));
        }
    }
    let mut excluded = std::collections::BTreeSet::new();
    if let Some(defs) = schema.get_mut("$defs").and_then(Value::as_object_mut) {
        defs.retain(|key, definition| {
            let keep =
                key != "discovery" && !definition.get("enum").and_then(Value::as_array).is_some_and(Vec::is_empty);
            if !keep {
                excluded.insert(format!("#/$defs/{key}"));
            }
            keep
        });
    }
    let empty = schema
        .pointer_mut("/properties/events/items/properties/effects/items/anyOf")
        .and_then(Value::as_array_mut)
        .is_some_and(|variants| {
            variants.retain(|variant| {
                variant.get("properties").and_then(Value::as_object).is_some_and(|properties| {
                    !properties.contains_key("discovery")
                        && !properties.values().any(|value| {
                            value.get("$ref").and_then(Value::as_str).is_some_and(|key| excluded.contains(key))
                        })
                })
            });
            variants.is_empty()
        });
    if empty {
        // 没有可用效果时仍可提交零个涟漪；不可发送 anyOf: [] 或 enum: [] 这样的无效 schema。
        if let Some(items) = schema.pointer_mut("/properties/events/items/properties/effects/items") {
            *items = object(json!({}));
        }
        if let Some(events) = schema.pointer_mut("/properties/events").and_then(Value::as_object_mut) {
            events.insert("maxItems".into(), json!(0));
        }
    }
    if schema.get("$defs").and_then(Value::as_object).is_some_and(serde_json::Map::is_empty)
        && let Some(root) = schema.as_object_mut()
    {
        root.remove("$defs");
    }
}

/// 语境内的效果目标不允许指向模型没有获知的地点。
pub fn check_context(
    p: &RippleProposal,
    locs: &[String],
    budget: u32,
    defs: &manifest_core::StaticData,
) -> Result<(), String> {
    for event in &p.events {
        for effect in &event.effects {
            let value = serde_json::to_value(effect).map_err(|_| "ai.ripple_effect".to_string())?;
            if value.get("loc").and_then(Value::as_str).is_some_and(|loc| !locs.iter().any(|known| known == loc))
                || value.get("discovery").is_some()
            {
                return Err("ai.ripple_target".into());
            }
        }
    }
    let resolved = resolve(defs, p)?;
    if ripple::cost(&resolved).is_none_or(|cost| cost > budget) {
        return Err("ai.ripple_budget".into());
    }
    Ok(())
}
