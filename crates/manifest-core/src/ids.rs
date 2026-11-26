//! 标识符类型。
//!
//! 静态内容（商品、地点、船型……）用 `u16` 下标，对应 `StaticData` 中各表的位置；
//! 数据文件中的条目只允许追加、不允许重排，以保证旧存档中的下标仍然有效。
//! 动态实体（舰队、商队、合同……）用 `u32` 自增编号。

use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! static_id {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub u16);

        impl $name {
            pub const fn idx(self) -> usize {
                self.0 as usize
            }
            pub fn from_idx(i: usize) -> Self {
                Self(i as u16)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}#{}", stringify!($name), self.0)
            }
        }
    };
}

macro_rules! dyn_id {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub u32);

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}#{}", stringify!($name), self.0)
            }
        }
    };
}

static_id!(
    /// 商品
    GoodId
);
static_id!(
    /// 地点（港口或内陆城市）
    LocId
);
static_id!(
    /// 船型
    ShipTypeId
);
static_id!(
    /// 海区
    RegionId
);
static_id!(
    /// 势力
    FactionId
);
static_id!(
    /// NPC 商会（静态定义）
    CompanyId
);
static_id!(
    /// 航海士（静态定义）
    MateId
);
static_id!(
    /// 配方
    RecipeId
);
static_id!(
    /// 产业类型
    IndustryTypeId
);
static_id!(
    /// 事件类型
    EventTypeId
);
static_id!(
    /// 开局剧本
    ScenarioId
);
static_id!(
    /// 期货交易所
    ExchangeId
);
static_id!(
    /// 道路
    RoadId
);
static_id!(
    /// 驮畜 / 车辆类型
    AnimalId
);
static_id!(
    /// 改造项目
    RefitId
);
static_id!(
    /// 殖民地建筑类型
    ColonyBuildingId
);
static_id!(
    /// 发现物
    DiscoveryId
);

dyn_id!(
    /// 舰队
    FleetId
);
dyn_id!(
    /// 商队
    CaravanId
);
dyn_id!(
    /// 产业实例
    IndustryId
);
dyn_id!(
    /// 委托合同
    ContractId
);
dyn_id!(
    /// 新闻 / 传闻
    NewsId
);
dyn_id!(
    /// 贷款
    LoanId
);
dyn_id!(
    /// 期货合约实例
    FuturesId
);
dyn_id!(
    /// 战斗
    BattleId
);
dyn_id!(
    /// 殖民地
    ColonyId
);

/// 资产所有者：玩家或某家 NPC 商会。
///
/// 序列化为字符串（`"player"` 或 `"c3"`），以便作为 JSON 映射的键。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum OwnerId {
    Player,
    Company(CompanyId),
}

impl OwnerId {
    pub fn is_player(self) -> bool {
        matches!(self, OwnerId::Player)
    }

    pub fn company(self) -> Option<CompanyId> {
        match self {
            OwnerId::Company(c) => Some(c),
            OwnerId::Player => None,
        }
    }

    pub fn as_key(self) -> String {
        match self {
            OwnerId::Player => "player".to_string(),
            OwnerId::Company(c) => format!("c{}", c.0),
        }
    }

    pub fn parse_key(s: &str) -> Option<OwnerId> {
        if s == "player" {
            return Some(OwnerId::Player);
        }
        s.strip_prefix('c').and_then(|n| n.parse::<u16>().ok()).map(|n| OwnerId::Company(CompanyId(n)))
    }
}

impl Serialize for OwnerId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_key())
    }
}

impl<'de> Deserialize<'de> for OwnerId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        OwnerId::parse_key(&s).ok_or_else(|| serde::de::Error::custom(format!("无效的所有者标识：{s}")))
    }
}

/// 网格坐标。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Debug)]
pub struct Cell {
    pub x: u16,
    pub y: u16,
}

impl Cell {
    pub const fn new(x: u16, y: u16) -> Self {
        Self { x, y }
    }
}
