//! H06 追逃、喊话与结伴（`rules.toml [hail]`，VOYAGE-PLAN §7）。
//!
//! - **喊话**：玩家手动航行的舰队离别的船 `range`（1/256 格，缺省 1.5 格，切比雪夫距离）以内时可以喊话：
//!   - 商船：**换消息**（它带着的出发港行情——没有就是它要去的港口此刻的行情——外加一条传闻）、
//!     **买补给**（按粮水价的 `supply_price_pct`% 买，最多 `supply_days_max` 天份）、
//!     **结伴**（`convoy_days` 天里海盗看你的视野只剩 `convoy_sight_pct`%：被盯上的机会大约减半）；
//!   - 海盗：**买路**（按货值的 `bribe_pct`%，至少 `bribe_min`；之后 `truce_days` 天它不追你）、
//!     **虚张声势**（谈判检定，成了同买路、不花钱；输了士气 −`bluff_morale`、当场开战）、**开战**（当场进入待决的海战）。
//!   - 官船（查验、问海盗出没处）：世界里没有官府的舰队，**没有做**（见交接文档）。
//! - **甩掉**：按分钟追击的海盗一整天看不见你而放弃时，名声 +`escape_fame`（雾、风位、结伴都能帮你甩掉）。
//!
//! 每个选项同一目标每天只能用一次（`used` 记到当天，次日清掉）。结果一律走内核命令（[`check`]）与校验；
//! 随机数 `Rng::derive(种子, 日期, Domain::Hail, …)`。开关关闭时状态里没有这一节、命令被拒，存档逐字节不变。

