//! 经纬度作者格式的运行态补充。内核只保存整数坐标、封闭引用与确定性条件。
use crate::{Cell, LocId, World};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AuthoredPlaces {
    pub locations: BTreeMap<String, LocationSource>,
    pub roads: BTreeMap<String, RoadSource>,
    pub discoveries: BTreeMap<String, DiscoverySource>,
    pub sites: BTreeMap<String, SiteSource>,
    /// 海区创作源（世界包登记的 C12 `regions.toml`）里给界面的内容字段，按海区 key；没有创作源的世界（经典）为空。
    pub regions: BTreeMap<String, RegionSource>,
    /// 完整保留显式登记的外部内容依赖，不把缺失人物或未支持的关系变成有效互动。
    pub pending_ties: Vec<PendingTie>,
}

/// 海区创作源里只给界面看的内容字段：不进世界状态，不参与航行、天气与任何结算。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RegionSource {
    /// 音乐分区（FRAMEWORK §15.1）：作者写的名字原样保留，由界面决定这片海放哪首航海曲；没写为 None
    pub music: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingTie {
    pub key: String,
    pub requires: String,
    pub tie: crate::cast::relations::TieDef,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Provenance {
    pub basis: String,
    pub sources: Vec<String>,
    /// 十万分之一度；仅用于显示/审计，导航仍用已生成的整数地图格。
    pub lonlat_e5: Option<[i64; 2]>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocationSource {
    pub provenance: Provenance,
    pub anchor_hint: String,
    pub river: Option<String>,
    pub facilities: Vec<String>,
    pub style: Option<String>,
    pub hidden: bool,
    pub realm: Option<String>,
    pub dormant: Option<DormantPort>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DormantPort {
    pub until: u32,
    pub by: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RoadSource {
    pub provenance: Provenance,
    pub days: u32,
    pub via: Vec<String>,
    pub risk_bp: i64,
    pub lore: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DiscoveryMode {
    #[default]
    Sight,
    Land,
    Dive,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiscoveryRequirements {
    pub mode: DiscoveryMode,
    pub permission: bool,
    pub landing: Option<bool>,
    pub weather: Option<String>,
    pub history: Option<String>,
    pub records: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveryMove {
    pub from_year: u32,
    pub location: String,
    pub lonlat_e5: [i64; 2],
    pub cell: Cell,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoverySource {
    pub provenance: Provenance,
    pub radius: u16,
    pub requires: DiscoveryRequirements,
    pub codex: bool,
    pub clue: Option<String>,
    pub phantom: bool,
    pub reachable: bool,
    pub once: bool,
    pub moves: Vec<DiscoveryMove>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteSource {
    pub provenance: Provenance,
    pub radius: u16,
    pub discovery: Option<String>,
}

impl World {
    pub(crate) fn require_open_port(&self, loc: LocId) -> Result<(), crate::error::CommandError> {
        if self.defs.locations.get(loc.idx()).is_some() && !self.port_is_open(loc) {
            return Err(crate::error::Reason::new("port.not_open", "港口尚未开放").rule());
        }
        Ok(())
    }

    /// 按作者开放年份启用；不改写静态归属，也不预设时间线的玩家干预结果。
    pub fn port_is_open(&self, loc: LocId) -> bool {
        let Some(place) = self.defs.locations.get(loc.idx()) else { return false };
        let year = self.defs.rules.world.start_year + i64::from(self.defs.calendar.date_of(self.day()).year) - 1;
        self.defs
            .geography
            .places
            .authored
            .locations
            .get(&place.key)
            .and_then(|p| p.dormant.as_ref())
            .is_none_or(|p| year >= i64::from(p.until))
    }
}
