//! 秘术文件与严格出处。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::arcana::ArcanaDefs;
pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> ArcanaDefs {
    if !dir.module_enabled("arcana") || !dir.contains("arcana.toml") {
        return ArcanaDefs::default();
    }
    let Some(text) = read(dir, "arcana.toml", issues) else { return ArcanaDefs::default() };
    let Some(d) = parse::<ArcanaDefs>("arcana.toml", &text, issues) else { return ArcanaDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for s in &d.schools {
            if s.basis.as_deref() == Some("original") && !dir.manifest.lore.allow_original.contains(&s.key) {
                issues.push("arcana.toml", &s.key, "原创流派必须在lore.allow_original中逐项许可");
            }
            if s.basis.as_ref().is_none_or(|b| b.trim().is_empty())
                || s.sources.is_empty()
                || s.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("arcana.toml", &s.key, "流派必须提供basis与sources");
            }
        }
        for s in &d.spells {
            if s.source.as_ref().is_none_or(|s| s.trim().is_empty()) {
                issues.push("arcana.toml", &s.key, "法术必须提供source");
            }
        }
    }
    d
}
