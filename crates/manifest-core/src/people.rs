//! 人口、繁荣度与需求层级（ECONOMY.md 6.4，规则见 [`crate::defs::PopulationRules`]）。
//!
//! - 港口与内陆城市有人口与繁荣度（殖民点另有殖民地自己的人口规则，不在这里）。
//! - 需求规模（目标库存）乘人口比例、需求层级系数与替代系数（[`demand_scale`]）；产量乘劳动力（人口比例，最多 1）。
//! - 每天收盘之后（[`World::people_day`]）：同组商品的替代系数向按价格分摊的份额移动一步，记下各层的满足度与库存指数，
//!   繁荣度向目标移动一步；月末头一年记下各月的参照，此后按满足度指数定繁荣度的目标、按繁荣度增减人口，并更新市况（带滞回）。
//! - 规则关闭时这里什么也不做，人口状态保持全零、不写进存档。

use crate::defs::{NeedTier, PopulationRules, StaticData};
use crate::fixed::Fx;
use crate::ids::{GoodId, LocId};
use crate::log::{LogEvent, LogKind};
use crate::world::{LocationState, MarketEntry, World};
use serde::{Deserialize, Serialize};

/// 港口市况：由满足度、繁荣度与库存派生、带滞回的离散状态。只允许追加。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Condition {
    /// 平稳
    #[default]
    Stable,
    /// 繁荣：繁荣度高
    Boom,
    /// 萧条：繁荣度低
    Depression,
    /// 饥荒：必需品远比往常短缺
    Famine,
    /// 过剩：库存普遍高于往常
    Glut,
}

impl Condition {
    pub const ALL: [Condition; 5] =
        [Condition::Stable, Condition::Boom, Condition::Depression, Condition::Famine, Condition::Glut];

    pub fn key(self) -> &'static str {
        match self {
            Condition::Stable => "stable",
            Condition::Boom => "boom",
            Condition::Depression => "depression",
            Condition::Famine => "famine",
            Condition::Glut => "glut",
        }
    }
}

/// 某地的人口与繁荣度。`pop0 == 0` 表示还没有（规则关闭、没有市场的地点）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct People {
    /// 开局人口与当前人口
    #[serde(default)]
    pub pop0: i64,
    #[serde(default)]
    pub pop: i64,
    /// 繁荣度（0–100）与它每天靠近的目标
    #[serde(default)]
    pub prosperity: Fx,
    #[serde(default)]
    pub goal: Fx,
    /// 本月至今各层满足度之和、库存指数之和（万分之一）与天数；月末用完清零
    #[serde(default)]
    pub sat_sum: [i64; 3],
    #[serde(default)]
    pub stock_sum: i64,
    #[serde(default)]
    pub days: u32,
    /// 上个月各层的满足度（0–1）与库存指数
    #[serde(default)]
    pub sat: [Fx; 3],
    #[serde(default)]
    pub stock_index: Fx,
    /// 头一年各月（1–12 月）的参照：满足度指数、必需品满足度、库存指数（万分之一；12 个月都有之前繁荣度与人口不动）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<[i64; 3]>,
    /// 市况与进入它的日期
    #[serde(default)]
    pub condition: Condition,
    #[serde(default)]
    pub since: u32,
}

/// 繁荣度的中点（0–100 的一半）。
const MID: Fx = Fx::from_int(50);
/// 繁荣度的上限。
const TOP: Fx = Fx::from_int(100);
/// 库存指数里单一商品“库存 / 目标库存”的截断。
const STOCK_CAP: Fx = Fx::from_int(4);

impl People {
    /// 全零：还没有人口（存档里省略）。
    pub fn is_unset(&self) -> bool {
        *self == People::default()
    }

    /// 开局：人口为 `pop0`，繁荣度 50，头一年学参照。
    pub fn fresh(pop0: i64) -> People {
        People { pop0, pop: pop0, prosperity: MID, goal: MID, ..People::default() }
    }

    /// 12 个月的参照都有了（头一年已过）。
    pub fn learned(&self) -> bool {
        self.learned_in(12)
    }

