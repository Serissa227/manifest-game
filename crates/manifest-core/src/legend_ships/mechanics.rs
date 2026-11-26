//! 每艘名船单独消费特性，舰队中活人的工资、粮水与疾病仍照常结算。
use super::*;
use crate::{
    fixed::{Fx, mul_div},
    nav::{current_mult, sail_mult},
    rng::{Domain, Rng},
    seafaring::VoyageMods,
    weather::{DayWeather, Sky},
};

pub fn ghost_crew(d: &StaticData, s: &Ship) -> i64 {
    if has(d, s, Trait::Ghost) { d.ship(s.kind).crew_max.max(1) } else { 0 }
}
pub fn fleet_unmanned(d: &StaticData, f: &crate::world::Fleet) -> bool {
    f.crew <= 0 && !f.ships.iter().any(|s| has(d, s, Trait::Ghost))
}
pub fn port_allowed(d: &StaticData, f: &crate::world::Fleet, loc: LocId) -> bool {
    let Some(l) = d.locations.get(loc.idx()) else { return false };
    !f.ships.iter().any(|s| {
        has(d, s, Trait::Ghost) && d.rules.ships.sacred_ports.contains(&l.key)
            || has(d, s, Trait::Giant) && d.rules.ships.shallow_ports.contains(&l.key)
    })
}
pub fn ship_limit(d: &StaticData, s: &Ship) -> u16 {
    if has(d, s, Trait::Paddle) || has(d, s, Trait::FairWind) {
        0
    } else if has(d, s, Trait::ClipperHull) {
        d.rules.ships.clipper_sail_limit as u16
    } else {
        match d.ship(s.kind).sail {
            crate::defs::SailType::Square => 67,
            crate::defs::SailType::Lateen => 50,
        }
    }
}
pub fn ship_speed(d: &StaticData, s: &Ship, heading: u8, w: Option<&DayWeather>, minute: u16) -> Fx {
    ship_speed_with(d, s, heading, w, minute, 0)
}
fn ship_speed_with(d: &StaticData, s: &Ship, heading: u8, w: Option<&DayWeather>, minute: u16, fog_offset: i64) -> Fx {
    let t = d.ship(s.kind);
    let r = &d.rules.ships;
    let base = t.speed + s.speed_bonus;
    let has = |trait_| has(d, s, trait_);
    let mut speed = if has(Trait::Paddle) {
        Fx::from_int(r.paddle_speed)
    } else if has(Trait::FairWind) {
        Fx::from_int(r.fair_wind_speed)
    } else {
        w.map_or(base, |w| {
            let sail = if has(Trait::ClipperHull) { crate::defs::SailType::Lateen } else { t.sail };
            base.mul(sail_mult(sail, heading, &w.sea))
        })
    };
    if has(Trait::ClipperHull) {
        speed = speed.mul(Fx::from_pct(r.clipper_speed_pct));
    }
    if r.s02_enabled && has(Trait::CalmFloor) && w.is_some_and(|w| w.sea.wind_strength <= r.calm_wind_max) {
        speed = speed.max(base.mul(Fx::from_pct(r.calm_floor_pct)));
    }
    let sky = w.map(|w| w.sky);
    if has(Trait::Ghost) {
        let pct = if sky == Some(Sky::Fog) {
            r.ghost_fog_pct
        } else if !(360..1080).contains(&minute) {
            r.ghost_night_pct
        } else {
            r.ghost_day_pct
        };
        speed = speed.mul(Fx::from_pct(pct));
    }
    if let Some(w) = w {
        match w.sky {
            Sky::Fog if has(Trait::FogSail) => speed = speed.mul(Fx::from_pct(r.fog_speed_pct)),
            Sky::Storm if has(Trait::StormRider) => speed = speed.mul(Fx::from_pct(r.storm_speed_pct)),
            Sky::Fog if has(Trait::Ghost) => {}
            Sky::Fog if r.s02_enabled && fog_offset > 0 => {
                let lost = Fx::ONE.raw() - w.speed_mult().raw();
                speed = speed.mul(Fx(w.speed_mult().raw() + lost * fog_offset.clamp(0, 100) / 100));
            }
            _ => speed = speed.mul(w.speed_mult()),
        }
        if w.sky == Sky::Storm && has(Trait::BoardingBridge) {
            speed = speed.mul(Fx::from_pct(r.bridge_storm_pct));
        }
    }
    speed.min(base.mul(Fx::from_int(3))).max(Fx(5000))
}
/// 舰队共用航速输入，包含实际日内时刻。
pub struct SpeedInput<'a> {
    pub defs: &'a StaticData,
    pub ships: &'a [Ship],
    pub crew: i64,
    pub morale: i64,
    pub heading: u8,
    pub weather: Option<&'a DayWeather>,
    pub minute: u16,
    pub mods: &'a VoyageMods,
}
pub fn speed(input: SpeedInput<'_>) -> Fx {
    let SpeedInput { defs: d, ships, crew, morale, heading, weather: w, minute, mods } = input;
    let mods = if d.rules.ships.s02_enabled { mods } else { &VoyageMods::NEUTRAL };
    let crew = crew - mods.idle_crew.max(0);
    let per_ship = ships.iter().map(|s| ship_speed_with(d, s, heading, w, minute, mods.fog_offset));
    let mut result = if mods.coordination > 0 && ships.len() > 1 {
        let mut all: Vec<_> = per_ship.collect();
        all.sort();
        Fx(all[0].raw() + (all[1].raw() - all[0].raw()) * mods.coordination.clamp(0, 100) / 100)
    } else {
        per_ship.min().unwrap_or(Fx::ONE)
    };
    if let Some(w) = w {
        result = result.mul(current_mult(heading, &w.sea));
    }
    let minimum: i64 = ships.iter().map(|s| crew_min(d, s)).sum();
    if crew < minimum && minimum > 0 {
        result = result.mul(Fx::ratio(crew, minimum).max(Fx::from_pct(30)));
    }
    if morale < 30 && ships.iter().any(|s| !has(d, s, Trait::Ghost)) {
        result = result.mul(Fx::from_pct(80));
    }
    if mods.speed_bp != 10_000 {
        result = result.mul(Fx(mods.speed_bp.max(0)));
    }
    result.max(Fx(5000))
}
pub fn armor(d: &StaticData, s: &Ship) -> i64 {
    if has(d, s, Trait::Armored) { d.rules.ships.armor_pct } else { 0 }
}

