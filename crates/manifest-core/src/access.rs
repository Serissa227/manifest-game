//! 商馆、货档与商誉（T01，`rules.toml [access]`，规则见 [`crate::defs::AccessRules`]）。
//!
//! - **货档**：每种货有档位（[`crate::defs::GoodDef::rank`]，0–3）。买入第 r 档的货，要求买方在这座港口的**商誉**
//!   达到 `rank_goodwill[r]`。只锁买、不锁卖：剧情给的货、产业的产出、别处买来的货都照常能卖。军需照旧另要许可证。
//! - **商誉** = 对当地势力的声望 + 本港商馆的加成（商会另有起步值 `company_goodwill`）。
//! - **商馆**：某个所有者在某港的累计投资达到门槛，就是几级商馆——
//!   第 L 级的门槛 = `house_base × house_step^(L−1) × (0.5 + 初始发展度 / 100)`。每级给商誉加成、交易税乘数与免费仓位。
//!   等级只由累计投资（[`crate::world::LocationState::investments`]）算出，不另存状态，旧存档里投过的钱照样算数。
//! - **不看商誉的情形**：同盟港的主人；本据在这个势力的商会；手上有进行中的请托或已接的委托要这种货；
//!   没有这套状态的旧存档读入后的宽限期；每港保底的几种货（出售清单里货档最低的 `floor_goods` 种）。
//! - **声望的来路**：成交额按势力累计，第 n 点要 `trade_rep_base × (1 + n / trade_rep_per)`（[`trade_reputation`]）；
//!   港口投资按同一港口的累计额每 `invest_rep_per` 一点（[`invest_reputation`]）。
//! - 规则关闭时（经典世界、测试夹具）这里的函数都退回“没有这条规则”：商馆恒为 0 级、什么都不锁，世界状态里也不多出字段。

use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 这套规则在一局里的状态（规则关闭时为空，不写进存档）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessState {
    /// 规则在这一局开始生效的日子：新开局是开局日；没有这套状态的旧存档是读入的那一天
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u32>,
    /// 旧存档读入后的宽限截止日（不含）：到这一天之前全档可买，声望照常累积；新开局没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grace_until: Option<u32>,
}

impl AccessState {
    pub fn is_empty(&self) -> bool {
        *self == AccessState::default()
    }
}

/// 货档把某种货锁住了：这种货的档位、要的商誉与手上的商誉。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RankGate {
    pub rank: u8,
    pub need: i64,
    pub have: i64,
}

/// 某个所有者在某地买货的门路（一次算好，逐种货查询；规划器与港口视图一处要问几十种货）。
#[derive(Clone, Debug, Default)]
pub struct BuyAccess {
    /// 规则打开
    on: bool,
    /// 不看商誉（同盟港的主人、本据势力的商会、宽限期）
    free: bool,
    /// 这里的商誉
    pub goodwill: i64,
    /// 这里保底放开的货（原本有档位的那几种）
    floor: Vec<GoodId>,
    /// 手上的请托、委托要的货
    wanted: Vec<GoodId>,
    /// 这里能投资（港口）：不能投资的地点用 inland_goodwill 那一组门槛（T02）
    investable: bool,
    /// 完成委托换来的本势力熟客放行（wanted 中也包含这些货）。
    pub patron: Vec<GoodId>,
    /// E03：产地隐秘货免货档，不占普通货的保底名额。
    rare: Vec<GoodId>,
}

impl BuyAccess {
    /// 买入这种货要的商誉（规则关闭、0 档、保底放开的为 0）。不看买方是谁。
    pub fn need(&self, defs: &crate::defs::StaticData, good: GoodId) -> i64 {
        if !self.on || self.floor.contains(&good) || self.rare.contains(&good) {
            return 0;
        }
        rank_need(defs, good, self.investable)
    }

    /// 这种货现在是不是被货档锁着（买得了时为 None）。
    pub fn gate(&self, defs: &crate::defs::StaticData, good: GoodId) -> Option<RankGate> {
        if !self.on || self.free {
            return None;
        }
        let need = self.need(defs, good);
        if need <= 0 || self.goodwill >= need || self.wanted.contains(&good) {
            return None;
        }
        Some(RankGate { rank: rank_of(defs, good), need, have: self.goodwill })
    }

    /// 这种货是因为手上的请托、委托才放行的（界面注明用）。
    pub fn wanted(&self, good: GoodId) -> bool {
        self.wanted.contains(&good)
    }

