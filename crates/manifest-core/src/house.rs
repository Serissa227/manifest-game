//! 商馆的回报、风险与目标（T02，交易与投资改造的第二阶段；规格见 `docs/TRADE-PLAN.md` 第 1 节）。
//!
//! T01（[`crate::access`]）把港口投资做成了有台阶的“商馆”；这里给它接上后文：
//!
//! - **分红**（`rules.toml [dividends]`）：每月 1 日，在上个月的腹地收入都进了城镇钱袋之后，
//!   每个在港口有累计投资的所有者应得 `累计投资 × 年利率 ÷ 12 × 市场深度系数`；本港当月可分的总额
//!   `pool = min(Σ应得, 腹地上月收入 × hinterland_pct%, 城镇钱袋余额)`，不够时按应得的比例分、向下取整，零头留在钱袋。
//!   钱从城镇钱袋付给投资者（`Flow::HouseDividend`），守恒。货币流通关闭的世界没有钱袋，也就没有分红。
//! - **遭劫**（同一节的 `sack_*`）：港口被攻破或洗劫时，所有投资者在该港的累计投资减去 `sack_loss_pct`%（向下取整保留），
//!   商馆达到 `sack_house_level` 级的只减 `sack_loss_pct_house`%；商馆等级随之重算。来源是史事的 `port_state = sacked / destroyed`
//!   与 `port_owner` 易手（[`crate::history`]），不另掷随机数。
//! - **船厂随发展度放大船**（`[shipyard_growth]`）：船型按基准价分档（公式，不逐个手填）；港口发展度每跨过一个台阶，
//!   船厂在它已有的船系里多造高一档（含这一档以下还没造的）的船型。基础清单不动。
//! - **商会跟投**（`[npc_invest]`）：每月 1 日，现金高于储备线的商会把超出部分的一成之半投进本据港或上月成交额最高的港口，
//!   走与玩家同一条 `InvestPort` 命令。
//!
//! 三张规则表缺省都关：没有这些段的数据包（经典世界、测试夹具）行为与旧版逐日相同，世界状态里也不多出字段。

use crate::circulation::Sector;
use crate::command::Command;
use crate::error::CoreError;
use crate::fixed::{Money, mul_div, mul_div_floor};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ───────────────────────────── 规则 ─────────────────────────────

/// 分红与遭劫（`rules.toml [dividends]`）。缺省关闭。数值的来历见 `docs/BALANCE.md`（T02）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DividendRules {
    pub enabled: bool,
    /// 年利率（百分比）：应得 = 累计投资 × annual_pct / 100 / 12 × 市场深度系数
    pub annual_pct: i64,
    /// 本港当月可分的总额不超过腹地上月收入的这个百分比
    pub hinterland_pct: i64,
    /// 遭劫时累计投资损失的百分比
    pub sack_loss_pct: i64,
    /// 商馆达到 `sack_house_level` 级的投资者只损失这个百分比
    pub sack_loss_pct_house: i64,
    pub sack_house_level: usize,
    /// 投资面板在遭劫后多少天里标明“上次遭劫、损失多少”
    pub sack_notice_days: u32,
}

impl Default for DividendRules {
    fn default() -> Self {
        DividendRules {
            enabled: false,
            annual_pct: 6,
            hinterland_pct: 10,
            sack_loss_pct: 50,
            sack_loss_pct_house: 25,
            sack_house_level: 3,
            sack_notice_days: 360,
        }
    }
}

impl DividendRules {
    /// 数据校验用：开启时说不通的取值（字段名，问题）。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(0..=100).contains(&self.annual_pct) || !(0..=100).contains(&self.hinterland_pct) {
            out.push(("annual_pct", "annual_pct 与 hinterland_pct 必须在 0 到 100 之间"));
        }
        if !(0..=100).contains(&self.sack_loss_pct) || !(0..=100).contains(&self.sack_loss_pct_house) {
            out.push(("sack_loss_pct", "sack_loss_pct 与 sack_loss_pct_house 必须在 0 到 100 之间"));
        }
        if self.sack_loss_pct_house > self.sack_loss_pct {
            out.push(("sack_loss_pct_house", "商馆够级的投资者损失不能比一般的更多"));
        }
        out
    }
}

