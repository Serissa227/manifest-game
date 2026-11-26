//! I10 文字投影：模型记录优先；没有 AI 执行器时也能按世界模板展示离线结果。
use crate::views::Ctx;
use manifest_core::{
    World,
    summary::{
        ai::AiSource,
        text::{self, TextTarget},
    },
};

pub(crate) fn get(ctx: Ctx<'_>, world: &World, target: &TextTarget) -> Option<(String, bool)> {
    project(ctx, world, target)
        .map(|(text, ai)| (crate::navigation_view::visibility::redact_text(ctx, world, &text), ai))
}

fn project(ctx: Ctx<'_>, world: &World, target: &TextTarget) -> Option<(String, bool)> {
    if let Some(record) = world.state.cast.ai.texts.get(&target.key()) {
        let visible = match target {
            TextTarget::Narration { event, .. } => {
                world.defs.history.event(event).is_some_and(|e| world.history_event_known(e))
                    && world.state.history.events.get(event).is_none_or(|s| !s.closed)
            }
            TextTarget::Letter { id, .. } => world.known_news(None).iter().any(|n| n.id == *id),
            TextTarget::AltChronicle { year } => *year < world.cast_date()[0],
            TextTarget::Diary { year, month } => {
                let today = world.cast_date();
                [*year, *month] < [today[0], today[1]]
            }
        };
        if !visible {
            return None;
        }
        if ctx.model_text && record.source == AiSource::Model {
            return Some((record.text.clone(), true));
        }
        let line = ctx
            .ai_templates
            .and_then(|t| t.texts.get(target.kind()))
            .and_then(|t| t.get(&record.section))
            .and_then(|t| t.get(record.variant));
        let result = line
            .map(|line| manifest_ai::pipeline::f9::fill(line, &record.params))
            .filter(|text| manifest_core::summary::ai::check_text(text, text::TEXT_CHARS).is_ok())
            .unwrap_or_else(|| record.fallback.clone());
        return Some((result, false));
    }
    let snapshot = text::snapshot(world, target)?;
    let templates = ctx.ai_templates?;
    let sections = templates.texts.get(target.kind())?;
    let lines = sections.get(&snapshot.section).or_else(|| sections.get("voice_generic"))?;
    let variant = u32::from_str_radix(snapshot.proof.get(..8)?, 16).ok()? as usize;
    let line = lines.get(variant % lines.len().max(1))?;
    let result = manifest_ai::pipeline::f9::fill(line, &snapshot.params);
    manifest_core::summary::ai::check_text(&result, text::TEXT_CHARS).ok()?;
    Some((result, false))
}

#[cfg(test)]
#[path = "ai_text_view_tests.rs"]
mod tests;
