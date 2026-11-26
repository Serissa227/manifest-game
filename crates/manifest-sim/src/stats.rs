//! 世界统计：物价指数、净资产等（模拟摘要与平衡报告共用）。

use manifest_core::World;
use manifest_core::fixed::{Fx, Money};
use manifest_core::ids::OwnerId;
use manifest_core::market::at_bound;

/// 物价指数：全部市场条目"现价 / 基准价"的算术平均。
pub fn price_index(world: &World) -> Fx {
    let mut sum = 0i64;
    let mut n = 0i64;
    for ls in &world.state.locations {
        for e in ls.market.values() {
            sum += Fx::ratio(e.price, e.base_price.max(1)).raw();
            n += 1;
        }
    }
    if n == 0 { Fx::ONE } else { Fx(sum / n) }
}

/// 货币总量：货币流通打开时是腹地以外全部账户之和（参与者、城镇、国库、银行，ECONOMY.md 6.9），关闭时是参与者持有的货币。
pub fn money_supply(world: &World) -> Money {
    if world.circulation_on() { world.all_money() - world.state.circulation.hinterland } else { world.total_money() }
}

/// 净资产（账面权益，含未结转利润）。
pub fn net_worth(world: &World, owner: OwnerId) -> Money {
    world.state.agents.get(&owner).map(|a| a.ledger.equity()).unwrap_or(0)
}

/// 仍在经营的 NPC 商会数量与总数。
pub fn companies_alive(world: &World) -> (usize, usize) {
    let all: Vec<_> = world.state.agents.values().filter(|a| a.owner.company().is_some()).collect();
    (all.iter().filter(|a| !a.bankrupt).count(), all.len())
}

/// 全部存活商会的净资产之和与最大值。
pub fn company_wealth(world: &World) -> (Money, Money) {
    let mut total = 0;
    let mut max = 0;
    for a in world.state.agents.values() {
        if a.owner.company().is_some() && !a.bankrupt {
            let w = a.ledger.equity().max(0);
            total += w;
            max = max.max(w);
        }
    }
    (total, max)
}

/// 当前卡在价格下限或上限的市场条目数量（按商品下标统计）与条目总数。
pub fn bound_counts(world: &World) -> (Vec<(u32, u32)>, Vec<u32>) {
    let defs = &world.defs;
    let mut stuck = vec![(0u32, 0u32); defs.goods.len()];
    let mut total = vec![0u32; defs.goods.len()];
    for ls in &world.state.locations {
        for (g, e) in &ls.market {
            let (lo, hi) = at_bound(defs, e);
            let i = g.idx();
            total[i] += 1;
            if lo {
                stuck[i].0 += 1;
            }
            if hi {
                stuck[i].1 += 1;
            }
        }
    }
    (stuck, total)
}
