//! E03：阶段开放、不可逆的开货记录与隐秘货。规则关闭时各查询退回原路。

use crate::defs::{MarketUnlockDef, StaticData};
use crate::error::{CommandError, Reason};
use crate::fixed::{Money, mul_div, mul_div_floor};
use crate::ids::{GoodId, LocId, OwnerId};
use crate::log::{LogEvent, LogKind};
use crate::text::TextArg;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 阶段给出的内容；只保存数值和内部键，不生成玩家文案。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StageUnlockRules {
    pub enabled: bool,
    pub shop_stage: u8,
    pub shelf_step: i64,
    pub book_stage: u8,
    pub book_slots: usize,
    pub agency_bonus: Vec<i64>,
    pub industry_bonus: Vec<i64>,
    pub eligible: BTreeMap<String, u8>,
    pub rumor_after_days: u32,
}

impl Default for StageUnlockRules {
    fn default() -> Self {
        Self {
            enabled: false,
            shop_stage: 2,
            shelf_step: 1,
            book_stage: 3,
            book_slots: 4,
            agency_bonus: vec![0; 7],
            industry_bonus: vec![0; 7],
            eligible: BTreeMap::new(),
            rumor_after_days: 360,
        }
    }
}

impl StageUnlockRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !(1..=6).contains(&self.shop_stage) {
            out.push(("shop_stage", "必须在 1–6 之间"));
        }
        if !(1..=6).contains(&self.book_stage) {
            out.push(("book_stage", "必须在 1–6 之间"));
        }
        if self.shelf_step < 0 {
            out.push(("shelf_step", "必须非负"));
        }
        if self.book_slots > 12 {
            out.push(("book_slots", "必须在 0–12 之间"));
        }
        for (key, values) in [("agency_bonus", &self.agency_bonus), ("industry_bonus", &self.industry_bonus)] {
            if values.len() != 7 || values.iter().any(|n| *n < 0) || values.windows(2).any(|w| w[0] > w[1]) {
                out.push((key, "须有七项，非负且不减"));
            }
        }
        if self
            .eligible
            .iter()
            .any(|(key, stage)| !matches!(key.as_str(), "academy" | "auction" | "exchange") || !(1..=6).contains(stage))
        {
            out.push(("eligible", "只许 academy、auction、exchange，阶段必须在 1–6 之间"));
        }
        out
    }
}

/// 隐秘货的整数报价与配额；缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RareRules {
    pub enabled: bool,
    pub month_limit: i64,
    pub peak_cells: i64,
    pub peak_bp: i64,
    pub buyer_bonus_bp: i64,
    pub saturate: i64,
    pub floor_bp: i64,
}

impl Default for RareRules {
    fn default() -> Self {
        Self {
            enabled: false,
            month_limit: 30,
            peak_cells: 300,
            peak_bp: 35_000,
            buyer_bonus_bp: 2_000,
            saturate: 20,
            floor_bp: 6_000,
        }
    }
}

