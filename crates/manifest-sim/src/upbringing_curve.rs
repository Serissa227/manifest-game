//! U02 工作包 2：养成期的中位成长曲线（公式，不跑模拟）。
//!
//! 每项属性／技能 = 开局值（年龄基线 + 家境底子 + 个人优势）+ 月均成长 × 月数，属性受每年每项的成长上限夹住。
//! 月均成长按“均衡”安排：每月格数 × 与该项相关活动的平均收益 ÷ 同时照顾的练习目标数（`rules.curve.focus`）。
//! 相关活动直接取活动定义：家乡期是本家庭能排的入门活动，学院期是本学院按学年开放的课业加课后活动。
//! 上界曲线把每格都押在收益最高的那项活动上（仍受年度上限）。
//!
//! 稳定入口：[`GrowthCurve::new`] 与 [`GrowthCurve::median`]／[`GrowthCurve::upper`]（按 [`Measure`] 取刻度）。
//! U02 的门槛生成、测试、CLI 的 `upbringing-curve`，以及 U04 的年度目标都用这里。全部整数运算。
use manifest_core::{
    StaticData,
    scenario::WorldDate,
    upbringing::{ActivityDef, ActivityKind, ActivityStage, FamilyDef, Stage},
};
use std::collections::{BTreeMap, BTreeSet};

/// 曲线覆盖的月数（1553 年 1 月到 1556 年 12 月）。
pub const MONTHS: usize = 48;
/// 内部累计用的千分刻度。
const MILLI: i64 = 1000;

/// 门槛的刻度：成长点、属性档位、评价分、品行值或技能经验。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Measure {
    Growth,
    Level,
    Rating,
    Conduct,
    Skill,
}

#[derive(Debug, thiserror::Error)]
pub enum CurveError {
    #[error("没有这个养成家庭：{0}")]
    UnknownFamily(String),
    #[error("家庭 {0} 没有养成阶段")]
    NoStages(String),
}

/// 一位主角的中位与上界成长曲线。
#[derive(Clone, Debug)]
pub struct GrowthCurve {
    pub family: String,
    start: WorldDate,
    opening: BTreeMap<String, i64>,
    /// 第 m 个月初（已过 m 个月）的累计值，千分刻度；属性为成长点，技能为经验。
    median: Vec<BTreeMap<String, i64>>,
    upper: Vec<BTreeMap<String, i64>>,
    conduct: BTreeSet<String>,
    growth_table: Vec<(i64, i64, i64)>,
    ratings: BTreeMap<String, Vec<(String, i64)>>,
}

fn month_start(start: WorldDate, m: usize) -> WorldDate {
    let total = start[1] as usize - 1 + m;
    [start[0] + (total / 12) as u32, (total % 12) as u32 + 1, 1]
}

fn stage_at(f: &FamilyDef, date: WorldDate) -> Option<&manifest_core::upbringing::StageDef> {
    f.stages.iter().rev().find(|s| s.from <= date)
}

/// 本家庭的老师会教的技能（`helper_levels` ≥ 1），用来把“选一门”的课分给本地能学的选项。
fn local_skills(defs: &StaticData, f: &FamilyDef) -> BTreeSet<String> {
    let people: BTreeSet<&String> = f.mentor_roles.values().chain(f.companions.keys()).collect();
    people
        .into_iter()
        .filter_map(|p| defs.upbringing.helper_levels.get(p))
        .flat_map(|levels| levels.iter().filter(|(_, v)| **v >= 1).map(|(k, _)| k.clone()))
        .collect()
}

