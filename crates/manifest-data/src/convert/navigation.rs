//! 世界包导航配置与持久缓存的唯一加载入口。

use crate::nav_cache::{NavCacheOptions, NavInput, load_existing, load_or_build, parse_navigation};
use crate::worlds::EffectiveWorld;
use crate::{DataError, DataIssue};
use manifest_core::calendar::Calendar;
use manifest_core::defs::{LocationDef, RegionDef};
use manifest_core::nav::{NavTable, NavigationRules, SeaMap};
use manifest_core::{Cell, LocId};
use std::sync::Arc;

pub(super) fn load(
    world: &EffectiveWorld,
    map: &SeaMap,
    regions: &[RegionDef],
    locations: &[LocationDef],
    ports: &[(LocId, Cell)],
) -> Result<Arc<NavTable>, DataError> {
    let calendar = &world.manifest.calendar;
    let rules = if world.contains("navigation.toml") {
        let text = world.read("navigation.toml").map_err(super::world_error)?;
        let keys = ports.iter().map(|(id, _)| (locations[id.idx()].key.clone(), *id)).collect::<Vec<_>>();
        Some(parse_navigation(&text, calendar, map, regions, &keys)?)
    } else if calendar.months() != Calendar::default().months() || calendar.seasons() != Calendar::default().seasons() {
        // 无导航文件仍沿用旧风流与距离，只把周期选择对齐世界日历。
        Some(NavigationRules { calendar: calendar.clone(), ..Default::default() })
    } else {
        None
    };
    let input =
        NavInput { world: &world.manifest.key, map, regions, rules: rules.as_ref(), loc_count: locations.len(), ports };
    let options = NavCacheOptions::for_data_dir(world.data_root());
    // 桌面版的缓存写在用户目录；那里还没有、而 data 旁有现成的（开发目录、随包附带的）时直接用，不再重建
    let beside = NavCacheOptions::beside_data(world.data_root());
    let found = match beside {
        Some(beside) => match load_existing(input, &options) {
            Ok(None) => load_existing(input, &beside),
            other => other,
        },
        None => Ok(None),
    };
    found.and_then(|found| found.map_or_else(|| load_or_build(input, &options), Ok)).map(|loaded| loaded.table).map_err(
        |error| DataError {
            issues: vec![DataIssue {
                file: "navigation.toml".into(),
                item: "navigation".into(),
                message: error.to_string(),
            }],
        },
    )
}
