//! 原生远足、比赛与交接信物也只投影实际获得的回忆。
use super::*;
pub(super) fn memory(ctx: Ctx<'_>, w: &World, key: &str, title: &str) -> Option<(String, String, Option<String>)> {
    let state = w.state.upbringing.as_ref()?;
    for e in &w.defs.upbringing.excursions {
        for n in &e.nodes {
            let progress = state.excursion_progress.get(&e.key).and_then(|p| p.get(&n.key)).map_or(0, |p| p.step);
            for (index, step) in n.steps.iter().enumerate().take(usize::from(progress)) {
                if step.memory.as_deref() != Some(key) || step.name != title {
                    continue;
                }
                let display = ctx.names.upbringing.excursions.iter().find(|v| v.key == e.key)?;
                let node = display.nodes.iter().find(|v| v.key == n.key)?;
                let step = node.steps.get(index)?;
                return Some((step.name.clone(), step.text.clone(), None));
            }
        }
    }
    for c in &w.defs.upbringing.contests {
        if c.name == title
            && c.rewards.iter().any(|r| {
                r.memory.as_deref() == Some(key)
                    && state.contest_results.values().any(|v| v.contest == c.key && v.rank == r.rank)
            })
        {
            let name = ctx.names.upbringing.contests.iter().find(|v| v.key == c.key)?.name.clone();
            return Some((name.clone(), name, None));
        }
    }
    // U04 工作包 5：年度目标的回忆奖励，标题与正文取目标文字（空时界面回退通用语）。
    if let Some(g) = w.upbringing_annual_goals().into_iter().find(|g| {
        state.goals.get(&g.key).is_some_and(|st| st.status == GoalStatus::Done)
            && g.rewards
                .iter()
                .any(|e| matches!(e, manifest_core::story2::Effect::Memory { memory, .. } if memory == key))
    }) {
        let text = ctx
            .names
            .upbringing
            .annual_goals
            .iter()
            .find(|v| v.key == g.key)
            .map_or_else(String::new, |v| v.text.clone());
        return Some((text.clone(), text, None));
    }
    let graduation = state.graduation.as_ref()?;
    if graduation.supplementary.iter().any(|ending| ending == key)
        && w.defs.upbringing.endings.iter().any(|e| e.key == key && e.title == title)
    {
        let display = ctx.names.upbringing.endings.iter().find(|e| e.key == key)?;
        return Some((display.title.clone(), display.text.clone(), None));
    }
    let (capital, display) = if graduation.path_fulfilled {
        let path = graduation.path.as_ref()?;
        (
            &w.defs.upbringing.paths.iter().find(|p| &p.key == path)?.capital,
            &ctx.names.upbringing.paths.iter().find(|p| &p.key == path)?.capital,
        )
    } else {
        (
            &w.defs.upbringing.family(&state.family)?.completion.as_ref()?.capital,
            &ctx.names.upbringing.family(&state.family)?.completion.as_ref()?.capital,
        )
    };
    if let Some(i) = capital.mementos.iter().position(|m| m.key == key && m.name == title) {
        let m = display.mementos.get(i)?;
        return Some((m.name.clone(), m.description.clone(), None));
    }
    if let Some(i) = capital.rumored.iter().position(|r| format!("rumored_region_{}", r.key) == key && r.name == title)
    {
        let r = display.rumored.get(i)?;
        return Some((r.name.clone(), r.name.clone(), None));
    }
    None
}
