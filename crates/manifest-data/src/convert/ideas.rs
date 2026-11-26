//! 思想文件与世界哈希使用同一有效文件清单。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::ideas::IdeasDefs;

pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> IdeasDefs {
    if !dir.module_enabled("ideas") || !dir.contains("ideas.toml") {
        return IdeasDefs::default();
    }
    let Some(text) = read(dir, "ideas.toml", issues) else { return IdeasDefs::default() };
    let Some(defs) = parse::<IdeasDefs>("ideas.toml", &text, issues) else { return IdeasDefs::default() };
    if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict) {
        for i in &defs.ideas {
            if i.basis.as_ref().is_none_or(|s| s.trim().is_empty())
                || i.sources.is_empty()
                || i.sources.iter().any(|s| s.trim().is_empty())
            {
                issues.push("ideas.toml", &i.key, "严格来源世界的思想必须提供basis与sources");
            }
        }
    }
    defs
}
