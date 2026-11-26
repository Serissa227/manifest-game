//! 势力与外交。
//!
//! 势力之间有关系值（−100–100）与状态机：和平 → 紧张 → 战争 → 停战 → 和平。
//! 状态变化完全由内核规则驱动：关系值低于阈值进入紧张；紧张持续足够久且关系继续恶化才会开战；
//! 战争持续一定天数后停战，停战期满回到和平。AI 事件只能提议调整关系值或在允许的转移上推动状态，
//! 必须经过裁决与内核校验。
//!
//! 玩家与商会对各势力有声望，影响交易税与许可证。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 外交状态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiploStatus {
    Peace,
    Tension,
    War,
    Truce,
}

/// 两个势力之间的关系（a < b）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relation {
    pub a: FactionId,
    pub b: FactionId,
    pub value: i64,
    pub baseline: i64,
    pub status: DiploStatus,
    /// 进入当前状态的日期
    pub since: u32,
}

/// 按基准关系初始化全部势力对。
pub fn initial_relations(defs: &crate::defs::StaticData) -> Vec<Relation> {
    let n = defs.factions.len();
    let mut out = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            let (a, b) = (FactionId::from_idx(i), FactionId::from_idx(j));
            let baseline = defs
                .relations
                .iter()
                .find(|r| (r.a == a && r.b == b) || (r.a == b && r.b == a))
                .map(|r| r.value)
                .unwrap_or(0);
            out.push(Relation { a, b, value: baseline, baseline, status: DiploStatus::Peace, since: 0 });
        }
    }
    out
}

impl World {
    pub fn relation(&self, x: FactionId, y: FactionId) -> Option<&Relation> {
        let (a, b) = if x < y { (x, y) } else { (y, x) };
        self.state.relations.iter().find(|r| r.a == a && r.b == b)
    }

    fn relation_mut(&mut self, x: FactionId, y: FactionId) -> Option<&mut Relation> {
        let (a, b) = if x < y { (x, y) } else { (y, x) };
        self.state.relations.iter_mut().find(|r| r.a == a && r.b == b)
    }

    /// 某势力是否与任何势力处于战争状态。
    pub fn at_war(&self, f: FactionId) -> bool {
        self.state.relations.iter().any(|r| r.status == DiploStatus::War && (r.a == f || r.b == f))
    }

    pub fn reputation(&self, owner: OwnerId, faction: FactionId) -> i64 {
        self.state.agents.get(&owner).and_then(|a| a.reputation.get(&faction).copied()).unwrap_or(0)
    }

    pub(crate) fn adjust_reputation(&mut self, owner: OwnerId, faction: FactionId, delta: i64) {
        if let Some(a) = self.state.agents.get_mut(&owner) {
            let r = a.reputation.entry(faction).or_insert(0);
            *r = (*r + delta).clamp(-100, 100);
        }
    }

    pub fn has_license(&self, owner: OwnerId, faction: FactionId) -> bool {
        self.state.agents.get(&owner).is_some_and(|a| a.licenses.contains(&faction))
    }

    pub fn has_marque(&self, owner: OwnerId, faction: FactionId) -> bool {
        self.state.agents.get(&owner).is_some_and(|a| a.marques.contains(&faction))
    }

    /// 在关系值变化后按规则推进状态机。
    fn apply_transitions(&mut self, idx: usize) -> Option<(FactionId, FactionId, DiploStatus)> {
        let day = self.state.day;
        let rules = self.defs.rules.diplomacy.clone();
        let r = &mut self.state.relations[idx];
        let held = day.saturating_sub(r.since);
        let next = match r.status {
            DiploStatus::Peace if r.value < rules.tension_below => Some(DiploStatus::Tension),
            DiploStatus::Tension if r.value > rules.peace_above => Some(DiploStatus::Peace),
            DiploStatus::Tension if r.value < rules.war_below && held >= rules.war_min_tension_days => {
                Some(DiploStatus::War)
            }
            DiploStatus::War if held >= rules.war_min_days && r.value > rules.war_below => Some(DiploStatus::Truce),
            DiploStatus::Truce if held >= rules.truce_days => Some(DiploStatus::Peace),
            _ => None,
        };
        if let Some(s) = next {
            r.status = s;
            r.since = day;
            if s == DiploStatus::Truce {
                // 停战后关系回升到紧张线以上
                r.value = r.value.max(rules.tension_below + 5);
            }
            return Some((r.a, r.b, s));
        }
        None
    }

