//! 怪异与旧剧情共用故事窗口；夜间门槛只在应用时钟消费。
use crate::{story_view::*, views::Ctx};
use manifest_core::World;
fn speaker() -> SpeakerView {
    SpeakerView { kind: "none", mate: None, asset: None, person: None, portrait: None, name: String::new() }
}
pub(crate) fn visible(w: &World, minute: u16) -> bool {
    w.creature_pending().is_some_and(|(_, c)| !c.when.night || !(360..1080).contains(&minute))
}
pub(crate) fn pending(ctx: Ctx<'_>, w: &World) -> Option<StoryEventView> {
    let (e, source) = w.creature_pending()?;
    let c = ctx.names.creatures.creature(&source.key)?;
    Some(StoryEventView {
        day: e.day,
        fleet: e.fleet.0,
        kind: if c.omens.is_empty() { "encounter" } else { "omen" },
        key: e.id.clone(),
        chapter: None,
        total: None,
        story: None,
        title: c.name.clone(),
        text: c.omen_text.clone().unwrap_or_else(|| c.text.clone()),
        speaker: speaker(),
        choices: c
            .responses
            .iter()
            .filter_map(|response| {
                let o = c.outcomes.get(response)?;
                Some(StoryChoiceView {
                    key: Some(serde_json::to_value(response).ok()?.as_str()?.into()),
                    text: o.text.clone(),
                    cost: o.cost.cash,
                    give: None,
                    check: None,
                    blocked: w.creature_response_ready(*response).err().map(|error| ctx.error(&error)),
                    hint: None,
                    requires: vec![],
                    dice: Default::default(),
                })
            })
            .collect(),
        // 插画 key：前端只在 scenes/ 里有这张图时显示（生物图按 creature_<key> 命名）
        extra: StoryEventExtra {
            night: Some(c.when.night),
            art: Some(format!("creature_{}", source.key)),
            ..Default::default()
        },
    })
}
pub(crate) fn last(ctx: Ctx<'_>, w: &World) -> Option<StoryResultView> {
    let result = w.state.creatures.last_result.as_ref()?;
    let c = ctx.names.creatures.creature(&result.encounter.creature)?;
    let o = c.outcomes.get(&result.response)?;
    Some(StoryResultView {
        day: result.encounter.day,
        kind: "encounter",
        key: result.encounter.id.clone(),
        title: c.name.clone(),
        choice: Some(o.text.clone()),
        reply: o.reply.clone(),
        success: Some(true),
        outcomes: vec![
            StoryOutcomeView { kind: "damage", value: result.hull_lost, ..Default::default() },
            StoryOutcomeView { kind: "crew", value: -result.crew_lost, ..Default::default() },
        ],
        speaker: speaker(),
        ended: true,
    })
}
pub(crate) fn mask(w: &World, minute: u16, view: &mut Option<StoryView>) {
    if visible(w, minute) {
        return;
    }
    if let Some(view) = view
        && view.pending.as_ref().is_some_and(|p| w.state.creatures.pending.as_ref().is_some_and(|e| e.id == p.key))
    {
        view.pending = None;
    }
}
