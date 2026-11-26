//! 货物只通过现有货舱与存货账出库；时间性任务留下可重放的实际行程凭据。
use super::{contribution::history_key, *};
use crate::{
    Command, World,
    error::CommandError,
    ledger::{Account, CashClass, JournalEntry, Memo},
    treasury::Flow,
    warehouse::Holder,
    world::FleetLocation,
};
use std::collections::BTreeSet;

pub(super) fn apply(
    w: &mut World,
    owner: OwnerId,
    e: &EventDef,
    l: &LeverDef,
    p: &Payload,
) -> Result<(), CommandError> {
    let port = l.port.as_ref().and_then(|p| w.defs.find_loc(p)).ok_or_else(|| blocked("贡献地点不存在"))?;
    if !w.location_open(port) {
        return Err(blocked("贡献港口尚未开放"));
    }
    match (l.kind, p) {
        (LeverKind::Deliver | LeverKind::Arms | LeverKind::Relief, Payload::Deliver { fleet, goods, donate }) => {
            deliver(w, owner, e, l, *fleet, goods, *donate)
        }
        (LeverKind::Money, Payload::Money { amount }) => {
            if !w.fleets_of(owner).any(|f| f.docked_at() == Some(port)) {
                return Err(CommandError::WrongLocation);
            }
            pay(w, owner, e, l, *amount)?;
            w.add_contribution(owner, e, l, amount.checked_mul(100).ok_or(CommandError::InvalidQuantity)?)
        }
        (LeverKind::Train | LeverKind::Escort, Payload::Commit {}) => commit(w, owner, e, l, port),
        _ => Err(blocked("杠杆不接受这个payload")),
    }
}

pub(super) fn pay(w: &mut World, owner: OwnerId, e: &EventDef, l: &LeverDef, amount: i64) -> Result<(), CommandError> {
    if !(1..=1_000_000_000).contains(&amount) {
        return Err(CommandError::InvalidQuantity);
    }
    let have = w.agent(owner)?.cash;
    if have < amount {
        return Err(CommandError::InsufficientCash { need: amount, have });
    }
    let faction = e
        .sides
        .iter()
        .find(|s| s.key == l.side)
        .and_then(|s| w.defs.find_faction(&s.faction))
        .ok_or_else(|| blocked("贡献的阵营不存在"))?;
    w.book_external(
        owner,
        Flow::Faction,
        crate::circulation::Sector::Treasury(faction),
        JournalEntry::new(w.day(), Memo::Other, CashClass::Operating)
            .dr(Account::OtherExpense, amount)
            .cr(Account::Cash, amount),
    )?;
    Ok(())
}

fn deliver(
    w: &mut World,
    owner: OwnerId,
    e: &EventDef,
    l: &LeverDef,
    fleet: FleetId,
    goods: &[(GoodId, i64)],
    donate: bool,
) -> Result<(), CommandError> {
    let port = l.port.as_ref().and_then(|p| w.defs.find_loc(p)).ok_or_else(|| blocked("贡献地点不存在"))?;
    let f = w.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if f.docked_at() != Some(port) {
        return Err(CommandError::WrongLocation);
    }
    if goods.is_empty() || goods.len() > l.goods.len() {
        return Err(CommandError::InvalidQuantity);
    }
    let mut seen = BTreeSet::new();
    let mut value = 0i64;
    for &(good, qty) in goods {
        let g = w.defs.goods.get(good.idx()).ok_or_else(|| CommandError::NotFound(format!("{good:?}")))?;
        if !seen.insert(good) || qty <= 0 || !l.goods.contains(&g.key) {
            return Err(CommandError::InvalidQuantity);
        }
        let have = w.holder_qty(owner, Holder::Fleet(fleet), good);
        if have < qty {
            return Err(CommandError::InsufficientCargo { have });
        }
        value = value
            .checked_add(g.base_price.checked_mul(qty).ok_or(CommandError::InvalidQuantity)?)
            .ok_or(CommandError::InvalidQuantity)?;
    }
    let c = w.contribution_mut(e, l);
    if c.seized.contains(&owner) {
        return Err(blocked("本事件的走私渠道已经暴露"));
    }
    let attempt = c.attempts;
    let mut rng = crate::rng::Rng::derive(
        w.state.seed,
        w.day(),
        crate::rng::Domain::History,
        history_key(&format!("{}:{}:{owner:?}", e.key, l.key)),
        u64::from(attempt) + 1,
    );
    let seized = l.smuggle
        && rng.chance_bp((l.seizure * 100 - w.attr_hook(owner, crate::captain::AttrHook::Smuggling)).clamp(0, 10_000));
    for &(good, qty) in goods {
        if donate || seized {
            w.holder_take(owner, Holder::Fleet(fleet), good, qty)?;
            let cost = w.agent_mut(owner)?.book.remove(good, qty);
            w.book_internal(
                owner,
                JournalEntry::new(w.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::OtherExpense, cost)
                    .cr(Account::Inventory, cost),
            )?;
        } else {
            Command::Sell { owner, fleet, good, qty, min_total: None }.apply(w)?;
        }
    }
    w.contribution_mut(e, l).attempts = attempt.checked_add(1).ok_or(CommandError::InvalidQuantity)?;
    if seized {
        w.contribution_mut(e, l).seized.insert(owner);
        w.adjust_reputation(owner, w.location_faction(port), -10);
        for effect in &l.seized_effects {
            w.apply_history_effect(effect)?;
        }
        return Ok(());
    }
    w.add_contribution(
        owner,
        e,
        l,
        value.checked_mul(if donate { 100 } else { l.sale_pct }).ok_or(CommandError::InvalidQuantity)?,
    )?;
    // 声望每位贡献者、每个杠杆只发一次；分单不能刷声望。
    if donate && w.contribution_mut(e, l).completed.insert(owner) {
        let faction = e.sides.iter().find(|s| s.key == l.side).and_then(|s| w.defs.find_faction(&s.faction));
        if let Some(f) = faction {
            w.adjust_reputation(owner, f, 1);
        }
    }
    Ok(())
}

