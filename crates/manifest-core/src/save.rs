//! 存档格式与版本迁移。
//!
//! 存档 = 格式标识 + 版本号 + 静态数据引用 + 世界状态快照 + 命令日志，JSON 编码。
//! 本模块只做内存中的序列化与迁移；读写文件与压缩由上层完成。
//!
//! 版本历史：
//! - v1：早期原型格式——快照字段名为 `world`，日志字段名为 `commands`，快照中的日期字段名为 `tick`。
//! - v2：M1 格式。
//! - v3：M2 新增仓库、商队、产业、合同、贷款、外交、期货等状态；旧存档缺失的字段取默认值，
//!   读档时由 `World::from_snapshot` 补齐外交关系与期货做市方。
//! - v4：当前格式（西幻扩展：殖民地、殖民点归属、名声、发现物；迷雾位图记录宽高）。v3 → v4 结构不变，
//!   新字段取默认值；读档时 `World::reconcile` 按旧地图宽度（`rules.world.legacy_map`）把迷雾位图重映射到当前地图。
//!   第五批重做地理（EXPANSION §10.2）不改存档格式、版本号仍为 4：地图变化引起的海上单位修正（重新寻路、移回海上）
//!   同样在读档时由 `World::reconcile` 完成，因为它需要当前的静态数据。
//! - v5：增加世界身份及属性、剧本、改造的 key 表；旧版本一律迁移为经典世界。

use crate::defs::{IdTables, StaticData};
use crate::error::CoreError;
use crate::replay::{LogEntry, StartParams};
use crate::world::WorldState;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SAVE_FORMAT: &str = "manifest-save";
pub const SAVE_VERSION: u32 = 5;

fn classic_world() -> String {
    "classic".into()
}

/// 存档引用的静态数据。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataRef {
    pub hash: String,
    pub keys: IdTables,
}

/// 存档文件。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaveFile {
    pub format: String,
    pub version: u32,
    pub core_version: String,
    #[serde(default = "classic_world")]
    pub world: String,
    pub data: DataRef,
    pub start: StartParams,
    pub snapshot: WorldState,
    pub log: Vec<LogEntry>,
}

impl SaveFile {
    pub fn new(defs: &StaticData, start: StartParams, snapshot: WorldState, log: Vec<LogEntry>) -> SaveFile {
        SaveFile {
            format: SAVE_FORMAT.to_string(),
            version: SAVE_VERSION,
            core_version: crate::CORE_VERSION.to_string(),
            world: defs.world_key.clone(),
            data: DataRef { hash: defs.meta.hash.clone(), keys: defs.meta.keys.clone() },
            start,
            snapshot,
            log,
        }
    }

    pub fn to_json(&self) -> Result<String, CoreError> {
        serde_json::to_string(self).map_err(|e| CoreError::Save(e.to_string()))
    }

    /// 解析存档：先按版本号迁移到当前格式，再反序列化。
    pub fn from_json(text: &str) -> Result<SaveFile, CoreError> {
        let value: Value = serde_json::from_str(text).map_err(|e| CoreError::Save(format!("JSON 解析失败：{e}")))?;
        let migrated = migrate(value)?;
        serde_json::from_value(migrated).map_err(|e| CoreError::Save(format!("存档结构不符：{e}")))
    }