/// 战术状态只保存有界机械字段；普通船继续省略整块。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CombatTraits {
    pub ghost: bool,
    pub armor: i64,
    pub ram: i64,
    pub bridge: i64,
    pub ram_used: bool,
}
pub fn combat(d: &StaticData, s: &Ship) -> Option<CombatTraits> {
    s.legend.as_ref()?;
    Some(CombatTraits {
        ghost: has(d, s, Trait::Ghost),
        armor: armor(d, s),
        ram: if has(d, s, Trait::Ram) { d.rules.ships.ram_pct } else { 0 },
        bridge: if has(d, s, Trait::BoardingBridge) { d.rules.ships.bridge_boarding_pct } else { 0 },
        ram_used: false,
    })
}
impl World {
    /// 活人耗尽时只保留亡者操纵的船，其余按既有沉船与货损记账。
    pub(crate) fn abandon_unmanned_ships(&mut self, fleet: FleetId) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        if self.fleet(fleet)?.crew > 0
            || !self.fleet(fleet)?.ships.iter().any(|s| s.durability > 0 && has(&defs, s, Trait::Ghost))
        {
            return Ok(());
        }
        for s in &mut self.fleet_mut(fleet)?.ships {
            if !has(&defs, s, Trait::Ghost) {
                s.durability = 0;
            }
        }
        self.sink_wrecked_ships(fleet)
    }
    pub fn legend_port_allowed(&self, f: &crate::world::Fleet, loc: LocId) -> bool {
        port_allowed(&self.defs, f, loc)
    }
    pub fn ghost_anchorage(&self, owner: OwnerId, loc: LocId) -> bool {
        self.fleets_of(owner)
            .any(|f| f.docked_at() == Some(loc) && f.ships.iter().any(|s| has(&self.defs, s, Trait::Ghost)))
    }
    pub fn legend_fog_hiding(&self, fleet: FleetId) -> i64 {
        if self.fleet_has_legend_trait(fleet, Trait::FogSail) { self.defs.rules.ships.fog_hide_pct } else { 0 }
    }
    pub fn legend_sacred_avoid(&self, fleet: FleetId) -> i64 {
        if self.fleet_has_legend_trait(fleet, Trait::Sacred) { self.defs.rules.ships.sacred_avoid_pct } else { 0 }
    }
    pub fn oracle_ship(&self, spell: &str) -> Option<&str> {
        self.defs
            .legend_ships
            .ships
            .iter()
            .find(|s| s.oracle_spell.as_deref() == Some(spell) && self.legend_ship_count(&s.key) > 0)
            .map(|s| s.key.as_str())
    }
    pub fn oracle_ready(&self, spell: &str) -> bool {
        self.spell_known_without_oracle(spell)
            || self.oracle_ship(spell).is_none()
            || self.available_oracle(spell).is_some()
    }
    fn available_oracle(&self, spell: &str) -> Option<&str> {
        self.defs
            .legend_ships
            .ships
            .iter()
            .filter(|s| s.oracle_spell.as_deref() == Some(spell) && self.legend_ship_count(&s.key) > 0)
            .find(|s| {
                let now = self.defs.calendar.date_of(self.day());
                self.state.legend_ships.oracle.get(&s.key).is_none_or(|day| {
                    let then = self.defs.calendar.date_of(*day);
                    (then.year, then.month) != (now.year, now.month)
                })
            })
            .map(|s| s.key.as_str())
    }
    pub(crate) fn record_oracle(&mut self, spell: &str) {
        if self.spell_known_without_oracle(spell) {
            return;
        }
        if let Some(key) = self.available_oracle(spell).map(str::to_owned) {
            let day = self.day();
            self.state.legend_ships.oracle.insert(key, day);
        }
    }
    /// 材料按各船逐一扣除并记损失账；缺料损伤有界，不把普通船变成免维护。
    pub(crate) fn legend_ships_day(&mut self) -> Result<(), CoreError> {
        if self.defs.legend_ships.is_empty() {
            return Ok(());
        }
        self.refresh_legend_ships();
        let defs = self.defs.clone();
        let day = self.day();
        let entries: Vec<_> = self
            .state
            .fleets
            .values()
            .flat_map(|f| {
                f.ships.iter().enumerate().filter_map(|(i, s)| {
                    s.legend.as_ref().and_then(|k| defs.legend_ships.ship(k)).map(|d| (f.id, f.owner, i, d.clone()))
                })
            })
            .collect();
        for (fleet, owner, index, d) in entries {
            let mut missing = false;
            for (key, qty) in &d.maintenance {
                let Some(good) = defs.find_good(key) else { continue };
                if self.fleet(fleet)?.cargo.get(&good).copied().unwrap_or(0) < *qty {
                    missing = true;
                    continue;
                }
                self.remove_cargo_with_loss(owner, fleet, good, *qty, day)?;
            }
            if d.traits.contains(&Trait::Giant) {
                let cost = defs.rules.ships.giant_maintenance;
                self.book_external(
                    owner,
                    crate::treasury::Flow::Shipyard,
                    self.fleet_town(fleet),
                    JournalEntry::new(day, Memo::Repair, CashClass::Operating)
                        .dr(Account::Repairs, cost)
                        .cr(Account::Cash, cost),
                )?;
            }
            if missing && let Some(s) = self.fleet_mut(fleet)?.ships.get_mut(index) {
                s.durability = (s.durability
                    - mul_div(s.max_durability, defs.rules.ships.maintenance_damage_pct, 100).max(1))
                .max(1);
            }
        }
        Ok(())
    }
    /// 独立随机域、同一次战斗/打捞只抽一次；一次最多一件物品。
    pub(crate) fn salvage_after(&mut self, fleet: FleetId, event: &str) -> Result<(), CoreError> {
        if self.state.legend_ships.salvage.contains(event) || self.state.legend_ships.salvage.len() >= 10000 {
            return Ok(());
        }
        let Some(f) = self.state.fleets.get(&fleet) else { return Ok(()) };
        if f.owner != OwnerId::Player {
            return Ok(());
        }
        let choices: BTreeSet<_> = f
            .ships
            .iter()
            .filter_map(|s| s.legend.as_ref().and_then(|k| self.defs.legend_ships.ship(k)))
            .filter(|s| s.traits.contains(&Trait::Salvage))
            .flat_map(|s| s.salvage.iter().cloned())
            .collect();
        if choices.is_empty() {
            return Ok(());
        }
        let hash = blake3::hash(event.as_bytes());
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        let mut rng = crate::rng::Rng::derive(
            self.state.seed,
            self.day(),
            crate::rng::Domain::Salvage,
            u64::from_le_bytes(bytes),
            u64::from(fleet.0),
        );
        self.state.legend_ships.salvage.insert(event.into());
        if rng.chance_bp(self.defs.rules.ships.salvage_chance_bp)
            && let Some(item) = choices.iter().nth(rng.below(choices.len() as u64) as usize).filter(|key| {
                self.defs.items.item(key).is_some_and(|i| i.price <= self.defs.rules.ships.salvage_value_cap)
            })
        {
            self.grant_item(OwnerId::Player, item, 1).map_err(|e| CoreError::SnapshotMismatch(e.to_string()))?;
        }
        Ok(())
    }
    /// 战术特性与本船一致；冲角使用记录可在战斗中改变。
    pub(crate) fn validate_legend_combat(&self) -> Result<(), CoreError> {
        for pirate in self.state.battles.pirates.values() {
            if pirate.ships.iter().any(|s| s.legend.is_some()) {
                return Err(CoreError::SnapshotMismatch("海盗不能复制传说船身份".into()));
            }
        }
        for battle in self.state.battles.tactical.values() {
            for unit in &battle.units {
                let mut expected = if unit.player {
                    self.state
                        .fleets
                        .get(&battle.fleet)
                        .and_then(|f| f.ships.get(unit.ship))
                        .and_then(|s| combat(&self.defs, s))
                } else {
                    None
                };
                if let (Some(t), Some(actual)) = (&mut expected, &unit.legend) {
                    t.ram_used = actual.ram_used;
                    if t.ram_used && t.ram == 0 {
                        return Err(CoreError::SnapshotMismatch("冲角使用记录无效".into()));
                    }
                }
                if unit.legend != expected {
                    return Err(CoreError::SnapshotMismatch("战术传说船特性与船只不符".into()));
                }
            }
        }
        Ok(())
    }
}