fn trainer_present(w: &World, owner: OwnerId, l: &LeverDef, port: LocId) -> bool {
    l.trainer.as_ref().is_some_and(|key| {
        if let Some(mate) = w.defs.find_mate(key).and_then(|id| w.state.mates.get(&id))
            && mate.owner.is_some()
        {
            let at = if owner == OwnerId::Player {
                w.cast_player_place().map(|p| p.loc)
            } else {
                w.flagship(owner).and_then(|id| w.state.fleets.get(&id)).and_then(|f| f.docked_at())
            };
            return mate.owner == Some(owner) && at == Some(port);
        }
        w.person_place(key).is_some_and(|p| p.loc == port)
    })
}

fn commit(w: &mut World, owner: OwnerId, e: &EventDef, l: &LeverDef, port: LocId) -> Result<(), CommandError> {
    let c = w.contribution_mut(e, l).clone();
    if c.completed.contains(&owner) {
        return Err(blocked("这项行动已经交付"));
    }
    if let Some(a) = c.activities.get(&owner).filter(|a| a.valid) {
        if a.days < l.days
            || (l.kind == LeverKind::Escort && (!a.departed || w.fleet(a.fleet)?.docked_at() != Some(port)))
        {
            return Err(blocked("行动的实际停留或护航尚未完成"));
        }
        if w.fleet(a.fleet)?.owner != owner
            || (l.kind == LeverKind::Train
                && (w.fleet(a.fleet)?.docked_at() != Some(port) || !trainer_present(w, owner, l, port)))
        {
            return Err(blocked("行动人员或舰队已经离开"));
        }
        let value = l
            .points
            .checked_mul(l.value_per_point)
            .and_then(|v| v.checked_mul(100))
            .ok_or(CommandError::InvalidQuantity)?;
        w.add_contribution(owner, e, l, value)?;
        let c = w.contribution_mut(e, l);
        c.completed.insert(owner);
        c.activities.remove(&owner);
        return Ok(());
    }
    let start = if l.kind == LeverKind::Escort {
        l.from.as_ref().and_then(|p| w.defs.find_loc(p)).ok_or_else(|| blocked("护航出发港不存在"))?
    } else {
        port
    };
    if !w.location_open(start) {
        return Err(blocked("行动出发港尚未开放"));
    }
    let fleet = w
        .fleets_of(owner)
        .find(|f| f.docked_at() == Some(start) && f.crew > 0)
        .map(|f| f.id)
        .ok_or(CommandError::WrongLocation)?;
    if l.kind == LeverKind::Train && !trainer_present(w, owner, l, port) {
        return Err(blocked("教官不在港口或队伍中"));
    }
    let convoy = if l.kind == LeverKind::Escort {
        let company =
            l.company.as_ref().and_then(|c| w.defs.find_company(c)).ok_or_else(|| blocked("护航商会不存在"))?;
        if owner == OwnerId::Company(company) {
            return Err(blocked("不能护送自己的船换取贡献"));
        }
        Some(
            w.fleets_of(OwnerId::Company(company))
                .find(|f| f.docked_at() == Some(start))
                .map(|f| f.id)
                .ok_or_else(|| blocked("船队尚未到达出发港"))?,
        )
    } else {
        None
    };
    if l.cost > 0 {
        pay(w, owner, e, l, l.cost)?;
    }
    let started = w.day();
    w.contribution_mut(e, l).activities.insert(
        owner,
        Activity { fleet, convoy, started, last_day: None, days: 0, departed: false, arrived: false, valid: true },
    );
    Ok(())
}

