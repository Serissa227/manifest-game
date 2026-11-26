use super::*;
use crate::{
    StaticData,
    story2::{Condition, Effect},
};
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActIndex {
    pub tracks: BTreeMap<String, MarkerIndex>,
    /// 静态资格通过但没有人物的轨道 → 所属家庭（内容补充入口）。
    pub unresolved: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarkerIndex {
    pub family: String,
    pub person: String,
    pub category: String,
    pub chapters: BTreeMap<String, bool>,
    pub places: BTreeMap<String, String>,
}
fn requirement_flags(r: &Requirements, out: &mut BTreeSet<String>) {
    out.extend(r.flag.iter().cloned());
    for child in r.all.iter().chain(&r.any) {
        requirement_flags(child, out);
    }
}
fn owner<'a>(defs: &'a StaticData, t: &crate::story2::TrackDef) -> Option<&'a FamilyDef> {
    defs.upbringing.families.iter().find(|f| {
        t.key.contains(&format!("_{}_", f.key))
            || t.source.contains(&format!("/families/{}", f.key))
            || t.chapters.iter().flat_map(|c| &c.when).any(|c| match c {
                Condition::Protagonist { protagonist } => f.protagonists.contains(protagonist),
                _ => false,
            })
    })
}
fn infer_person(defs: &StaticData, t: &crate::story2::TrackDef, family: Option<&FamilyDef>) -> Option<String> {
    let explicit = defs.upbringing.act_markers.iter().find(|m| m.track == t.key);
    if let Some(person) = explicit.and_then(|m| m.person.as_ref()) {
        return Some(person.clone());
    }
    if let Some(person) = defs.upbringing.event_gates.get(&t.key).and_then(|g| g.actors.first()) {
        return Some(person.clone());
    }
    if let Some(person) = t.cast.first() {
        return Some(person.clone());
    }
    if let Some(person) = t.chapters.iter().find_map(|c| c.cast.first().or(c.speaker.as_ref())) {
        return Some(person.clone());
    }
    let mut suffix =
        ["_rw_", "_side_", "_family_bond_"].into_iter().find_map(|p| t.key.split_once(p).map(|(_, s)| s))?;
    let mut companions = BTreeSet::new();
    if let Some(f) = family {
        companions.extend(f.companions.keys().cloned());
        for route in std::iter::once(f).chain(f.routed.iter().map(|(_, v)| v)) {
            for a in route.stages.iter().filter_map(|s| s.academy.as_deref()).filter_map(|k| defs.upbringing.academy(k))
            {
                companions.extend(a.companions.keys().cloned());
            }
        }
    }
    loop {
        if defs.cast.person(suffix).is_some() {
            return Some(suffix.into());
        }
        let matches: Vec<_> = companions.iter().filter(|p| p.ends_with(&format!("_{suffix}"))).collect();
        if matches.len() == 1 {
            return Some(matches[0].clone());
        }
        match suffix.rsplit_once('_') {
            Some((head, _)) => suffix = head,
            None => return None,
        }
    }
}
pub fn build_index(defs: &StaticData) -> ActIndex {
    let mut readers = BTreeMap::<String, BTreeSet<String>>::new();
    for t in &defs.story2.tracks {
        for c in &t.chapters {
            for condition in c.when.iter().chain(c.choices.iter().flat_map(|o| &o.requires)) {
                if let Condition::Flag { flag, .. } = condition {
                    readers.entry(flag.clone()).or_default().insert(t.key.clone());
                }
            }
        }
    }
    let mut external = BTreeSet::new();
    for e in &defs.upbringing.endings {
        requirement_flags(&e.requirements, &mut external);
    }
    for p in &defs.upbringing.paths {
        requirement_flags(&p.requirements, &mut external);
        requirement_flags(&p.reveal, &mut external);
    }
    for f in &defs.upbringing.families {
        external.extend(f.routes.iter().map(|r| r.flag.clone()));
    }
    let mut out = ActIndex::default();
    for (key, g) in &defs.upbringing.event_gates {
        let Some(t) = defs.story2.track(key) else { continue };
        let Some(c) = t.chapter(&t.start) else { continue };
        let custom = defs.upbringing.act_markers.iter().find(|m| m.track == *key);
        let category = infer_event_category(key, Some(g));
        if g.festival.is_some()
            || g.activity.is_some()
            || g.letter_received
            || g.remote_cast
            || g.mail_route.is_some()
            || c.deadline_days.is_some_and(|d| d < 28)
            || c.window.is_some_and(|w| {
                crate::scenario::day_of(defs, w[0])
                    .ok()
                    .zip(crate::scenario::day_of(defs, w[1]).ok())
                    .is_some_and(|(a, b)| b.saturating_sub(a) < 28)
            })
            || [
                "critical",
                "festival",
                "birthday",
                "calendar",
                "academy",
                "letter",
                "news",
                "daily",
                "festival_pool",
                "omen",
                "first",
                "placeholder",
                "low_mood",
                "illness",
                "job_followup",
            ]
            .contains(&category)
            || custom.is_some_and(|m| m.marker == Some(false))
        {
            continue;
        }
        let family = owner(defs, t);
        let Some(person) = infer_person(defs, t, family) else {
            out.unresolved.insert(key.clone(), family.map_or("", |f| f.key.as_str()).into());
            continue;
        };
        let chapters=t.chapters.iter().map(|c| {
            let key_chapter=custom.and_then(|m|m.key.as_ref()).map_or_else(|| {
                crate::story2::graph::branches(c).iter().flat_map(|b|&b.effects).any(|e| {
                    matches!(e,Effect::Flag{flag,value:true} if external.contains(flag) || readers.get(flag).is_some_and(|r|r.iter().any(|other|other!=key)))
                })
            },|keys|keys.contains(&c.key));
            (c.key.clone(),key_chapter)
        }).collect();
        out.tracks.insert(
            key.clone(),
            MarkerIndex {
                family: family.map_or("", |f| f.key.as_str()).into(),
                person,
                category: category.into(),
                chapters,
                places: custom.map(|m| m.places.clone()).unwrap_or_default(),
            },
        );
    }
    out
}
