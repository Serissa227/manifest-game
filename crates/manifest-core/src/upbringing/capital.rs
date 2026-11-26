//! C12 原定实物、见识与故事信物在结业时交接，不折算成额外现金。
use crate::{
    ledger::{Account, CashClass, JournalEntry, Memo},
    *,
};
use serde::Deserialize;
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeArea {
    pub key: String,
    pub name: String,
    pub regions: Vec<String>,
    #[serde(default)]
    pub clip_arcmin: Option<[i32; 4]>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Memento {
    pub key: String,
    pub name: String,
    pub description: String,
    pub kind: String,
    pub transferable: bool,
    pub consumable: bool,
    #[serde(default)]
    pub item: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Estate {
    pub kind: String,
    pub industry: String,
    pub loc: String,
    pub good: String,
    pub level: i64,
    pub workers: i64,
    pub source: String,
    pub grant_once: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaravanCapital {
    pub loc: String,
    pub animal: String,
    pub capacity: i64,
    pub guards: i64,
    pub cargo: std::collections::BTreeMap<String, i64>,
    pub cash: i64,
    pub source: String,
    pub grant_once: String,
}
pub(super) fn valid(d: &StaticData, c: &super::Capital) -> bool {
    c.source.as_deref().is_none_or(|v| v == "family_capital")
        && c.grant_once.as_ref().is_none_or(|s| !s.is_empty())
        && c.known.iter().chain(&c.rumored).all(|a| {
            !a.key.is_empty()
                && !a.name.is_empty()
                && !a.regions.is_empty()
                && a.regions.iter().all(|k| d.regions.iter().any(|r| &r.key == k))
                && a.clip_arcmin
                    .is_none_or(|[w, s, e, n]| w < e && s < n && w >= -10800 && e <= 10800 && s >= -5400 && n <= 5400)
                && (a.clip_arcmin.is_none() || d.nav.grid.rules().and_then(|r| r.projection.as_ref()).is_some())
        })
        && c.mementos.iter().all(|m| {
            !m.key.is_empty()
                && !m.name.is_empty()
                && !m.description.is_empty()
                && m.kind == "story_keepsake"
                && !m.transferable
                && !m.consumable
                && m.item.as_ref().is_none_or(|k| c.items.contains_key(k))
        })
        && c.estate.as_ref().is_none_or(|e| {
            e.source == "family_capital"
                && !e.grant_once.is_empty()
                && (1..=crate::industry::MAX_LEVEL).contains(&e.level)
                && d.locations.iter().any(|l| l.key == e.loc)
                && e.kind == "plantation"
                && d.industry_types.iter().enumerate().any(|(i, k)| {
                    k.key == e.industry
                        && k.workers * e.level == e.workers
                        && d.recipes.iter().any(|r| {
                            r.industry.idx() == i
                                && r.inputs.is_empty()
                                && r.outputs.iter().any(|(g, _)| d.good(*g).key == e.good)
                        })
                })
        })
        && c.ship_condition.is_none_or(|v| (1..=100).contains(&v) && !c.ships.is_empty())
        && c.licenses.iter().all(|k| d.factions.iter().any(|f| f.key == *k))
        && c.licenses.iter().collect::<std::collections::BTreeSet<_>>().len() == c.licenses.len()
        && c.caravan.as_ref().is_none_or(|a| {
            a.source == "family_capital"
                && !a.grant_once.is_empty()
                && a.cash == 0
                && a.cargo.is_empty()
                && a.guards >= 0
                && a.capacity > 0
                && d.locations.iter().any(|l| l.key == a.loc)
                && d.animals.iter().any(|v| v.key == a.animal && v.capacity > 0 && a.capacity % v.capacity == 0)
        })
}
impl World {
    pub(crate) fn grant_upbringing_extras(&mut self, c: &super::Capital) -> Result<(), CommandError> {
        let day = self.day();
        for area in &c.known {
            let regions = self
                .defs
                .regions
                .iter()
                .enumerate()
                .filter(|(_, r)| area.regions.contains(&r.key))
                .map(|(i, _)| RegionId::from_idx(i))
                .collect::<std::collections::BTreeSet<_>>();
            if let Some(bounds) = area.clip_arcmin {
                let Some(p) = self.defs.nav.grid.rules().and_then(|r| r.projection.clone()) else {
                    return Err(CommandError::InvalidQuantity);
                };
                for y in 0..self.defs.map.height {
                    let lat = p.latitude_half_arcmin(y);
                    if lat < i64::from(bounds[1]) * 2 || lat >= i64::from(bounds[3]) * 2 {
                        continue;
                    }
                    for x in 0..self.defs.map.width {
                        let lon = i64::from(p.west) * 2 + (i64::from(x) * 2 + 1) * i64::from(p.arcmin_per_cell);
                        let cell = Cell::new(x, y);
                        if lon >= i64::from(bounds[0]) * 2
                            && lon < i64::from(bounds[2]) * 2
                            && self.defs.map.region_of(cell).is_some_and(|r| regions.contains(&r))
                        {
                            self.reveal_around(cell, 0);
                        }
                    }
                }
            } else {
                for r in regions {
                    crate::story::apply(self, None, &crate::story::StoryEffect::Chart(r))?;
                }
            }
            self.state.story2.flags.insert(format!("known_region_{}", area.key));
        }
        for area in &c.rumored {
            self.state.story2.flags.insert(format!("rumored_region_{}", area.key));
            self.state.story2.memories.insert(format!("rumored_region_{}", area.key), area.name.clone());
            if let Some(s) = &mut self.state.upbringing {
                s.memory_days.entry(format!("rumored_region_{}", area.key)).or_insert(day);
            }
        }
        for m in &c.mementos {
            self.state.story2.memories.insert(m.key.clone(), m.name.clone());
            if let Some(s) = &mut self.state.upbringing {
                s.memory_days.entry(m.key.clone()).or_insert(day);
            }
        }
        if let Some(e) = &c.estate
            && !self.upbringing_flag(&e.grant_once)
        {
            let kind = self
                .defs
                .industry_types
                .iter()
                .position(|k| k.key == e.industry)
                .map(IndustryTypeId::from_idx)
                .ok_or(CommandError::InvalidQuantity)?;
            let recipe = self
                .defs
                .recipes
                .iter()
                .position(|r| {
                    r.industry == kind
                        && r.inputs.is_empty()
                        && r.outputs.iter().any(|(g, _)| self.defs.good(*g).key == e.good)
                })
                .map(RecipeId::from_idx)
                .ok_or(CommandError::InvalidQuantity)?;
            let loc = self
                .defs
                .locations
                .iter()
                .position(|l| l.key == e.loc)
                .map(LocId::from_idx)
                .ok_or(CommandError::WrongLocation)?;
            let value = self.defs.industry_types[kind.idx()].build_cost * e.level;
            let id = IndustryId(self.state.next_industry.max(1));
            self.state.next_industry = id.0 + 1;
            self.state.industries.insert(
                id,
                crate::industry::Industry {
                    id,
                    owner: OwnerId::Player,
                    loc,
                    kind,
                    recipe,
                    level: e.level,
                    manager: crate::industry::Manager::None,
                    stalled: false,
                    book_value: value,
                },
            );
            self.agent_mut(OwnerId::Player)?
                .ledger
                .post(
                    JournalEntry::new(day, Memo::Opening, CashClass::Investing)
                        .dr(Account::Property, value)
                        .cr(Account::Capital, value),
                )
                .map_err(CoreError::from)?;
            self.state.story2.flags.insert(e.grant_once.clone());
        }
        if let Some(a) = &c.caravan
            && !self.upbringing_flag(&a.grant_once)
        {
            let animal = self
                .defs
                .animals
                .iter()
                .position(|k| k.key == a.animal)
                .map(AnimalId::from_idx)
                .ok_or(CommandError::InvalidQuantity)?;
            let loc = self
                .defs
                .locations
                .iter()
                .position(|l| l.key == a.loc)
                .map(LocId::from_idx)
                .ok_or(CommandError::WrongLocation)?;
            let count = a.capacity / self.defs.animal(animal).capacity;
            let value = count * self.defs.animal(animal).price;
            let id = CaravanId(self.state.next_caravan.max(1));
            self.state.next_caravan = id.0 + 1;
            self.state.caravans.insert(
                id,
                crate::caravan::Caravan {
                    id,
                    owner: OwnerId::Player,
                    animal,
                    count,
                    guards: a.guards,
                    cargo: Default::default(),
                    location: crate::caravan::CaravanLocation::At(loc),
                    book_value: value,
                },
            );
            self.agent_mut(OwnerId::Player)?
                .ledger
                .post(
                    JournalEntry::new(day, Memo::Opening, CashClass::Investing)
                        .dr(Account::Property, value)
                        .cr(Account::Capital, value),
                )
                .map_err(CoreError::from)?;
            self.state.story2.flags.insert(a.grant_once.clone());
        }
        if let Some(flag) = &c.grant_once {
            self.state.story2.flags.insert(flag.clone());
        }
        Ok(())
    }
}