impl World {
    pub(super) fn history_material_day(&mut self) -> Result<(), CommandError> {
        let defs = self.defs.clone();
        for e in &defs.history.events {
            if self.state.history.events.get(&e.key).is_none_or(|s| s.closed || s.outcome.is_some()) {
                continue;
            }
            if e.window.is_some_and(|window| self.cast_date() > window[1]) {
                if let Some(state) = self.state.history.events.get_mut(&e.key) {
                    for c in state.contributions.values_mut() {
                        for a in c.activities.values_mut() {
                            a.valid = false;
                        }
                    }
                }
                continue;
            }
            for l in &e.levers {
                let Some(port) = l.port.as_ref().and_then(|p| defs.find_loc(p)) else { continue };
                let activities = self
                    .state
                    .history
                    .events
                    .get(&e.key)
                    .and_then(|s| s.contributions.get(&l.key))
                    .map(|c| c.activities.clone())
                    .unwrap_or_default();
                for (owner, mut a) in activities {
                    if !a.valid || a.last_day == Some(self.day()) {
                        continue;
                    }
                    a.last_day = Some(self.day());
                    if !self.location_open(port) {
                        a.valid = false;
                        self.contribution_mut(e, l).activities.insert(owner, a);
                        continue;
                    }
                    let fleet = self.state.fleets.get(&a.fleet).filter(|f| f.owner == owner && f.crew > 0);
                    if l.kind == LeverKind::Train {
                        a.valid =
                            fleet.is_some_and(|f| f.docked_at() == Some(port)) && trainer_present(self, owner, l, port);
                        if a.valid {
                            a.days = a.days.saturating_add(1).min(l.days);
                        }
                    } else {
                        let convoy = a.convoy.and_then(|id| self.state.fleets.get(&id)).filter(|f| {
                            f.crew > 0
                                && l.company
                                    .as_ref()
                                    .and_then(|c| defs.find_company(c))
                                    .is_some_and(|c| f.owner == OwnerId::Company(c))
                        });
                        match fleet.zip(convoy).map(|(f, c)| (&f.location, &c.location)) {
                            Some((FleetLocation::AtSea(f), FleetLocation::AtSea(c)))
                                if f.destination() == Some(port)
                                    && c.destination() == Some(port)
                                    && self.defs.map.region_of(f.cell()).is_some()
                                    && self.defs.map.region_of(f.cell()) == self.defs.map.region_of(c.cell()) =>
                            {
                                a.departed = true;
                                a.days = a.days.saturating_add(1).min(l.days);
                            }
                            Some((FleetLocation::Docked(f), FleetLocation::Docked(c))) if f == c && *f == port => {
                                a.departed = true;
                                if !a.arrived {
                                    a.days = a.days.saturating_add(1).min(l.days);
                                }
                                a.arrived = true;
                                a.valid = a.days >= l.days;
                            }
                            Some((FleetLocation::Docked(f), FleetLocation::Docked(c)))
                                if f == c
                                    && !a.departed
                                    && l.from.as_ref().is_some_and(|key| defs.loc(*f).key == *key) => {}
                            _ => a.valid = false,
                        }
                    }
                    let arrived = self.state.fleets.get(&a.fleet).is_some_and(|f| f.docked_at() == Some(port));
                    if a.valid && a.days >= l.days && arrived {
                        let before = self.clone();
                        let value = l
                            .points
                            .checked_mul(l.value_per_point)
                            .and_then(|v| v.checked_mul(100))
                            .ok_or(CommandError::InvalidQuantity)?;
                        self.add_contribution(owner, e, l, value)?;
                        let c = self.contribution_mut(e, l);
                        c.completed.insert(owner);
                        c.activities.remove(&owner);
                        self.campaign_credit(&before, e)?;
                    } else {
                        self.contribution_mut(e, l).activities.insert(owner, a);
                    }
                }
            }
        }
        Ok(())
    }
}