    pub fn learned_in(&self, months: usize) -> bool {
        self.refs.len() == months && self.refs.iter().all(|r| r[0] > 0)
    }

    /// 人口相对开局的比例（没有人口时为 1）。
    pub fn ratio(&self) -> Fx {
        if self.pop0 > 0 { Fx::ratio(self.pop, self.pop0) } else { Fx::ONE }
    }

    /// 劳动力：人口比例，最多 1。
    pub fn labour(&self) -> Fx {
        self.ratio().min(Fx::ONE)
    }
}

/// 需求层级系数：1 + 弹性 × (繁荣度 − 50) / 50，夹在上下限之间；没有层级（生产资料）或没有人口时为 1。
pub fn tier_mult(r: &PopulationRules, p: &People, need: Option<NeedTier>) -> Fx {
    let Some(t) = need else { return Fx::ONE };
    let e = r.elasticity[t.index()];
    if p.pop0 == 0 || e == Fx::ZERO {
        return Fx::ONE;
    }
    (Fx::ONE + e.mul((p.prosperity - MID).div(MID))).clamp(r.tier_min, r.tier_max)
}

/// 替代系数（1 + 偏离）。
pub fn substitute_mult(e: &MarketEntry) -> Fx {
    Fx(Fx::SCALE + e.subst_bp)
}

/// 某市场的需求规模的三个分量：人口比例、需求层级系数、替代系数。规则关闭或没有人口时都是 1。
pub fn demand_scale(defs: &StaticData, p: &People, good: GoodId, e: &MarketEntry) -> (Fx, Fx, Fx) {
    let r = &defs.rules.population;
    if !r.enabled || p.pop0 == 0 {
        return (Fx::ONE, Fx::ONE, Fx::ONE);
    }
    (p.ratio(), tier_mult(r, p, defs.good(good).need), substitute_mult(e))
}

/// 当天的各层满足度（万分之一）与库存指数：每层取各商品（同一替代组合成一项，按合计的库存与目标库存）
/// “库存 / 目标库存”截断到 1 的均值，某层没有商品时为 1；库存指数是全部商品“库存 / 目标库存”截断到 4 的均值。
pub fn satisfaction(defs: &StaticData, ls: &LocationState) -> ([i64; 3], i64) {
    let mut sum = [0i64; 3];
    let mut n = [0i64; 3];
    let (mut stock_sum, mut stock_n) = (0i64, 0i64);
    // 替代组：（组号, 层级, 库存合计, 目标库存合计）
    let mut groups: Vec<(u16, usize, i64, i64)> = Vec::new();
    // 开放市场补上的只收不卖的条目不算（城镇的满足度只看地点清单里的商品）
    for (g, e) in ls.market.iter().filter(|(_, e)| !e.extra) {
        let ratio = Fx::ratio(e.stock.max(0), e.target.max(1));
        stock_sum += ratio.min(STOCK_CAP).raw();
        stock_n += 1;
        let def = defs.good(*g);
        let Some(t) = def.need else { continue };
        match def.group {
            Some(gi) => match groups.iter_mut().find(|x| x.0 == gi) {
                Some(x) => {
                    x.2 += e.stock.max(0);
                    x.3 += e.target.max(1);
                }
                None => groups.push((gi, t.index(), e.stock.max(0), e.target.max(1))),
            },
            None => {
                sum[t.index()] += ratio.min(Fx::ONE).raw();
                n[t.index()] += 1;
            }
        }
    }
    for (_, t, stock, target) in groups {
        sum[t] += Fx::ratio(stock, target).min(Fx::ONE).raw();
        n[t] += 1;
    }
    let sat = [0, 1, 2].map(|k| if n[k] > 0 { sum[k] / n[k] } else { Fx::SCALE });
    let stock = if stock_n > 0 { stock_sum / stock_n } else { Fx::SCALE };
    (sat, stock)
}