/// 一个船系：哪些船型（按基准价分档），以及哪些文化圈的船厂不论已造什么都算在这一系里。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShipLine {
    pub key: String,
    /// 船型 key
    pub ships: Vec<String>,
    /// 这些文化圈的船厂也算这一系（缺省为空：只有已经在造这一系某种船的船厂才算）
    #[serde(default)]
    pub cultures: Vec<String>,
    /// 解析后的船型（数据层加载船型表后填写）
    #[serde(skip)]
    pub ids: Vec<ShipTypeId>,
    #[serde(default)]
    pub foreign: Vec<String>,
    #[serde(skip)]
    pub foreign_ids: Vec<usize>,
}

/// 船厂随发展度放大船（`rules.toml [shipyard_growth]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ShipyardGrowthRules {
    pub enabled: bool,
    /// 船型分档的基准价阈值（升序）：基准价 ≥ 第 k 个阈值的船至少是第 k + 1 档
    pub price_tiers: Vec<Money>,
    /// 发展度台阶（升序）：每跨过一个，船厂多造高一档
    pub steps: Vec<i64>,
    pub lines: Vec<ShipLine>,
    pub foreign_from: usize,
    pub foreign_tiers: Vec<usize>,
}

impl Default for ShipyardGrowthRules {
    fn default() -> Self {
        ShipyardGrowthRules {
            enabled: false,
            price_tiers: vec![8_000, 15_000, 30_000, 50_000],
            steps: vec![65, 80],
            lines: Vec::new(),
            foreign_from: 0,
            foreign_tiers: Vec::new(),
        }
    }
}

impl ShipyardGrowthRules {
    /// 某个基准价落在第几档（0 起）。
    pub fn tier(&self, price: Money) -> usize {
        self.price_tiers.iter().filter(|t| price >= **t).count()
    }

    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if self.price_tiers.windows(2).any(|w| w[0] >= w[1]) || self.price_tiers.iter().any(|p| *p <= 0) {
            out.push(("price_tiers", "分档阈值必须为正且严格递增"));
        }
        if self.steps.is_empty()
            || self.steps.windows(2).any(|w| w[0] >= w[1])
            || self.steps.iter().any(|s| !(1..=9999).contains(s))
        {
            out.push(("steps", "发展度台阶至少一个，在 1 到 9999 之间且严格递增"));
        }
        if self.lines.iter().any(|l| l.ships.is_empty()) {
            out.push(("lines", "每个船系至少要有一种船"));
        }
        if self.foreign_from > 0
            && (self.foreign_from > self.steps.len()
                || self.foreign_tiers.len() != self.steps.len().saturating_sub(self.foreign_from) + 1
                || self.foreign_tiers.iter().any(|t| *t > 4)
                || self.foreign_tiers.windows(2).any(|w| w[0] > w[1]))
        {
            out.push(("foreign_tiers", "须覆盖 foreign_from 起的每一道台阶，不减且每项在 0–4 之间"));
        }
        for line in &self.lines {
            if self.lines.iter().filter(|l| l.key == line.key).count() != 1 {
                out.push(("lines", "船系键不得重复"));
            }
            if line.foreign.iter().any(|key| key == &line.key || !self.lines.iter().any(|l| &l.key == key)) {
                out.push(("lines.foreign", "外来船系必须已登记且不能是自身"));
            }
        }
        out
    }
}

/// 商会跟投（`rules.toml [npc_invest]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NpcInvestRules {
    pub enabled: bool,
    /// 每月把超出储备线的现金的这个百分比投出去
    pub share_pct: i64,
    /// 储备线 = 上个月的经营开支 × 这个倍数
    pub reserve_months: i64,
    /// 投本据港的概率（百分比）；其余投上月成交额最高的港口
    pub home_pct: i64,
}

impl Default for NpcInvestRules {
    fn default() -> Self {
        NpcInvestRules { enabled: false, share_pct: 5, reserve_months: 6, home_pct: 60 }
    }
}

impl NpcInvestRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(0..=100).contains(&self.share_pct) || !(0..=100).contains(&self.home_pct) || self.reserve_months < 0 {
            out.push(("share_pct", "share_pct 与 home_pct 必须在 0 到 100 之间，reserve_months 不能为负"));
        }
        out
    }
}