impl World {
    /// 夜隐并入既有隐蔽合计；按天追击的调用方再折成半天。
    pub(crate) fn legend_night_hiding(&self, fleet: FleetId) -> i64 {
        if self.defs.rules.ships.s02_enabled && self.fleet_has_legend_trait(fleet, Trait::NightHide) {
            self.defs.rules.ships.night_hide_pct
        } else {
            0
        }
    }

    /// 瞭望只由玩家舰队提供，探索与调查共用同一个加成。
    pub(crate) fn legend_lookout_cells(&self, fleet: FleetId) -> i64 {
        if self.defs.rules.ships.s02_enabled
            && self.state.fleets.get(&fleet).is_some_and(|f| f.owner == OwnerId::Player)
            && self.fleet_has_legend_trait(fleet, Trait::Lookout)
        {
            self.defs.rules.ships.lookout_cells
        } else {
            0
        }
    }

    /// 每次遭遇只派生一次独立掷骰，不消费海盗或风暴原有随机流。
    pub(crate) fn legend_deters(&mut self, fleet: FleetId, pirate: u32) -> bool {
        let r = &self.defs.rules.ships;
        if !r.s02_enabled
            || !self.state.fleets.get(&fleet).is_some_and(|f| {
                f.owner == OwnerId::Player
                    && f.ships.iter().any(|s| {
                        has(&self.defs, s, Trait::Dread)
                            && i128::from(s.durability) * 100
                                >= i128::from(s.max_durability) * i128::from(r.dread_min_hull_pct)
                    })
            })
        {
            return false;
        }
        let day = self.day();
        let mut rng = Rng::derive(self.state.seed, day, Domain::LegendTraits, u64::from(pirate), u64::from(fleet.0));
        if !rng.chance_bp(r.dread_bp) {
            return false;
        }
        if self.defs.rules.hail.enabled {
            self.state
                .hail
                .truces
                .insert(pirate, crate::hail::Truce { fleet, until: day.saturating_add(r.dread_truce_days - 1) });
        }
        self.state.battles.chases.remove(&pirate);
        self.push_log(LogEvent { day, kind: LogKind::PirateDeterred { fleet, owner: OwnerId::Player } });
        true
    }
}

