//! 传说船的目录、图纸及严格出处。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::legend_ships::LegendShipsDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> LegendShipsDefs {
    if !dir.module_enabled("legendary_ships") || !dir.contains("legend_ships.toml") {
        return LegendShipsDefs::default();
    }
    let Some(t) = read(dir, "legend_ships.toml", issues) else { return LegendShipsDefs::default() };
    let Some(d) = parse::<LegendShipsDefs>("legend_ships.toml", &t, issues) else { return LegendShipsDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for s in &d.ships {
            if s.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || s.sources.is_empty()
                || s.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("legend_ships.toml", &s.key, "传说船必须提供basis与sources");
            }
        }
    }
    d
}
