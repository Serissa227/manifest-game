//! 帷幕通行与有界的彼界时间债；所有额外日期仍走完整日结。
pub mod validation;
use crate::{Cell, CoreError, LocId, OwnerId, World, societies::blocked, story2::Condition};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub const MAX_SKIP: u32 = 90;
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RealmsDefs {
    pub realms: Vec<RealmDef>,
}
impl RealmsDefs {
    pub fn is_empty(&self) -> bool {
        self.realms.is_empty()
    }
    pub fn realm(&self, key: &str) -> Option<&RealmDef> {
        self.realms.iter().find(|r| r.key == key)
    }
    pub fn at(&self, d: &crate::StaticData, cell: Cell) -> Option<&RealmDef> {
        self.realms.iter().find(|r| r.veil.contains(d, cell))
    }
    /// 全部帷幕格的外接矩形 `(x0, y0, x1, y1)`（含端点）：矩形之外的格子不在任何帷幕里（[`RealmsDefs::at`] 必为 None）。
    /// 有帷幕按海区划（`mark`）时给不出矩形，返回 None；一格帷幕也没有时是个空矩形（什么格子都不含）。
    pub fn veil_bounds(&self) -> Option<(u16, u16, u16, u16)> {
        if self.realms.iter().any(|r| r.veil.mark.is_some()) {
            return None;
        }
        let cells = || self.realms.iter().flat_map(|r| &r.veil.cells);
        let (x0, y0) = (cells().map(|c| c.x).min().unwrap_or(1), cells().map(|c| c.y).min().unwrap_or(1));
        let (x1, y1) = (cells().map(|c| c.x).max().unwrap_or(0), cells().map(|c| c.y).max().unwrap_or(0));
        Some((x0, y0, x1, y1))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RealmDef {
    pub key: String,
    pub name: String,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub veil: Veil,
    #[serde(default)]
    pub key_items: Vec<String>,
    /// 组间任选其一，组内的物品、许可和完成记录须同时满足。
    #[serde(default)]
    pub key_any: Vec<KeyGroup>,
    #[serde(default)]
    pub also: Vec<Condition>,
    pub ports: Vec<String>,
    pub hint: String,
    pub knowledge: Option<String>,
    #[serde(default)]
    pub rules: Vec<String>,
    pub otherworld: Option<Otherworld>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct KeyGroup {
    pub items: Vec<String>,
    pub flags: Vec<String>,
    pub completed_tracks: Vec<String>,
}
impl KeyGroup {
    fn allows(&self, w: &World, owner: OwnerId) -> bool {
        self.items.iter().all(|key| w.item_quantity(owner, key) > 0)
            && self.flags.iter().all(|flag| w.state.story2.flags.contains(flag))
            && self
                .completed_tracks
                .iter()
                .all(|key| w.state.story2.tracks.get(key).is_some_and(|s| s.status == crate::story2::Status::Done))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Veil {
    pub mark: Option<String>,
    #[serde(default)]
    pub cells: Vec<Cell>,
    pub push: u8,
}
impl Veil {
    pub fn contains(&self, d: &crate::StaticData, c: Cell) -> bool {
        self.cells.contains(&c)
            || self.mark.as_ref().is_some_and(|key| d.map.region_of(c).is_some_and(|r| d.regions[r.idx()].key == *key))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Otherworld {
    pub guest_nights: u32,
    pub time_ratio: u32,
    pub max_skip_days: u32,
    #[serde(default)]
    pub iron_ashore: bool,
    pub touch_land: String,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealmStatus {
    #[default]
    Unknown,
    Heard,
    VeilFound,
    Entered,
    Open,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RealmsState {
    pub states: BTreeMap<String, RealmStatus>,
    pub stay: Option<Stay>,
    pub debt: u32,
    pub eaten: BTreeSet<String>,
}
impl RealmsState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stay {
    pub realm: String,
    pub nights: u32,
}
impl World {
    pub(crate) fn realm_route(&self, fleet: &crate::world::Fleet, dest: LocId) -> Option<crate::nav::Path> {
        self.check_navigation(fleet, dest).ok()?;
        // 帷幕只占海图上几格，而寻路每展开一格要问十几次“这格能不能过”：先用帷幕的外接矩形挡掉矩形之外的
        // （那里不在任何帷幕里，一定能过），矩形里的才逐个帷幕去问。结果与每格都问相同。
        let veils = self.defs.realms.veil_bounds();
        let outside = |c: Cell| veils.is_some_and(|(x0, y0, x1, y1)| c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1);
        self.defs.nav.grid.find_path_allowed(
            self.defs.nav.grid.period_on(self.day()),
            fleet.cell(&self.defs),
            self.defs.loc(dest).cell,
            |c| outside(c) || self.realm_cell_allowed(fleet.owner, c),
        )
    }
    pub fn realm_status(&self, key: &str) -> RealmStatus {
        let state = self.state.realms.states.get(key).copied().unwrap_or_default();
        if state == RealmStatus::Unknown
            && self
                .defs
                .realms
                .realm(key)
                .and_then(|r| r.knowledge.as_ref())
                .is_some_and(|k| self.has_knowledge_record(k))
        {
            RealmStatus::Heard
        } else {
            state
        }
    }
    pub fn realm_passable(&self, owner: OwnerId, key: &str) -> bool {
        self.realm_status(key) == RealmStatus::Open
            || owner == OwnerId::Player
                && self.defs.realms.realm(key).is_some_and(|r| {
                    r.key_items.iter().all(|k| self.item_quantity(owner, k) > 0)
                        && (r.key_any.is_empty() || r.key_any.iter().any(|group| group.allows(self, owner)))
                        && self.story2_conditions(&r.also, self.day())
                })
    }
    pub(crate) fn realm_passes(&self, owner: OwnerId) -> BTreeSet<String> {
        self.defs.realms.realms.iter().filter(|r| self.realm_passable(owner, &r.key)).map(|r| r.key.clone()).collect()
    }
    pub fn realm_cell_allowed(&self, owner: OwnerId, cell: Cell) -> bool {
        self.defs.realms.at(&self.defs, cell).is_none_or(|r| self.realm_passable(owner, &r.key))
    }
    pub fn realm_of_port(&self, loc: LocId) -> Option<&RealmDef> {
        let l = self.defs.locations.get(loc.idx())?;
        self.defs.realms.realms.iter().find(|r| r.ports.contains(&l.key))
    }
    pub fn realm_key_at_port(&self, loc: LocId) -> Option<&str> {
        self.realm_of_port(loc).map(|r| r.key.as_str()).or_else(|| {
            self.defs
                .locations
                .get(loc.idx())
                .and_then(|l| self.defs.geography.places.authored.locations.get(&l.key))
                .and_then(|l| l.realm.as_deref())
        })
    }
    pub fn realm_port_allowed(&self, owner: OwnerId, loc: LocId) -> bool {
        self.realm_key_at_port(loc).is_none_or(|key| self.realm_passable(owner, key))
    }
    pub(crate) fn record_realm_contact(&mut self, key: &str, entered: bool) {
        let status = if entered { RealmStatus::Entered } else { RealmStatus::VeilFound };
        let entry = self.state.realms.states.entry(key.into()).or_default();
        *entry = (*entry).max(status);
        if entered {
            self.activate_realm_ports(key);
        }
    }
    fn activate_realm_ports(&mut self, key: &str) {
        let ports: Vec<_> = self
            .defs
            .realms
            .realm(key)
            .into_iter()
            .flat_map(|r| &r.ports)
            .filter_map(|p| self.defs.find_loc(p))
            .collect();
        for loc in ports {
            if let Some(p) =
                self.state.history.ports.get_mut(&loc).filter(|p| p.status == crate::history::PortStatus::Dormant)
            {
                p.status = crate::history::PortStatus::Open;
                p.until = None;
            }
        }
    }
    pub(crate) fn open_realm(&mut self, key: &str) -> Result<(), crate::CommandError> {
        if self.defs.realms.realm(key).is_none() {
            return Err(blocked("realm.unknown"));
        }
        self.state.realms.states.insert(key.into(), RealmStatus::Open);
        self.activate_realm_ports(key);
        Ok(())
    }
    pub(crate) fn eat_otherworld(&mut self, key: &str) -> Result<(), crate::CommandError> {
        if self.cast_player_place().and_then(|p| self.realm_of_port(p.loc)).is_none_or(|r| r.key != key) {
            return Err(blocked("realm.away"));
        }
        self.state.realms.eaten.insert(key.into());
        Ok(())
    }
    pub fn realm_iron_allowed(&self, loc: LocId) -> bool {
        self.realm_of_port(loc).and_then(|r| r.otherworld.as_ref()).is_none_or(|r| {
            r.iron_ashore
                || !self
                    .defs
                    .items
                    .items
                    .iter()
                    .any(|i| i.tags.iter().any(|t| t == "iron") && self.item_quantity(OwnerId::Player, &i.key) > 0)
        })
    }
    pub(crate) fn check_realm_command(&self, cmd: &crate::Command) -> Result<(), crate::CommandError> {
        use crate::Command::*;
        if self.defs.realms.is_empty() {
            return Ok(());
        }
        let Some(owner) = cmd.owner() else { return Ok(()) };
        let loc = match cmd {
            Buy { fleet, .. }
            | Sell { fleet, .. }
            | Resupply { fleet, .. }
            | HireCrew { fleet, .. }
            | Repair { fleet, .. }
            | BuyShip { fleet, .. }
            | SellShip { fleet, .. }
            | RefitShip { fleet, .. } => self.state.fleets.get(fleet).and_then(|f| f.docked_at()),
            BuyInto { holder, .. } | SellFrom { holder, .. } | DeliverContract { holder, .. } => {
                self.holder_location(owner, *holder).ok()
            }
            FoundFleet { at, .. } | FormCaravan { at, .. } => Some(*at),
            RentWarehouse { loc, .. }
            | BuyWarehouse { loc, .. }
            | BuildIndustry { loc, .. }
            | InvestPort { loc, .. }
            | ReportDiscovery { loc, .. }
            | BuyMarketReport { loc, .. }
            | ApplyBargain { loc, .. }
            | BuyItem { loc, .. }
            | SellItem { loc, .. } => Some(*loc),
            _ => None,
        };
        if loc.is_some_and(|loc| !self.realm_port_allowed(owner, loc)) {
            return Err(blocked("realm.key"));
        }
        if matches!(cmd, Talk { .. } | GiveGoods { .. } | RecruitPerson { .. } | RequestAudience { .. })
            && self.cast_player_place().is_some_and(|p| !self.realm_iron_allowed(p.loc))
        {
            return Err(blocked("realm.iron_ashore"));
        }
        Ok(())
    }
    pub(crate) fn realm_skip_paused(&self) -> bool {
        self.upbringing_waiting()
            || self.state.story.pending.is_some()
            || self.pending_story2().is_some()
            || self.state.creatures.pending.is_some()
            || self.flagship(OwnerId::Player).is_none_or(|f| {
                self.fleet_in_battle(f) || self.state.fleets.get(&f).is_none_or(|f| f.docked_at().is_none())
            })
    }
    /// 会话在每个额外日之间处理排期、预测与AI，再用同一暂停条件决定是否继续。
    pub fn realm_skipping(&self) -> bool {
        self.state.realms.debt > 0 && !self.realm_skip_paused()
    }
    /// 只计玩家实际等待的一夜；额外结算不再次生成时间债。
    pub(crate) fn prepare_realm_night(&mut self) {
        let here = self
            .flagship(OwnerId::Player)
            .and_then(|f| self.state.fleets.get(&f))
            .and_then(|f| f.docked_at())
            .and_then(|l| self.realm_of_port(l))
            .cloned();
        let Some(realm) = here.filter(|r| r.otherworld.is_some()) else {
            self.state.realms.stay = None;
            return;
        };
        let Some(rule) = realm.otherworld else { return };
        if self.state.realms.stay.as_ref().is_none_or(|s| s.realm != realm.key) {
            self.state.realms.stay = Some(Stay { realm: realm.key.clone(), nights: 0 });
        }
        if let Some(stay) = &mut self.state.realms.stay {
            stay.nights = stay.nights.saturating_add(1);
            if stay.nights > rule.guest_nights || self.state.realms.eaten.contains(&realm.key) {
                self.state.realms.debt = self
                    .state
                    .realms
                    .debt
                    .saturating_add(rule.time_ratio.saturating_sub(1))
                    .min(rule.max_skip_days)
                    .min(MAX_SKIP);
            }
        }
    }
    pub(crate) fn validate_realms_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.realms;
        let valid = s.debt <= MAX_SKIP
            && s.states.iter().all(|(k, v)| self.defs.realms.realm(k).is_some() && *v != RealmStatus::Unknown)
            && s.eaten.iter().all(|k| self.defs.realms.realm(k).is_some())
            && s.stay
                .as_ref()
                .is_none_or(|stay| self.defs.realms.realm(&stay.realm).is_some_and(|r| r.otherworld.is_some()));
        if valid { Ok(()) } else { Err(CoreError::SnapshotMismatch("秘境状态无效".into())) }
    }
}

/// 沿来向逐格推回；不能越过陆地、地图边界或另一道帷幕。
pub(crate) fn push_back(
    d: &crate::StaticData,
    start: crate::navigation::SubCell,
    delta: [i64; 2],
    push: u8,
) -> crate::navigation::SubCell {
    let mut cell = start.cell();
    let mut pos = start;
    for _ in 0..push {
        let Some(next) =
            d.map.topology().normalize(i64::from(cell.x) - delta[0].signum(), i64::from(cell.y) - delta[1].signum())
        else {
            break;
        };
        if !d.map.is_sea_in_bounds(next) || d.realms.at(d, next).is_some() {
            break;
        }
        pos = crate::navigation::SubCell::center(next);
        cell = next;
    }
    pos
}

impl World {
    /// H10b：应用层目的地缓存只读通行权摘要。
    pub fn realm_passes_of(&self, owner: OwnerId) -> BTreeSet<String> {
        self.realm_passes(owner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::tiny_defs;
    use serde_json::json;

    fn realm(key: &str, veil: serde_json::Value) -> serde_json::Value {
        json!({"key": key, "name": key, "veil": veil, "ports": [], "hint": ""})
    }

    /// 外接矩形之外的格子不在任何帷幕里：寻路先用矩形挡一道（P12），与每格都逐个帷幕去问相同。
    #[test]
    fn cells_outside_the_veil_bounds_belong_to_no_realm() {
        let d = tiny_defs();
        let cell = |x: u16, y: u16| json!({"x": x, "y": y});
        let realms: RealmsDefs = serde_json::from_value(json!({"realms": [
            realm("a", json!({"cells": [cell(7, 3), cell(9, 3), cell(8, 5)], "push": 2})),
            realm("b", json!({"cells": [cell(6, 4), cell(12, 6)], "push": 2})),
        ]}))
        .expect("帷幕");
        let (x0, y0, x1, y1) = realms.veil_bounds().expect("只有逐格的帷幕时给得出矩形");
        assert_eq!((x0, y0, x1, y1), (6, 3, 12, 6));
        let mut inside = 0;
        for y in 0..12u16 {
            for x in 0..20u16 {
                let c = Cell::new(x, y);
                if c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1 {
                    assert!(realms.at(&d, c).is_none(), "{c:?}");
                } else {
                    inside += usize::from(realms.at(&d, c).is_some());
                }
            }
        }
        assert_eq!(inside, 5);
        // 一格帷幕也没有：空矩形，什么格子都在外面
        let none: RealmsDefs =
            serde_json::from_value(json!({"realms": [realm("a", json!({"push": 2}))]})).expect("帷幕");
        let (x0, y0, x1, y1) = none.veil_bounds().expect("空矩形");
        assert!((0..4u16).all(|v| v < x0 || v > x1 || v < y0 || v > y1));
        // 按海区划的帷幕给不出矩形：每格照旧逐个去问
        let marked: RealmsDefs =
            serde_json::from_value(json!({"realms": [realm("a", json!({"mark": "west", "push": 2}))]})).expect("帷幕");
        assert_eq!(marked.veil_bounds(), None);
    }
}