// ───────────────────────────── 状态 ─────────────────────────────

/// 本港当月可分的总额被哪一条上限压住了。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DividendCap {
    /// 没被压住：人人照应得的拿
    #[default]
    None,
    /// 腹地收入的那一条
    Hinterland,
    /// 城镇钱袋的余额
    Purse,
}

/// 某港最近一次分红。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DividendRecord {
    pub day: u32,
    /// 应得合计
    pub due: Money,
    /// 实分合计
    pub paid: Money,
    pub cap: DividendCap,
    /// 各投资者实得（按所有者排序，不含 0）
    pub shares: Vec<(OwnerId, Money)>,
}

impl DividendRecord {
    pub fn share_of(&self, owner: OwnerId) -> Money {
        self.shares.iter().find(|(o, _)| *o == owner).map_or(0, |(_, v)| *v)
    }
}

/// 某港最近一次遭劫：各投资者损失的累计投资。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SackRecord {
    pub day: u32,
    pub losses: Vec<(OwnerId, Money)>,
}

impl SackRecord {
    pub fn loss_of(&self, owner: OwnerId) -> Money {
        self.losses.iter().find(|(o, _)| *o == owner).map_or(0, |(_, v)| *v)
    }
}

/// 这套规则在一局里的状态（规则关闭时为空，不写进存档）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HouseState {
    /// 各港最近一次分红（每月 1 日整张换掉；没有人分到钱的港口不记）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dividends: BTreeMap<LocId, DividendRecord>,
    /// 各港最近一次遭劫
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sacks: BTreeMap<LocId, SackRecord>,
    /// 商会本月在各港的成交额（不含税；跟投挑港口用，每月 1 日清空）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub turnover: BTreeMap<OwnerId, BTreeMap<LocId, Money>>,
}

impl HouseState {
    pub fn is_empty(&self) -> bool {
        *self == HouseState::default()
    }
}

// ───────────────────────────── 船厂 ─────────────────────────────

/// 某港在某个发展度下的船厂清单：数据里的基础清单在前，随发展度多出来的船型按船系的顺序接在后面。
/// 规则关闭、或这里本来没有船厂时就是基础清单。只依赖静态数据（数据测试与界面拿它算“到多少发展度开造”）。
pub fn shipyard_at(defs: &crate::defs::StaticData, loc: LocId, development: i64) -> Vec<ShipTypeId> {
    let Some(l) = defs.locations.get(loc.idx()) else { return Vec::new() };
    let base = l.shipyard.clone();
    let r = &defs.rules.shipyard_growth;
    if !r.enabled || base.is_empty() {
        return base;
    }
    let reached = r.steps.iter().filter(|s| development >= **s).count();
    if reached == 0 {
        return base;
    }
    let tier = |s: ShipTypeId| defs.ships.get(s.idx()).map_or(usize::MAX, |d| r.tier(d.price));
    let yard_top = base.iter().map(|s| tier(*s)).max().unwrap_or(0);
    let own: Vec<_> = r
        .lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            let mine: Vec<_> = line.ids.iter().filter(|s| base.contains(s)).map(|s| tier(*s)).collect();
            (!mine.is_empty() || line.cultures.contains(&l.culture))
                .then(|| (i, mine.into_iter().max().unwrap_or(yard_top)))
        })
        .collect();
    let foreign: Vec<_> = own
        .iter()
        .flat_map(|(i, _)| r.lines[*i].foreign_ids.iter().copied())
        .filter(|i| !own.iter().any(|(j, _)| j == i))
        .collect();
    let mut out = base.clone();
    // 逐台阶追加：保留低台阶清单为高台阶清单的开头；外来船按规则表船系顺序。
    for step in 1..=reached {
        for (i, top) in &own {
            for s in &r.lines[*i].ids {
                let unique = defs.ships.get(s.idx()).is_none_or(|d| d.unique);
                if !unique && tier(*s) <= top.saturating_add(step) && !out.contains(s) {
                    out.push(*s);
                }
            }
        }
        if r.foreign_from == 0 || step < r.foreign_from {
            continue;
        }
        let Some(top) = r.foreign_tiers.get(step - r.foreign_from) else { continue };
        for (_, line) in r.lines.iter().enumerate().filter(|(i, _)| foreign.contains(i)) {
            for s in &line.ids {
                let unique = defs.ships.get(s.idx()).is_none_or(|d| d.unique);
                if !unique && tier(*s) <= *top && !out.contains(s) {
                    out.push(*s);
                }
            }
        }
    }
    out
}