/// 均衡安排里能排的入门活动：本家庭或公共的、不需要属性／技能门槛、打工只算第一档。
fn usable(a: &ActivityDef, f: &FamilyDef, stage: Stage, academy: Option<&str>) -> bool {
    let family_flag = format!("c9_family_{}", f.key);
    a.stage.allows(stage)
        && matches!(
            a.kind,
            ActivityKind::Lesson
                | ActivityKind::Training
                | ActivityKind::Job
                | ActivityKind::Club
                | ActivityKind::Craft
                | ActivityKind::Social
        )
        && a.unlock.flag.as_ref().is_none_or(|flag| *flag == family_flag)
        && a.unlock.attrs.is_empty()
        && a.unlock.growth.is_empty()
        && a.unlock.rating.is_empty()
        && a.unlock.skills.is_empty()
        && a.tier.as_ref().is_none_or(|t| t.level <= 1)
        && a.place.academy.as_deref().is_none_or(|k| Some(k) == academy)
        && !(stage == Stage::Academy && a.kind == ActivityKind::Lesson && a.stage != ActivityStage::Academy)
}

/// 一组活动每格的平均收益（千分刻度，已除以练习目标数）与单格最高收益。
struct PoolGain {
    median: BTreeMap<String, i64>,
    best: BTreeMap<String, i64>,
}

fn pool_gain(pool: &[&ActivityDef], local: &BTreeSet<String>, focus: i64) -> PoolGain {
    let mut sums: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    let mut best: BTreeMap<String, i64> = BTreeMap::new();
    let mut add = |key: &str, mid_milli: i64, high: i64| {
        let e = sums.entry(key.to_owned()).or_default();
        e.0 += mid_milli;
        e.1 += 1;
        let b = best.entry(key.to_owned()).or_default();
        *b = (*b).max(high.saturating_mul(MILLI));
    };
    for a in pool {
        for (key, [lo, hi]) in &a.gains {
            add(key, (lo + hi) * MILLI / 2, *hi);
        }
        for s in &a.skills {
            add(&s.skill, s.xp * MILLI, s.xp);
        }
        if let Some(c) = &a.skill_choice {
            let here: Vec<&String> = c.options.iter().filter(|o| local.contains(*o)).collect();
            let options: Vec<&String> = if here.is_empty() { c.options.iter().collect() } else { here };
            for o in options {
                add(o, c.xp * MILLI, c.xp);
            }
        }
    }
    let focus = focus.max(1);
    PoolGain { median: sums.into_iter().map(|(k, (sum, n))| (k, sum / n.max(1) / focus)).collect(), best }
}

