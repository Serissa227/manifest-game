//! 族裔定义与出处；阳光与逆转规则由内核验证。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::lineages::LineagesDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> LineagesDefs {
    if !dir.module_enabled("lineages") || !dir.contains("lineages.toml") {
        return LineagesDefs::default();
    }
    let Some(t) = read(dir, "lineages.toml", issues) else { return LineagesDefs::default() };
    let Some(d) = parse::<LineagesDefs>("lineages.toml", &t, issues) else { return LineagesDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for l in &d.lineages {
            if l.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || l.sources.is_empty()
                || l.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("lineages.toml", &l.key, "族裔必须提供basis与sources");
            }
        }
    }
    d
}