/// 某港的船厂还没开造、随发展度会开造的船型，与开造要的发展度（按台阶从低到高）。
pub fn shipyard_upcoming(defs: &crate::defs::StaticData, loc: LocId) -> Vec<(ShipTypeId, i64)> {
    let r = &defs.rules.shipyard_growth;
    if !r.enabled {
        return Vec::new();
    }
    let mut seen = shipyard_at(defs, loc, 0);
    let mut out = Vec::new();
    for step in &r.steps {
        for s in shipyard_at(defs, loc, *step) {
            if !seen.contains(&s) {
                seen.push(s);
                out.push((s, *step));
            }
        }
    }
    out
}

impl World {
    /// 某港船厂现在出售的船型（随发展度；规则关闭时就是数据里的清单）。
    pub fn shipyard(&self, loc: LocId) -> Vec<ShipTypeId> {
        let dev = self.state.locations.get(loc.idx()).map_or(0, |l| l.development);
        shipyard_at(&self.defs, loc, dev)
    }

    /// 某港船厂现在是否出售这种船。
    pub fn shipyard_sells(&self, loc: LocId, ship: ShipTypeId) -> bool {
        match self.defs.locations.get(loc.idx()) {
            Some(l) if l.shipyard.contains(&ship) => true,
            Some(_) if self.defs.rules.shipyard_growth.enabled => self.shipyard(loc).contains(&ship),
            _ => false,
        }
    }
}

// ───────────────────────────── 分红 ─────────────────────────────

/// 某笔累计投资在某个发展度下一个月应得的分红。
pub fn dividend_due(defs: &crate::defs::StaticData, invested: Money, development: i64) -> Money {
    let r = &defs.rules.dividends;
    if invested <= 0 {
        return 0;
    }
    let deep = crate::market::depth_factor(defs, development).apply(invested);
    mul_div_floor(deep, r.annual_pct, 1200).max(0)
}

/// 本港这个月可分的总额与压住它的上限（还没有扣钱）。
fn dividend_pool(world: &World, loc: LocId, due: Money, month_days: u32) -> (Money, DividendCap) {
    let r = &world.defs.rules.dividends;
    let hinterland =
        mul_div_floor(world.hinterland_income(loc).saturating_mul(i64::from(month_days)), r.hinterland_pct, 100);
    let purse = world.purse(loc).map_or(0, |p| p.money.max(0));
    if due <= hinterland && due <= purse {
        (due, DividendCap::None)
    } else if hinterland <= purse {
        (hinterland.max(0), DividendCap::Hinterland)
    } else {
        (purse, DividendCap::Purse)
    }
}

impl World {
    /// 分红这条规则是否在起作用（要有城镇钱袋：钱从那里出）。
    pub fn dividends_on(&self) -> bool {
        self.defs.rules.dividends.enabled && self.circulation_on()
    }

