//! 结社有效文件与严格出处；不对经典世界补默认内容。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::societies::SocietiesDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> SocietiesDefs {
    if !dir.module_enabled("societies") || !dir.contains("societies.toml") {
        return SocietiesDefs::default();
    }
    let Some(text) = read(dir, "societies.toml", issues) else { return SocietiesDefs::default() };
    let Some(defs) = parse::<SocietiesDefs>("societies.toml", &text, issues) else { return SocietiesDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for s in &defs.societies {
            if s.basis.as_deref() == Some("original") && !dir.manifest.lore.allow_original.contains(&s.key) {
                issues.push("societies.toml", &s.key, "原创结社必须在lore.allow_original中逐项许可");
            }
            if s.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || s.sources.is_empty()
                || s.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("societies.toml", &s.key, "严格来源世界必须提供basis与sources");
            }
        }
    }
    defs
}