/// 替代：同一组里本地有两种以上商品时，按价格重新分摊这一组的需求——份额 ∝ 基础需求 / (价格 / 正常价)²
/// （正常价见 [`crate::market::normal_price`]：只看相对往常的涨跌，各地的特产本来就便宜，不因此多分到需求），
/// 单一商品的份额不超过上限（基础份额本来就更高的不再增加），超出的部分按比例分给其余商品；
/// 替代系数（份额 / 基础份额）每天向新值移动一步，夹在 0.2–5 倍。组里只剩一种商品时系数回到 1。
fn substitute_day(defs: &StaticData, ls: &mut LocationState) {
    let r = &defs.rules.population;
    // （组号, 商品, 基础需求, 相对价格）；市场按商品编号排序，结果与迭代顺序无关
    let mut members: Vec<(u16, GoodId, i64, Fx)> = Vec::new();
    // 开放市场补上的只收不卖的条目不参与替代（替代只在地点清单里的同组商品之间）
    for (g, e) in ls.market.iter().filter(|(_, e)| !e.extra) {
        if let Some(gi) = defs.good(*g).group {
            let normal = crate::market::normal_price(defs, e);
            let rel = Fx::ratio(e.price.max(1), normal.max(1)).clamp(Fx::from_pct(10), Fx::from_int(10));
            members.push((gi, *g, e.demand.max(1), rel));
        }
    }
    members.sort_by_key(|m| (m.0, m.1));
    let mut i = 0;
    while i < members.len() {
        let gi = members[i].0;
        let end = members[i..].iter().position(|m| m.0 != gi).map(|p| i + p).unwrap_or(members.len());
        let group = &members[i..end];
        i = end;
        if group.len() < 2 {
            for m in group {
                if let Some(e) = ls.market.get_mut(&m.1) {
                    e.subst_bp = 0;
                }
            }
            continue;
        }
        let total: i64 = group.iter().map(|m| m.2).sum();
        let base: Vec<Fx> = group.iter().map(|m| Fx::ratio(m.2, total)).collect();
        let raw: Vec<Fx> = group.iter().zip(&base).map(|(m, b)| b.div(m.3.mul(m.3)).max(Fx(1))).collect();
        let raw_sum = raw.iter().fold(Fx::ZERO, |s, x| s + *x);
        let mut share: Vec<Fx> = raw.iter().map(|x| x.div(raw_sum)).collect();
        // 单一商品的上限：超出的部分按比例分给没有超出的商品
        let cap: Vec<Fx> = base.iter().map(|b| r.substitution_cap.max(*b)).collect();
        let mut excess = Fx::ZERO;
        for (s, c) in share.iter_mut().zip(&cap) {
            if *s > *c {
                excess += *s - *c;
                *s = *c;
            }
        }
        if excess > Fx::ZERO {
            let room = share.iter().zip(&cap).filter(|(s, c)| s < c).fold(Fx::ZERO, |a, (s, _)| a + *s);
            if room > Fx::ZERO {
                for (s, c) in share.iter_mut().zip(&cap) {
                    if *s < *c {
                        *s = (*s + excess.mul(s.div(room))).min(*c);
                    }
                }
            }
        }
        for ((m, b), s) in group.iter().zip(&base).zip(&share) {
            let want = s.div(*b);
            if let Some(e) = ls.market.get_mut(&m.1) {
                let cur = substitute_mult(e);
                let next = (cur + (want - cur).mul(r.substitution_rate)).clamp(Fx::from_pct(20), Fx::from_int(5));
                e.subst_bp = next.raw() - Fx::SCALE;
            }
        }
    }
}

/// 下一个市况：按饥荒、萧条、繁荣、过剩的先后找第一个成立的；当前市况用解除门槛（滞回），其余用进入门槛。
/// 繁荣排在过剩之前：供货充足、满足度上去了的港口是“繁荣”；满足度没变而库存堆高（多是当地本来就够的东西）才是“过剩”。
pub fn next_condition(r: &PopulationRules, cur: Condition, essential: Fx, prosperity: Fx, stock: Fx) -> Condition {
    let active = |c: Condition| {
        let held = c == cur;
        let pick = |pair: (Fx, Fx)| if held { pair.1 } else { pair.0 };
        match c {
            Condition::Famine => essential < pick(r.famine),
            Condition::Depression => prosperity < pick(r.depression),
            Condition::Glut => stock > pick(r.glut),
            Condition::Boom => prosperity > pick(r.boom),
            Condition::Stable => true,
        }
    };
    [Condition::Famine, Condition::Depression, Condition::Boom, Condition::Glut]
        .into_iter()
        .find(|c| active(*c))
        .unwrap_or(Condition::Stable)
}

