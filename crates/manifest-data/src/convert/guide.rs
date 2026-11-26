//! 玩法与引导线的严格分片加载；引用和结构由内核统一校验。
use super::{Issues, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::story2::guide_defs::GuideDefs;

pub(super) fn load(dir: &EffectiveWorld, issues: &mut Issues) -> GuideDefs {
    // guide 是合并表，世界解析器按 manifest 的顺序合到逻辑文件 guide.toml。
    load_optional(dir, "guide.toml", issues).unwrap_or_default()
}