use crate::OwnerId;
use crate::battle::PendingBattle;
use crate::captain::AttrHook;
use crate::error::{CommandError, Reason};
use crate::fixed::{Money, mul_div};
use crate::ids::FleetId;
use crate::info::InfoSource;
use crate::navigation::SubCell;
use crate::rng::{Domain, Rng};
use crate::story::StoryEffect;
use crate::weather_cells::sub_dx;
use crate::world::{FleetLocation, Voyage, World, WorldState};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 喊话的规则（`rules.toml [hail]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HailRules {
    pub enabled: bool,
    /// 能喊话的距离（1/256 格，切比雪夫）
    pub range: i64,
    /// 向商船买补给的价格（粮、水价的百分比）
    pub supply_price_pct: i64,
    /// 一次最多买几天份
    pub supply_days_max: i64,
    /// 结伴几天
    pub convoy_days: u32,
    /// 结伴时海盗看你的视野（百分比）
    pub convoy_sight_pct: i64,
    /// 买路钱：货值的百分比
    pub bribe_pct: i64,
    /// 买路钱下限
    pub bribe_min: Money,
    /// 买路或吓退以后，这支海盗几天不追你
    pub truce_days: u32,
    /// 虚张声势的基础成功率（万分比）
    pub bluff_bp: i64,
    /// 谈判（Negotiate）每点加的成功率（万分比）
    pub bluff_negotiate_bp: i64,
    /// 火力每比对方多一成（10%）加的成功率（万分比，可为负）
    pub bluff_power_bp: i64,
    /// 虚张声势输了士气减多少
    pub bluff_morale: i64,
    /// 甩掉追击的海盗给的名声
    pub escape_fame: i64,
}

impl Default for HailRules {
    fn default() -> Self {
        Self {
            enabled: false,
            range: 384,
            supply_price_pct: 300,
            supply_days_max: 5,
            convoy_days: 5,
            convoy_sight_pct: 50,
            bribe_pct: 10,
            bribe_min: 50,
            truce_days: 10,
            bluff_bp: 3_500,
            bluff_negotiate_bp: 100,
            bluff_power_bp: 300,
            bluff_morale: 10,
            escape_fame: 2,
        }
    }
}

impl HailRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(1..=2_048).contains(&self.range) {
            out.push(("range", "须在 1–2048 之间（1/256 格）"));
        }
        if !(100..=1_000).contains(&self.supply_price_pct) || !(1..=30).contains(&self.supply_days_max) {
            out.push(("supply_price_pct", "价格 100–1000%、天数 1–30"));
        }
        if !(0..=100).contains(&self.convoy_sight_pct) || self.convoy_days == 0 {
            out.push(("convoy_sight_pct", "视野 0–100%、天数至少 1"));
        }
        if !(0..=100).contains(&self.bribe_pct) || self.bribe_min < 0 || self.truce_days == 0 {
            out.push(("bribe_pct", "买路钱 0–100%、下限非负、休战至少 1 天"));
        }
        if !(0..=10_000).contains(&self.bluff_bp) || self.bluff_morale < 0 || self.escape_fame < 0 {
            out.push(("bluff_bp", "成功率 0–10000、士气与名声非负"));
        }
        out
    }
}

/// 喊话的对象。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HailTarget {
    /// 别的舰队（商船）
    Fleet(FleetId),
    /// 海盗（海盗编号）
    Pirate(u32),
}

/// 喊话的选项。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HailAction {
    /// 商船：换消息
    News,
    /// 商船：买补给（天数）
    Supplies(u8),
    /// 商船：结伴
    Convoy,
    /// 海盗：买路
    Bribe,
    /// 海盗：虚张声势
    Bluff,
    /// 海盗：开战
    Fight,
}

impl HailAction {
    fn index(self) -> u8 {
        match self {
            HailAction::News => 0,
            HailAction::Supplies(_) => 1,
            HailAction::Convoy => 2,
            HailAction::Bribe => 3,
            HailAction::Bluff => 4,
            HailAction::Fight => 5,
        }
    }

    fn for_pirate(self) -> bool {
        matches!(self, HailAction::Bribe | HailAction::Bluff | HailAction::Fight)
    }
}

/// 结伴：到哪天为止。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Convoy {
    pub with: FleetId,
    pub until: u32,
}

/// 休战：这支海盗到哪天为止不追哪支舰队。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Truce {
    pub fleet: FleetId,
    pub until: u32,
}

/// 刚做完的一次喊话（航行视图上回一句用）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HailResult {
    pub day: u32,
    pub fleet: FleetId,
    pub target: HailTarget,
    pub action: HailAction,
    /// 成了没有（虚张声势）；其余总是 true
    pub ok: bool,
    /// 花了多少钱
    pub cost: Money,
}

/// 喊话的状态。开关关闭时总是空的、不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HailState {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub convoys: BTreeMap<FleetId, Convoy>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub truces: BTreeMap<u32, Truce>,
    /// 当天用过的（日期, 对象, 选项序号）
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub used: BTreeSet<(u32, HailTarget, u8)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<HailResult>,
}

impl HailState {
    pub fn is_empty(&self) -> bool {
        self.convoys.is_empty() && self.truces.is_empty() && self.used.is_empty() && self.last.is_none()
    }
}

impl World {
    /// 这支玩家舰队此刻是否在结伴（海盗看它的视野打折）。
    pub fn convoy_active(&self, fleet: FleetId) -> bool {
        self.defs.rules.hail.enabled && self.state.hail.convoys.get(&fleet).is_some_and(|c| c.until >= self.state.day)
    }

    /// 这支海盗此刻是否与这支舰队休战（买过路或被吓退）。
    pub fn pirate_truce(&self, pirate: u32, fleet: FleetId) -> bool {
        self.defs.rules.hail.enabled
            && self.state.hail.truces.get(&pirate).is_some_and(|t| t.fleet == fleet && t.until >= self.state.day)
    }

    /// 喊话对象此刻的位置（1/256 格）：舰队取所在格的中心，海盗取追击中的精确位置或所在格的中心。
    pub fn hail_target_pos(&self, target: HailTarget) -> Option<SubCell> {
        match target {
            HailTarget::Fleet(id) => {
                let f = self.state.fleets.get(&id)?;
                matches!(f.location, FleetLocation::AtSea(_)).then(|| SubCell::center(f.cell(&self.defs)))
            }
            HailTarget::Pirate(id) => {
                let p = self.state.battles.pirates.get(&id)?;
                Some(self.state.battles.chases.get(&id).map_or(SubCell::center(p.cell), |c| c.pos))
            }
        }
    }

    /// 某支玩家舰队此刻能喊话的对象（按对象排序）。
    pub fn hail_targets(&self, fleet: FleetId) -> Vec<HailTarget> {
        let rules = &self.defs.rules.hail;
        if !rules.enabled {
            return Vec::new();
        }
        let Some(me) = self.manual_pos(fleet) else { return Vec::new() };
        let near = |p: SubCell| sub_dx(&self.defs, me.x, p.x).abs().max((p.y - me.y).abs()) <= rules.range;
        let mut out: Vec<HailTarget> = self
            .state
            .fleets
            .values()
            .filter(|f| f.id != fleet && f.owner != OwnerId::Player && matches!(f.location, FleetLocation::AtSea(_)))
            .map(|f| HailTarget::Fleet(f.id))
            .chain(self.state.battles.pirates.values().filter(|p| !p.engaged).map(|p| HailTarget::Pirate(p.id)))
            .filter(|t| self.hail_target_pos(*t).is_some_and(near))
            .collect();
        out.sort();
        out
    }

    fn manual_pos(&self, fleet: FleetId) -> Option<SubCell> {
        match &self.state.fleets.get(&fleet)?.location {
            FleetLocation::AtSea(Voyage::Manual { manual }) => Some(manual.pos),
            _ => None,
        }
    }

    /// 买路钱：船上货物按基准价的货值 × `bribe_pct`%，不少于 `bribe_min`。
    pub fn bribe_cost(&self, fleet: FleetId) -> Money {
        let rules = &self.defs.rules.hail;
        let value: Money = self.state.fleets.get(&fleet).map_or(0, |f| {
            f.cargo.iter().map(|(g, q)| self.defs.goods.get(g.idx()).map_or(0, |d| d.base_price) * q).sum()
        });
        mul_div(value, rules.bribe_pct, 100).max(rules.bribe_min)
    }

    /// 向商船买 `days` 天补给的价钱。
    pub fn hail_supply_cost(&self, fleet: FleetId, days: i64) -> Money {
        let rules = &self.defs.rules;
        let crew = self.state.fleets.get(&fleet).map_or(0, |f| f.crew.max(1));
        let units = crate::fleet::supplies_for_days(&self.defs, crew, days);
        mul_div(units * (rules.food_price + rules.water_price), rules.hail.supply_price_pct, 100)
    }

    /// 虚张声势的成功率（万分比）：基础 + 谈判 + 火力对比，夹在 5%–90%。
    pub fn bluff_chance_bp(&self, fleet: FleetId, pirate: u32) -> i64 {
        let rules = &self.defs.rules.hail;
        let guns = |ships: &[crate::world::Ship]| ships.iter().map(|s| s.guns).sum::<i64>();
        let mine = self.state.fleets.get(&fleet).map_or(0, |f| guns(&f.ships) * 10 + f.crew * 2);
        let theirs = self.state.battles.pirates.get(&pirate).map_or(1, |p| guns(&p.ships) * 10 + p.crew * 2).max(1);
        // 火力每比对方多（少）一成，加（减）bluff_power_bp
        let edge = mul_div(mine - theirs, 10, theirs) * rules.bluff_power_bp;
        let negotiate = self.attr_hook(OwnerId::Player, AttrHook::Negotiate).max(0) * rules.bluff_negotiate_bp;
        (rules.bluff_bp + negotiate + edge).clamp(500, 9_000)
    }

    /// 日结：过期的结伴、休战与当天的用过记录清掉（开关关闭时什么也不做）。
    pub(crate) fn hail_day(&mut self) {
        if !self.defs.rules.hail.enabled {
            return;
        }
        let day = self.state.day;
        let h = &mut self.state.hail;
        h.convoys.retain(|_, c| c.until >= day);
        h.truces.retain(|_, t| t.until >= day);
        h.used.retain(|(d, _, _)| *d >= day);
        if h.last.is_some_and(|l| l.day < day) {
            h.last = None;
        }
    }

    /// 开战：玩家舰队与这支海盗进入待决的海战（与遭遇一样，次日未作选择就自动结算）。
    pub(crate) fn start_pirate_battle(&mut self, fleet: FleetId, pirate: u32) {
        let day = self.state.day;
        let id = crate::ids::BattleId(self.state.battles.next_battle);
        self.state.battles.next_battle += 1;
        self.state.battles.pending.insert(id, PendingBattle { id, fleet, pirate, day });
        if let Some(p) = self.state.battles.pirates.get_mut(&pirate) {
            p.engaged = true;
        }
        self.state.battles.chases.remove(&pirate);
        self.pacing_note(crate::pacing::BeatSource::Battle.weight());
    }
}

/// 命令校验与结算（返回结算后的世界状态）。
pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    target: HailTarget,
    action: HailAction,
) -> Result<Box<WorldState>, CommandError> {
    let rules = &world.defs.rules.hail;
    if !rules.enabled {
        return Err(Reason::new("hail.disabled", "这个世界不能喊话").rule());
    }
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let f = world.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if world.fleet_in_battle(fleet) {
        return Err(Reason::new("fleet.in_battle", "舰队正在交战").rule());
    }
    if !world.hail_targets(fleet).contains(&target) {
        return Err(Reason::new("hail.far", "离得太远，喊不到").rule());
    }
    if action.for_pirate() != matches!(target, HailTarget::Pirate(_)) {
        return Err(Reason::new("hail.action", "对这条船不能这样做").rule());
    }
    let day = world.state.day;
    if world.state.hail.used.contains(&(day, target, action.index())) {
        return Err(Reason::new("hail.used", "今天已经这样喊过了").rule());
    }
    let cash = world.agent(owner)?.cash;
    let mut w = world.clone();
    let mut cost = 0;
    let mut ok = true;
    match (target, action) {
        (HailTarget::Fleet(other), HailAction::News) => {
            let o = w.fleet(other)?.clone();
            let snap = o.news.clone().or_else(|| match &o.location {
                FleetLocation::AtSea(Voyage::Route(r)) => Some(w.take_snapshot(r.dest, InfoSource::Ship)),
                _ => w.fleet_port(&o).map(|l| w.take_snapshot(l, InfoSource::Ship)),
            });
            if let Some(snap) = snap {
                w.learn(owner, snap);
            }
            crate::story::apply(&mut w, Some(fleet), &StoryEffect::Rumor)
                .map_err(|e| Reason::new("hail.apply", e.to_string()).rule())?;
        }
        (HailTarget::Fleet(_), HailAction::Supplies(days)) => {
            let days = i64::from(days);
            if !(1..=rules.supply_days_max).contains(&days) {
                return Err(Reason::new("hail.days", "买的天数不对").range());
            }
            cost = w.hail_supply_cost(fleet, days);
            if cash < cost {
                return Err(CommandError::InsufficientCash { need: cost, have: cash });
            }
            for e in [StoryEffect::Cash(-cost), StoryEffect::Supplies(days)] {
                crate::story::apply(&mut w, Some(fleet), &e)
                    .map_err(|e| Reason::new("hail.apply", e.to_string()).rule())?;
            }
        }
        (HailTarget::Fleet(other), HailAction::Convoy) => {
            w.state.hail.convoys.insert(fleet, Convoy { with: other, until: day + rules.convoy_days - 1 });
        }
        (HailTarget::Pirate(pid), HailAction::Bribe) => {
            cost = w.bribe_cost(fleet);
            if cash < cost {
                return Err(CommandError::InsufficientCash { need: cost, have: cash });
            }
            crate::story::apply(&mut w, Some(fleet), &StoryEffect::Cash(-cost))
                .map_err(|e| Reason::new("hail.apply", e.to_string()).rule())?;
            w.state.hail.truces.insert(pid, Truce { fleet, until: day + rules.truce_days - 1 });
            w.state.battles.chases.remove(&pid);
        }
        (HailTarget::Pirate(pid), HailAction::Bluff) => {
            let chance = w.bluff_chance_bp(fleet, pid);
            let mut rng = Rng::derive(w.state.seed, day, Domain::Hail, u64::from(pid), u64::from(fleet.0));
            ok = rng.chance_bp(chance);
            if ok {
                w.state.hail.truces.insert(pid, Truce { fleet, until: day + rules.truce_days - 1 });
                w.state.battles.chases.remove(&pid);
            } else {
                let fm = w.fleet_mut(fleet)?;
                fm.morale = (fm.morale - rules.bluff_morale).max(0);
                w.start_pirate_battle(fleet, pid);
            }
        }
        (HailTarget::Pirate(pid), HailAction::Fight) => w.start_pirate_battle(fleet, pid),
        _ => return Err(Reason::new("hail.action", "对这条船不能这样做").rule()),
    }
    w.state.hail.used.insert((day, target, action.index()));
    // H08：航海日志开着时，喊话记一条日志（“做了什么决定”）
    if w.defs.rules.voyage_log.enabled {
        let what = match (action, ok) {
            (HailAction::News, _) => "换了消息".to_owned(),
            (HailAction::Supplies(d), _) => format!("买了 {d} 天的粮水，花 {cost} 金币"),
            (HailAction::Convoy, _) => "约好结伴同行".to_owned(),
            (HailAction::Bribe, _) => format!("付了 {cost} 金币买路"),
            (HailAction::Bluff, true) => "虚张声势，把海盗吓走了".to_owned(),
            (HailAction::Bluff, false) => "虚张声势被看穿，打起来了".to_owned(),
            (HailAction::Fight, _) => "向海盗开战".to_owned(),
        };
        w.push_log(crate::log::LogEvent { day, kind: crate::log::LogKind::Hailed { fleet, owner, what } });
    }
    w.state.hail.last = Some(HailResult { day, fleet, target, action, ok, cost });
    Ok(Box::new(w.state))
}

#[cfg(test)]
#[path = "hail_tests.rs"]
mod tests;