    /// 这种货是这座港口保底放开的。
    pub fn floored(&self, good: GoodId) -> bool {
        self.floor.contains(&good)
    }

    /// 买方在这里不看商誉（同盟港的主人、本据势力的商会、宽限期）。
    pub fn free(&self) -> bool {
        self.free
    }
}

/// 某种货的货档（夹在规则列出的档位之内）。
pub fn rank_of(defs: &crate::defs::StaticData, good: GoodId) -> u8 {
    let top = defs.rules.access.rank_goodwill.len().saturating_sub(1);
    defs.goods.get(good.idx()).map_or(0, |g| usize::from(g.rank).min(top) as u8)
}

/// 某种货照档位要的商誉（不算保底）。能投资的地点（港口）与不能投资的（内陆城市等）各用一组门槛（T02）。
fn rank_need(defs: &crate::defs::StaticData, good: GoodId, investable: bool) -> i64 {
    defs.rules.access.rank_table(investable).get(usize::from(rank_of(defs, good))).copied().unwrap_or(0)
}

/// 某地能不能投资（只有港口能设商馆）。
pub fn investable(defs: &crate::defs::StaticData, loc: LocId) -> bool {
    defs.locations.get(loc.idx()).is_some_and(|l| l.is_port())
}

/// 每港保底：出售清单里（军需除外）货档最低、同档按基准价从低到高的 `floor_goods` 种货不看商誉。
/// 返回其中原本有门槛的那几种（0 档的本来就不用放开）。只依赖静态数据。
pub fn floor_goods(defs: &crate::defs::StaticData, loc: LocId) -> Vec<GoodId> {
    floor_from_list(defs, loc, crate::open_market::sale_list(defs, loc))
}

fn floor_from_list(defs: &crate::defs::StaticData, loc: LocId, list: Vec<GoodId>) -> Vec<GoodId> {
    let r = &defs.rules.access;
    if !r.enabled || r.floor_goods == 0 {
        return Vec::new();
    }
    let mut list: Vec<_> =
        list.into_iter().filter(|g| !defs.good(*g).license && !crate::stages::is_rare(defs, *g)).collect();
    let inv = investable(defs, loc);
    list.sort_by_key(|g| (rank_need(defs, *g, inv), defs.good(*g).base_price, g.0));
    list.truncate(r.floor_goods);
    list.retain(|g| rank_need(defs, *g, inv) > 0);
    list
}

impl World {
    /// 商馆、货档与商誉这条规则是否打开。
    pub fn access_on(&self) -> bool {
        self.defs.rules.access.enabled
    }

    /// 旧存档读入后的宽限期里（全档可买）。
    pub fn access_grace(&self) -> bool {
        self.access_on() && self.state.access.grace_until.is_some_and(|until| self.state.day < until)
    }

    /// 宽限期还剩几天（不在宽限期里为 None）。
    pub fn access_grace_left(&self) -> Option<u32> {
        if !self.access_grace() {
            return None;
        }
        self.state.access.grace_until.map(|until| until.saturating_sub(self.state.day))
    }

    /// 开局：记下规则生效的日子（规则关闭时什么都不记）。
    pub(crate) fn init_access(&mut self) {
        if self.access_on() && self.state.access.since.is_none() {
            self.state.access.since = Some(self.state.day);
        }
    }

    /// 读档：规则打开而存档里没有这套状态（旧存档）——从今天算起，给一段宽限期。
    pub(crate) fn reconcile_access(&mut self) {
        if self.access_on() && self.state.access.since.is_none() {
            let day = self.state.day;
            self.state.access.since = Some(day);
            self.state.access.grace_until = Some(day.saturating_add(self.defs.rules.access.grace_days));
        }
    }

    /// 某港第 `level` 级商馆要的累计投资（0 级为 0；超出最高等级的为 None）。
    pub fn house_threshold(&self, loc: LocId, level: usize) -> Option<Money> {
        let r = &self.defs.rules.access;
        if level == 0 {
            return Some(0);
        }
        if !r.enabled || level > r.max_house() {
            return None;
        }
        let dev0 = self.defs.locations.get(loc.idx()).map_or(50, |l| l.development).clamp(1, 100);
        let mut cost = r.house_base.max(1);
        for _ in 1..level {
            cost = cost.saturating_mul(r.house_step.max(1));
        }
        if self.defs.rules.development.enabled {
            let base = self.defs.locations.get(loc.idx()).map_or(50, |l| l.development);
            let depth = self.defs.rules.development.depth_bp(base);
            return Some(mul_div(cost, 5000 + depth / 2, 10_000).max(1));
        }
        Some(mul_div(cost, 50 + dev0, 100).max(1))
    }

