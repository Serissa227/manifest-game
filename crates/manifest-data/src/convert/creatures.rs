//! 怪异目录：严格世界必须声明出处。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::creatures::CreaturesDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> CreaturesDefs {
    if !dir.module_enabled("creatures") || !dir.contains("creatures.toml") {
        return CreaturesDefs::default();
    }
    let Some(t) = read(dir, "creatures.toml", issues) else { return CreaturesDefs::default() };
    let Some(d) = parse::<CreaturesDefs>("creatures.toml", &t, issues) else { return CreaturesDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for c in &d.creatures {
            if c.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || c.sources.is_empty()
                || c.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("creatures.toml", &c.key, "怪异必须提供basis与sources");
            }
        }
    }
    d
}