    /// tick 第 6 步：外交关系的日常变化与状态转移。
    pub(crate) fn diplomacy_step(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let seed = self.state.seed;
        let rules = self.defs.rules.diplomacy.clone();
        let mut changes = Vec::new();
        for i in 0..self.state.relations.len() {
            let mut rng = Rng::derive(seed, day, Domain::Diplomacy, i as u64, 0);
            {
                let r = &mut self.state.relations[i];
                // 每 10 天向基准回归 1 点（战争中恶化停止回归）
                if day.is_multiple_of(10) && r.status != DiploStatus::War {
                    r.value += (r.baseline - r.value).signum();
                }
                if rng.chance_bp(rules.incident_bp) {
                    // 外交摩擦多于示好
                    let delta = if rng.chance_bp(6_000) { -rng.range(5, 15) } else { rng.range(3, 10) };
                    r.value = (r.value + delta).clamp(-100, 100);
                }
                // 战争中关系每天有小概率缓和，为停战创造条件
                if r.status == DiploStatus::War && rng.chance_bp(300) {
                    r.value = (r.value + rng.range(2, 6)).min(100);
                }
            }
            if let Some(c) = self.apply_transitions(i) {
                changes.push(c);
            }
        }
        for (a, b, status) in changes {
            self.push_log(LogEvent { day, kind: LogKind::Diplomacy { a, b, status } });
        }
        Ok(())
    }

    /// 经裁决与校验的外交事件：调整关系值（可推动状态机，但不能跳过中间状态）。
    pub fn apply_relation_delta(&mut self, a: FactionId, b: FactionId, delta: i64) -> Result<(), CoreError> {
        let day = self.state.day;
        let idx = {
            let (x, y) = if a < b { (a, b) } else { (b, a) };
            self.state
                .relations
                .iter()
                .position(|r| r.a == x && r.b == y)
                .ok_or_else(|| CoreError::Internal("势力关系不存在".into()))?
        };
        if let Some(r) = self.relation_mut(a, b) {
            r.value = (r.value + delta).clamp(-100, 100);
        }
        if let Some((a, b, status)) = self.apply_transitions(idx) {
            self.push_log(LogEvent { day, kind: LogKind::Diplomacy { a, b, status } });
        }
        Ok(())
    }

    /// 交易税率系数：声望（每 100 点 −25%）、战时加成（持有该势力私掠许可者免除）。
    pub fn faction_tax_mult(&self, owner: OwnerId, faction: FactionId) -> Fx {
        let rules = &self.defs.rules.diplomacy;
        let rep = self.reputation(owner, faction);
        let mut m = Fx::ONE - Fx::ratio(rep, 400);
        if self.at_war(faction) && !self.has_marque(owner, faction) {
            m = m.mul(rules.war_tax);
        }
        m.max(Fx::from_pct(10))
    }
}

/// 许可证 / 私掠许可命令的校验结果。
pub(crate) struct PermitPlan {
    pub faction: FactionId,
    pub cost: Money,
    pub marque: bool,
}

pub(crate) fn check_license(world: &World, owner: OwnerId, faction: FactionId) -> Result<PermitPlan, CommandError> {
    let f = world.defs.factions.get(faction.idx()).ok_or_else(|| CommandError::NotFound(format!("{faction:?}")))?;
    if world.has_license(owner, faction) {
        return Err(crate::error::Reason::new("office.has_license", "已持有该势力的许可证").rule());
    }
    let need = world.defs.rules.diplomacy.license_reputation;
    if world.reputation(owner, faction) < need {
        return Err(crate::error::Reason::new("office.reputation", format!("声望不足：需要 {need}"))
            .arg("need", crate::text::TextArg::Int(need))
            .rule());
    }
    let have = world.agent(owner)?.cash;
    if have < f.license_price {
        return Err(CommandError::InsufficientCash { need: f.license_price, have });
    }
    Ok(PermitPlan { faction, cost: f.license_price, marque: false })
}

pub(crate) fn check_marque(world: &World, owner: OwnerId, faction: FactionId) -> Result<PermitPlan, CommandError> {
    let f = world.defs.factions.get(faction.idx()).ok_or_else(|| CommandError::NotFound(format!("{faction:?}")))?;
    if !world.at_war(faction) {
        return Err(crate::error::Reason::new("office.no_war", "该势力未处于战争状态，不发放私掠许可").rule());
    }
    if world.has_marque(owner, faction) {
        return Err(crate::error::Reason::new("office.has_marque", "已持有该势力的私掠许可").rule());
    }
    if world.reputation(owner, faction) < 0 {
        return Err(crate::error::Reason::new("office.negative_reputation", "声望为负，不发放私掠许可").rule());
    }
    let have = world.agent(owner)?.cash;
    if have < f.marque_price {
        return Err(CommandError::InsufficientCash { need: f.marque_price, have });
    }
    Ok(PermitPlan { faction, cost: f.marque_price, marque: true })
}

pub(crate) fn exec_permit(world: &mut World, owner: OwnerId, plan: PermitPlan) -> Result<(), CommandError> {
    let day = world.state.day;
    world.book_external(
        owner,
        Flow::License,
        Sector::Treasury(plan.faction),
        JournalEntry::new(day, Memo::License, CashClass::Operating)
            .dr(Account::Fees, plan.cost)
            .cr(Account::Cash, plan.cost),
    )?;
    let agent = world.agent_mut(owner)?;
    let list = if plan.marque { &mut agent.marques } else { &mut agent.licenses };
    list.push(plan.faction);
    list.sort();
    if plan.marque {
        world.adjust_reputation(owner, plan.faction, 5);
    }
    Ok(())
}