impl GrowthCurve {
    /// 按数据算出一位主角（家庭键）的曲线。
    pub fn new(defs: &StaticData, family: &str) -> Result<Self, CurveError> {
        let f = defs.upbringing.family(family).ok_or_else(|| CurveError::UnknownFamily(family.into()))?;
        let start = f.stages.first().ok_or_else(|| CurveError::NoStages(family.into()))?.from;
        let start = [start[0], start[1], 1];
        let rules = &defs.upbringing.rules;
        let cr = &rules.curve;
        let conduct: BTreeSet<String> = defs
            .captain
            .attributes
            .iter()
            .enumerate()
            .filter(|(i, _)| defs.captain.group(*i).is_some_and(|g| g.key == "conduct"))
            .map(|(_, a)| a.key.clone())
            .collect();
        let attrs: BTreeSet<String> = defs.captain.attributes.iter().map(|a| a.key.clone()).collect();
        let opening = manifest_core::upbringing::growth::opening_growth(defs, f);
        let local = local_skills(defs, f);
        let mut cur: BTreeMap<String, i64> = opening.iter().map(|(k, v)| (k.clone(), v * MILLI)).collect();
        let mut up = cur.clone();
        let (mut used, mut used_up): (BTreeMap<String, i64>, BTreeMap<String, i64>) = Default::default();
        let mut median = vec![cur.clone()];
        let mut upper = vec![up.clone()];
        let mut year = start[0];
        let mut academy_months = 0usize;
        for m in 0..MONTHS {
            let date = month_start(start, m);
            if date[0] != year {
                year = date[0];
                used.clear();
                used_up.clear();
            }
            // 每年每项上限按当月的年龄（U02 工作包 4）。
            let age = i64::from(date[0]) - i64::from(f.born[0]) - i64::from((date[1], 15) < (f.born[1], f.born[2]));
            let cap = manifest_core::upbringing::growth::annual_cap_at(rules, Some(age)).saturating_mul(MILLI);
            let Some(st) = stage_at(f, [date[0], date[1], 15]) else {
                median.push(cur.clone());
                upper.push(up.clone());
                continue;
            };
            let academy = st.academy.as_deref();
            let pools: Vec<(i64, Vec<&ActivityDef>)> = if st.stage == Stage::Home {
                vec![(
                    cr.home_slots,
                    defs.upbringing.activities.iter().filter(|a| usable(a, f, Stage::Home, None)).collect(),
                )]
            } else {
                let academic_year = academy_months / 12 + 1;
                academy_months += 1;
                let courses = academy
                    .and_then(|k| defs.upbringing.academy(k))
                    .map(|a| {
                        a.curriculum
                            .iter()
                            .filter(|c| c.unlock.year.is_none_or(|y| y as usize <= academic_year))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let after = defs
                    .upbringing
                    .activities
                    .iter()
                    .filter(|a| a.kind != ActivityKind::Lesson && usable(a, f, Stage::Academy, academy))
                    .collect();
                vec![(cr.academy_lesson_slots, courses), (cr.academy_after_slots, after)]
            };
            for (slots, pool) in pools {
                let gain = pool_gain(&pool, &local, cr.focus);
                for (target, used, per_slot) in
                    [(&mut cur, &mut used, &gain.median), (&mut up, &mut used_up, &gain.best)]
                {
                    for (key, value) in per_slot {
                        let add = slots.saturating_mul(*value);
                        if attrs.contains(key) {
                            if conduct.contains(key) || key == "fortune" || key == "arcana" {
                                continue;
                            }
                            let spent = used.entry(key.clone()).or_default();
                            let add = add.min((cap - *spent).max(0));
                            *spent += add;
                            let v = target.entry(key.clone()).or_default();
                            *v = (*v + add).min(1000 * MILLI);
                        } else {
                            *target.entry(key.clone()).or_default() += add;
                        }
                    }
                }
            }
            median.push(cur.clone());
            upper.push(up.clone());
        }
        let ratings = defs
            .captain
            .ratings
            .iter()
            .map(|r| {
                (
                    r.key.clone(),
                    r.weights
                        .iter()
                        .filter_map(|(i, w)| defs.captain.attributes.get(*i).map(|a| (a.key.clone(), *w)))
                        .collect(),
                )
            })
            .collect();
        Ok(Self {
            family: family.into(),
            start,
            opening,
            median,
            upper,
            conduct,
            growth_table: rules.growth_table.iter().map(|b| (b.from, b.to, b.value)).collect(),
            ratings,
        })
    }

    /// 某天落在第几个月（0 = 养成第一个月；之后封顶在曲线末尾）。
    pub fn month_of(&self, date: WorldDate) -> usize {
        let months =
            (i64::from(date[0]) - i64::from(self.start[0])) * 12 + i64::from(date[1]) - i64::from(self.start[1]);
        months.clamp(0, MONTHS as i64) as usize
    }

    /// 开局成长（属性为成长点、品行为 0–100）。
    pub fn opening(&self, key: &str) -> i64 {
        self.opening.get(key).copied().unwrap_or(0)
    }

    /// 成长点换成属性档位。
    pub fn level_of(&self, growth: i64) -> i64 {
        self.growth_table.iter().find(|(from, to, _)| *from <= growth && growth <= *to).map_or(1, |b| b.2)
    }

    fn raw(&self, upper: bool, key: &str, month: usize) -> i64 {
        let table = if upper { &self.upper } else { &self.median };
        table.get(month.min(MONTHS)).and_then(|m| m.get(key)).copied().unwrap_or(0) / MILLI
    }

    fn value(&self, upper: bool, measure: Measure, key: &str, month: usize) -> i64 {
        match measure {
            Measure::Growth | Measure::Conduct | Measure::Skill => self.raw(upper, key, month),
            Measure::Level => {
                if key == "arcana" {
                    0
                } else {
                    self.level_of(self.raw(upper, key, month))
                }
            }
            Measure::Rating => {
                let Some(weights) = self.ratings.get(key) else { return 0 };
                let (mut sum, mut total) = (0i64, 0i64);
                for (attr, w) in weights {
                    let v = if self.conduct.contains(attr) {
                        self.raw(upper, attr, month) * 10
                    } else if attr == "arcana" {
                        0
                    } else {
                        self.level_of(self.raw(upper, attr, month)) * 100
                    };
                    sum += v * w;
                    total += w;
                }
                if total > 0 { sum / total } else { 0 }
            }
        }
    }

    /// 某天的中位预期。
    pub fn median(&self, measure: Measure, key: &str, date: WorldDate) -> i64 {
        self.value(false, measure, key, self.month_of(date))
    }

    /// 某天的上界（每格都押在收益最高的活动上）。
    pub fn upper(&self, measure: Measure, key: &str, date: WorldDate) -> i64 {
        self.value(true, measure, key, self.month_of(date))
    }

    /// 第 `month` 个月初的中位预期（0–48）。
    pub fn median_at(&self, measure: Measure, key: &str, month: usize) -> i64 {
        self.value(false, measure, key, month)
    }

    /// 到某天为止，各属性（不含品行、运气、秘术）中位成长相对开局的增量之和。
    pub fn total_growth(&self, date: WorldDate) -> i64 {
        let m = self.month_of(date);
        self.opening
            .keys()
            .filter(|k| !self.conduct.contains(*k) && *k != "fortune" && *k != "arcana")
            .map(|k| self.raw(false, k, m) - self.opening(k))
            .sum()
    }
}

/// 条件刻度：attr 条件按 key 区分属性档位、评价与品行；growth 为成长点；skill 为经验。
pub fn measure_of(defs: &StaticData, kind: &str, key: &str) -> Measure {
    match kind {
        "growth" => Measure::Growth,
        "skill" => Measure::Skill,
        _ => {
            if defs.captain.ratings.iter().any(|r| r.key == key) {
                Measure::Rating
            } else if let Some(i) = defs.captain.attribute_index(key) {
                if defs.captain.group(i).is_some_and(|g| g.key == "conduct") {
                    Measure::Conduct
                } else {
                    Measure::Level
                }
            } else {
                Measure::Skill
            }
        }
    }
}

/// 曲线报告（JSON）：每位主角每月月初的各项中位预期与四年总成长；CLI `upbringing-curve` 用。
pub fn report_json(defs: &StaticData, family: Option<&str>) -> Result<String, CurveError> {
    let mut out = serde_json::Map::new();
    let mut skills: Vec<&String> = defs.story2.skills.iter().collect();
    skills.sort();
    for f in defs.upbringing.families.iter().filter(|f| family.is_none_or(|k| k == f.key)) {
        let curve = GrowthCurve::new(defs, &f.key)?;
        let months: Vec<serde_json::Value> = (0..=MONTHS)
            .map(|m| {
                let growth: serde_json::Map<String, serde_json::Value> = defs
                    .captain
                    .attributes
                    .iter()
                    .map(|a| (a.key.clone(), curve.median_at(Measure::Growth, &a.key, m).into()))
                    .collect();
                let ratings: serde_json::Map<String, serde_json::Value> = defs
                    .captain
                    .ratings
                    .iter()
                    .map(|r| (r.key.clone(), curve.median_at(Measure::Rating, &r.key, m).into()))
                    .collect();
                let skills: serde_json::Map<String, serde_json::Value> = skills
                    .iter()
                    .filter_map(|k| {
                        let v = curve.median_at(Measure::Skill, k, m);
                        (v > 0).then(|| ((*k).clone(), v.into()))
                    })
                    .collect();
                serde_json::json!({"month": m, "growth": growth, "ratings": ratings, "skills": skills})
            })
            .collect();
        out.insert(
            f.key.clone(),
            serde_json::json!({"total_growth_4y": curve.total_growth([1557, 1, 1]), "months": months}),
        );
    }
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}
