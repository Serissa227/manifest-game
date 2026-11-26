//! 主角身份决定轨道归属；人物船只是日程的只读投影，不创建经济主体。
use super::PersonKind;
use crate::{Cell, LocId, World};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PersonFleet {
    pub person: String,
    pub loc: LocId,
    pub cell: Cell,
    pub ships: Vec<String>,
}

impl World {
    pub(crate) fn excluded_protagonist_tracks(&self) -> std::collections::BTreeSet<String> {
        let selected = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        self.defs
            .cast
            .persons
            .iter()
            .filter(|p| p.kind == PersonKind::Protagonist)
            .filter_map(|p| if selected == Some(p.key.as_str()) { p.npc_track.clone() } else { p.main_track.clone() })
            .collect()
    }
    /// 不替作者开轨道：auto、门槛旗标、日期仍由故事定义决定。
    pub fn protagonist_track_allowed(&self, track: &str) -> bool {
        let selected = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        self.defs.cast.persons.iter().filter(|p| p.kind == PersonKind::Protagonist).all(|p| {
            (p.main_track.as_deref() != Some(track) || selected == Some(p.key.as_str()))
                && (p.npc_track.as_deref() != Some(track) || selected != Some(p.key.as_str()))
        })
    }

    /// 可供海图和遭遇使用。同行、死亡、未出航或当前无日程者没有独立人物船。
    pub fn person_fleets(&self) -> Vec<PersonFleet> {
        let selected = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        let mut fleets = Vec::new();
        for person in &self.defs.cast.persons {
            if person.kind != PersonKind::Protagonist
                || selected == Some(person.key.as_str())
                || self.person_in_team(&person.key)
            {
                continue;
            }
            let Some(family) = person.family.as_deref().and_then(|key| self.defs.upbringing.family(key)) else {
                continue;
            };
            if self.cast_date() < family.graduation {
                continue;
            }
            let Some(capital) = family.completion.as_ref().map(|c| &c.capital) else { continue };
            let Some(at) = self.person_place(&person.key) else { continue };
            if capital.ships.is_empty() {
                continue;
            }
            fleets.push(PersonFleet {
                person: person.key.clone(),
                loc: at.loc,
                cell: self.defs.loc(at.loc).cell,
                ships: capital.ships.clone(),
            });
        }
        fleets.sort_by(|a, b| a.person.cmp(&b.person));
        fleets
    }
}
