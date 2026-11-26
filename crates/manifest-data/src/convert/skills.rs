//! K01：读技能的效果（`skills.toml` 的 `effects` 与 `levels[].effects`）。
//!
//! 效果的种类用物品的封闭词表（[`EffectKind`]），写错种类或多写字段都报数据错误，不默默丢弃。
//! 数值范围、逐级阈值、与技能等级表一致等检查在静态数据组装完之后由 [`manifest_core::skills::problems`] 做；
//! 限定的活动名是否真实由养成校验（U05 的 `effect_activity_problems`）一并检查。

use super::Issues;
use manifest_core::items::effects::Effect;
use manifest_core::skills::{SkillEffects, SkillLevelEffects};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LevelRaw {
    level: u32,
    xp: i64,
    #[serde(default)]
    effects: Vec<Effect>,
}

/// 一条技能的效果；技能没写任何效果时为 None。
pub(super) fn load(file: &str, key: &str, skill: &toml::Value, issues: &mut Issues) -> Option<SkillEffects> {
    let summary = skill.get("effects");
    let levels = skill.get("levels");
    if summary.is_none() && levels.is_none() {
        return None;
    }
    let summary: Vec<Effect> = match summary.cloned().map(|v| v.try_into()) {
        None => Vec::new(),
        Some(Ok(v)) => v,
        Some(Err(e)) => {
            issues.push(file, key, format!("effects 写得不对：{e}"));
            return None;
        }
    };
    let levels: Vec<LevelRaw> = match levels.cloned().map(|v| v.try_into()) {
        None => Vec::new(),
        Some(Ok(v)) => v,
        Some(Err(e)) => {
            issues.push(file, key, format!("levels 写得不对：{e}"));
            return None;
        }
    };
    let max_level = match skill.get("max_level").and_then(|v| v.as_integer()).map(u32::try_from) {
        Some(Ok(n)) => n,
        None if levels.is_empty() => 0,
        _ => {
            issues.push(file, key, "写了 levels 却没有有效的 max_level");
            return None;
        }
    };
    Some(SkillEffects {
        max_level,
        summary,
        levels: levels
            .into_iter()
            .map(|l| SkillLevelEffects { level: l.level, xp: l.xp, effects: l.effects })
            .collect(),
    })
}
