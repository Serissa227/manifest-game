//! 族裔来自故事；阳光状态有界，遮蔽与逆转使用真实装备与轨道。
pub mod validation;
use crate::{
    FleetId, OwnerId, World,
    error::{CommandError, CoreError},
    societies::blocked,
    weather::Sky,
};
use serde::{Deserialize, Serialize};
pub const MAX_STRAIN: u8 = 20;
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LineagesDefs {
    pub lineages: Vec<LineageDef>,
    pub indoor_venues: Vec<String>,
}
impl LineagesDefs {
    pub fn is_empty(&self) -> bool {
        self.lineages.is_empty()
    }
    pub fn lineage(&self, k: &str) -> Option<&LineageDef> {
        self.lineages.iter().find(|l| l.key == k)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Vampire,
    Witch,
    Elf,
    Spirit,
    Shapeshifter,
    Undead,
    Other,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineageDef {
    pub key: String,
    pub name: String,
    pub kind: Kind,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub origin: String,
    #[serde(default)]
    pub powers: Vec<Power>,
    #[serde(default)]
    pub weaknesses: Vec<String>,
    pub daylight: Option<Daylight>,
    #[serde(default)]
    pub hunted_by: Vec<String>,
    #[serde(default)]
    pub relations: Vec<Relation>,
    pub reversal: Option<String>,
    pub reversal_note: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Power {
    NightSight { radius: u8 },
    Fog { pct: u8 },
    Ward { power: u8 },
    Spell { spell: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relation {
    pub lineage: String,
    pub kind: RelationKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Kin,
    Allies,
    Enemies,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Daylight {
    pub effect: SunEffect,
    pub shade: Vec<String>,
    pub safe_weather: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SunEffect {
    Burn,
    Weaken,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LineagesState {
    pub changed: bool,
    pub player: Option<String>,
    pub strain: u8,
    pub last_day: Option<u32>,
}
impl LineagesState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
impl World {
    pub fn player_lineage(&self) -> Option<&LineageDef> {
        let key = if self.state.lineages.changed {
            self.state.lineages.player.as_deref()
        } else {
            self.state
                .protagonist
                .as_ref()
                .and_then(|p| p.protagonist.as_deref())
                .and_then(|p| self.defs.cast.person(p))
                .map(|p| p.lineage.as_str())
        }?;
        self.defs.lineages.lineage(key)
    }
    pub fn lineage_has_spell(&self, key: &str) -> bool {
        self.player_lineage().is_some_and(|l| l.powers.iter().any(|p| matches!(p,Power::Spell{spell}if spell==key)))
    }
    pub fn lineage_power(&self, kind: &str, minute: u16) -> i64 {
        self.player_lineage()
            .map_or(0, |l| {
                l.powers
                    .iter()
                    .filter_map(|p| match (p, kind) {
                        (Power::NightSight { radius }, "night_sight") if !(360..1080).contains(&minute) => {
                            Some(i64::from(*radius))
                        }
                        (Power::Fog { pct }, "fog") => Some(i64::from(*pct)),
                        (Power::Ward { power }, "ward") => Some(i64::from(*power)),
                        _ => None,
                    })
                    .sum::<i64>()
            })
            .min(if kind == "night_sight" { 8 } else { 20 })
    }
    pub fn lineage_shaded(&self, daylight: &Daylight) -> bool {
        self.inventory(OwnerId::Player)
            .and_then(|i| i.equipment.get("captain"))
            .into_iter()
            .flat_map(|slots| slots.values())
            .any(|key| self.defs.items.item(key).is_some_and(|i| i.tags.iter().any(|t| daylight.shade.contains(t))))
    }
    pub fn lineage_exposed(&self, minute: u16) -> bool {
        let Some(sun) = self.player_lineage().and_then(|l| l.daylight.as_ref()) else { return false };
        if !(360..1080).contains(&minute) || self.lineage_shaded(sun) {
            return false;
        }
        // 未离开甲板／船舱的默认港口位置按有遮蔽处理；明确的户外场所才暴露。
        let Some(place) = self.state.cast.place.as_ref() else { return false };
        if place.venue.is_empty()
            || self.defs.lineages.indoor_venues.contains(&place.venue)
            || ["cabin", "tavern", "inn", "library", "temple", "church", "academy", "covered_litter"]
                .contains(&place.venue.as_str())
        {
            return false;
        }
        self.weather_at(self.defs.loc(place.loc).cell).is_some_and(|w| {
            w.sky == Sky::Clear
                && !sun
                    .safe_weather
                    .iter()
                    .any(|safe| safe == w.sky.key() || (safe == "overcast" && w.sky == Sky::Cloudy))
        })
    }
    pub(crate) fn transform_lineage(&mut self, lineage: Option<&str>) -> Result<(), CommandError> {
        if self.defs.lineages.is_empty() {
            return Err(blocked("lineage.disabled"));
        }
        if let Some(key) = lineage {
            let d = self.defs.lineages.lineage(key).cloned().ok_or_else(|| blocked("lineage.unknown"))?;
            let reverse = d.reversal.as_deref().ok_or_else(|| blocked("lineage.no_reversal"))?;
            if self.state.story2.tracks.get(reverse).is_some_and(|t| t.status != crate::story2::Status::Active) {
                self.state.story2.tracks.remove(reverse);
                self.state.story2.pending.retain(|p| p.track != reverse);
            }
            self.start_story2(reverse)?;
            self.record_forbidden(crate::societies::Activity::Lineage(key));
        }
        self.state.lineages.changed = true;
        self.state.lineages.player = lineage.map(str::to_owned);
        self.state.lineages.strain = 0;
        Ok(())
    }
    pub(crate) fn lineages_day(&mut self) {
        if self.defs.lineages.is_empty()
            || self.player_lineage().is_none()
            || self.state.lineages.last_day == Some(self.day())
        {
            return;
        }
        // 日结按白天行程的场所取一次暴露，不能因午夜结算而让白天规则失效。
        let exposed = self.lineage_exposed(720);
        self.state.lineages.strain = if exposed {
            self.state.lineages.strain.saturating_add(2).min(MAX_STRAIN)
        } else {
            self.state.lineages.strain.saturating_sub(2)
        };
        self.state.lineages.last_day = Some(self.day());
    }
    pub fn lineage_fleet_penalty(&self, fleet: FleetId) -> i64 {
        if self.flagship(OwnerId::Player) == Some(fleet) { i64::from(self.state.lineages.strain) } else { 0 }
    }
    pub(crate) fn validate_lineages_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.lineages;
        if s.is_empty()
            || !self.defs.lineages.is_empty()
                && s.strain <= MAX_STRAIN
                && s.last_day.is_none_or(|d| d <= self.day())
                && s.player.as_ref().is_none_or(|k| s.changed && self.defs.lineages.lineage(k).is_some())
                && (s.strain == 0 || self.player_lineage().is_some())
                && (s.last_day.is_none() || s.changed || self.player_lineage().is_some())
        {
            Ok(())
        } else {
            Err(CoreError::SnapshotMismatch("族裔转化或阳光减益无效".into()))
        }
    }
}
