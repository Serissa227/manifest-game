//! 市场月报（docs/ECONOMY.md 8.5）：每月为上个月行情变化最大的至多两个海区各写一篇，以官方来源发布。
//!
//! 月报只写内核算出的事实（[`ReportFacts`]）：月均价涨得最多与跌得最多的商品、最短缺的商品、涉及本海区势力的进行中政策、
//! 钱袋吃紧或充裕的港口（货币流通，ECONOMY.md 6.9，经济月报的一部分）、本据港在本海区的商会展望。文字由模型写（没有模型时由离线模板拼句），经 `RecordMarketReport` 记下；
//! 内核只查海区、月份、字数与是否已经写过，不改变任何数值。

use crate::error::CommandError;
use crate::fixed::{Fx, mul_div};
use crate::ids::*;
use crate::news;
use crate::text::TextRef;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 月报的字数上限。
pub const MAX_REPORT_CHARS: usize = 400;
/// 保留的月报篇数。
pub const REPORTS_KEPT: usize = 60;
/// 每月至多写几个海区。
pub const REPORTS_PER_MONTH: usize = 2;

/// 一篇记下的月报。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketReport {
    /// 发布的日期
    pub day: u32,
    pub region: RegionId,
    /// 所写的月份（月序，从 0 开始）
    pub month: u32,
    pub text: String,
    /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tpl: Option<TextRef>,
}

/// 某海区上个月的事实（内核算出，月报只能引用这些）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportFacts {
    pub region: RegionId,
    /// 所写的月份（月序）
    pub month: u32,
    /// 月均价相对前一个月涨得最多与跌得最多的（地点, 商品, 涨跌 万分之一）
    pub riser: Option<(LocId, GoodId, i64)>,
    pub faller: Option<(LocId, GoodId, i64)>,
    /// 最短缺的（库存不到目标的三成）
    pub shortage: Option<(LocId, GoodId)>,
    /// 进行中、涉及本海区势力的政策（组合事件的标题）
    pub policy: Option<String>,
    /// 流动性系数离 1 最远（至少差 5%）的港口与它的流动性系数（货币流通打开时）
    pub money: Option<(LocId, Fx)>,
    /// 本据港在本海区的商会展望里最强的一条（商会, 商品, 看法）
    pub outlook: Option<(CompanyId, GoodId, i8)>,
    /// 事件量：涨跌幅度之和加上短缺与政策（挑选海区用）
    pub score: i64,
}

impl ReportFacts {
    /// 是否有可写的事实。
    pub fn has_news(&self) -> bool {
        self.riser.is_some()
            || self.faller.is_some()
            || self.shortage.is_some()
            || self.policy.is_some()
            || self.money.is_some()
    }
}

impl World {
    /// 某地所在的海区（港口的停泊格所在的海区；内陆城市没有）。
    pub fn region_of_loc(&self, loc: LocId) -> Option<RegionId> {
        let l = self.defs.locations.get(loc.idx())?;
        if !l.is_port() {
            return None;
        }
        self.defs.map.region_of(l.cell)
    }

    /// 刚结束的月份（月序）；第一个月还没结束时为 None。
    pub fn last_month(&self) -> Option<u32> {
        self.defs.calendar.month_index(self.state.day).checked_sub(1)
    }

