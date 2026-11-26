//! 族裔的闭合能力与每条转化的逆转出口。
use super::*;
use crate::{StaticData, societies::validation::key};
use std::collections::BTreeSet;
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    if d.lineages.lineages.len() > 128 {
        errors.push("族裔目录超过128条".into());
    }
    for l in &d.lineages.lineages {
        let reverse = l.reversal.as_deref().is_none_or(|r| {
            d.story2.track(r).is_some_and(|t| {
                accessible_reversal(t, &l.key)
                    && t.chapters.iter().any(|c| {
                        crate::story2::graph::branches(c)
                            .iter()
                            .flat_map(|b| &b.effects)
                            .any(|e| matches!(e, crate::story2::Effect::Transform { lineage: None }))
                    })
                    && t.chapters.iter().all(|c| {
                        c.window.is_none()
                            && c.deadline.is_none()
                            && c.deadline_days.is_none()
                            && crate::story2::graph::branches(c).iter().flat_map(|b| &b.effects).all(|e| {
                                matches!(
                                    e,
                                    crate::story2::Effect::Transform { lineage: None }
                                        | crate::story2::Effect::Flag { .. }
                                        | crate::story2::Effect::Item { qty: i64::MIN..=-1, .. }
                                )
                            })
                    })
            })
        });
        if !key(&l.key)
            || !keys.insert(&l.key)
            || l.name.trim().is_empty()
            || l.origin.trim().is_empty()
            || !reverse
            || l.reversal.is_some() && l.reversal_note.as_ref().is_none_or(|s| s.trim().is_empty())
            || l.hunted_by.iter().any(|k| d.find_faction(k).is_none() && d.societies.society(k).is_none())
            || l.relations.iter().any(|r| r.lineage == l.key || d.lineages.lineage(&r.lineage).is_none())
            || l.powers.len() > 8
            || l.powers.iter().any(|p| match p {
                Power::NightSight { radius } => !(1..=4).contains(radius),
                Power::Fog { pct } => !(1..=20).contains(pct),
                Power::Ward { power } => !(1..=10).contains(power),
                Power::Spell { spell } => d.arcana.spell(spell).is_none(),
            })
            || l.daylight.as_ref().is_some_and(|s| {
                s.shade.is_empty()
                    || s.shade.iter().any(|t| !key(t))
                    || s.safe_weather
                        .iter()
                        .any(|k| !["cloudy", "overcast", "fog", "rain", "storm", "snow"].contains(&k.as_str()))
            })
        {
            errors.push(format!("{}：族裔引用、能力、遮蔽或逆转路径无效", l.key));
        }
    }
    for p in &d.societies.policies {
        if p.forbids.lineages.iter().any(|k| d.lineages.lineage(k).is_none()) {
            errors.push(format!("{}：违禁族裔不存在", p.faction));
        }
    }
    errors
}

// 逆转至少有一条不依赖财物、随机检定或会失效日期的路径；防止只声明了一个永远到不了的解药。
fn accessible_reversal(t: &crate::story2::TrackDef, lineage: &str) -> bool {
    use crate::story2::{Condition, Effect};
    let allowed = |c: &Condition| matches!(c,Condition::Lineage{lineage:k,person:None} if k==lineage);
    let mut todo = vec![t.start.as_str()];
    let mut seen = BTreeSet::new();
    while let Some(k) = todo.pop() {
        if !seen.insert(k) {
            continue;
        }
        let Some(c) = t.chapter(k) else { continue };
        if c.at.is_some()
            || !c.venue.is_empty()
            || !c.objectives.is_empty()
            || c.window.is_some()
            || c.deadline.is_some()
            || c.deadline_days.is_some()
            || !c.when.iter().all(allowed)
        {
            continue;
        }
        let witness = c
            .default
            .iter()
            .filter(|_| c.stage == Some(crate::story2::Stage::Witness) && c.choices.is_empty())
            .cloned();
        for b in c
            .choices
            .iter()
            .filter(|o| o.requires.iter().all(allowed) && o.check.is_none())
            .map(|o| o.branch())
            .chain(witness)
        {
            if b.effects.iter().any(|e| matches!(e, Effect::Item { .. })) {
                continue;
            }
            if b.effects.iter().any(|e| matches!(e, Effect::Transform { lineage: None })) {
                return true;
            }
            if let Some(next) = t.chapter(&b.next) {
                todo.push(&next.key);
            }
        }
    }
    false
}
