//! `data/effects.toml`：组合事件的效果词表与边界。

use super::{Issues, fx, load_file};
use crate::raw::Dec;
use crate::worlds::EffectiveWorld;
use manifest_core::composed::{ComposedRules, EffectBounds};
use manifest_core::defs::EffectKind;
use manifest_core::fixed::Fx;
use serde::Deserialize;

const FILE: &str = "effects.toml";

/// 殖民地效果的系数下限（殖民地属于玩家，负面效果的幅度不能超过这里）。
const COLONY_MULT_FLOOR: Fx = Fx(6_000);
/// 殖民地效果的变化量下限。
const COLONY_DELTA_FLOOR: i64 = -15;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EffectsFile {
    composed: ComposedRaw,
    effects: Vec<EffectRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ComposedRaw {
    max_effects: usize,
    cooldown_days: u32,
    max_per_year: u32,
    repeat_days: u32,
    budget: Dec,
    max_title_chars: usize,
    max_text_chars: usize,
    /// 新殖民地不受负面殖民地效果影响的天数（缺省 0）
    #[serde(default)]
    colony_grace_days: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EffectRaw {
    effect: String,
    name: String,
    #[serde(default)]
    description: String,
    mult: Option<[Dec; 2]>,
    days: Option<[u32; 2]>,
    delta: Option<[i64; 2]>,
    #[serde(default)]
    port_only: bool,
    peace_delta: Option<[i64; 2]>,
}

/// 读取并校验；有问题时记入 `is` 并返回 None。
pub(super) fn load(dir: &EffectiveWorld, is: &mut Issues) -> Option<ComposedRules> {
    let raw: EffectsFile = load_file(dir, FILE, is)?;
    let before = is.list.len();
    let c = &raw.composed;
    let item = "composed";
    if !(1..=5).contains(&c.max_effects) {
        is.push(FILE, item, "max_effects 必须在 1 到 5 之间");
    }
    if !(1..=360).contains(&c.cooldown_days) {
        is.push(FILE, item, "cooldown_days 必须在 1 到 360 之间");
    }
    if !(1..=60).contains(&c.max_per_year) {
        is.push(FILE, item, "max_per_year 必须在 1 到 60 之间");
    }
    if c.repeat_days > 720 {
        is.push(FILE, item, "repeat_days 不能超过 720");
    }
    let budget = fx(c.budget);
    if budget <= Fx::ZERO || budget > Fx::from_int(5) {
        is.push(FILE, item, "budget 必须满足 0 < budget ≤ 5");
    }
    if !(4..=60).contains(&c.max_title_chars) {
        is.push(FILE, item, "max_title_chars 必须在 4 到 60 之间");
    }
    if !(20..=600).contains(&c.max_text_chars) {
        is.push(FILE, item, "max_text_chars 必须在 20 到 600 之间");
    }
    if c.colony_grace_days > 720 {
        is.push(FILE, item, "colony_grace_days 不能超过 720");
    }
    if raw.effects.is_empty() {
        is.push(FILE, "effects", "至少需要一种效果");
    }
    let mut effects: Vec<EffectBounds> = Vec::new();
    for e in &raw.effects {
        let item = format!("effects[{}]", e.effect);
        let Some(kind) = EffectKind::from_key(&e.effect) else {
            let keys: Vec<&str> = EffectKind::ALL.iter().map(|k| k.key()).collect();
            is.push(FILE, &item, format!("effect “{}”不在内核实现的效果集合中（可用：{}）", e.effect, keys.join("、")));
            continue;
        };
        if effects.iter().any(|b| b.effect == kind) {
            is.push(FILE, &item, "效果重复");
            continue;
        }
        if e.name.trim().is_empty() {
            is.push(FILE, &item, "name 不能为空");
        }
        let mult = e.mult.map(|[lo, hi]| (fx(lo), fx(hi)));
        let range_ok = |need: bool, present: bool, name: &str, is: &mut Issues| {
            if need && !present {
                is.push(FILE, &item, format!("该效果需要 {name} 范围"));
            }
            if !need && present {
                is.push(FILE, &item, format!("该效果不使用 {name}"));
            }
        };
        range_ok(kind.needs_mult(), mult.is_some(), "mult", is);
        range_ok(kind.needs_days(), e.days.is_some(), "days", is);
        range_ok(kind.needs_delta(), e.delta.is_some(), "delta", is);
        if let Some((lo, hi)) = mult
            && (lo > hi || lo < Fx::from_pct(10) || hi > Fx::from_int(5) || (lo == Fx::ONE && hi == Fx::ONE))
        {
            is.push(FILE, &item, "mult 必须满足 0.1 ≤ 下限 ≤ 上限 ≤ 5，且不能只有 1");
        }
        if let Some([lo, hi]) = e.days
            && (lo > hi || lo == 0 || hi > 720)
        {
            is.push(FILE, &item, "days 必须满足 1 ≤ 下限 ≤ 上限 ≤ 720");
        }
        if let Some([lo, hi]) = e.delta
            && (lo > hi || lo < -100 || hi > 100 || (lo == 0 && hi == 0))
        {
            is.push(FILE, &item, "delta 必须满足 −100 ≤ 下限 ≤ 上限 ≤ 100，且不能只有 0");
        }
        if e.port_only && !kind.needs_loc() {
            is.push(FILE, &item, "该效果不使用地点，不能设置 port_only");
        }
        if e.port_only && kind.targets_site() {
            is.push(FILE, &item, "该效果作用于殖民点，不能设置 port_only");
        }
        // 殖民地都属于玩家：负面幅度有硬上限，数据只能在此之内取值
        if kind.targets_colony() {
            if let Some((lo, _)) = mult
                && lo < COLONY_MULT_FLOOR
            {
                is.push(FILE, &item, "殖民地效果的 mult 下限不能低于 0.6（对玩家殖民地的负面效果要克制）");
            }
            if let Some([lo, _]) = e.delta
                && lo < COLONY_DELTA_FLOOR
            {
                is.push(FILE, &item, "殖民地效果的 delta 下限不能低于 −15（对玩家殖民地的负面效果要克制）");
            }
        }
        if let Some([plo, phi]) = e.peace_delta {
            if kind != EffectKind::RelationShift {
                is.push(FILE, &item, "只有 relation_shift 可以设置 peace_delta");
            } else if let Some([lo, hi]) = e.delta
                && (plo > phi || plo < lo || phi > hi)
            {
                is.push(FILE, &item, "peace_delta 必须在 delta 范围之内且下限不大于上限");
            }
        }
        effects.push(EffectBounds {
            effect: kind,
            name: e.name.clone(),
            description: e.description.clone(),
            mult,
            days: e.days.map(|[a, b]| (a, b)),
            delta: e.delta.map(|[a, b]| (a, b)),
            port_only: e.port_only,
            peace_delta: e.peace_delta.map(|[a, b]| (a, b)),
        });
    }
    if is.list.len() > before {
        return None;
    }
    Some(ComposedRules {
        max_effects: c.max_effects,
        cooldown_days: c.cooldown_days,
        max_per_year: c.max_per_year,
        repeat_days: c.repeat_days,
        budget,
        max_title_chars: c.max_title_chars,
        max_text_chars: c.max_text_chars,
        colony_grace_days: c.colony_grace_days,
        effects,
    })
}
