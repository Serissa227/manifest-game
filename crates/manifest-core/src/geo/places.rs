//! 地图外日程地点：有封闭标识与区域，没有虚构坐标或市场。
use crate::{cast::schedule::schedule_on, world::World};
use serde::Deserialize;

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlaceCatalog {
    #[serde(skip)]
    pub authored: super::authored::AuthoredPlaces,
    pub offstage_regions: Vec<OffstageRegion>,
    pub offstage: Vec<OffstagePlace>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OffstageRegion {
    pub key: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OffstagePlace {
    pub key: String,
    pub name: String,
    pub region: String,
}

impl PlaceCatalog {
    pub fn offstage(&self, key: &str) -> Option<&OffstagePlace> {
        self.offstage.iter().find(|place| place.key == key)
    }
}

impl World {
    /// 内核的真实日程，应用层仍须按见闻/书信过滤，不直接公开未知人物的位置。
    pub fn person_offstage(&self, key: &str) -> Option<&OffstagePlace> {
        if !self.person_alive(key)
            || self.person_in_team(key)
            || self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(key)
        {
            return None;
        }
        let schedule = schedule_on(
            self.defs.cast.person(key)?,
            self.state.cast.persons.get(key),
            self.cast_date(),
            self.defs.calendar.season_of(self.day()) as u32,
        )?;
        self.defs.geography.places.offstage(&schedule.at)
    }
}