    /// 某个所有者在某港的商馆等级（规则关闭、不是港口或没投过钱时为 0）。
    pub fn house_level(&self, owner: OwnerId, loc: LocId) -> usize {
        let r = &self.defs.rules.access;
        if !r.enabled || !self.defs.locations.get(loc.idx()).is_some_and(|l| l.is_port()) {
            return 0;
        }
        let invested = self.invested(owner, loc);
        (1..=r.max_house())
            .take_while(|level| self.house_threshold(loc, *level).is_some_and(|need| invested >= need))
            .count()
    }

    /// 某个所有者在某港的累计投资。
    pub fn invested(&self, owner: OwnerId, loc: LocId) -> Money {
        self.state.locations.get(loc.idx()).and_then(|l| l.investments.get(&owner).copied()).unwrap_or(0)
    }

    /// 商馆给的交易税乘数（没有商馆或规则关闭时为 1）。
    pub fn house_tax(&self, owner: OwnerId, loc: LocId) -> Fx {
        let r = &self.defs.rules.access;
        if !r.enabled {
            return Fx::ONE;
        }
        r.house_tax.get(self.house_level(owner, loc)).copied().unwrap_or(Fx::ONE)
    }

    /// 商馆给的免费仓位（没有商馆或规则关闭时为 0）。
    pub fn house_storage(&self, owner: OwnerId, loc: LocId) -> i64 {
        let r = &self.defs.rules.access;
        if !r.enabled {
            return 0;
        }
        r.house_storage.get(self.house_level(owner, loc)).copied().unwrap_or(0)
    }

    /// 某地白给的仓位：同盟港的免费容量与商馆的免费仓位不相加，取更多的一个。
    pub fn free_storage(&self, owner: OwnerId, loc: LocId) -> i64 {
        let ally = self.state.locations.get(loc.idx()).and_then(|l| l.ally) == Some(owner);
        let from_ally = if ally { self.defs.rules.warehouse.ally_free_capacity } else { 0 };
        from_ally.max(self.house_storage(owner, loc))
    }

    /// 某个所有者在某地的商誉：对当地势力的声望 + 本港商馆的加成（商会另加起步值）。规则关闭时就是声望。
    pub fn goodwill(&self, owner: OwnerId, loc: LocId) -> i64 {
        let rep = self.reputation(owner, self.location_faction(loc));
        let r = &self.defs.rules.access;
        if !r.enabled {
            return rep;
        }
        let house = r.house_goodwill.get(self.house_level(owner, loc)).copied().unwrap_or(0);
        let start = if owner.company().is_some() { r.company_goodwill } else { 0 };
        rep + house + start
    }

