//! 海区创作源（C12：世界包登记的 `regions.toml`）里给界面的内容字段，按海区 key 对到运行时的海区上。
//!
//! 运行时的海区（范围、季节天气、气候）来自地图包生成的 `world/regions.toml`，那份文件不带内容字段；
//! 音乐分区（FRAMEWORK §15.1）只写在创作源里。这里只取显示用的字段：不改海区定义，不进航线指纹，
//! 也不影响任何模拟结果。没有登记创作源的世界（经典、测试海域）得到空表。

use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::defs::RegionDef;
use manifest_core::geo::authored::RegionSource;
use std::collections::BTreeMap;
use toml::Value;

/// 海区创作源的逻辑路径（`world.toml` 的 `[tables] regions = [...]` 合并成的表）。
const FILE: &str = "regions.toml";

/// 读创作源里各海区的内容字段。创作源与地图包的海区是否逐个对应由地图包的加载检查
/// （`map_package::load`：“地图海区顺序与作者海区不一致”）；这里只认运行时确有的海区，别的行不理会。
pub(super) fn load(dir: &EffectiveWorld, regions: &[RegionDef], is: &mut Issues) -> BTreeMap<String, RegionSource> {
    let mut out = BTreeMap::new();
    if !dir.contains(FILE) {
        return out;
    }
    let Some(text) = read(dir, FILE, is) else { return out };
    let Some(source) = parse::<Value>(FILE, &text, is) else { return out };
    for row in source.get("regions").and_then(Value::as_array).into_iter().flatten() {
        let Some(key) = row.get("key").and_then(Value::as_str).filter(|key| regions.iter().any(|r| r.key == *key))
        else {
            continue;
        };
        let music = match row.get("music") {
            None => None,
            // 原样保留作者写的名字（大小写、连字符由界面规整）；只有空白的当作没写
            Some(Value::String(zone)) => Some(zone.clone()).filter(|zone| !zone.trim().is_empty()),
            Some(_) => {
                is.push(FILE, format!("regions[{key}]"), "music 必须是文字（音乐分区的名字或曲目编号）");
                None
            }
        };
        out.insert(key.to_owned(), RegionSource { music });
    }
    out
}