/// 月末（`month` 为刚结束的月份 1–12）：头一年记下当月的参照；此后繁荣度的目标 = 50 × (1 + 灵敏度 × (当月指数 / 当月参照 − 1))，
/// 人口按繁荣度增减，市况按必需品满足度、繁荣度与库存指数更新。
fn month_end(r: &PopulationRules, p: &mut People, month: u32, day: u32, months: usize, dev_cap: Option<i64>) {
    let days = i64::from(p.days.max(1));
    let sat = p.sat_sum.map(|s| s / days);
    let stock = p.stock_sum / days;
    let index = (0..3).fold(Fx::ZERO, |acc, k| acc + Fx(sat[k]).mul(r.weights[k]));
    p.sat = sat.map(Fx);
    p.stock_index = Fx(stock);
    p.sat_sum = [0; 3];
    p.stock_sum = 0;
    p.days = 0;
    if !p.learned_in(months) {
        p.refs.resize(months, [0; 3]);
        if let Some(slot) = p.refs.get_mut(month.saturating_sub(1) as usize)
            && slot[0] == 0
        {
            *slot = [index.raw().max(1), sat[0].max(1), stock.max(1)];
        }
        return;
    }
    let rf = p.refs[month.saturating_sub(1) as usize];
    let rel = Fx::ratio(index.raw(), rf[0]) - Fx::ONE;
    p.goal = MID.mul(Fx::ONE + r.sensitivity.mul(rel)).clamp(Fx::ZERO, TOP);
    let growth = r.growth.mul((p.prosperity - MID).div(MID));
    let lo = r.min_ratio.apply(p.pop0).max(1);
    let hi = dev_cap.unwrap_or_else(|| r.max_ratio.apply(p.pop0)).max(lo);
    let next = (p.pop + growth.apply(p.pop)).clamp(lo, hi);
    p.pop = if dev_cap.is_some() {
        // 新上限下降时也逐月收敛，避免事件或迁移让人口瞬间跌落；月变化不超过 0.25%。
        let step = crate::fixed::mul_div_floor(p.pop, 25, 10_000);
        next.clamp(p.pop - step, p.pop + step)
    } else {
        next
    };
    let next = next_condition(r, p.condition, Fx::ratio(sat[0], rf[1]), p.prosperity, Fx::ratio(stock, rf[2]));
    if next != p.condition {
        p.condition = next;
        p.since = day;
    }
}

impl World {
    /// 让人口与规则对齐：规则打开时为有市场的港口与城市补上人口（新开局与旧存档都从这里开始，头一年学参照）。
    pub(crate) fn init_people(&mut self) {
        let r = &self.defs.rules.population;
        if !r.enabled {
            return;
        }
        for (ls, def) in self.state.locations.iter_mut().zip(&self.defs.locations) {
            if def.is_site() || def.market.is_empty() || ls.people.pop0 > 0 {
                continue;
            }
            ls.people = People::fresh(crate::development::initial_population(&self.defs, ls.development).max(1));
        }
    }