    /// 账本日结的一部分：每月 1 日给各港的投资者分红（在当天的腹地收入入账之前；上个月的都已入账）。
    pub(crate) fn dividends_month_start(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        if !self.dividends_on() || day == 0 || !self.defs.calendar.month_start(day) {
            return Ok(());
        }
        let month_days = self.defs.calendar.month_days(day - 1);
        let mut records = BTreeMap::new();
        let ports: Vec<LocId> = self.defs.port_ids().collect();
        for loc in ports {
            let Some(ls) = self.state.locations.get(loc.idx()) else { continue };
            if ls.investments.is_empty() {
                continue;
            }
            let dev = ls.development;
            let dues: Vec<(OwnerId, Money)> = ls
                .investments
                .iter()
                .filter(|(o, _)| self.state.agents.get(o).is_some_and(|a| !a.bankrupt))
                .map(|(o, v)| (*o, dividend_due(&self.defs, *v, dev)))
                .filter(|(_, d)| *d > 0)
                .collect();
            let due: Money = dues.iter().map(|(_, d)| *d).sum();
            if due <= 0 {
                continue;
            }
            let (pool, cap) = dividend_pool(self, loc, due, month_days);
            let mut shares = Vec::new();
            for (owner, d) in dues {
                // 不够时按应得的比例分，向下取整，零头留在钱袋
                let share = if pool >= due { d } else { mul_div_floor(d, pool, due).min(d) };
                if share <= 0 {
                    continue;
                }
                self.book_external(
                    owner,
                    Flow::HouseDividend,
                    Sector::Town(loc),
                    JournalEntry::new(day, Memo::HouseDividend, CashClass::Investing)
                        .dr(Account::Cash, share)
                        .cr(Account::HouseDividends, share),
                )?;
                shares.push((owner, share));
            }
            let paid: Money = shares.iter().map(|(_, v)| *v).sum();
            if paid > 0 {
                records.insert(loc, DividendRecord { day, due, paid, cap, shares });
            }
        }
        if !records.is_empty() {
            let total: Money = records.values().map(|r| r.paid).sum();
            let player: Money = records.values().map(|r| r.share_of(OwnerId::Player)).sum();
            let capped = records.values().filter(|r| r.cap != DividendCap::None).count() as u32;
            let (top, top_paid) = records
                .iter()
                .max_by(|a, b| a.1.paid.cmp(&b.1.paid).then(b.0.cmp(a.0)))
                .map(|(l, r)| (*l, r.paid))
                .unwrap_or((LocId(0), 0));
            let player_ports = records.values().filter(|r| r.share_of(OwnerId::Player) > 0).count() as u32;
            self.push_log(LogEvent {
                day,
                kind: LogKind::HouseDividends {
                    total,
                    ports: records.len() as u32,
                    capped,
                    loc: top,
                    top: top_paid,
                    player,
                    player_ports,
                },
            });
        }
        self.state.house.dividends = records;
        Ok(())
    }
}

// ───────────────────────────── 遭劫 ─────────────────────────────

impl World {
    /// 港口遭劫：所有投资者在该港的累计投资按比例减少（商馆够级的少减），商馆等级随之重算，同盟港重新判定。
    /// 规则关闭、或没有人在那里投过钱时什么也不做。
    pub(crate) fn sack_port(&mut self, loc: LocId) {
        let r = self.defs.rules.dividends.clone();
        if !r.enabled {
            return;
        }
        let day = self.state.day;
        // 同一天里同一座港口只算一次（一件史事里既易手又洗劫时不折两遍）
        if self.state.house.sacks.get(&loc).is_some_and(|s| s.day == day) {
            return;
        }
        let Some(ls) = self.state.locations.get(loc.idx()) else { return };
        let before: Vec<(OwnerId, Money)> = ls.investments.iter().map(|(o, v)| (*o, *v)).collect();
        let mut losses = Vec::new();
        for (owner, v) in before {
            let pct = if self.house_level(owner, loc) >= r.sack_house_level {
                r.sack_loss_pct_house
            } else {
                r.sack_loss_pct
            };
            let keep = mul_div_floor(v, 100 - pct.clamp(0, 100), 100).clamp(0, v);
            if keep < v {
                losses.push((owner, v - keep));
                self.state.locations[loc.idx()].investments.insert(owner, keep);
            }
        }
        // 归零的不留空条目（与从没投过一样）
        self.state.locations[loc.idx()].investments.retain(|_, v| *v > 0);
        if losses.is_empty() {
            return;
        }
        let total: Money = losses.iter().map(|(_, v)| *v).sum();
        let player = losses.iter().find(|(o, _)| o.is_player()).map_or(0, |(_, v)| *v);
        let investors = losses.len() as u32;
        self.state.house.sacks.insert(loc, SackRecord { day, losses });
        self.push_log(LogEvent { day, kind: LogKind::HouseSacked { loc, total, investors, player } });
        self.update_ally(loc);
    }

    /// 某港最近一次遭劫（还在面板该提起的日子里；规则关闭时为 None）。
    pub fn recent_sack(&self, loc: LocId) -> Option<&SackRecord> {
        let r = &self.defs.rules.dividends;
        if !r.enabled {
            return None;
        }
        self.state.house.sacks.get(&loc).filter(|s| self.state.day < s.day.saturating_add(r.sack_notice_days))
    }
}

