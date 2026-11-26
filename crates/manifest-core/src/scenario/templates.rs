//! 模板从已加载的家庭、学院与人物引用派生；不另造一套开局资本。
use crate::{StaticData, upbringing::CompanionRole};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TemplateProfile {
    pub key: String,
    pub family: String,
    pub academies: Vec<String>,
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub flags: Vec<String>,
    pub path: Option<String>,
    pub titles: Vec<String>,
    pub voyage_flag: Option<String>,
    pub companions: BTreeMap<String, CompanionRole>,
    /// 模板对应的既有人物；人物仍按自己的日程与故事门槛活动。
    pub npcs: BTreeMap<String, Vec<String>>,
}

pub fn profile(defs: &StaticData, key: &str) -> Option<TemplateProfile> {
    let family = defs.upbringing.families.iter().find(|f| f.templates.iter().any(|t| t == key))?;
    let completion = family.completion.as_ref()?;
    let academies: BTreeSet<_> = family.stages.iter().filter_map(|s| s.academy.clone()).collect();
    let mut companions = family.companions.clone();
    for academy in defs.upbringing.academies.iter().filter(|a| academies.contains(&a.key)) {
        companions.extend(academy.companions.clone());
    }
    let npcs = defs
        .cast
        .persons
        .iter()
        .filter(|p| p.template.as_deref() == Some(key))
        .map(|p| {
            let mut tracks: BTreeSet<String> =
                p.npc_track.iter().chain(&p.bond_track).chain(&p.tracks).cloned().collect();
            tracks.extend(
                defs.story2
                    .tracks
                    .iter()
                    .filter(|t| t.source.replace('\\', "/").contains("/npc/") && t.cast.contains(&p.key))
                    .map(|t| t.key.clone()),
            );
            (p.key.clone(), tracks.into_iter().collect())
        })
        .collect();
    let titles = completion
        .defaults
        .path
        .as_ref()
        .and_then(|key| defs.upbringing.paths.iter().find(|p| &p.key == key))
        .map(|p| p.award.titles.clone())
        .unwrap_or_default();
    Some(TemplateProfile {
        key: key.into(),
        family: family.key.clone(),
        academies: academies.into_iter().collect(),
        growth: completion.defaults.growth.clone(),
        skills: completion.defaults.skills.clone(),
        flags: completion.defaults.flags.clone(),
        path: completion.defaults.path.clone(),
        titles,
        voyage_flag: completion.capital.grant_once.clone(),
        companions,
        npcs,
    })
}

pub fn validate(defs: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    for scenario in &defs.scenarios {
        for template in &scenario.template_defs {
            let families: Vec<_> = defs
                .upbringing
                .families
                .iter()
                .filter(|f| f.scenario == scenario.key && f.templates.contains(&template.key))
                .collect();
            if families.len() > 1 {
                errors.push(format!("{}: 模板重复归属养成家庭", template.key));
            }
            let Some(family) = families.first() else {
                continue;
            };
            if template.card.as_ref().is_some_and(|card| {
                !card.academy.key.is_empty()
                    && !family.stages.iter().any(|s| s.academy.as_ref() == Some(&card.academy.key))
            }) {
                errors.push(format!("{}: 开局卡片的学院与家庭不一致", template.key));
            }
            if let Some(completion) = &family.completion {
                if completion.defaults.path.as_ref().is_some_and(|p| !completion.paths.contains(p)) {
                    errors.push(format!("{}: 缺省志向不属于本家庭", template.key));
                }
                for key in &completion.paths {
                    if let Some(path) = defs.upbringing.paths.iter().find(|p| &p.key == key)
                        && path.capital.grant_once != completion.capital.grant_once
                    {
                        errors.push(format!("{}: 志向 {} 的一次性出航旗标与家庭不一致", template.key, key));
                    }
                }
            }
        }
    }
    errors
}