    /// tick 第 3 步（收盘之后）：替代系数、满足度与库存指数、繁荣度；月末更新繁荣度的目标、人口与市况。
    pub(crate) fn people_day(&mut self) {
        let defs = self.defs.clone();
        let r = &defs.rules.population;
        if !r.enabled {
            return;
        }
        let day = self.state.day;
        let month_end_today = self.defs.calendar.month_end(day);
        let month = self.defs.calendar.date_of(day).month;
        let mut changes = Vec::new();
        for (li, ls) in self.state.locations.iter_mut().enumerate() {
            if ls.people.pop0 == 0 {
                continue;
            }
            substitute_day(&defs, ls);
            let (sat, stock) = satisfaction(&defs, ls);
            let p = &mut ls.people;
            for (acc, s) in p.sat_sum.iter_mut().zip(sat) {
                *acc += s;
            }
            p.stock_sum += stock;
            p.days += 1;
            p.prosperity = (p.prosperity + (p.goal - p.prosperity).mul(r.prosperity_daily)).clamp(Fx::ZERO, TOP);
            if month_end_today {
                let before = p.condition;
                let cap = defs.rules.development.enabled.then(|| {
                    crate::development::population_cap(&defs, ls.development, defs.locations[li].development, p.pop0)
                });
                month_end(r, p, month, day, defs.calendar.months().len(), cap);
                if p.condition != before && p.condition != Condition::Stable {
                    changes.push((LocId::from_idx(li), p.condition));
                }
            }
        }
        for (loc, condition) in changes {
            self.push_log(LogEvent { day, kind: LogKind::PortCondition { loc, condition } });
        }
    }

    /// 某地的人口（没有人口时为 None）。
    pub fn people(&self, loc: LocId) -> Option<&People> {
        self.state.locations.get(loc.idx()).map(|l| &l.people).filter(|p| p.pop0 > 0)
    }

    /// 港口与城市此刻还能招到的人手（ECONOMY.md 6.4：新船员来自当地人口，人口不能招到下限以下）；
    /// 人口规则关闭、殖民点或没有人口时为 None（不受限制）。与招募船员的校验同一个算法。
    pub fn hands_for_hire(&self, loc: LocId) -> Option<i64> {
        let r = &self.defs.rules.population;
        if !r.enabled || self.defs.locations.get(loc.idx()).is_none_or(|d| d.is_site()) {
            return None;
        }
        let p = self.people(loc)?;
        let floor = r.min_ratio.apply(p.pop0).max(1);
        Some((p.pop - floor).max(0))
    }

    /// 这支舰队此刻最多还能招募多少船员（不算现金）：不超过船员上限；在港口受当地人手限制，
    /// 在自己的殖民地从殖民者里招（至少留下 1 人）；在海上、别人的殖民点或荒野为 0。界面的“一键补足船员”按它封顶。
    pub fn crew_hire_room(&self, fleet: &crate::world::Fleet) -> i64 {
        let Some(loc) = fleet.docked_at() else { return 0 };
        let room = (fleet.crew_max(&self.defs) - fleet.crew).max(0);
        let hands = if self.defs.loc(loc).is_site() {
            match self.colony_at(loc).filter(|c| c.owner == fleet.owner) {
                Some(c) => (c.population - 1).max(0),
                None => 0,
            }
        } else {
            self.hands_for_hire(loc).unwrap_or(room)
        };
        room.min(hands)
    }

    /// 港口与城市的人口增减（雇船员、遣散船员；人口规则关闭或没有人口时什么也不做），夹在上下限之间。
    pub(crate) fn adjust_population(&mut self, loc: LocId, delta: i64) {
        let r = &self.defs.rules.population;
        if !r.enabled || self.defs.locations.get(loc.idx()).is_none_or(|d| d.is_site()) {
            return;
        }
        let (min_ratio, max_ratio) = (r.min_ratio, r.max_ratio);
        if let Some(ls) = self.state.locations.get_mut(loc.idx()).filter(|l| l.people.pop0 > 0) {
            let p = &mut ls.people;
            let lo = min_ratio.apply(p.pop0).max(1);
            let hi = if self.defs.rules.development.enabled {
                // 招募与遣散只改变给定人数，超过新上限的旧人口由月结慢慢收敛。
                crate::development::population_cap(&self.defs, ls.development, self.defs.loc(loc).development, p.pop0)
                    .max(p.pop)
            } else {
                max_ratio.apply(p.pop0)
            }
            .max(lo);
            p.pop = (p.pop + delta).clamp(lo, hi);
        }
    }
}
