//! 历史分片仅加载当前世界的有效文件；规则和引用由内核统一校验。
use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::history::HistoryDefs;

pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> HistoryDefs {
    let mut defs = HistoryDefs::default();
    if !dir.module_enabled("history") {
        return defs;
    }
    for file in dir.files_in("history") {
        let Some(text) = read(dir, &file, issues) else { continue };
        let Some(mut part) = parse::<HistoryDefs>(&file, &text, issues) else { continue };
        for event in &mut part.events {
            event.source = file.clone();
            if matches!(dir.manifest.lore.sourcing, crate::worlds::Sourcing::Strict)
                && (event.basis.as_ref().is_none_or(|s| s.trim().is_empty())
                    || event.sources.is_empty()
                    || event.sources.iter().any(|s| s.trim().is_empty()))
            {
                issues.push(&file, &event.key, "严格来源世界的历史事件必须提供basis与sources");
            }
        }
        for c in &mut part.campaigns {
            c.source = file.clone();
        }
        defs.campaigns.extend(part.campaigns);
        defs.events.extend(part.events);
        defs.ports.extend(part.ports);
        defs.envoys.extend(part.envoys);
    }
    defs.order = manifest_core::history::validation::order(&defs).unwrap_or_default();
    defs
}