// ───────────────────────────── 商会跟投 ─────────────────────────────

/// 成交时记下商会在这座港口本月的成交额（跟投规则打开时；其余时候什么也不做）。
pub(crate) fn note_turnover(world: &mut World, owner: OwnerId, loc: LocId, gross: Money) {
    if !world.defs.rules.npc_invest.enabled || owner.company().is_none() || gross <= 0 {
        return;
    }
    *world.state.house.turnover.entry(owner).or_default().entry(loc).or_insert(0) += gross;
}

/// 某个所有者上个月的开支（月报里的费用合计，含销售成本——买货的本钱是商会最大的一笔周转——只扣掉投资支出本身；
/// 还没有月报时为 None）。
fn monthly_spending(world: &World, owner: OwnerId) -> Option<Money> {
    let report = world.state.agents.get(&owner)?.ledger.monthly.last()?;
    let skip: Money =
        report.income.expenses.iter().filter(|(a, _)| matches!(a, Account::Investment)).map(|(_, v)| *v).sum();
    Some((report.income.total_expense - skip).max(0))
}

impl World {
    /// NPC 决策的一部分：每月 1 日，现金高于储备线的商会把超出部分的 `share_pct`% 投进一个港口
    /// （`home_pct`% 的机会投本据港，否则投上月成交额最高的港口）。走与玩家相同的 `InvestPort` 命令。
    pub(crate) fn npc_invest_step(&mut self) -> Result<(), CoreError> {
        let r = self.defs.rules.npc_invest.clone();
        let day = self.state.day;
        if !r.enabled || !self.defs.calendar.month_start(day) {
            return Ok(());
        }
        let turnover = std::mem::take(&mut self.state.house.turnover);
        let companies: Vec<OwnerId> = self
            .state
            .agents
            .values()
            .filter(|a| !a.bankrupt && a.owner.company().is_some())
            .map(|a| a.owner)
            .collect();
        let min = self.defs.rules.invest.min_amount;
        for owner in companies {
            let Some(spending) = monthly_spending(self, owner) else { continue };
            let Ok(agent) = self.agent(owner) else { continue };
            let (cash, home) = (agent.cash, agent.home);
            // 储备线：上月开支的若干倍；也不低于商会自己的储备（本据船厂最贵的船 × 商会 2.0 的 reserve_ships，
            // 与它付维护费、年末分红用的是同一条线）
            let own = self.defs.loc(home).shipyard.iter().map(|s| self.defs.ship(*s).price).max().unwrap_or(0)
                * self.defs.rules.npc.v2.reserve_ships;
            let reserve = spending.saturating_mul(r.reserve_months).max(own);
            let amount = mul_div((cash - reserve).max(0), r.share_pct, 100);
            if amount < min.max(1) {
                continue;
            }
            let busiest = turnover
                .get(&owner)
                .and_then(|m| m.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))).map(|(l, _)| *l))
                .filter(|l| self.defs.loc(*l).is_port());
            let home_port = self.defs.locations.get(home.idx()).is_some_and(|l| l.is_port()).then_some(home);
            let cid = owner.company().map_or(0, |c| u64::from(c.0));
            let mut rng = Rng::derive(self.state.seed, day, Domain::NpcInvest, cid, 0);
            let roll_home = (rng.below(100) as i64) < r.home_pct;
            let target = if roll_home { home_port.or(busiest) } else { busiest.or(home_port) };
            if let Some(loc) = target {
                let _ = Command::InvestPort { owner, loc, amount }.apply(self);
            }
        }
        Ok(())
    }

    /// 某港投资者的排名（累计投资从多到少，同额按所有者），最多 n 名。
    pub fn top_investors(&self, loc: LocId, n: usize) -> Vec<(OwnerId, Money)> {
        let Some(ls) = self.state.locations.get(loc.idx()) else { return Vec::new() };
        let mut list: Vec<(OwnerId, Money)> =
            ls.investments.iter().map(|(o, v)| (*o, *v)).filter(|(_, v)| *v > 0).collect();
        list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        list.truncate(n);
        list
    }
}

#[cfg(test)]
mod tests;
