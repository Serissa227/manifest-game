//! 同学的毕业记录只保存实际相识与已有经历；离别之后第一次同处一地才算重逢。
use super::relations::Affection;
use crate::{World, upbringing::CompanionRole};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchoolMemory {
    pub family: String,
    pub academies: Vec<String>,
    pub graduated_on: u32,
    pub affection: Affection,
    pub promise: bool,
    pub memories: Vec<String>,
    pub parted: bool,
    pub reunited_on: Option<u32>,
}

impl World {
    pub(crate) fn remember_schoolmates(&mut self) {
        let Some(family) = self.upbringing_family() else {
            return;
        };
        let family_key = family.key.clone();
        let mut classmates: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for stage in family
            .stages
            .iter()
            .filter(|s| s.from <= self.cast_date() && s.entry_flag.as_ref().is_none_or(|f| self.upbringing_flag(f)))
        {
            let Some(academy) =
                stage.academy.as_ref().and_then(|key| self.defs.upbringing.academies.iter().find(|a| &a.key == key))
            else {
                continue;
            };
            for (person, role) in &academy.companions {
                if matches!(role, CompanionRole::Classmate | CompanionRole::Rival | CompanionRole::Friend) {
                    classmates.entry(person.clone()).or_default().push(academy.key.clone());
                }
            }
        }
        let day = self.day();
        for (key, mut academies) in classmates {
            let parted = !self.person_here(&key) && !self.person_in_team(&key);
            let Some(person) = self.state.cast.persons.get_mut(&key) else {
                continue;
            };
            if !person.met || person.school.is_some() {
                continue;
            }
            academies.sort();
            academies.dedup();
            person.school = Some(SchoolMemory {
                family: family_key.clone(),
                academies,
                graduated_on: day,
                affection: person.affection.clone(),
                promise: self.state.cast.promise.as_deref() == Some(&key),
                memories: person.interactions.memories.clone(),
                parted,
                reunited_on: None,
            });
        }
    }

    pub(crate) fn meet_schoolmates(&mut self) {
        let day = self.day();
        let updates: Vec<_> = self
            .state
            .cast
            .persons
            .iter()
            .filter_map(|(key, p)| {
                let memory = p.school.as_ref()?;
                if day <= memory.graduated_on || memory.reunited_on.is_some() || self.person_in_team(key) {
                    return None;
                }
                Some((key.clone(), self.person_here(key)))
            })
            .collect();
        for (key, here) in updates {
            if let Some(memory) = self.state.cast.persons.get_mut(&key).and_then(|p| p.school.as_mut()) {
                if !here {
                    memory.parted = true;
                } else if memory.parted {
                    memory.reunited_on = Some(day);
                }
            }
        }
    }

    pub(crate) fn valid_school_memories(&self) -> bool {
        self.state.cast.persons.values().filter_map(|p| p.school.as_ref()).all(|m| {
            m.graduated_on <= self.day()
                && !m.family.is_empty()
                && !m.academies.is_empty()
                && m.academies.windows(2).all(|pair| pair[0] < pair[1])
                && m.reunited_on.is_none_or(|d| m.parted && d > m.graduated_on && d <= self.day())
                && (0..=100).contains(&m.affection.affinity)
                && (0..=100).contains(&m.affection.heart)
        })
    }
}
