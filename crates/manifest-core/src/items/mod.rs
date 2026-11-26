//! 个人物品；静态定义与效果供物品、技能、称号共用，不进入船货和资产估值。

pub mod effects;
pub mod equipment;
pub mod gifts;
pub mod inventory;
pub mod reading;
pub mod shop;
pub use inventory::{Inventory, ItemsState};

use crate::fixed::Money;
use effects::{Effect, EffectKind, EffectLimit};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Weapon,
    Sidearm,
    Outfit,
    Accessory,
    Instrument,
    Focus,
    Book,
    Consumable,
    Gift,
    Curio,
    Chart,
    Key,
}

impl ItemKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Weapon => "weapon",
            Self::Sidearm => "sidearm",
            Self::Outfit => "outfit",
            Self::Accessory => "accessory",
            Self::Instrument => "instrument",
            Self::Focus => "focus",
            Self::Book => "book",
            Self::Consumable => "consumable",
            Self::Gift => "gift",
            Self::Curio => "curio",
            Self::Chart => "chart",
            Self::Key => "key",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemDef {
    pub key: String,
    pub name: String,
    pub kind: ItemKind,
    pub rarity: u8,
    pub price: Money,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub lore: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub bonus: BTreeMap<String, i64>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default, rename = "use")]
    pub uses: Vec<Effect>,
    pub shop: Option<ShopRule>,
    pub read: Option<ReadDef>,
    pub chart: Option<ChartDef>,
    pub work: Option<String>,
    pub published: Option<(i64, String)>,
    #[serde(default)]
    pub flags: ItemFlags,
    #[serde(default)]
    pub key_item: bool,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub owner_hint: Option<String>,
    pub made_by: Option<String>,
    pub variant_of: Option<String>,
}
impl ItemDef {
    pub fn protected(&self) -> bool {
        self.key_item || self.flags.key || self.kind == ItemKind::Key
    }
    pub fn work_key(&self) -> &str {
        self.work.as_deref().unwrap_or(&self.key)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ItemFlags {
    pub key: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShopRule {
    #[serde(default)]
    pub cultures: Vec<String>,
    pub min_size: u8,
    pub weight: i64,
    /// 世界季节编号 0–3；空表表示四季都出售。
    #[serde(default)]
    pub seasons: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadDef {
    pub days: u32,
    pub lang: Option<String>,
    pub category: String,
    #[serde(default)]
    pub gains: BTreeMap<String, i64>,
    #[serde(default)]
    pub skills: Vec<SkillGain>,
    #[serde(default)]
    pub reveals: Vec<String>,
    /// 首次读完作品获得的见闻键；从书目派生，不是海区，也不直接触发历史结果。
    #[serde(default)]
    pub records: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillGain {
    pub skill: String,
    pub xp: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartDef {
    pub regions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookCategory {
    pub key: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetDef {
    pub key: String,
    pub name: String,
    pub items: Vec<String>,
    /// 0 表示全部；允许世界定义收藏型套装的门槛。
    #[serde(default)]
    pub required: usize,
    #[serde(default)]
    pub bonus: Vec<Effect>,
    #[serde(default)]
    pub title: String,
}
impl SetDef {
    pub fn threshold(&self) -> usize {
        if self.required == 0 { self.items.len() } else { self.required }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ItemsDefs {
    pub items: Vec<ItemDef>,
    pub sets: Vec<SetDef>,
    pub book_categories: Vec<BookCategory>,
}
impl ItemsDefs {
    pub fn enabled(&self) -> bool {
        !self.items.is_empty()
    }
    pub fn item(&self, key: &str) -> Option<&ItemDef> {
        self.items.iter().find(|i| i.key == key)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ItemsRules {
    pub effects: BTreeMap<EffectKind, EffectLimit>,
    pub attribute_bonus: EffectLimit,
    pub shelf_slots: usize,
    pub stock: i64,
    pub sell_bp: i64,
    pub use_days: u32,
    pub xp_per_point: i64,
}
impl Default for ItemsRules {
    fn default() -> Self {
        Self {
            effects: BTreeMap::new(),
            attribute_bonus: EffectLimit { single: 3, total: 6 },
            shelf_slots: 12,
            stock: 4,
            sell_bp: 5_000,
            use_days: 7,
            xp_per_point: 100,
        }
    }
}
impl ItemsRules {
    pub fn limit(&self, kind: EffectKind) -> EffectLimit {
        let hard = kind.ceiling();
        let limit = self.effects.get(&kind).copied().unwrap_or(hard);
        EffectLimit { single: limit.single.clamp(0, hard.single), total: limit.total.clamp(0, hard.total) }
    }
}
