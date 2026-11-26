//! R10-T04：玩家的代办与航线小账，只供视图读取，不参与任何结算。

use crate::agency::{AgencyFill, OrderSide};
use crate::fixed::Money;
use crate::ids::{FleetId, LocId, OwnerId};
use crate::market::TradeQuote;
use crate::warehouse::Holder;
use crate::world::{FleetLocation, Voyage, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 估算账目缺省关闭；航线记录满时淘汰最久没有跑过的一条。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TradeBooksRules {
    pub enabled: bool,
    pub route_lines: usize,
}

impl Default for TradeBooksRules {
    fn default() -> Self {
        Self { enabled: false, route_lines: 60 }
    }
}

impl TradeBooksRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        if (1..=500).contains(&self.route_lines) {
            Vec::new()
        } else {
            vec![("route_lines", "航线账条数必须在 1 到 500 之间")]
        }
    }
}

fn is_zero(v: &Money) -> bool {
    *v == 0
}

/// 一次靠港停留；from 指向上一程，bought 等下一次离港才归入下一程。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<LocId>,
    pub at: LocId,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub bought: Money,
}

/// 按有向港口对汇总；成本为移动平均，海上开销为固定价估算。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteLine {
    pub from: LocId,
    pub to: LocId,
    pub trips: u32,
    pub days: u32,
    pub sold_total: Money,
    pub sold_cost: Money,
    pub sea_cost: Money,
    pub bought_total: Money,
    pub last_day: u32,
}

/// 每港永久代办小账；只记录玩家，不受最近成交条数上限影响。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AgencyLedger {
    pub buy_qty: i64,
    pub buy_total: Money,
    pub sell_qty: i64,
    pub sell_total: Money,
    pub sell_cost: Money,
    pub fees: Money,
}

impl AgencyLedger {
    pub fn profit(&self) -> Money {
        self.sell_total - self.sell_cost - self.fees
    }
}

/// 新状态为空时不写入旧存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TradeBooksState {
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub stays: BTreeMap<FleetId, Stay>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub outbound: BTreeMap<FleetId, (LocId, Money)>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteLine>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub agency: BTreeMap<LocId, AgencyLedger>,
}

impl TradeBooksState {
    pub fn is_empty(&self) -> bool {
        self.stays.is_empty() && self.outbound.is_empty() && self.routes.is_empty() && self.agency.is_empty()
    }
}

fn fleet_holder(world: &World, owner: OwnerId, holder: Holder, loc: LocId) -> Option<FleetId> {
    if !world.defs.rules.trade_books.enabled || !owner.is_player() {
        return None;
    }
    let Holder::Fleet(fleet) = holder else { return None };
    let f = world.state.fleets.get(&fleet)?;
    (f.owner == owner && f.docked_at() == Some(loc)).then_some(fleet)
}

/// 买入的含税现金付出计入本次停留，下一程到港后才写入航线。
pub(crate) fn note_buy(world: &mut World, owner: OwnerId, holder: Holder, q: &TradeQuote) {
    let Some(fleet) = fleet_holder(world, owner, holder, q.loc) else { return };
    let stay = world.state.books.stays.entry(fleet).or_insert(Stay { from: None, at: q.loc, bought: 0 });
    stay.bought += q.total;
}

/// 本次停留卖出的货归上一程；初始港口没有上一程，仓库与代办也不在此记录。
pub(crate) fn note_sell(world: &mut World, owner: OwnerId, holder: Holder, q: &TradeQuote, cost: Money) {
    let Some(fleet) = fleet_holder(world, owner, holder, q.loc) else { return };
    let Some(stay) = world.state.books.stays.get(&fleet).filter(|s| s.at == q.loc) else { return };
    let Some(from) = stay.from else { return };
    if let Ok(i) = world.state.books.routes.binary_search_by_key(&(from, q.loc), |l| (l.from, l.to)) {
        let line = &mut world.state.books.routes[i];
        line.sold_total += q.total;
        line.sold_cost += cost;
    }
}

impl World {
    /// 日志首次捕捉到这一程时，把本港装货额冻结；不另接航行命令。
    pub(crate) fn books_depart(&mut self, fleet: FleetId) {
        if !self.defs.rules.trade_books.enabled {
            return;
        }
        let Some(f) = self.state.fleets.get(&fleet).filter(|f| f.owner.is_player()) else { return };
        // 旧自动航线的 fleet_port 返回目的港；首次出港无停留记录时，从路径首格找出发港。
        let at = match &f.location {
            FleetLocation::AtSea(Voyage::Route(route)) => {
                route.path.first().and_then(|cell| self.defs.port_ids().find(|l| self.defs.loc(*l).cell == *cell))
            }
            _ => self.fleet_port(f),
        };
        let outbound = self.state.books.stays.remove(&fleet).map(|s| (s.at, s.bought)).or_else(|| at.map(|l| (l, 0)));
        if let Some(outbound) = outbound {
            self.state.books.outbound.insert(fleet, outbound);
        }
    }

    /// 到港后累计海上开销与装货额，并开始一段新的停留。
    pub(crate) fn books_arrive(&mut self, fleet: FleetId, from: Option<LocId>, to: LocId, days: u32) {
        if !self.defs.rules.trade_books.enabled {
            return;
        }
        let Some(f) = self.state.fleets.get(&fleet).filter(|f| f.owner.is_player()) else { return };
        let sea_cost = crate::npc::journey_cost(&self.defs, f, i64::from(days));
        let outbound = self.state.books.outbound.remove(&fleet).or_else(|| from.map(|l| (l, 0)));
        if let Some((from, bought)) = outbound {
            let day = self.day();
            let lines = &mut self.state.books.routes;
            let i = match lines.binary_search_by_key(&(from, to), |l| (l.from, l.to)) {
                Ok(i) => i,
                Err(i) => {
                    lines.insert(
                        i,
                        RouteLine {
                            from,
                            to,
                            trips: 0,
                            days: 0,
                            sold_total: 0,
                            sold_cost: 0,
                            sea_cost: 0,
                            bought_total: 0,
                            last_day: day,
                        },
                    );
                    i
                }
            };
            let line = &mut lines[i];
            line.trips = line.trips.saturating_add(1);
            line.days = line.days.saturating_add(days);
            line.sea_cost += sea_cost;
            line.bought_total += bought;
            line.last_day = day;
            let keep = self.defs.rules.trade_books.route_lines.max(1);
            while lines.len() > keep {
                if let Some(oldest) =
                    lines.iter().enumerate().min_by_key(|(_, l)| (l.last_day, l.from, l.to)).map(|(i, _)| i)
                {
                    lines.remove(oldest);
                }
            }
        }
        self.state.books.stays.insert(fleet, Stay { from: outbound.map(|o| o.0), at: to, bought: 0 });
    }
}

/// 每一笔真实成交后再累计永久账，所有字段只用于展示。
pub(crate) fn note_agency(world: &mut World, fill: &AgencyFill) {
    if !world.defs.rules.trade_books.enabled || !fill.owner.is_player() {
        return;
    }
    let ledger = world.state.books.agency.entry(fill.loc).or_default();
    match fill.side {
        OrderSide::Buy => {
            ledger.buy_qty += fill.qty;
            ledger.buy_total += fill.total;
        }
        OrderSide::Sell => {
            ledger.sell_qty += fill.qty;
            ledger.sell_total += fill.total;
            ledger.sell_cost += fill.cost;
        }
    }
    ledger.fees += fill.fee;
}