    /// 手上进行中的请托（剧情目标）与已接的委托要的货：对这些货放行。
    pub fn errand_goods(&self, owner: OwnerId) -> Vec<GoodId> {
        use crate::contract::ContractStatus;
        let mut out: Vec<GoodId> = self
            .state
            .contracts
            .values()
            .filter(|c| c.status == ContractStatus::Accepted(owner))
            .map(|c| c.good)
            .collect();
        if owner.is_player() {
            for (key, track) in &self.state.story2.tracks {
                if track.status != crate::story2::Status::Active {
                    continue;
                }
                let Some(chapter) = self.defs.story2.track(key).and_then(|t| t.chapter(&track.chapter)) else {
                    continue;
                };
                for objective in &chapter.objectives {
                    if let crate::story2::objectives::ObjectiveKind::Goods { good, .. } = &objective.kind
                        && let Some(i) = self.defs.goods.iter().position(|g| g.key == *good)
                    {
                        out.push(GoodId::from_idx(i));
                    }
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }

    /// 某个所有者在某地买货的门路（规则关闭时什么都不锁）。
    pub fn buy_access(&self, owner: OwnerId, loc: LocId) -> BuyAccess {
        if !self.access_on() || self.defs.locations.get(loc.idx()).is_none() {
            return BuyAccess::default();
        }
        let ally = self.state.locations.get(loc.idx()).and_then(|l| l.ally) == Some(owner);
        // 商会在本据所属势力的港口全开
        let home = owner.company().is_some()
            && self
                .state
                .agents
                .get(&owner)
                .is_some_and(|a| self.location_faction(a.home) == self.location_faction(loc));
        let mut wanted = self.errand_goods(owner);
        let mut patron = Vec::new();
        if self.defs.rules.contracts.v2.enabled
            && let Some(agent) = self.state.agents.get(&owner)
        {
            patron = agent
                .passes
                .iter()
                .filter(|p| p.faction == self.location_faction(loc) && p.until > self.day())
                .map(|p| p.good)
                .collect();
            patron.sort();
            patron.dedup();
            wanted.extend(&patron);
            wanted.sort();
            wanted.dedup();
        }
        BuyAccess {
            on: true,
            free: ally || home || self.access_grace(),
            goodwill: self.goodwill(owner, loc),
            floor: floor_from_list(&self.defs, loc, self.market_sale_list(loc)),
            wanted,
            investable: investable(&self.defs, loc),
            patron,
            rare: self
                .defs
                .good_ids()
                .filter(|g| {
                    crate::stages::is_rare(&self.defs, *g) && crate::stages::rare_source(&self.defs, *g) == Some(loc)
                })
                .collect(),
        }
    }

    /// 某种货在某地是不是被货档锁着（买得了时为 None）。一处要问许多种货时用 [`World::buy_access`]。
    pub fn rank_gate(&self, owner: OwnerId, loc: LocId, good: GoodId) -> Option<RankGate> {
        if !self.access_on() {
            return None;
        }
        self.buy_access(owner, loc).gate(&self.defs, good)
    }
}

/// 成交带来的声望（规则打开时）：成交额按势力累计，对某势力的第 n 点声望（n 为现有声望，负数按 0）要
/// `trade_rep_base × (1 + n / trade_rep_per)`；经由贸易最多积累到 `trade_rep_cap`，到顶后不再累计。
pub(crate) fn trade_reputation(world: &mut World, owner: OwnerId, loc: LocId, gross: Money) {
    let faction = world.location_faction(loc);
    trade_reputation_for_faction(world, owner, faction, gross);
}

/// 合同按发布方累计，避免目的港易手以后把报酬的成交额记给新领主。
pub(crate) fn trade_reputation_for_faction(world: &mut World, owner: OwnerId, faction: FactionId, gross: Money) {
    let r = world.defs.rules.access.clone();
    let mut rep = world.reputation(owner, faction);
    if gross <= 0 || rep >= r.trade_rep_cap {
        return;
    }
    let Some(agent) = world.state.agents.get_mut(&owner) else { return };
    let mut turnover = agent.trade_turnover.get(&faction).copied().unwrap_or(0).saturating_add(gross);
    let mut gained = 0;
    while rep < r.trade_rep_cap {
        let need = r.trade_rep_base + mul_div(r.trade_rep_base, rep.max(0), r.trade_rep_per.max(1));
        if turnover < need.max(1) {
            break;
        }
        turnover -= need.max(1);
        rep += 1;
        gained += 1;
    }
    if rep >= r.trade_rep_cap || turnover == 0 {
        agent.trade_turnover.remove(&faction);
    } else {
        agent.trade_turnover.insert(faction, turnover);
    }
    if gained > 0 {
        world.adjust_reputation(owner, faction, gained);
    }
}

/// 港口投资带来的声望（规则打开时）：同一港口的累计投资每满 `invest_rep_per` 一点（不保底），单笔最多 `invest_rep_max` 点。
/// `before` 是这笔投资之前在这座港口的累计额。
pub(crate) fn invest_reputation(world: &World, before: Money, amount: Money) -> i64 {
    let r = &world.defs.rules.access;
    let per = r.invest_rep_per.max(1);
    ((before.saturating_add(amount)) / per - before / per).clamp(0, r.invest_rep_max.max(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::tiny_defs;
    use std::sync::Arc;

    const P: OwnerId = OwnerId::Player;

    fn defs_on() -> crate::defs::StaticData {
        let mut d = (*tiny_defs()).clone();
        d.rules.access.enabled = true;
        d
    }

    #[test]
    fn house_thresholds_follow_the_formula() {
        let w = World::new(Arc::new(defs_on()), ScenarioId(0), 1).unwrap();
        // alpha 的初始发展度是 50：5k / 15k / 45k / 135k
        let alpha = LocId(0);
        assert_eq!(w.defs.loc(alpha).development, 50);
        let costs: Vec<_> = (0..=5).map(|l| w.house_threshold(alpha, l)).collect();
        assert_eq!(costs, vec![Some(0), Some(5_000), Some(15_000), Some(45_000), Some(135_000), None]);
        // 初始发展度 d 的港口乘 (0.5 + d / 100)
        let mut d = defs_on();
        d.locations[0].development = 72;
        let w72 = World::new(Arc::new(d), ScenarioId(0), 1).unwrap();
        assert_eq!(w72.house_threshold(alpha, 1), Some(6_100));
        assert_eq!(w72.house_threshold(alpha, 4), Some(164_700));
    }

    #[test]
    fn house_level_counts_only_the_owners_own_investment() {
        let mut w = World::new(Arc::new(defs_on()), ScenarioId(0), 1).unwrap();
        let alpha = LocId(0);
        let other = OwnerId::Company(CompanyId(0));
        for (mine, level) in
            [(0, 0), (4_999, 0), (5_000, 1), (14_999, 1), (15_000, 2), (45_000, 3), (135_000, 4), (9_999_999, 4)]
        {
            w.state.locations[alpha.idx()].investments.insert(P, mine);
            w.state.locations[alpha.idx()].investments.insert(other, 500_000);
            assert_eq!(w.house_level(P, alpha), level, "累计 {mine}");
        }
        let r = w.defs.rules.access.clone();
        w.state.locations[alpha.idx()].investments.insert(P, 45_000);
        assert_eq!(w.house_tax(P, alpha), r.house_tax[3]);
        assert_eq!(w.house_storage(P, alpha), r.house_storage[3]);
        // 商誉 = 声望（小型世界开局 5）+ 商馆加成
        assert_eq!(w.goodwill(P, alpha), w.reputation(P, w.location_faction(alpha)) + r.house_goodwill[3]);
    }

    #[test]
    fn with_the_rule_off_nothing_is_gated_and_no_state_is_kept() {
        let mut w = World::new(tiny_defs(), ScenarioId(0), 1).unwrap();
        assert!(!w.access_on() && w.state.access.is_empty());
        w.state.locations[0].investments.insert(P, 1_000_000);
        assert_eq!(w.house_level(P, LocId(0)), 0);
        assert_eq!(w.house_tax(P, LocId(0)), Fx::ONE);
        assert_eq!(w.house_storage(P, LocId(0)), 0);
        for g in w.defs.good_ids() {
            assert_eq!(w.rank_gate(P, LocId(0), g), None);
        }
        let json = serde_json::to_string(&w.state).unwrap();
        assert!(!json.contains("\"access\"") && !json.contains("trade_turnover"));
    }

    #[test]
    fn trade_reputation_accumulates_turnover_point_by_point() {
        let mut w = World::new(Arc::new(defs_on()), ScenarioId(0), 1).unwrap();
        let alpha = LocId(0);
        let f = w.location_faction(alpha);
        // 小型世界开局带 5 点声望：清零，从第一点算起
        w.state.agents.get_mut(&P).unwrap().reputation.insert(f, 0);
        // 第一点 2000；不足时记在账上
        trade_reputation(&mut w, P, alpha, 1_500);
        assert_eq!(w.reputation(P, f), 0);
        trade_reputation(&mut w, P, alpha, 500);
        assert_eq!(w.reputation(P, f), 1);
        assert!(w.state.agents[&P].trade_turnover.is_empty(), "正好用完，不留零头");
        // 到 10 点一共要 2000 × (10 + 4.5) = 29,000
        trade_reputation(&mut w, P, alpha, 27_000);
        assert_eq!(w.reputation(P, f), 10);
        // 到 50 点一共要 345,000；之后不再涨，也不再记账
        trade_reputation(&mut w, P, alpha, 345_000 - 29_000);
        assert_eq!(w.reputation(P, f), 50);
        trade_reputation(&mut w, P, alpha, 10_000_000);
        assert_eq!(w.reputation(P, f), 50);
        assert!(w.state.agents[&P].trade_turnover.is_empty());
    }

    #[test]
    fn investing_earns_reputation_per_cumulative_twenty_thousand_without_a_floor() {
        let w = World::new(Arc::new(defs_on()), ScenarioId(0), 1).unwrap();
        assert_eq!(invest_reputation(&w, 0, 1_000), 0, "不保底");
        assert_eq!(invest_reputation(&w, 19_000, 1_000), 1, "同一港口累计满两万");
        assert_eq!(invest_reputation(&w, 0, 45_000), 2);
        assert_eq!(invest_reputation(&w, 0, 10_000_000), 10, "单笔封顶");
    }
}