/// 潜水必须满足原有发现条件与实际位置，同一发现只结算一次。
pub(crate) fn check_dive(
    w: &World,
    owner: OwnerId,
    fleet: FleetId,
    discovery: DiscoveryId,
) -> Result<Box<WorldState>, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let f = w.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if w.state.explore.discovered.contains_key(&discovery) {
        return Err(blocked("legend_ship.dive_done"));
    }
    let mut candidate = World { defs: w.defs.clone(), state: w.state.clone() };
    if let crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { .. }) = &f.location {
        let course = w.manual_course(f, &[], w.state.navigation.minute);
        if course.arrival.is_some() || course.voyage.sail != crate::navigation::Sail::Furled {
            return Err(blocked("legend_ship.dive_anchor"));
        }
        candidate.fleet_mut(fleet)?.location =
            crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { manual: course.voyage });
    }
    candidate.check_discovery_survey(fleet, discovery, crate::geo::authored::DiscoveryMode::Dive)?;
    transaction(w, |w| {
        let day = w.day();
        w.state.explore.discovered.insert(discovery, day);
        w.push_log(crate::log::LogEvent { day, kind: crate::log::LogKind::Discovered { discovery, owner } });
        w.salvage_after(fleet, &format!("dive:{}", discovery.0))?;
        Ok(())
    })
}
