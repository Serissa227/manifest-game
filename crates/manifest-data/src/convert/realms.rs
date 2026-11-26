//! 秘境文件及严格出处。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::realms::RealmsDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> RealmsDefs {
    if !dir.module_enabled("realms") || !dir.contains("realms.toml") {
        return RealmsDefs::default();
    }
    let Some(t) = read(dir, "realms.toml", issues) else { return RealmsDefs::default() };
    let Some(d) = parse::<RealmsDefs>("realms.toml", &t, issues) else { return RealmsDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for r in &d.realms {
            if r.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || r.sources.is_empty()
                || r.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("realms.toml", &r.key, "秘境必须提供basis与sources");
            }
        }
    }
    d
}