    /// 检查存档引用的数据条目与当前数据兼容（条目只允许在末尾追加）。
    pub fn check_compatible(&self, defs: &StaticData) -> Result<(), CoreError> {
        if self.world != defs.world_key {
            return Err(CoreError::WorldMismatch { saved: self.world.clone(), current: defs.world_key.clone() });
        }
        let cur = &defs.meta.keys;
        let old = &self.data.keys;
        let tables = [
            ("商品", &old.goods, &cur.goods),
            ("地点", &old.locations, &cur.locations),
            ("船型", &old.ships, &cur.ships),
            ("海区", &old.regions, &cur.regions),
            ("势力", &old.factions, &cur.factions),
            ("商会", &old.companies, &cur.companies),
            ("驮畜", &old.animals, &cur.animals),
            ("道路", &old.roads, &cur.roads),
            ("产业类型", &old.industry_types, &cur.industry_types),
            ("配方", &old.recipes, &cur.recipes),
            ("期货交易所", &old.exchanges, &cur.exchanges),
            ("期货合约", &old.futures_specs, &cur.futures_specs),
            ("事件类型", &old.events, &cur.events),
            ("航海士", &old.mates, &cur.mates),
            ("殖民地建筑", &old.colony_buildings, &cur.colony_buildings),
            ("发现物", &old.discoveries, &cur.discoveries),
            ("属性", &old.attributes, &cur.attributes),
            ("剧本", &old.scenarios, &cur.scenarios),
            ("改造", &old.refits, &cur.refits),
            ("岗位", &old.roles, &cur.roles),
        ];
        for (name, o, c) in tables {
            if o.len() > c.len() {
                return Err(CoreError::SnapshotMismatch(format!(
                    "{name}：存档有 {} 条，当前数据只有 {} 条",
                    o.len(),
                    c.len()
                )));
            }
            for (i, (a, b)) in o.iter().zip(c.iter()).enumerate() {
                if a != b {
                    return Err(CoreError::SnapshotMismatch(format!("{name} #{i}：存档中为“{a}”，当前数据为“{b}”")));
                }
            }
        }
        Ok(())
    }
}

/// 把任意旧版本存档迁移到当前版本。
pub fn migrate(mut value: Value) -> Result<Value, CoreError> {
    let format = value.get("format").and_then(Value::as_str).unwrap_or_default().to_string();
    if format != SAVE_FORMAT {
        return Err(CoreError::Save(format!("不是 Manifest 存档（format = “{format}”）")));
    }
    let mut version =
        value.get("version").and_then(Value::as_u64).ok_or_else(|| CoreError::Save("缺少版本号".into()))?;
    if version > u64::from(SAVE_VERSION) {
        return Err(CoreError::Save(format!("存档版本 {version} 比程序支持的 {SAVE_VERSION} 更新")));
    }
    while version < u64::from(SAVE_VERSION) {
        value = match version {
            1 => migrate_v1_to_v2(value)?,
            // v2 → v3、v3 → v4：新增字段均有默认值，结构不变（迷雾位图的重映射需要静态数据，在读档时完成）
            2 | 3 => value,
            4 => {
                let obj = value.as_object_mut().ok_or_else(|| CoreError::Save("存档顶层不是对象".into()))?;
                obj.insert("world".into(), Value::from("classic"));
                value
            }
            v => return Err(CoreError::Save(format!("没有从版本 {v} 迁移的方法"))),
        };
        version += 1;
        if let Some(obj) = value.as_object_mut() {
            obj.insert("version".into(), Value::from(version));
        }
    }
    Ok(value)
}

fn rename_key(obj: &mut serde_json::Map<String, Value>, from: &str, to: &str) -> Result<(), CoreError> {
    let v = obj.remove(from).ok_or_else(|| CoreError::Save(format!("旧存档缺少字段 {from}")))?;
    obj.insert(to.to_string(), v);
    Ok(())
}

/// v1 → v2：字段改名 `world` → `snapshot`、`commands` → `log`、快照中 `tick` → `day`。
fn migrate_v1_to_v2(mut value: Value) -> Result<Value, CoreError> {
    let obj = value.as_object_mut().ok_or_else(|| CoreError::Save("存档顶层不是对象".into()))?;
    rename_key(obj, "world", "snapshot")?;
    rename_key(obj, "commands", "log")?;
    let snap =
        obj.get_mut("snapshot").and_then(Value::as_object_mut).ok_or_else(|| CoreError::Save("快照不是对象".into()))?;
    rename_key(snap, "tick", "day")?;
    Ok(value)
}

/// 把当前格式降级为 v1（仅用于生成兼容性测试样例）。
pub fn downgrade_to_v1(mut value: Value) -> Result<Value, CoreError> {
    let obj = value.as_object_mut().ok_or_else(|| CoreError::Save("存档顶层不是对象".into()))?;
    rename_key(obj, "snapshot", "world")?;
    rename_key(obj, "log", "commands")?;
    obj.insert("version".into(), Value::from(1u32));
    let snap =
        obj.get_mut("world").and_then(Value::as_object_mut).ok_or_else(|| CoreError::Save("快照不是对象".into()))?;
    rename_key(snap, "day", "tick")?;
    Ok(value)
}
