//! 安静日期仅备份历史状态；含事件效果的日期仍在完整世界副本中原子结算。
use super::*;
use crate::{
    World,
    error::{CommandError, CoreError},
};

impl World {
    /// 港口的动态势力；其他地点沿用静态定义。
    pub fn location_faction(&self, loc: LocId) -> FactionId {
        self.state.history.ports.get(&loc).and_then(|p| p.faction).unwrap_or_else(|| self.defs.loc(loc).faction)
    }
    pub fn port_status(&self, loc: LocId) -> PortStatus {
        self.state.history.ports.get(&loc).map_or(PortStatus::Open, |p| {
            if p.status == PortStatus::Sacked && p.until.is_some_and(|until| self.day() >= until) {
                PortStatus::Open
            } else {
                p.status
            }
        })
    }
    /// 除休眠、被劫掠和毁灭的港口外，既有城市、殖民地市场规则照常校验。
    /// 时间线的动态状态（A7）与作者写的开放年份（B10b 的 `port_is_open`）都要满足。
    pub fn location_open(&self, loc: LocId) -> bool {
        self.defs.locations.get(loc.idx()).is_some()
            && self.port_status(loc) == PortStatus::Open
            && self.port_is_open(loc)
            && self
                .realm_key_at_port(loc)
                .is_none_or(|key| self.realm_status(key) >= crate::realms::RealmStatus::Entered)
    }
    /// 势力范围随开放港口的当前归属变化；没有历史覆盖时沿用原几何算法。
    pub fn faction_reaches(&self, faction: FactionId, site: LocId) -> bool {
        if self.state.history.ports.is_empty() {
            return crate::colony::faction_reaches(&self.defs, faction, site);
        }
        let reach = self.defs.rules.colony.claim_reach;
        if reach <= 0 {
            return true;
        }
        let cell = self.defs.loc(site).cell;
        self.defs
            .port_ids()
            .filter(|l| self.location_faction(*l) == faction && self.location_open(*l))
            .any(|l| self.defs.map.topology().squared_distance(self.defs.loc(l).cell, cell) <= reach * reach)
    }
    pub fn history_outcome(&self, event: &str) -> Option<&str> {
        self.state.history.events.get(event)?.outcome.as_deref()
    }
    pub fn history_deviation(&self) -> usize {
        self.state.history.chronicle.iter().filter(|r| r.deviates).count()
    }
    pub(crate) fn init_history(&mut self) {
        if self.defs.history.is_empty() {
            return;
        }
        self.init_campaigns();
        for e in &self.defs.history.events {
            self.state.history.events.entry(e.key.clone()).or_default();
        }
        for p in &self.defs.history.ports {
            if let Some(loc) = self.defs.find_loc(&p.port) {
                let faction = p.faction.as_ref().and_then(|f| self.defs.find_faction(f));
                self.state.history.ports.entry(loc).or_insert(DynamicPort { faction, status: p.state, until: None });
            }
        }
    }
    pub(crate) fn history_day(&mut self) -> Result<(), CoreError> {
        if self.defs.history.is_empty()
            || !self.state.history.enabled
            || self.state.history.last_day == Some(self.day())
        {
            return Ok(());
        }
        // 日常漂移、门槛与关闭标记只写 history；真正的事件效果可能改动整个世界。
        // 在第一个效果之前退回原快照，沿用完整事务，错误时不会留下部分状态。
        let history = self.state.history.clone();
        match self.advance_history_day(true) {
            Ok(true) => return Ok(()),
            Ok(false) => self.state.history = history,
            Err(error) => {
                self.state.history = history;
                return Err(error);
            }
        }
        let mut trial = self.clone();
        trial.advance_history_day(false)?;
        self.state = trial.state;
        Ok(())
    }
    /// true 表示已经完成；false 表示必须用完整世界事务重试。
    fn advance_history_day(&mut self, history_only: bool) -> Result<bool, CoreError> {
        if history_only
            && self.state.history.events.values().any(|s| s.contributions.values().any(|c| !c.activities.is_empty()))
        {
            return Ok(false);
        }
        self.init_history();
        self.campaign_year();
        // 没有活动时 material_day 不写状态；有活动则已转入完整事务。
        if !history_only {
            self.history_material_day().map_err(|e| CoreError::Internal(format!("历史行动：{e}")))?;
        }
        let defs = self.defs.clone();
        let today = self.cast_date();
        for _ in 0..=defs.history.events.len() {
            self.history_ideas_changed();
            let mut changed = false;
            for &index in &defs.history.order {
                let event = &defs.history.events[index];
                let Some(state) = self.state.history.events.get(&event.key) else { continue };
                if state.outcome.is_some() || state.closed {
                    continue;
                }
                // 条件终局可提前结束战役；后来的战事不能再把世界改回缺省轨迹。
                let finished = event
                    .campaign
                    .as_ref()
                    .filter(|c| self.state.history.campaigns.get(*c).is_some_and(|s| s.finished.is_some()))
                    .and_then(|c| defs.history.campaign(c))
                    .and_then(|c| c.ending_event.as_ref())
                    .and_then(|key| defs.history.event(key))
                    .is_some_and(|ending| {
                        !ending.outcome_rules.is_empty() && self.history_outcome(&ending.key).is_some()
                    });
                if finished {
                    self.state.history.events.entry(event.key.clone()).or_default().closed = true;
                    continue;
                }
                let expired = event.deadline() <= today;
                let triggered = (state.forced
                    || !event.trigger.is_empty() && self.history_conditions(event, &event.trigger))
                    && event.window.is_none_or(|w| w[0] <= today && today <= w[1]);
                if !expired && !triggered {
                    continue;
                }
                let requirements = event
                    .requires
                    .iter()
                    .all(|r| self.history_outcome(&r.event).is_some_and(|v| r.outcome.as_ref().is_none_or(|o| o == v)));
                if !requirements || event.locked && !state.unlocked {
                    continue;
                }
                if history_only {
                    return Ok(false);
                }
                let (outcome, resolution) =
                    self.campaign_outcome(event).map_err(|e| CoreError::Internal(e.to_string()))?;
                self.resolve_history(event, outcome, resolution.score)
                    .map_err(|e| CoreError::Internal(format!("历史事件 {}：{e}", event.key)))?;
                self.state.history.events.entry(event.key.clone()).or_default().resolution = Some(resolution);
                changed = true;
            }
            if !changed {
                break;
            }
        }
        for e in &defs.history.events {
            if e.deadline() <= today {
                let state = self.state.history.events.entry(e.key.clone()).or_default();
                if state.outcome.is_none() {
                    state.closed = true;
                }
            }
        }
        self.history_ideas_changed();
        if history_only
            && defs.history.campaigns.iter().any(|c| {
                c.ending_event.as_ref().is_some_and(|event| self.history_outcome(event).is_some())
                    && self.state.history.campaigns.get(&c.key).is_none_or(|s| s.finished.is_none())
            })
        {
            return Ok(false);
        }
        self.finish_campaigns().map_err(|e| CoreError::Internal(format!("历史结局：{e}")))?;
        self.state.history.last_day = Some(self.day());
        Ok(true)
    }
    pub(super) fn resolve_history(
        &mut self,
        event: &EventDef,
        outcome: &OutcomeDef,
        balance: i64,
    ) -> Result<(), CommandError> {
        let day = self.day();
        let state = self.state.history.events.entry(event.key.clone()).or_default();
        state.outcome = Some(outcome.key.clone());
        state.resolved_day = Some(day);
        state.balance = balance;
        for effect in &outcome.effects {
            self.apply_history_effect(effect)?;
        }
        self.campaign_result(event, outcome)?;
        self.apply_cast_fate(&event.key, &outcome.key);
        self.state.history.chronicle.push(ChronicleEntry {
            day,
            event: event.key.clone(),
            outcome: outcome.key.clone(),
            deviates: outcome.key != event.history.outcome,
        });
        Ok(())
    }
    pub(crate) fn apply_history_effect(&mut self, effect: &Effect) -> Result<(), CommandError> {
        let Effect::History(effect) = effect else {
            if let Effect::Story(effect) = effect {
                self.apply_story2_effect(effect, false)?;
            }
            return Ok(());
        };
        match effect {
            HistoryEffect::Var { campaign, var, add } => self.change_campaign(campaign, var, *add)?,
            HistoryEffect::PortOwner { port, faction } => {
                let loc = self.defs.find_loc(port).ok_or_else(|| CommandError::NotFound(port.clone()))?;
                let faction = self.defs.find_faction(faction).ok_or_else(|| CommandError::NotFound(faction.clone()))?;
                // 城池易手（T02）：换了主人的港口算遭劫，投资者的累计投资折损（`[dividends]` 关闭时什么也不做）
                let taken = self.location_faction(loc) != faction;
                self.state.history.ports.entry(loc).or_default().faction = Some(faction);
                if taken {
                    self.sack_port(loc);
                }
            }
            HistoryEffect::PortState { port, state, days } => {
                let loc = self.defs.find_loc(port).ok_or_else(|| CommandError::NotFound(port.clone()))?;
                let until = days.map(|d| self.day().saturating_add(d));
                // 洗劫、毁城（T02）：投资者的累计投资折损（`[dividends]` 关闭时什么也不做）
                let sacked =
                    matches!(state, PortStatus::Sacked | PortStatus::Destroyed) && self.port_status(loc) != *state;
                let p = self.state.history.ports.entry(loc).or_default();
                p.status = *state;
                p.until = until;
                if sacked {
                    self.sack_port(loc);
                }
            }
            HistoryEffect::Unlock { event } | HistoryEffect::Close { event } => {
                if self.defs.history.event(event).is_none() {
                    return Err(CommandError::NotFound(event.clone()));
                }
                let s = self.state.history.events.entry(event.clone()).or_default();
                if s.outcome.is_none() {
                    if matches!(effect, HistoryEffect::Unlock { .. }) {
                        s.unlocked = true;
                    } else {
                        s.closed = true;
                    }
                }
            }
            HistoryEffect::Diplomacy { a, b, from, to } => {
                if !validation::legal_transition(*from, *to) {
                    return Err(blocked("外交转换不合法"));
                }
                let a = self.defs.find_faction(a).ok_or_else(|| CommandError::NotFound(a.clone()))?;
                let b = self.defs.find_faction(b).ok_or_else(|| CommandError::NotFound(b.clone()))?;
                let day = self.day();
                let r = self
                    .state
                    .relations
                    .iter_mut()
                    .find(|r| (r.a == a && r.b == b) || (r.a == b && r.b == a))
                    .ok_or_else(|| blocked("势力关系不存在"))?;
                // 已走到其他状态时不能倒退或跳过状态；史实结果仍可记录。
                if r.status == *from {
                    r.status = *to;
                    r.since = day;
                }
            }
        }
        Ok(())
    }
    pub(crate) fn validate_history_snapshot(&self) -> Result<(), CoreError> {
        let h = &self.state.history;
        let valid = (self.defs.history.is_empty() && h.is_empty())
            || (!self.defs.history.is_empty()
                && crate::summary::ripple::valid_snapshot(self)
                && campaign::valid_snapshot(self)
                && ideas::valid_snapshot(self)
                && contacts::valid_snapshot(self)
                && knowledge::valid_snapshot(self)
                && contribution::valid_snapshot(self)
                && h.last_day.is_none_or(|d| d <= self.day())
                && h.events.iter().all(|(key, s)| {
                    self.defs.history.event(key).is_some_and(|e| {
                        s.outcome.as_ref().is_none_or(|o| e.outcomes.iter().any(|v| &v.key == o))
                            && s.outcome.is_some() == s.resolved_day.is_some()
                            && s.resolved_day.is_none_or(|d| d <= self.day())
                            && !(s.closed && s.outcome.is_some())
                    })
                })
                && h.ports.iter().all(|(l, p)| {
                    self.defs.locations.get(l.idx()).is_some_and(|l| l.is_port())
                        && p.faction.is_none_or(|f| self.defs.factions.get(f.idx()).is_some())
                        && (p.status == PortStatus::Sacked) == p.until.is_some()
                })
                && h.chronicle.iter().enumerate().all(|(i, r)| {
                    h.events
                        .get(&r.event)
                        .is_some_and(|s| s.outcome.as_ref() == Some(&r.outcome) && s.resolved_day == Some(r.day))
                        && r.deviates
                            == self.defs.history.event(&r.event).is_some_and(|e| e.history.outcome != r.outcome)
                        && !h.chronicle[..i].iter().any(|old| old.event == r.event)
                        && (i == 0 || h.chronicle[i - 1].day <= r.day)
                })
                && h.events.values().filter(|s| s.outcome.is_some()).count() == h.chronicle.len());
        if valid { Ok(()) } else { Err(CoreError::SnapshotMismatch("时间线状态、结果或港口无效".into())) }
    }
}

#[cfg(test)]
#[path = "timeline_equivalence.rs"]
mod tests;
