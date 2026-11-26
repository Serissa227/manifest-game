//! 阅读以半天进度为整数单位：自行阅读每天两单位，通事每天一单位。
//! 版本进度分别保存，首次作品奖励与书目以 work 去重。
use crate::{
    error::{CommandError, CoreError},
    ids::*,
    world::World,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadMode {
    #[serde(rename = "self")]
    Direct,
    Interpreter,
    Translation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    /// 玩家选择的版本与实际阅读的版本（译本时不同）。
    pub book: String,
    pub source: String,
    pub mode: ReadMode,
    pub interpreter: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookRecord {
    pub key: String,
    pub day: u32,
    pub category: String,
}

impl World {
    pub(crate) fn valid_reading_inventory(&self, inv: &super::Inventory) -> bool {
        let records_ok = inv.bibliography.values().all(|r| r.day <= self.day());
        let reading_ok = inv.reading.as_ref().is_none_or(|r| match r.mode {
            ReadMode::Direct => r.book == r.source && r.interpreter.is_none(),
            ReadMode::Translation => r.book != r.source && r.interpreter.is_none(),
            ReadMode::Interpreter => r.book == r.source && r.interpreter.is_some(),
        });
        records_ok
            && reading_ok
            && inv.attr_xp.values().all(|xp| *xp >= 0)
            && inv.skill_xp.iter().all(|(key, xp)| {
                *xp >= 0
                    && !key.is_empty()
                    && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            })
    }
    pub fn knows_language(&self, owner: OwnerId, lang: &str) -> bool {
        self.inventory(owner).and_then(|i| i.skill_xp.get(lang)).is_some_and(|xp| *xp > 0)
    }
    pub fn interpreter_knows(&self, owner: OwnerId, mate: &str, lang: &str) -> bool {
        self.defs.mates.iter().enumerate().find(|(_, d)| d.key == mate).is_some_and(|(i, _)| {
            let id = MateId::from_idx(i);
            self.state.mates.get(&id).is_some_and(|m| m.owner == Some(owner)) && self.mate_ability(id, lang) > 0
        })
    }
    pub fn has_read_work(&self, owner: OwnerId, work: &str) -> bool {
        let key = self.defs.items.item(work).map(|i| i.work_key()).unwrap_or(work);
        self.inventory(owner).is_some_and(|i| i.bibliography.contains_key(key))
    }
    pub fn books_read(&self, owner: OwnerId, category: Option<&str>) -> usize {
        self.inventory(owner)
            .map_or(0, |i| i.bibliography.values().filter(|b| category.is_none_or(|c| c == b.category)).count())
    }
    pub fn reading_days(&self, owner: OwnerId, reading: &Reading) -> (u32, u32) {
        let days = self.defs.items.item(&reading.source).and_then(|i| i.read.as_ref()).map_or(0, |r| r.days);
        let units = self.inventory(owner).and_then(|i| i.read_progress.get(&reading.source)).copied().unwrap_or(0);
        if reading.mode == ReadMode::Interpreter { (units, days.saturating_mul(2)) } else { (units / 2, days) }
    }
    /// I4 与命令共用的选择：自己读、可读译本、按 key 最小的在队通事。
    pub fn choose_reading(
        &self,
        owner: OwnerId,
        key: &str,
        interpreter: Option<&str>,
    ) -> Result<Reading, CommandError> {
        let item = super::inventory::item(self, key)?;
        let read = item.read.as_ref().ok_or_else(|| CommandError::Precondition("这不是一本可读的书".into()))?;
        if self.item_quantity(owner, key) < 1 {
            return Err(CommandError::InsufficientStock { available: 0 });
        }
        if self.has_read_work(owner, item.work_key()) {
            return Err(CommandError::Precondition("已经读过这部作品".into()));
        }
        let mut reading = Reading { book: key.into(), source: key.into(), mode: ReadMode::Direct, interpreter: None };
        if let Some(mate) = interpreter {
            if !read.lang.as_deref().is_some_and(|lang| self.interpreter_knows(owner, mate, lang)) {
                return Err(CommandError::Precondition("通事不在队中或不会这门语言".into()));
            }
            reading.mode = ReadMode::Interpreter;
            reading.interpreter = Some(mate.into());
            return Ok(reading);
        }
        if read.lang.as_deref().is_none_or(|lang| self.knows_language(owner, lang)) {
            return Ok(reading);
        }
        if let Some(translation) = self
            .defs
            .items
            .items
            .iter()
            .filter(|i| i.work_key() == item.work_key() && self.item_quantity(owner, &i.key) > 0)
            .filter(|i| {
                i.read.as_ref().is_some_and(|r| r.lang.as_deref().is_none_or(|l| self.knows_language(owner, l)))
            })
            .min_by_key(|i| i.key.as_str())
        {
            reading.source = translation.key.clone();
            reading.mode = ReadMode::Translation;
            return Ok(reading);
        }
        if let Some(lang) = read.lang.as_deref()
            && let Some(mate) = self
                .defs
                .mates
                .iter()
                .filter(|m| self.interpreter_knows(owner, &m.key, lang))
                .min_by_key(|m| m.key.as_str())
        {
            reading.mode = ReadMode::Interpreter;
            reading.interpreter = Some(mate.key.clone());
            return Ok(reading);
        }
        Err(CommandError::Precondition("不会这门语言，也没有可读的译本或通事".into()))
    }
    pub(crate) fn items_reading_day(&mut self) -> Result<(), CoreError> {
        if !self.defs.items.enabled() {
            return Ok(());
        }
        let active: Vec<_> =
            self.state.items.owners.iter().filter_map(|(owner, inv)| Some((*owner, inv.reading.clone()?))).collect();
        let defs = self.defs.clone();
        let upbringing = self.upbringing_active();
        let mut growth = Vec::new();
        for (owner, reading) in active {
            let Some(item) = defs.items.item(&reading.source) else {
                continue;
            };
            let Some(read) = &item.read else {
                continue;
            };
            let language_ok = if reading.mode == ReadMode::Interpreter {
                reading
                    .interpreter
                    .as_deref()
                    .zip(read.lang.as_deref())
                    .is_some_and(|(mate, lang)| self.interpreter_knows(owner, mate, lang))
            } else {
                read.lang.as_deref().is_none_or(|lang| self.knows_language(owner, lang))
            };
            let keep = self.item_quantity(owner, &reading.source) > 0
                && language_ok
                && !self.has_read_work(owner, item.work_key());
            let inv = self.state.items.owners.entry(owner).or_default();
            if !keep {
                inv.reading = None;
                continue;
            }
            let units = inv.read_progress.entry(reading.source.clone()).or_default();
            *units = units.saturating_add(if reading.mode == ReadMode::Interpreter { 1 } else { 2 });
            if *units < read.days.saturating_mul(2) {
                continue;
            }
            inv.reading = None;
            inv.read_progress.remove(&reading.source);
            inv.bibliography.insert(
                item.work_key().into(),
                BookRecord { key: reading.source, day: self.state.day, category: read.category.clone() },
            );
            for (attr, xp) in &read.gains {
                if upbringing && owner == OwnerId::Player {
                    growth.push((attr.clone(), *xp));
                } else {
                    let value = inv.attr_xp.entry(attr.clone()).or_default();
                    *value = value.saturating_add(*xp);
                }
            }
            for skill in &read.skills {
                let value = inv.skill_xp.entry(skill.skill.clone()).or_default();
                *value = value.saturating_add(skill.xp);
            }
            if owner == OwnerId::Player {
                let mut regions = BTreeSet::new();
                for key in &read.reveals {
                    if let Some(i) = defs.regions.iter().position(|r| r.key == *key) {
                        regions.insert(RegionId::from_idx(i));
                    }
                    if let Some(chart) = defs.items.item(key).and_then(|i| i.chart.as_ref()) {
                        regions.extend(
                            chart.regions.iter().filter_map(|key| {
                                defs.regions.iter().position(|r| r.key == *key).map(RegionId::from_idx)
                            }),
                        );
                    }
                }
                for region in regions {
                    crate::explore::exec_chart(self, owner, crate::explore::ChartPlan { region, cost: 0 })?;
                }
            }
        }
        for (attr, xp) in growth {
            self.gain_upbringing_growth(&attr, xp);
        }
        // 没有立下身世时保留成长值；立下身世后的首个日结再兑现，不会丢掉首读奖励。
        for (owner, inv) in &mut self.state.items.owners {
            if upbringing && *owner == OwnerId::Player {
                continue;
            }
            let Some(captain) = self.state.agents.get_mut(owner).and_then(|a| a.captain.as_mut()) else {
                continue;
            };
            for (key, xp) in &mut inv.attr_xp {
                let Some(index) = defs.captain.attribute_index(key) else {
                    continue;
                };
                let Some(attr) = captain.attrs.get_mut(index) else {
                    continue;
                };
                let threshold = defs.rules.items.xp_per_point.max(1);
                let gain = *xp / threshold;
                *xp %= threshold;
                *attr = attr.saturating_add(gain);
                if let Some(group) = defs.captain.group(index) {
                    *attr = (*attr).clamp(group.range[0], group.range[1]);
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn apply(world: &mut World, owner: OwnerId, reading: Reading) {
    world.state.items.owners.entry(owner).or_default().reading = Some(reading);
}