impl RareRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        for (key, value) in
            [("month_limit", self.month_limit), ("peak_cells", self.peak_cells), ("saturate", self.saturate)]
        {
            if value < 1 {
                out.push((key, "必须至少为 1"));
            }
        }
        if self.peak_bp < 10_000 {
            out.push(("peak_bp", "必须至少为 10000"));
        }
        if self.buyer_bonus_bp < 0 {
            out.push(("buyer_bonus_bp", "必须非负"));
        }
        if !(1..=10_000).contains(&self.floor_bp) {
            out.push(("floor_bp", "必须在 1–10000 之间"));
        }
        out
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketUnlock {
    pub loc: LocId,
    pub good: GoodId,
    pub day: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RareState {
    pub sold_month: i64,
    /// 件数 × 100；每日向下取整地衰减。
    pub sat: i64,
}

impl RareState {
    pub fn is_unset(&self) -> bool {
        self.sold_month == 0 && self.sat == 0
    }
}

/// 静态查询没有记录时，条件条目视为尚未开放；运行时必须传入存档里的记录。
pub fn market_open(defs: &StaticData, records: &[MarketUnlock], loc: LocId, good: GoodId) -> bool {
    !defs.rules.stage_unlocks.enabled
        || defs.locations.get(loc.idx()).is_none_or(|l| !l.unlocks.iter().any(|u| u.good == good))
        || records.iter().any(|u| u.loc == loc && u.good == good)
}

pub fn is_rare(defs: &StaticData, good: GoodId) -> bool {
    defs.rules.rare.enabled && defs.goods.get(good.idx()).is_some_and(|g| g.secret)
}

pub fn rare_source(defs: &StaticData, good: GoodId) -> Option<LocId> {
    defs.rare_source.get(good.idx()).copied().flatten()
}

impl World {
    pub fn rare_good(&self, good: GoodId) -> bool {
        is_rare(&self.defs, good)
    }

    pub fn market_open(&self, loc: LocId, good: GoodId) -> bool {
        market_open(&self.defs, &self.state.unlocks, loc, good)
    }

    /// 隐秘货一经产地开放便全局露面，普通货始终可见。
    pub fn good_revealed(&self, good: GoodId) -> bool {
        !self.defs.rules.stage_unlocks.enabled
            || self.defs.goods.get(good.idx()).is_none_or(|g| !g.secret)
            || self.state.unlocks.iter().any(|u| u.good == good)
    }

    fn unlock_condition(&self, loc: LocId, u: &MarketUnlockDef) -> bool {
        u.stage.is_some_and(|s| self.port_stage(loc) >= s)
            || u.discovery.is_some_and(|d| self.state.explore.discovered.contains_key(&d))
            || u.creature.as_ref().is_some_and(|c| self.state.creatures.last.contains_key(c))
            || u.visited.is_some_and(|v| self.state.explore.visited.contains(&v))
    }

    /// 日结第二步最前面执行：按港口编号、作者条目顺序开货；记录本身按 (loc, good) 排序。
    pub fn stage_unlocks_day(&mut self) {
        let defs = self.defs.clone();
        let day = self.state.day;
        let month_start = defs.calendar.date_of(day).day == 1;
        if defs.rules.stage_unlocks.enabled {
            for loc in defs.loc_ids() {
                for u in &defs.loc(loc).unlocks {
                    if self.market_open(loc, u.good) || !self.unlock_condition(loc, u) {
                        continue;
                    }
                    let Some(m) = defs.loc(loc).listed(u.good) else { continue };
                    let Some(ls) = self.state.locations.get_mut(loc.idx()) else { continue };
                    ls.market.insert(u.good, crate::market::new_entry(&defs, m));
                    let record = MarketUnlock { loc, good: u.good, day };
                    let index = self.state.unlocks.partition_point(|r| (r.loc, r.good) < (loc, u.good));
                    self.state.unlocks.insert(index, record);
                    self.push_log(LogEvent { day, kind: LogKind::MarketOpened { loc, good: u.good } });
                }
                if !defs.loc(loc).is_port() {
                    continue;
                }
                let stage = self.port_stage(loc);
                let Some(ls) = self.state.locations.get_mut(loc.idx()) else { continue };
                let from = ls.growth.stage_seen.replace(stage);
                if let Some(from) = from
                    && from != stage
                    && self.location_visible(loc)
                {
                    self.push_log(LogEvent { day, kind: LogKind::PortStage { loc, from, to: stage } });
                }
            }
        }
        if defs.rules.rare.enabled {
            for ls in self.state.locations.iter_mut() {
                for (_, entry) in ls.market.iter_mut().filter(|(g, _)| is_rare(&defs, **g)) {
                    entry.rare.sat = mul_div_floor(entry.rare.sat.max(0), 29, 30);
                    if month_start {
                        // 命令先于日结：保留本月一日、生产之前已经买走的数量。
                        entry.rare.sold_month = rare_bought_today(entry, day);
                    }
                }
            }
        }
    }

    pub fn port_stage(&self, loc: LocId) -> u8 {
        self.state.locations.get(loc.idx()).map_or(0, |l| self.defs.rules.development.stage(l.development).0)
    }

    /// 规则关闭时完全保留作者的物品店设置。
    pub fn effective_shop(&self, loc: LocId) -> bool {
        self.defs.locations.get(loc.idx()).is_some_and(|l| {
            l.is_port()
                && (l.shop
                    || self.book_shelf(loc)
                    || (self.defs.rules.stage_unlocks.enabled
                        && self.port_stage(loc) >= self.defs.rules.stage_unlocks.shop_stage))
        })
    }

    pub fn effective_size(&self, loc: LocId) -> u8 {
        let Some(l) = self.defs.locations.get(loc.idx()) else { return 1 };
        let r = &self.defs.rules.stage_unlocks;
        let gain = if r.enabled {
            i64::from(self.port_stage(loc).saturating_sub(self.defs.rules.development.stage(l.development).0))
                .saturating_mul(r.shelf_step)
        } else {
            0
        };
        i64::from(l.size).saturating_add(gain).clamp(1, 5) as u8
    }

    /// 末尾裁决：作者已有书店开局就有独立书架；其余港口随阶段开放。
    pub fn book_shelf(&self, loc: LocId) -> bool {
        let r = &self.defs.rules.stage_unlocks;
        r.enabled
            && self.defs.locations.get(loc.idx()).is_some_and(|l| {
                l.is_port() && (self.authored_facility(loc, "bookshop") || self.port_stage(loc) >= r.book_stage)
            })
    }

    pub fn authored_facility(&self, loc: LocId, facility: &str) -> bool {
        self.defs
            .locations
            .get(loc.idx())
            .and_then(|l| self.defs.geography.places.authored.locations.get(&l.key))
            .is_some_and(|a| a.facilities.iter().any(|f| f == facility))
    }

    pub fn agency_stage_bonus(&self, owner: OwnerId, loc: LocId) -> i64 {
        if !self.agency_on() || self.house_level(owner, loc) == 0 {
            return 0;
        }
        self.stage_bonus(loc, &self.defs.rules.stage_unlocks.agency_bonus)
    }

    pub fn industry_stage_bonus(&self, owner: OwnerId, loc: LocId) -> i64 {
        if self.industry_slots_at_level(0).is_none() || self.house_level(owner, loc) == 0 {
            return 0;
        }
        self.stage_bonus(loc, &self.defs.rules.stage_unlocks.industry_bonus)
    }

    pub fn stage_bonus(&self, loc: LocId, table: &[i64]) -> i64 {
        if self.defs.rules.stage_unlocks.enabled {
            table.get(usize::from(self.port_stage(loc))).copied().unwrap_or(0)
        } else {
            0
        }
    }

    /// 有养成记录时从毕业日开始，否则从取得控制权开始；不把预演年份算进去。
    pub fn rare_rumor(&self, loc: LocId) -> Option<GoodId> {
        let r = &self.defs.rules.stage_unlocks;
        let since = self
            .state
            .upbringing
            .as_ref()
            .and_then(|s| s.graduation.as_ref())
            .map(|g| g.day)
            .or(self.state.control_day)
            .unwrap_or(0);
        if !r.enabled
            || self.upbringing_active()
            || self.day().saturating_sub(since) < r.rumor_after_days
            || !self.fleets_of(OwnerId::Player).any(|f| f.docked_at() == Some(loc))
        {
            return None;
        }
        let hidden: Vec<_> = self.defs.good_ids().filter(|g| !self.good_revealed(*g)).collect();
        if hidden.is_empty() {
            return None;
        }
        let index = (u64::from(self.defs.calendar.month_index(self.day())) + u64::from(loc.0)) % hidden.len() as u64;
        hidden.get(index as usize).copied()
    }

    pub fn rare_limit(&self, loc: LocId, good: GoodId) -> i64 {
        self.defs
            .locations
            .get(loc.idx())
            .and_then(|l| l.unlocks.iter().find(|u| u.good == good))
            .and_then(|u| u.limit)
            .unwrap_or(self.defs.rules.rare.month_limit)
    }

    pub fn rare_left(&self, loc: LocId, good: GoodId) -> i64 {
        let sold = self.market(loc, good).map_or(0, |e| {
            if self.defs.calendar.date_of(self.day()).day == 1 {
                rare_bought_today(e, self.day())
            } else {
                e.rare.sold_month
            }
        });
        self.rare_limit(loc, good).saturating_sub(sold).max(0)
    }

    pub(crate) fn check_rare_buy(&self, loc: LocId, good: GoodId, qty: i64) -> Result<(), CommandError> {
        if qty <= 0 || !is_rare(&self.defs, good) {
            return Ok(());
        }
        if rare_source(&self.defs, good) != Some(loc) || !self.market_open(loc, good) {
            return Err(CommandError::NotSoldHere);
        }
        let left = self.rare_left(loc, good);
        if qty > left {
            return Err(Reason::new("trade.rare_quota", "（待写）")
                .arg("left", TextArg::Int(left))
                .arg("limit", TextArg::Int(self.rare_limit(loc, good)))
                .rule());
        }
        Ok(())
    }

    /// 贸易距离表来自 T04；不可达按峰值距离。
    pub fn rare_cells(&self, loc: LocId, good: GoodId) -> i64 {
        rare_source(&self.defs, good)
            .and_then(|source| self.defs.trade_dist.get(source.idx()).and_then(|row| row.get(loc.idx())))
            .filter(|cells| **cells != u16::MAX)
            .map_or(self.defs.rules.rare.peak_cells, |cells| i64::from(*cells))
    }

    pub fn rare_peak(&self, loc: LocId, good: GoodId) -> Money {
        let r = &self.defs.rules.rare;
        let buyer = self
            .defs
            .locations
            .get(loc.idx())
            .and_then(|l| l.listed(good))
            .is_some_and(|m| m.supply == 0 && m.demand > 0);
        let multiplier = 10_000i64
            .saturating_add(mul_div_floor(
                r.peak_bp - 10_000,
                self.rare_cells(loc, good).min(r.peak_cells),
                r.peak_cells,
            ))
            .saturating_add(if buyer { r.buyer_bonus_bp } else { 0 });
        mul_div(self.defs.good(good).base_price, multiplier, 10_000)
    }

    pub fn rare_sat_bp(&self, loc: LocId, good: GoodId) -> i64 {
        let sat = self.market(loc, good).map_or(0, |e| e.rare.sat.max(0));
        let k = self.defs.rules.rare.saturate.saturating_mul(100);
        mul_div(k, 10_000, k.saturating_add(sat))
    }

    /// 产地以外第 i 件的卖价；不读库存，也不含议价、锚地修正和税。
    pub fn rare_sell_unit(&self, loc: LocId, good: GoodId, index: i64) -> Money {
        let r = &self.defs.rules.rare;
        let sat = self.market(loc, good).map_or(0, |e| e.rare.sat.max(0));
        let k = r.saturate.saturating_mul(100);
        let denominator = k.saturating_add(sat).saturating_add(index.max(0).saturating_mul(100));
        let floor = mul_div_floor(self.defs.good(good).base_price, r.floor_bp, 10_000);
        mul_div(self.rare_peak(loc, good), k, denominator).max(floor)
    }
}

/// 设施只返回已存在机制的键；学院、拍卖与期货交易所由阶段视图单列资格。
pub fn facility_key(key: &str) -> Option<&'static str> {
    match key {
        "tavern" => Some("tavern"),
        "church" => Some("church"),
        "temple" => Some("temple"),
        "mosque" => Some("mosque"),
        "shop" => Some("shop"),
        "bookshop" => Some("bookshop"),
        _ => None,
    }
}

pub fn facilities_at(defs: &StaticData, loc: LocId, development: i64) -> Vec<&'static str> {
    let Some(l) = defs.locations.get(loc.idx()) else { return Vec::new() };
    let mut out = Vec::new();
    if let Some(source) = defs.geography.places.authored.locations.get(&l.key) {
        for facility in source.facilities.iter().filter_map(|key| facility_key(key)) {
            if !out.contains(&facility) {
                out.push(facility);
            }
        }
    }
    if l.shop && !out.contains(&"shop") {
        out.push("shop");
    }
    let r = &defs.rules.stage_unlocks;
    if r.enabled && l.is_port() {
        let stage = defs.rules.development.stage(development).0;
        for (key, threshold) in [("shop", r.shop_stage), ("bookshop", r.book_stage)] {
            if stage >= threshold && !out.contains(&key) {
                out.push(key);
            }
        }
    }
    out
}

/// 月初报价与日结共享当天购入数；不新增存档日期字段。
pub(crate) fn rare_bought_today(entry: &crate::world::MarketEntry, day: u32) -> i64 {
    if entry.flow.day == day {
        entry.flow.player_bought.saturating_add(entry.flow.npc_bought).saturating_add(entry.flow.other_bought).max(0)
    } else {
        0
    }
}
