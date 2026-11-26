//! 有名船只的图纸、船厂与唯一性；普通船型不会产生传说身份。
pub mod mechanics;
mod rules;
pub mod validation;
use crate::{
    arcana::Cost,
    ledger::{Account, CashClass, JournalEntry, Memo},
    log::{LogEvent, LogKind},
    societies::{blocked, transaction},
    warehouse::Holder,
    world::Ship,
    *,
};
pub use rules::Rules;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LegendShipsDefs {
    pub ships: Vec<LegendShipDef>,
}
impl LegendShipsDefs {
    pub fn is_empty(&self) -> bool {
        self.ships.is_empty()
    }
    pub fn ship(&self, key: &str) -> Option<&LegendShipDef> {
        self.ships.iter().find(|s| s.key == key)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trait {
    Ghost,
    Oracle,
    FogSail,
    StormRider,
    Armored,
    Ram,
    Paddle,
    Giant,
    ClipperHull,
    Sacred,
    FairWind,
    BoardingBridge,
    Salvage,
    Dread,
    NightHide,
    StormWard,
    CalmFloor,
    FreshKeep,
    Lookout,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Recovery {
    #[default]
    Never,
    Rebuild,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegendShipDef {
    pub key: String,
    pub name: String,
    pub unique: bool,
    pub hull: String,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub traits: Vec<Trait>,
    #[serde(default)]
    pub trait_notes: BTreeMap<Trait, String>,
    pub lore: String,
    pub acquire: Acquire,
    pub acquire_note: String,
    #[serde(default)]
    pub cost: Cost,
    #[serde(default)]
    pub maintenance: BTreeMap<String, i64>,
    #[serde(default)]
    pub lost: Recovery,
    #[serde(default)]
    pub sold: Recovery,
    pub knowledge: Option<String>,
    pub oracle_spell: Option<String>,
    #[serde(default)]
    pub salvage: Vec<String>,
    #[serde(default = "one")]
    pub limit: u8,
    #[serde(default)]
    pub unrevealed_name: Option<String>,
    #[serde(default)]
    pub reveal_flag: Option<String>,
}
fn one() -> u8 {
    1
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Acquire {
    pub track: Option<String>,
    pub blueprint: Option<String>,
    pub shipyards: Vec<String>,
    #[serde(default)]
    pub kind: AcquireKind,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcquireKind {
    #[default]
    Build,
    Witness,
    GrantStory,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LegendShipsState {
    pub ships: BTreeMap<String, Record>,
    pub known: BTreeSet<String>,
    pub oracle: BTreeMap<String, u32>,
    pub salvage: BTreeSet<String>,
}
impl LegendShipsState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Record {
    pub built: u32,
    pub owned: u8,
    pub lost: u32,
    pub sold: u32,
}
pub fn has(d: &StaticData, s: &Ship, t: Trait) -> bool {
    s.legend.as_ref().and_then(|k| d.legend_ships.ship(k)).is_some_and(|v| v.traits.contains(&t))
}
pub fn crew_min(d: &StaticData, s: &Ship) -> i64 {
    if has(d, s, Trait::Ghost) {
        0
    } else {
        d.ship(s.kind).crew_min * if has(d, s, Trait::Giant) { d.rules.ships.giant_multiplier } else { 1 }
    }
}
pub fn crew_max(d: &StaticData, s: &Ship) -> i64 {
    if has(d, s, Trait::Ghost) {
        0
    } else {
        d.ship(s.kind).crew_max * if has(d, s, Trait::Giant) { d.rules.ships.giant_multiplier } else { 1 }
    }
}
impl World {
    pub fn legend_ship_count(&self, key: &str) -> usize {
        self.state.fleets.values().flat_map(|f| &f.ships).filter(|s| s.legend.as_deref() == Some(key)).count()
    }
    pub fn legend_ship_state(&self, key: &str) -> &'static str {
        let Some(s) = self.defs.legend_ships.ship(key) else { return "unknown" };
        if self.legend_ship_count(key) > 0 {
            return "owned";
        }
        if self.state.legend_ships.ships.get(key).is_some_and(|r| r.built > 0) {
            return "lost";
        }
        if s.acquire.blueprint.as_ref().is_some_and(|i| self.item_quantity(OwnerId::Player, i) > 0) {
            return "blueprint";
        }
        if self.state.legend_ships.known.contains(key)
            || s.acquire.track.as_ref().is_some_and(|t| self.state.story2.tracks.contains_key(t))
        {
            return "known";
        }
        if s.knowledge.as_ref().is_some_and(|k| self.has_knowledge_record(k)) { "rumor" } else { "unknown" }
    }
    pub fn can_commission_ship(&self, owner: OwnerId, key: &str, loc: LocId) -> Result<FleetId, CommandError> {
        if owner != OwnerId::Player {
            return Err(blocked("legend_ship.player_only"));
        }
        if self.defs.rules.ships.s02_enabled
            && let Some(s) = self.defs.legend_ships.ship(key)
        {
            match s.acquire.kind {
                AcquireKind::Witness => return Err(Reason::new("legend_ship.witness", "（待写）").rule()),
                AcquireKind::GrantStory => {
                    return Err(Reason::new("legend_ship.granted", "（待写）").rule());
                }
                AcquireKind::Build => {}
            }
        }
        let s = self
            .defs
            .legend_ships
            .ship(key)
            .filter(|_| self.legend_ship_state(key) != "unknown")
            .ok_or_else(|| blocked("legend_ship.unknown"))?;
        if s.acquire.blueprint.as_ref().is_some_and(|i| self.item_quantity(owner, i) == 0) {
            return Err(blocked("legend_ship.blueprint"));
        }
        if s.acquire
            .track
            .as_ref()
            .is_some_and(|t| self.state.story2.tracks.get(t).is_none_or(|v| v.status != crate::story2::Status::Done))
        {
            return Err(blocked("legend_ship.track"));
        }
        if self.legend_ship_count(key) >= usize::from(s.limit) {
            return Err(blocked("legend_ship.limit"));
        }
        if let Some(r) = self.state.legend_ships.ships.get(key) {
            if r.built == u32::MAX {
                return Err(blocked("legend_ship.limit"));
            }
            let count = self.legend_ship_count(key) as u64;
            let lost = u64::from(r.lost) + u64::from(r.owned).saturating_sub(count);
            let spent = count
                + if matches!(s.sold, Recovery::Never) { u64::from(r.sold) } else { 0 }
                + if matches!(s.lost, Recovery::Never) { lost } else { 0 };
            if spent >= u64::from(s.limit) {
                return Err(blocked("legend_ship.unrecoverable"));
            }
        }
        let f = self
            .flagship(owner)
            .and_then(|f| self.state.fleets.get(&f))
            .filter(|f| f.docked_at() == Some(loc))
            .ok_or_else(|| blocked("legend_ship.away"))?;
        let l = self.defs.locations.get(loc.idx()).ok_or_else(|| blocked("legend_ship.shipyard"))?;
        let hull = self
            .defs
            .ships
            .iter()
            .position(|h| h.key == s.hull)
            .map(ShipTypeId::from_idx)
            .ok_or_else(|| blocked("legend_ship.hull"))?;
        if !s.acquire.shipyards.contains(&l.key)
            || !l.shipyard.contains(&hull)
            || !self.location_open(loc)
            || !self.port_is_open(loc)
        {
            return Err(blocked("legend_ship.shipyard"));
        }
        if f.ships.len() >= crate::world::MAX_SHIPS_PER_FLEET {
            return Err(CommandError::FleetFull);
        }
        if self.agent(owner)?.cash < s.cost.cash {
            return Err(blocked("legend_ship.cash"));
        }
        if s.cost.items.iter().any(|(k, q)| self.item_available(owner, k) < *q)
            || s.cost
                .goods
                .iter()
                .any(|(k, q)| self.defs.find_good(k).is_none_or(|g| f.cargo.get(&g).copied().unwrap_or(0) < *q))
        {
            return Err(blocked("legend_ship.materials"));
        }
        Ok(f.id)
    }
    pub(crate) fn refresh_legend_ships(&mut self) {
        let counts: BTreeMap<String, u8> =
            self.state.fleets.values().flat_map(|f| &f.ships).filter_map(|s| s.legend.as_ref()).fold(
                BTreeMap::new(),
                |mut m, k| {
                    let n = m.entry(k.clone()).or_default();
                    *n = n.saturating_add(1);
                    m
                },
            );
        for (k, r) in &mut self.state.legend_ships.ships {
            let n = counts.get(k).copied().unwrap_or(0);
            if n < r.owned {
                r.lost = r.lost.saturating_add(u32::from(r.owned - n));
            }
            r.owned = n;
        }
    }
    pub(crate) fn record_legend_ship_sale(&mut self, s: &Ship) {
        if let Some(k) = &s.legend {
            let r = self.state.legend_ships.ships.entry(k.clone()).or_default();
            r.owned = r.owned.saturating_sub(1);
            r.sold = r.sold.saturating_add(1);
        }
    }
    pub fn fleet_has_legend_trait(&self, f: FleetId, t: Trait) -> bool {
        self.state.fleets.get(&f).is_some_and(|f| f.ships.iter().any(|s| has(&self.defs, s, t)))
    }
}
pub(crate) fn check(w: &World, owner: OwnerId, key: &str, loc: LocId) -> Result<Box<WorldState>, CommandError> {
    transaction(w, |w| {
        w.refresh_legend_ships();
        let fleet = w.can_commission_ship(owner, key, loc)?;
        let d = w.defs.legend_ships.ship(key).cloned().ok_or_else(|| blocked("legend_ship.unknown"))?;
        let hull = w
            .defs
            .ships
            .iter()
            .position(|s| s.key == d.hull)
            .map(ShipTypeId::from_idx)
            .ok_or_else(|| blocked("legend_ship.hull"))?;
        let mut book = d.cost.cash;
        w.book_external(
            owner,
            crate::treasury::Flow::Shipyard,
            w.town_sector(loc),
            JournalEntry::new(w.day(), Memo::ShipPurchase, CashClass::Investing)
                .dr(Account::Ships, d.cost.cash)
                .cr(Account::Cash, d.cost.cash),
        )?;
        for (i, q) in &d.cost.items {
            w.take_item(owner, i, *q);
        }
        for (g, q) in &d.cost.goods {
            let good = w.defs.find_good(g).ok_or_else(|| blocked("legend_ship.materials"))?;
            w.holder_take(owner, Holder::Fleet(fleet), good, *q)?;
            let cost = w.agent_mut(owner)?.book.remove(good, *q);
            book = book.saturating_add(cost);
            w.book_internal(
                owner,
                JournalEntry::new(w.day(), Memo::ShipPurchase, CashClass::Investing)
                    .dr(Account::Ships, cost)
                    .cr(Account::Inventory, cost),
            )?;
        }
        let mut s = crate::fleet::new_ship(&w.defs, hull);
        s.legend = Some(key.into());
        s.built = w.day();
        s.book_value = book;
        if d.traits.contains(&Trait::Giant) {
            s.capacity = s.capacity.saturating_mul(w.defs.rules.ships.giant_multiplier);
            s.guns = s.guns.saturating_mul(w.defs.rules.ships.giant_multiplier);
        }
        if d.traits.contains(&Trait::ClipperHull) {
            s.capacity = crate::fixed::mul_div(s.capacity, w.defs.rules.ships.clipper_capacity_pct, 100);
        }
        w.fleet_mut(fleet)?.ships.push(s);
        let r = w.state.legend_ships.ships.entry(key.into()).or_default();
        r.built = r.built.saturating_add(1);
        r.owned = r.owned.saturating_add(1);
        w.state.legend_ships.known.insert(key.into());
        Ok(())
    })
}

impl Trait {
    pub fn key(self) -> &'static str {
        match self {
            Self::Ghost => "ghost",
            Self::Oracle => "oracle",
            Self::FogSail => "fog_sail",
            Self::StormRider => "storm_rider",
            Self::Armored => "armored",
            Self::Ram => "ram",
            Self::Paddle => "paddle",
            Self::Giant => "giant",
            Self::ClipperHull => "clipper_hull",
            Self::Sacred => "sacred",
            Self::FairWind => "fair_wind",
            Self::BoardingBridge => "boarding_bridge",
            Self::Salvage => "salvage",
            Self::Dread => "dread",
            Self::NightHide => "night_hide",
            Self::StormWard => "storm_ward",
            Self::CalmFloor => "calm_floor",
            Self::FreshKeep => "fresh_keep",
            Self::Lookout => "lookout",
        }
    }
}

impl World {
    /// 剧情授予的预检与唯一性账；所有可能失败的检查都在放船之前完成。
    pub(crate) fn grant_legend_ship(
        &mut self,
        owner: OwnerId,
        key: &str,
        fleet: FleetId,
    ) -> Result<FleetId, CommandError> {
        if !self.defs.rules.ships.s02_enabled {
            return Err(Reason::new("legend_ship.granted", "（待写）").rule());
        }
        if owner != OwnerId::Player {
            return Err(blocked("legend_ship.player_only"));
        }
        if self.upbringing_active() {
            return Err(Reason::new("legend_ship.upbringing", "（待写）").rule());
        }
        let d = self.defs.legend_ships.ship(key).cloned().ok_or_else(|| blocked("legend_ship.unknown"))?;
        if d.acquire.kind != AcquireKind::GrantStory {
            return Err(Reason::new("legend_ship.granted", "（待写）").rule());
        }
        let count = self.legend_ship_count(key);
        if count >= usize::from(d.limit) {
            return Err(blocked("legend_ship.limit"));
        }
        if let Some(r) = self.state.legend_ships.ships.get(key) {
            if r.built == u32::MAX {
                return Err(blocked("legend_ship.limit"));
            }
            let count = count as u64;
            let lost = u64::from(r.lost) + u64::from(r.owned).saturating_sub(count);
            let spent = count
                + if matches!(d.sold, Recovery::Never) { u64::from(r.sold) } else { 0 }
                + if matches!(d.lost, Recovery::Never) { lost } else { 0 };
            if spent >= u64::from(d.limit) {
                return Err(blocked("legend_ship.unrecoverable"));
            }
        }
        let target = self.state.fleets.get(&fleet).ok_or_else(|| blocked("legend_ship.away"))?;
        if target.owner != owner {
            return Err(blocked("legend_ship.player_only"));
        }
        let hull = self
            .defs
            .ships
            .iter()
            .position(|h| h.key == d.hull)
            .map(ShipTypeId::from_idx)
            .ok_or_else(|| blocked("legend_ship.hull"))?;
        let mut ship = crate::fleet::new_ship(&self.defs, hull);
        ship.legend = Some(key.into());
        ship.built = self.day();
        ship.book_value = 0;
        if d.traits.contains(&Trait::Giant) {
            ship.capacity = ship.capacity.saturating_mul(self.defs.rules.ships.giant_multiplier);
            ship.guns = ship.guns.saturating_mul(self.defs.rules.ships.giant_multiplier);
        }
        if d.traits.contains(&Trait::ClipperHull) {
            ship.capacity = crate::fixed::mul_div(ship.capacity, self.defs.rules.ships.clipper_capacity_pct, 100);
        }
        self.refresh_legend_ships();
        let fleet = self.place_granted_legend_ship(fleet, ship)?;
        let record = self.state.legend_ships.ships.entry(key.into()).or_default();
        record.built = record.built.saturating_add(1);
        record.owned = record.owned.saturating_add(1);
        self.state.legend_ships.known.insert(key.into());
        self.push_log(LogEvent {
            day: self.day(),
            kind: LogKind::LegendShipGranted { fleet, owner, ship: key.into() },
        });
        Ok(fleet)
    }

    /// 授予不挤掉已有船；满编时在原位置另开一支无船员、无粮水的舰队。
    fn place_granted_legend_ship(&mut self, fleet: FleetId, ship: Ship) -> Result<FleetId, CoreError> {
        let source = self.fleet(fleet)?;
        if source.ships.len() < crate::world::MAX_SHIPS_PER_FLEET {
            self.fleet_mut(fleet)?.ships.push(ship);
            return Ok(fleet);
        }
        let location = source.location.clone();
        let days_at_sea = source.days_at_sea;
        let id = self.alloc_fleet_id();
        self.state.fleets.insert(
            id,
            crate::world::Fleet {
                id,
                owner: OwnerId::Player,
                ships: vec![ship],
                crew: 0,
                morale: 100,
                food: 0,
                water: 0,
                supply_remainder: Default::default(),
                cargo: BTreeMap::new(),
                location,
                days_at_sea,
                idle_days: 0,
                plan: None,
                news: None,
            },
        );
        self.push_log(LogEvent { day: self.day(), kind: LogKind::NewFleet { fleet: id, owner: OwnerId::Player } });
        Ok(id)
    }
}
