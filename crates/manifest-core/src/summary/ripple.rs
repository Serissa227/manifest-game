//! 一个历史结局的一次涟漪预算；整批先在临时世界校验，不能留下半个事件。
use super::ai::{blocked, check_text};
use crate::{
    CommandError, Fx, World,
    composed::{ComposedEffect, ComposedSource},
};
use serde::{Deserialize, Serialize};

pub const MAX_RIPPLES: usize = 2;
pub const RIPPLE_DAYS: u32 = 30;
pub const MAX_BUDGET: u32 = 20_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RippleEvent {
    pub title: String,
    pub text: String,
    pub effects: Vec<ComposedEffect>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RippleResult {
    pub event: String,
    pub outcome: String,
    pub resolved_day: u32,
    pub requested_day: u32,
    pub summary: String,
    pub events: Vec<RippleEvent>,
    pub source: ComposedSource,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RippleReceipt {
    pub day: u32,
    pub spent: u32,
    pub summary: String,
    pub source: ComposedSource,
}

/// 预算单位为万分点；每条效果至少花费 100 点，整数变化每点折合 100 点，无幅度参数花费 10000 点。
pub fn cost(events: &[RippleEvent]) -> Option<u32> {
    events.iter().flat_map(|event| &event.effects).try_fold(0_u32, |total, e| {
        let amount = if let Some(mult) = e.params.mult {
            mult.raw().checked_sub(Fx::SCALE)?.checked_abs()?
        } else if let Some(delta) = e.params.delta {
            delta.checked_abs()?.checked_mul(100)?
        } else {
            10_000
        };
        total.checked_add(u32::try_from(amount.max(100)).ok()?)
    })
}

pub fn available(world: &World, event: &str) -> Option<(String, u32, u32)> {
    let def = world.defs.history.event(event).filter(|e| world.history_event_known(e))?;
    if def.ripple_budget > MAX_BUDGET {
        return None;
    }
    let state = world.state.history.events.get(event)?;
    let resolved = state.resolved_day?;
    if state.closed || state.ripple.is_some() || world.day().checked_sub(resolved).is_none_or(|age| age > RIPPLE_DAYS) {
        return None;
    }
    let outcome = state.outcome.as_ref()?;
    def.outcomes.iter().find(|o| o.key == *outcome)?;
    Some((outcome.clone(), resolved, def.ripple_budget))
}

pub fn check(world: &World, result: &RippleResult) -> Result<Box<crate::world::WorldState>, CommandError> {
    check_text(&result.summary, 240)?;
    let (outcome, resolved, budget) = available(world, &result.event).ok_or_else(|| blocked("ai.ripple_event"))?;
    if result.outcome != outcome
        || result.source == ComposedSource::Rule
        || result.resolved_day != resolved
        || result.events.len() > MAX_RIPPLES
        || world.day().checked_sub(result.requested_day).is_none_or(|age| age > 1)
    {
        return Err(blocked("ai.ripple_context"));
    }
    let spent = cost(&result.events).filter(|cost| *cost <= budget).ok_or_else(|| blocked("ai.ripple_budget"))?;
    let mut trial = world.clone();
    for (index, event) in result.events.iter().enumerate() {
        check_text(&event.title, trial.defs.composed.max_title_chars)?;
        check_text(&event.text, trial.defs.composed.max_text_chars)?;
        if event.effects.iter().any(|effect| {
            effect.params.discovery.is_some()
                || effect
                    .params
                    .loc
                    .is_some_and(|loc| trial.defs.locations.get(loc.idx()).is_none() || !trial.location_visible(loc))
        }) {
            return Err(blocked("ai.ripple_target"));
        }
        trial
            .validate_composed_in_batch(&event.title, &event.text, &event.effects, index > 0)
            .map_err(|_| blocked("ai.ripple_bounds"))?;
        trial
            .start_composed(&event.title, &event.text, &event.effects, result.source)
            .map_err(|_| blocked("ai.ripple_effect"))?;
    }
    trial.state.history.events.get_mut(&result.event).ok_or_else(|| blocked("ai.ripple_event"))?.ripple =
        Some(RippleReceipt { day: world.day(), spent, summary: result.summary.clone(), source: result.source });
    Ok(Box::new(trial.state))
}

pub fn valid_snapshot(world: &World) -> bool {
    world.state.history.events.iter().all(|(key, state)| {
        state.ripple.as_ref().is_none_or(|r| {
            world.defs.history.event(key).is_some_and(|e| r.spent <= e.ripple_budget && e.ripple_budget <= MAX_BUDGET)
                && state.resolved_day.is_some_and(|day| day <= r.day && r.day - day <= RIPPLE_DAYS)
                && state.outcome.is_some()
                && r.day <= world.day()
                && r.source != ComposedSource::Rule
                && check_text(&r.summary, 240).is_ok()
        })
    })
}
