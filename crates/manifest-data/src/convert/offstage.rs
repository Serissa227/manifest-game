//! 场外地点目录：严格 key/区域闭包，不进入地图地点编号。
use super::{Issues, check_keys, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::geo::places::PlaceCatalog;

pub(super) fn load(dir: &EffectiveWorld, location_keys: &[String], is: &mut Issues) -> PlaceCatalog {
    let catalog: PlaceCatalog = load_optional(dir, "offstage.toml", is).unwrap_or_default();
    check_keys(
        "offstage.toml",
        "offstage_regions",
        catalog.offstage_regions.iter().map(|p| (p.key.as_str(), p.name.as_str())),
        is,
    );
    check_keys("offstage.toml", "offstage", catalog.offstage.iter().map(|p| (p.key.as_str(), p.name.as_str())), is);
    for p in &catalog.offstage {
        if location_keys.contains(&p.key) {
            is.push("offstage.toml", &p.key, "场外 key 与地图地点重复");
        }
        if !catalog.offstage_regions.iter().any(|r| r.key == p.region) {
            is.push("offstage.toml", &p.key, "未知场外区域");
        }
    }
    catalog
}
