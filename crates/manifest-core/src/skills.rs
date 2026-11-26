//! K01：技能效果（`skills.toml` 的 `effects` 与 `levels[].effects`）。
//!
//! - 规则开关 `rules.toml [skill_effects] enabled`，缺省关闭：经典世界与测试夹具不写这一节，走原来的代码路径。
//! - 只有玩家主角有技能等级（物品栏里的 `skill_xp`；等级按 [`World::upbringing_skill_level`]，
//!   即 `native_rules.toml` 的 `skill_profiles` 阈值）。按文件头的约定**仅当前等级的效果生效**，低等级的不累加。
//! - 技能效果作为来源（`skill:<key>`）并进物品、套装、考试奖励的同一个汇总（[`crate::items::effects::aggregate`]），
//!   受同一套单件 / 叠加上限约束；各读取点照旧读 [`World::attr_hook`] 或 [`World::item_hook`]，不另开通道。
//! - 没有读取点的种类（目前只有 `chart_reveal`）照样加载、校验与显示，但不进汇总（[`has_reader`]）。
//!
//! 这里不做 IO；数据由 `manifest-data` 读入 [`crate::story2::Story2Defs::skill_effects`]。

use crate::items::effects::{Effect, EffectContext, EffectKind};
use crate::{OwnerId, StaticData, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// `rules.toml [skill_effects]`。缺省关闭。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SkillEffectsRules {
    pub enabled: bool,
}

/// 一个技能各等级的效果。`summary` 是数据里技能顶层的 `effects`（只作没有 `levels` 时的回退）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SkillEffects {
    pub max_level: u32,
    pub summary: Vec<Effect>,
    pub levels: Vec<SkillLevelEffects>,
}

/// 某一级的效果与这一级的累计经验阈值（数据里写的 `xp`；生效的等级按技能等级的阈值表算）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillLevelEffects {
    pub level: u32,
    pub xp: i64,
    pub effects: Vec<Effect>,
}

impl SkillEffects {
    /// 第 `level` 级生效的效果：0 级为空；写了 `levels` 的取那一级（超过最高一级取最高一级），没写的取顶层 `effects`。
    pub fn at(&self, level: u32) -> &[Effect] {
        if level == 0 {
            return &[];
        }
        if self.levels.is_empty() {
            return &self.summary;
        }
        self.levels
            .iter()
            .find(|l| l.level == level)
            .or_else(|| self.levels.iter().filter(|l| l.level <= level).max_by_key(|l| l.level))
            .map_or(&[], |l| l.effects.as_slice())
    }
}

/// 这种效果在内核里有没有读取点。没有的照样显示，但不进汇总（接上了也不会改变任何数）。
/// 物品那一侧的 `chart_reveal` 同样没有读取点（H01 交接第 2 节第 9 条）。
pub fn has_reader(kind: EffectKind) -> bool {
    !matches!(kind, EffectKind::ChartReveal)
}

/// 数据里技能效果的数值上界：有读取点的不得超过世界的单件上限（物品同理）；没有读取点的只要求不离谱（≤ 100）。
fn value_max(defs: &StaticData, kind: EffectKind) -> i64 {
    if has_reader(kind) { defs.rules.items.limit(kind).single } else { 100 }
}