    /// 某海区上个月的事实；没有港口或还没有结束的月份时为 None。
    pub fn report_facts(&self, region: RegionId) -> Option<ReportFacts> {
        let month = self.last_month()?;
        let defs = &self.defs;
        let ports: Vec<LocId> = defs.port_ids().filter(|l| self.region_of_loc(*l) == Some(region)).collect();
        if ports.is_empty() {
            return None;
        }
        let mut riser: Option<(LocId, GoodId, i64)> = None;
        let mut faller: Option<(LocId, GoodId, i64)> = None;
        let mut shortage: Option<(LocId, GoodId, i64)> = None;
        let mut score = 0;
        for &l in &ports {
            for (g, e) in &self.state.locations[l.idx()].market {
                let n = e.monthly.len();
                if n >= 2 {
                    let (prev, now) = (e.monthly[n - 2].max(1), e.monthly[n - 1]);
                    let change = mul_div(now - prev, 10_000, prev);
                    score += change.abs() / 100;
                    if change > 0 && riser.is_none_or(|r| change > r.2) {
                        riser = Some((l, *g, change));
                    }
                    if change < 0 && faller.is_none_or(|f| change < f.2) {
                        faller = Some((l, *g, change));
                    }
                }
                let ratio = mul_div(e.stock, 10_000, e.target.max(1));
                if ratio < 3_000 && shortage.is_none_or(|s| ratio < s.2) {
                    shortage = Some((l, *g, ratio));
                }
            }
        }
        // 只写明显的涨跌（一成以上）
        let riser = riser.filter(|r| r.2 >= 1_000);
        let faller = faller.filter(|f| f.2 <= -1_000);
        let factions: Vec<FactionId> = ports.iter().map(|l| self.location_faction(*l)).collect();
        let today = self.state.day;
        let policy = self
            .state
            .events
            .composed
            .iter()
            .rev()
            .filter(|r| r.end() > today)
            .find(|r| {
                r.effects.iter().any(|e| {
                    e.effect.needs_faction_a()
                        && !e.effect.needs_faction_b()
                        && e.params.good.is_some()
                        && e.params.faction_a.is_some_and(|f| factions.contains(&f))
                })
            })
            .map(|r| r.title.clone());
        let mut outlook: Option<(CompanyId, GoodId, i8)> = None;
        for (owner, a) in &self.state.agents {
            let (Some(c), Some(s)) = (owner.company(), a.strategy.as_ref()) else { continue };
            if a.bankrupt || !ports.contains(&a.home) {
                continue;
            }
            let Some(o) = s.outlook.as_ref().filter(|o| o.day + crate::commerce::OUTLOOK_DAYS > today) else {
                continue;
            };
            for (g, v) in &o.views {
                if *v != 0 && outlook.is_none_or(|x| v.abs() > x.2.abs()) {
                    outlook = Some((c, *g, *v));
                }
            }
        }
        // 钱袋吃紧或充裕：流动性系数离 1 最远、至少差 5% 的港口
        let money = ports
            .iter()
            .filter_map(|l| self.purse(*l).filter(|_| self.circulation_on()).map(|p| (*l, p.liquidity)))
            .filter(|(_, v)| (v.raw() - Fx::SCALE).abs() >= 500)
            .max_by_key(|(l, v)| ((v.raw() - Fx::SCALE).abs(), std::cmp::Reverse(l.0)));
        score += if shortage.is_some() { 10 } else { 0 }
            + if policy.is_some() { 10 } else { 0 }
            + if money.is_some() { 10 } else { 0 };
        Some(ReportFacts {
            region,
            month,
            riser,
            faller,
            shortage: shortage.map(|(l, g, _)| (l, g)),
            policy,
            money,
            outlook,
            score,
        })
    }

    /// 这个月要写月报的海区：上个月有可写的事实、事件量最大的至多两个（按事件量从大到小，同分按海区编号）。
    pub fn report_regions(&self) -> Vec<RegionId> {
        let Some(month) = self.last_month() else { return Vec::new() };
        let mut all: Vec<ReportFacts> = (0..self.defs.regions.len())
            .filter_map(|i| self.report_facts(RegionId::from_idx(i)))
            .filter(|f| f.has_news())
            .filter(|f| !self.state.news.reports.iter().any(|r| r.region == f.region && r.month == month))
            .collect();
        all.sort_by(|a, b| b.score.cmp(&a.score).then(a.region.cmp(&b.region)));
        all.into_iter().take(REPORTS_PER_MONTH).map(|f| f.region).collect()
    }
}

/// `RecordMarketReport` 的预检：海区存在；只写刚结束的月份、每个海区每月一篇；文字 1–400 字。
pub(crate) fn check_report(
    world: &World,
    region: RegionId,
    month: u32,
    text: &str,
    tpl: Option<&TextRef>,
) -> Result<(), CommandError> {
    if world.defs.regions.get(region.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{region:?}")));
    }
    if world.last_month() != Some(month) {
        return Err(CommandError::OutOfRange("只能为刚结束的月份写月报".into()));
    }
    if world.state.news.reports.iter().any(|r| r.region == region && r.month == month) {
        return Err(CommandError::Precondition("这个海区这个月已有月报".into()));
    }
    news::check_text(text, MAX_REPORT_CHARS)?;
    tpl.map_or(Ok(()), TextRef::check)
}

/// 记下一篇月报。
pub(crate) fn exec_report(world: &mut World, region: RegionId, month: u32, text: String, tpl: Option<TextRef>) {
    let day = world.state.day;
    let reports = &mut world.state.news.reports;
    reports.push(MarketReport { day, region, month, text, tpl });
    if reports.len() > REPORTS_KEPT {
        let excess = reports.len() - REPORTS_KEPT;
        reports.drain(0..excess);
    }
}