/// 加载后的校验（在 `manifest-data` 组装完静态数据后调用）。限定活动名是否真实由
/// [`crate::upbringing::validation::effect_activity_problems`] 一并检查（复用 U05 的校验）。
pub fn problems(defs: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    for (key, s) in &defs.story2.skill_effects {
        let mut push = |m: String| errors.push(format!("技能 {key}：{m}"));
        let all = s.summary.iter().chain(s.levels.iter().flat_map(|l| &l.effects));
        for e in all {
            if !(1..=value_max(defs, e.kind)).contains(&e.value) {
                push(format!("{} 的数值 {} 不在 1–{} 之内", e.kind.key(), e.value, value_max(defs, e.kind)));
            }
            if (e.activity.is_some() && e.kind != EffectKind::ActivityPct)
                || ((e.tag.is_some() || e.culture.is_some()) && e.kind != EffectKind::AffinityPct)
                || (e.spell.is_some() != (e.kind == EffectKind::Spell))
                || (e.region.is_some() && e.kind != EffectKind::ChartReveal)
            {
                push(format!("{} 的限定参数不匹配", e.kind.key()));
            }
        }
        if !s.levels.is_empty() {
            let numbered = s.levels.iter().enumerate().all(|(i, l)| l.level as usize == i + 1);
            if !numbered || s.levels.len() != s.max_level as usize {
                push(format!("levels 应从 1 级起逐级写到 max_level（{}）", s.max_level));
            }
            if s.levels.windows(2).any(|w| w[1].xp <= w[0].xp) || s.levels.first().is_some_and(|l| l.xp <= 0) {
                push("各级经验阈值应为正数且逐级递增".into());
            }
            if let Some(p) = defs.upbringing.skill_profiles.get(key)
                && !p.unavailable
                && p.thresholds != s.levels.iter().map(|l| l.xp).collect::<Vec<_>>()
            {
                push(format!("各级经验阈值与技能等级表（skill_profiles）的 {:?} 不一致", p.thresholds));
            }
            // 同一种效果逐级不减：写反、写错位的数值多半是笔误
            let value = |l: &SkillLevelEffects, k: EffectKind| -> i64 {
                l.effects.iter().filter(|e| e.kind == k).map(|e| e.value).sum()
            };
            for w in s.levels.windows(2) {
                for e in &w[0].effects {
                    if value(&w[1], e.kind) < value(&w[0], e.kind) {
                        push(format!("{} 在第 {} 级比第 {} 级还低", e.kind.key(), w[1].level, w[0].level));
                    }
                }
            }
        }
    }
    errors
}

/// 某种效果在主角身上的合计：`raw` 是各来源各自限过单件上限后的和，`applied` 是再限过叠加上限的实得
/// （都按数据里的数，百分数未折基点）。`raw > applied` 即“被叠加上限压住了”。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EffectTotal {
    pub raw: i64,
    pub applied: i64,
}

impl World {
    pub fn skill_effects_enabled(&self) -> bool {
        self.defs.rules.skill_effects.enabled
    }

    /// 技能当前等级生效的效果（不看开关；没有效果数据的技能为空）。
    pub fn skill_effects_now(&self, key: &str) -> &[Effect] {
        self.defs.story2.skill_effects.get(key).map_or(&[], |s| s.at(self.upbringing_skill_level(key)))
    }

    /// 并进效果汇总的技能来源：开关打开时，玩家每个技能当前等级的效果（只留有读取点的种类）。
    pub(crate) fn skill_effect_sources(&self) -> Vec<(String, Vec<Effect>)> {
        if !self.skill_effects_enabled() {
            return Vec::new();
        }
        let Some(inv) = self.inventory(OwnerId::Player) else { return Vec::new() };
        inv.skill_xp
            .iter()
            .filter(|(_, xp)| **xp > 0)
            .filter_map(|(key, _)| {
                let effects: Vec<Effect> =
                    self.skill_effects_now(key).iter().filter(|e| has_reader(e.kind)).cloned().collect();
                (!effects.is_empty()).then(|| (format!("skill:{key}"), effects))
            })
            .collect()
    }

    /// 主角身上某种效果的合计与实得（不限定活动、标签等的那一份；界面用来写“已到上限”）。
    pub fn captain_effect_total(&self, kind: EffectKind) -> EffectTotal {
        let rules = &self.defs.rules.items;
        let context = EffectContext::default();
        let sources = self.item_effect_sources(OwnerId::Player, "captain");
        let raw = sources.iter().fold(0i64, |sum, (_, effects)| {
            let one = effects
                .iter()
                .filter(|e| e.kind == kind && e.applies(&context))
                .fold(0i64, |v, e| v.saturating_add(e.value.max(0)).min(rules.limit(kind).single));
            sum.saturating_add(one)
        });
        let applied =
            crate::items::effects::aggregate(sources.iter().map(|(k, e)| (k.as_str(), e.as_slice())), rules, &context)
                .get(&kind)
                .copied()
                .unwrap_or(0);
        EffectTotal { raw, applied }
    }
}

/// 测试与界面共用：技能 key → 效果的表。
pub type SkillEffectTable = BTreeMap<String, SkillEffects>;

#[cfg(test)]
mod tests;
