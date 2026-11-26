//! K2 正式门槛生成与六种打法的内核实跑报表。
#[cfg(test)]
mod candidate_equivalence;

use crate::upbringing_curve::{GrowthCurve, Measure};
use manifest_core::{
    Command, CommandError, CoreError, OwnerId, StaticData, World,
    upbringing::{act::*, *},
};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
mod omen;
mod policy;
mod report;
use policy::Strategy;
pub use report::report;

pub fn generate(defs: &StaticData, family: &str) -> Result<String, crate::upbringing_curve::CurveError> {
    let f = defs
        .upbringing
        .family(family)
        .ok_or_else(|| crate::upbringing_curve::CurveError::UnknownFamily(family.into()))?;
    let r = defs.rules.upbringing.act.clone().unwrap_or_default();
    let mut curves = vec![GrowthCurve::new(defs, family)?];
    for (_, route) in &f.routed {
        let mut variant = defs.clone();
        if let Some(base) = variant.upbringing.families.iter_mut().find(|f| f.key == family) {
            *base = route.clone();
        }
        curves.push(GrowthCurve::new(&variant, family)?);
    }
    let start = f.stages.first().ok_or_else(|| crate::upbringing_curve::CurveError::NoStages(family.into()))?.from;
    let end = [start[0] + 1, start[1], 1];
    let mut text = String::from(
        "# 由 manifest-cli --world terra16 upbringing-act-gen --family mio --write 生成，不要手改。\n# gain 是相对开局的成长增量；levels 是第 0–48 月初的中位档（改投路线取上包）。\nformat_version = 1\n",
    );
    let mut attrs = BTreeSet::new();
    for line in defs.upbringing.lines.iter().filter(|l| l.family == family) {
        let Some(attr) = line.attr.as_deref() else { continue };
        attrs.insert(attr);
        attrs.extend(line.root.as_deref());
        let u12 = curves
            .iter()
            .map(|c| c.upper(Measure::Growth, attr, end) - c.upper(Measure::Growth, attr, start))
            .max()
            .unwrap_or(0)
            .max(0);
        let gain: Vec<_> = (0..line.tiers.len()).map(|i| (u12 * r.tier_gate.gain_pct[i] + 99) / 100).collect();
        let _ = writeln!(text, "\n[[act_line_gates]]\nline = {line:?}\nu12 = {u12}\ngain = {gain:?}", line = line.key);
    }
    for attr in attrs {
        let levels: Vec<_> =
            (0..=48).map(|m| curves.iter().map(|c| c.median_at(Measure::Level, attr, m)).max().unwrap_or(1)).collect();
        let _ = writeln!(text, "\n[[act_medians]]\nfamily = {family:?}\nattr = {attr:?}\nlevels = {levels:?}");
    }
    Ok(text)
}

const LESSON: usize = 0;
const JOB: usize = 1;

#[derive(Clone, Copy, Default)]
struct Gains {
    growth: i64,
    skills: i64,
}

#[derive(Clone)]
struct Expected {
    growth: BTreeMap<String, i64>,
    used: BTreeMap<String, i64>,
    skills: BTreeMap<String, i64>,
    paid: BTreeMap<String, u8>,
    cash: i64,
    fatigue: i64,
    mood: i64,
    affinity: BTreeMap<String, i64>,
    gains: [Gains; 5],
    rank: u8,
}
impl Expected {
    // 期望值只供原有选课与行动优先级估回报；报表所得与总评全部从真实世界读取。
    fn from_world(w: &World) -> Result<Self, ReportError> {
        let s = w.state.upbringing.as_ref().ok_or(ReportError::Unavailable("upbringing"))?;
        Ok(Self {
            growth: s.growth.iter().map(|(k, v)| (k.clone(), v * 1000)).collect(),
            used: s.year_growth.iter().map(|(k, v)| (k.clone(), v * 1000)).collect(),
            skills: w
                .inventory(OwnerId::Player)
                .map_or_else(BTreeMap::new, |i| i.skill_xp.iter().map(|(k, v)| (k.clone(), v * 1000)).collect()),
            paid: s.act.lines.iter().map(|(k, v)| (k.clone(), v.paid)).collect(),
            cash: w.act_cash() * 1000,
            fatigue: s.fatigue * 1000,
            mood: s.mood * 1000,
            affinity: w.state.cast.persons.iter().map(|(k, p)| (k.clone(), p.affection.affinity)).collect(),
            gains: [Gains::default(); 5],
            rank: w.act_rank(),
        })
    }
    fn level(&self, defs: &StaticData, key: &str) -> i64 {
        let value = self.growth.get(key).copied().unwrap_or(0) / 1000;
        defs.upbringing.rules.growth_table.iter().find(|b| b.from <= value && value <= b.to).map_or(1, |b| b.value)
    }
    fn room(&self, key: &str, annual: i64, cap: i64) -> i64 {
        (annual * cap / 100 * 1000 - self.used.get(key).copied().unwrap_or(0))
            .max(0)
            .min((1000000 - self.growth.get(key).copied().unwrap_or(0)).max(0))
    }
    fn gain(&mut self, key: &str, milli: i64, annual: i64, cap: i64) -> i64 {
        let n = milli.min(self.room(key, annual, cap));
        let used = self.used.entry(key.into()).or_default();
        let value = self.growth.entry(key.into()).or_default();
        *value += n;
        *used += n;
        n
    }
    fn line_total(&self, r: &ActRules, line: &LineDef, g: i64, annual: i64, cap: i64) -> i64 {
        line.attr.as_deref().map_or(0, |a| g.min(self.room(a, annual, cap)))
            + line.side.as_deref().map_or(0, |a| (g * r.side_pct / 100).min(self.room(a, annual, cap)))
            + if line.skill.is_some() { g * r.skill_pct / 100 } else { 0 }
    }
    fn apply_line(&mut self, r: &ActRules, line: &LineDef, g: i64, annual: i64, cap: i64, source: usize) {
        if let Some(attr) = &line.attr {
            let gained = self.gain(attr, g, annual, cap);
            self.gains[source].growth += gained;
        }
        if let Some(attr) = &line.side {
            let gained = self.gain(attr, g * r.side_pct / 100, annual, cap);
            self.gains[source].growth += gained;
        }
        if let Some(skill) = &line.skill {
            let xp = g * r.skill_pct / 100;
            *self.skills.entry(skill.clone()).or_default() += xp;
            self.gains[source].skills += xp;
        }
    }
}

fn root_attr<'a>(defs: &StaticData, line: &'a LineDef) -> Option<&'a str> {
    line.root.as_deref().or_else(|| line.attr.as_deref().filter(|a| is_root(defs, a)))
}
fn is_root(defs: &StaticData, attr: &str) -> bool {
    defs.captain.attribute_index(attr).and_then(|i| defs.captain.group(i)).is_some_and(|g| g.key == "aptitude")
}
fn risk(e: &Expected, defs: &StaticData, a: &ActivityDef) -> i64 {
    a.risk.as_ref().map_or(0, |r| {
        (r.failure_bp - r.attr.as_deref().map_or(0, |attr| e.level(defs, attr)) * r.per)
            .clamp(r.min_bp, r.max_bp.unwrap_or(10000))
    })
}
/// 返回普通期望、稳妥关键时刻前的无失手期望、自修基数，单位为千分之一成长点。
fn lesson_gain(defs: &StaticData, r: &ActRules, e: &Expected, line: &LineDef, tier: usize) -> (i64, i64, i64) {
    let root = root_attr(defs, line).map_or(1, |a| e.level(defs, a));
    let mood_pct = if e.mood >= r.mood_factor.high * 1000 {
        r.mood_factor.high_pct
    } else if e.mood <= r.mood_factor.low * 1000 {
        r.mood_factor.low_pct
    } else {
        100
    };
    let eff = (r.efficiency.base + r.efficiency.per_level * (root - 1)) * mood_pct / 100;
    let base = r.tier_yield[tier] * 10 * eff / 100;
    let fail = (defs.upbringing.activity(&line.tiers[tier].activity).map_or(0, |a| risk(e, defs, a))
        + if e.fatigue >= r.result.fail_tired * 1000 { r.result.fail_tired_bp } else { 0 })
    .clamp(0, 10000);
    let great = (r.result.great_bp + if e.mood >= r.mood_factor.high * 1000 { r.result.great_mood_bp } else { 0 })
        .clamp(0, 10000);
    let ok = base * (10000 * 100 + great * (r.result.great_pct - 100)) / 1000000;
    ((base * fail * r.result.fail_pct / 100 + ok * (10000 - fail)) / 10000, ok, base)
}
fn tier_open(
    defs: &StaticData,
    line: &LineDef,
    t: usize,
    e: &Expected,
    opening: &BTreeMap<String, i64>,
    rank: u8,
    master: bool,
) -> bool {
    let r = defs.rules.upbringing.act.clone().unwrap_or_default();
    if e.paid.get(&line.key).is_some_and(|mask| mask & (1 << t) != 0) {
        return true;
    }
    let tier = &line.tiers[t];
    let attr = line.attr.as_deref().unwrap_or("");
    let root = root_attr(defs, line).unwrap_or("");
    let gate = defs
        .upbringing
        .act_line_gates
        .iter()
        .find(|g| g.line == line.key)
        .and_then(|g| g.gain.get(t))
        .copied()
        .unwrap_or(0);
    let gain = e.growth.get(attr).copied().unwrap_or(0) / 1000 - opening.get(attr).copied().unwrap_or(0);
    let requires = match &tier.requires {
        Some(LineRequires::Lines(reqs)) => {
            reqs.iter().all(|r| e.paid.get(&r.line).is_some_and(|mask| mask & (1 << r.tier) != 0))
        }
        _ => true,
    };
    (master || tier.gate.is_none())
        && gain >= gate
        && e.level(defs, root) >= tier.root.unwrap_or(r.tier_gate.root[t])
        && line
            .mentor
            .as_ref()
            .is_none_or(|m| e.affinity.get(m).copied().unwrap_or(0) >= tier.bond.unwrap_or(r.tier_gate.bond[t]))
        && rank >= r.tier_gate.rank[t]
        && requires
}

fn open_tier(defs: &StaticData, e: &Expected, line: &LineDef, opening: &BTreeMap<String, i64>, mode: usize) -> usize {
    let max = [0, 2, 3][mode];
    (0..line.tiers.len().min(max + 1))
        .rev()
        .find(|t| tier_open(defs, line, *t, e, opening, e.rank, mode == 2))
        .unwrap_or(0)
}

/// 根基投入与结业前各阶段的开档收益比较；其他开档条件仍由实际排课逐格检查。
fn root_return(
    defs: &StaticData,
    e: &Expected,
    root: (&LineDef, usize),
    family: &FamilyDef,
    week: u32,
    annual: i64,
    mode: usize,
) -> i64 {
    let r = defs.rules.upbringing.act.clone().unwrap_or_default();
    let (line, tier) = root;
    let Some(attr) = line.attr.as_deref() else { return 0 };
    let level = e.level(defs, attr);
    let start = family.stages.first().map_or(family.graduation, |s| s.from);
    let week_of = |d: [u32; 3]| (d[0] - start[0]) * 48 + (d[1] - 1) * 4 + (d[2] - 1) / 7;
    let future_lines: Vec<_> = defs
        .upbringing
        .lines
        .iter()
        .filter(|l| {
            l.family == family.key
                && l.root.as_deref() == Some(attr)
                && family.stages.iter().enumerate().any(|(i, s)| {
                    s.stage == l.stage
                        && s.academy.as_deref().unwrap_or("") == l.academy
                        && week_of(family.stages.get(i + 1).map_or(family.graduation, |s| s.from)) > week
                })
        })
        .collect();
    let target = future_lines
        .iter()
        .flat_map(|l| l.tiers.iter().enumerate().take(if mode == 1 { 3 } else { 4 }))
        .map(|(i, t)| t.root.unwrap_or(r.tier_gate.root[i]))
        .filter(|v| *v > level)
        .min();
    let Some(next) = target.and_then(|target| defs.upbringing.rules.growth_table.iter().find(|b| b.value == target))
    else {
        return 0;
    };
    let g = lesson_gain(defs, &r, e, line, tier).0;
    if g <= 0 || e.room(attr, annual, r.ladder.cap_pct_by_tier[tier]) == 0 {
        return 0;
    }
    let investment = (next.from * 1000 - e.growth.get(attr).copied().unwrap_or(0) + g - 1) / g;
    let opening = growth::opening_growth(defs, family);
    let opportunity = defs
        .upbringing
        .lines
        .iter()
        .filter(|l| {
            l.family == family.key
                && l.stage == line.stage
                && l.academy == line.academy
                && l.attr.as_deref().is_some_and(|a| !is_root(defs, a))
        })
        .map(|l| {
            let t = open_tier(defs, e, l, &opening, mode);
            e.line_total(&r, l, lesson_gain(defs, &r, e, l, t).0, annual, r.ladder.cap_pct_by_tier[t])
        })
        .max()
        .unwrap_or(0);
    let cost = investment * (opportunity - e.line_total(&r, line, g, annual, r.ladder.cap_pct_by_tier[tier])).max(0);
    let mut before = e.clone();
    let mut after = e.clone();
    after.growth.insert(attr.into(), next.from * 1000);
    let ready = week + ((investment + 1) / 2) as u32;
    let mut year = start[0] + week / 48;
    let mut benefit = 0;
    // 每周两格估算练到目标所需时间，按实际阶段格数、年度额度与单项上限计算余下收益。
    for future in ready..week_of(family.graduation) {
        let date = [start[0] + future / 48, future / 4 % 12 + 1, 1 + future % 4 * 7];
        if date[0] != year {
            year = date[0];
            before.used.clear();
            after.used.clear();
        }
        let Some(stage) = family.stages.iter().rev().find(|s| s.from <= date) else { continue };
        let mains: Vec<_> = defs
            .upbringing
            .lines
            .iter()
            .filter(|l| {
                l.family == family.key
                    && l.stage == stage.stage
                    && l.academy == stage.academy.as_deref().unwrap_or("")
                    && l.attr.as_deref().is_some_and(|a| !is_root(defs, a))
            })
            .collect();
        let count = if stage.stage == Stage::Home { r.lessons.home } else { r.lessons.academy };
        let age =
            i64::from(date[0] - family.born[0] - u32::from((date[1], date[2]) < (family.born[1], family.born[2])));
        let cap = growth::annual_cap_at(&defs.upbringing.rules, Some(age));
        for main in mains.iter().cycle().skip(future as usize).take(usize::from(count)) {
            let projected = |state: &Expected| {
                main.tiers
                    .iter()
                    .enumerate()
                    .take(if mode == 1 { 3 } else { 4 })
                    .rev()
                    .find(|(i, t)| {
                        root_attr(defs, main)
                            .is_none_or(|a| state.level(defs, a) >= t.root.unwrap_or(r.tier_gate.root[*i]))
                            && (mode == 2 || t.gate.is_none())
                    })
                    .map_or(0, |(i, _)| i)
            };
            let low = projected(&before);
            let high = projected(&after);
            let old = lesson_gain(defs, &r, &before, main, low).0;
            let new = lesson_gain(defs, &r, &after, main, high).0;
            benefit += after.line_total(&r, main, new, cap, r.ladder.cap_pct_by_tier[high])
                - before.line_total(&r, main, old, cap, r.ladder.cap_pct_by_tier[low]);
            before.apply_line(&r, main, old, cap, r.ladder.cap_pct_by_tier[low], LESSON);
            after.apply_line(&r, main, new, cap, r.ladder.cap_pct_by_tier[high], LESSON);
        }
    }
    (benefit - cost) / investment.max(1)
}

fn work(e: &mut Expected, defs: &StaticData, r: &ActRules, job: (&ActivityDef, usize), annual: i64) {
    let (job, tier) = job;
    let risk = risk(e, defs, job);
    e.cash +=
        r.job_income[tier] * ((10000 - risk) * 100 + risk * job.failure.income_pct) / 1000 - job.cost * r.job.permille;
    let fatigue_pct = if e.fatigue >= 80000 {
        60
    } else if e.fatigue >= 60000 {
        80
    } else {
        100
    };
    let mood_pct = if e.mood >= 80000 {
        110
    } else if e.mood < -30000 {
        80
    } else {
        100
    };
    for (attr, bounds) in &job.gains {
        let gain = (bounds[0] + bounds[1]) * 500 * r.job.permille / 1000 * fatigue_pct / 100 * mood_pct / 100
            * ((10000 - risk) * 100 + risk * job.failure.gains_pct)
            / 1000000;
        let gained = e.gain(attr, gain, annual, 100);
        e.gains[JOB].growth += gained;
    }
    for skill in &job.skills {
        let xp = skill.xp * r.job.permille * (10000 - risk) / 10000;
        *e.skills.entry(skill.skill.clone()).or_default() += xp;
        e.gains[JOB].skills += xp;
    }
    e.mood =
        (e.mood + job.mood * r.job.permille + job.failure.mood * r.job.permille * risk / 10000).clamp(-100000, 100000);
    e.fatigue =
        (e.fatigue + r.job_fatigue * 100 + job.failure.extra_fatigue * r.job.permille * risk / 10000).min(100000);
}

#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error(transparent)]
    Curve(#[from] crate::upbringing_curve::CurveError),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    Command(#[from] CommandError),
    #[error("upbringing-act-report: {0}")]
    Unavailable(&'static str),
    #[error("upbringing-act-report: strategy={strategy} seed={seed}: {detail}")]
    Run { strategy: &'static str, seed: u64, detail: String },
}

struct PlanChoice<'a> {
    line: &'a LineDef,
    tier: usize,
    master: bool,
    fee: i64,
    tool: i64,
}

/// 随手与认真保留原有选门骨架；学业补考前准备，人情按主命排课。
fn plan_week(w: &mut World, strategy: Strategy, cursor: &mut usize) -> Result<i64, ReportError> {
    if w.act_sailing() {
        Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
        return Ok(0);
    }
    let mode = strategy.lesson_mode();
    let defs = w.defs.clone();
    let f = w.upbringing_family().ok_or(ReportError::Unavailable("family"))?.clone();
    let r = w.act_rules().cloned().unwrap_or_default();
    let e = Expected::from_world(w)?;
    let annual = w.upbringing_annual_cap();
    let start = f.stages.first().ok_or(ReportError::Unavailable("stages"))?.from;
    let date = w.cast_date();
    let week = (date[0] - start[0]) * 48 + (date[1] - 1) * 4 + (date[2] - 1) / 7;
    let lines: Vec<_> = defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)).collect();
    let mut roots: Vec<_> =
        lines.iter().copied().filter(|l| l.attr.as_deref().is_some_and(|a| is_root(&defs, a))).collect();
    roots.sort_by_key(|l| (!lines.iter().any(|v| v.root == l.attr), &l.key));
    let defaults = w.act_default_lessons();
    let mut slots: Vec<LessonPlan> = Vec::new();
    let mut tools = BTreeSet::new();
    let mut monthly = BTreeMap::<String, usize>::new();
    let mut committed = 0;
    let mut weekly_fee = 0;
    for (slot, day) in w.act_lesson_days().to_vec().into_iter().enumerate() {
        let inactive = u32::from(day) < w.act_day() || w.act_ill();
        let choices: Vec<_> = lines
            .iter()
            .filter_map(|line| {
                (0..line.tiers.len().min([1, 3, 4][mode])).rev().find_map(|tier| {
                    let status = w.act_tier_status(line, tier as u8);
                    let master = !inactive && mode == 2 && status.missing == ["master"];
                    if !inactive && !status.missing.is_empty() && !master {
                        return None;
                    }
                    let activity = defs.upbringing.activity(&line.tiers[tier].activity)?;
                    if !inactive && let Some(limit) = activity.monthly_limit {
                        let group = activity.monthly_limit_group.as_deref().unwrap_or(&activity.key);
                        let mut remaining = activity.clone();
                        remaining.monthly_limit =
                            Some(limit.saturating_sub(monthly.get(group).copied().unwrap_or(0) as u32));
                        if !w.act_activity_structural(&remaining, date) {
                            return None;
                        }
                    }
                    let fee = if inactive { 0 } else { status.fee };
                    let tool = if inactive || status.paid || tools.contains(&(line.key.clone(), tier)) {
                        0
                    } else {
                        status.tool
                    };
                    let gift = if master { status.gift } else { 0 };
                    (fee + tool + gift <= w.act_cash() - committed).then_some(PlanChoice {
                        line,
                        tier,
                        master,
                        fee,
                        tool,
                    })
                })
            })
            .collect();
        let mains: Vec<_> = choices.iter().filter(|c| !roots.iter().any(|r| r.key == c.line.key)).collect();
        let investments: Vec<_> = choices
            .iter()
            .filter_map(|c| {
                if mode == 0 || slot >= 2 || !roots.iter().any(|r| r.key == c.line.key) {
                    return None;
                }
                let value = root_return(&defs, &e, (c.line, c.tier), &f, week, annual, mode);
                (value > 0).then_some((c, value))
            })
            .collect();
        let root = if mode == 1 {
            investments.get((week as usize + slot) % investments.len().max(1)).map(|(c, _)| *c)
        } else {
            investments.iter().max_by_key(|(_, value)| *value).map(|(c, _)| *c)
        };
        let targeted = choices
            .iter()
            .filter(|c| c.line.attr.as_deref().is_some_and(|a| e.room(a, annual, r.ladder.cap_pct_by_tier[c.tier]) > 0))
            .map(|c| (c, policy::lesson_priority(w, strategy, c.line)))
            .filter(|(_, priority)| *priority > 0)
            .max_by_key(|(_, priority)| *priority)
            .map(|(c, _)| c);
        let choice = if strategy == Strategy::Scholar && slot < 2 {
            root.or(targeted)
        } else if targeted.is_some() {
            targeted
        } else {
            None
        }
        .or_else(|| {
            if strategy == Strategy::Idle {
                defaults.get(slot).and_then(|p| choices.iter().find(|c| c.line.key == p.line))
            } else if mode == 0 {
                defaults
                    .get(slot)
                    .and_then(|p| mains.iter().find(|c| c.line.key == p.line))
                    .copied()
                    .or_else(|| mains.get(slot % mains.len().max(1)).copied())
            } else if root.is_some() {
                root
            } else if !mains.is_empty() {
                let eligible: Vec<_> = mains
                    .iter()
                    .copied()
                    .filter(|c| {
                        c.line.attr.as_deref().is_some_and(|a| e.room(a, annual, r.ladder.cap_pct_by_tier[c.tier]) > 0)
                    })
                    .collect();
                let pool = if mode < 2 || eligible.is_empty() { &mains } else { &eligible };
                let selected = pool[*cursor % pool.len()];
                *cursor += 1;
                Some(selected)
            } else {
                None
            }
            .or_else(|| choices.first())
        })
        .ok_or(ReportError::Unavailable("lesson_plan"))?;
        if choice.master {
            Command::MasterTest { owner: OwnerId::Player, line: choice.line.key.clone(), play: false }.apply(w)?;
        }
        committed += choice.fee + choice.tool;
        weekly_fee += choice.fee;
        if !inactive {
            tools.insert((choice.line.key.clone(), choice.tier));
        }
        if !inactive && let Some(a) = defs.upbringing.activity(&choice.line.tiers[choice.tier].activity) {
            *monthly.entry(a.monthly_limit_group.as_deref().unwrap_or(&a.key).into()).or_default() += 1;
        }
        slots.push(LessonPlan { line: choice.line.key.clone(), tier: choice.tier as u8, with: None });
    }
    if strategy == Strategy::Greedy {
        slots = policy::greedy_lessons(w, slots)?;
    }
    Command::PlanLessons { owner: OwnerId::Player, slots }.apply(w)?;
    if strategy == Strategy::Greedy {
        weekly_fee = w.act_fee_week();
    }
    Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
    Ok(weekly_fee)
}

fn action_at(w: &World, action: ActAction) -> Option<FreeStep> {
    w.act_places()
        .iter()
        .find(|p| w.act_action_problem(&p.key, &action).is_ok())
        .map(|p| FreeStep { place: p.key.clone(), action })
}

/// 随手与认真原有的挣钱、自修、休养和师长好感优先级。
fn legacy_free_step(w: &World, mode: usize, weekly_fee: i64) -> Result<Option<FreeStep>, ReportError> {
    let s = w.state.upbringing.as_ref().ok_or(ReportError::Unavailable("upbringing"))?;
    if s.act.points == 0 {
        return Ok(None);
    }
    if w.act_ill() {
        return Ok(action_at(w, ActAction::Rest));
    }
    let defs = &w.defs;
    let r = w.act_rules().cloned().unwrap_or_default();
    let e = Expected::from_world(w)?;
    let annual = w.upbringing_annual_cap();
    let job = w
        .act_places()
        .iter()
        .flat_map(|p| {
            w.act_job_tier(&p.key).into_iter().filter_map(move |a| {
                let action = ActAction::Job { activity: a.key.clone() };
                (job_group(a) == "countinghouse_job" && w.act_action_problem(&p.key, &action).is_ok())
                    .then(|| (a, w.act_job_level(a), FreeStep { place: p.key.clone(), action }))
            })
        })
        .max_by_key(|(_, tier, _)| *tier);
    let lines: Vec<_> = defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)).collect();
    let study = lines
        .iter()
        .filter_map(|line| {
            let tier = (0..line.tiers.len().min(2)).rev().find(|t| w.act_tier_open(line, *t as u8))?;
            let step = action_at(w, ActAction::SelfStudy { line: line.key.clone(), tier: tier as u8 })?;
            let g = lesson_gain(defs, &r, &e, line, tier).2 * r.self_study_pct / 100;
            Some((step, e.line_total(&r, line, g, annual, 100)))
        })
        .max_by_key(|(_, value)| *value);
    let mut worked = e.clone();
    if let Some((a, tier, _)) = &job {
        work(&mut worked, defs, &r, (a, *tier), annual);
    }
    let job_value = worked.gains[JOB].growth + worked.gains[JOB].skills;
    let study_value = study.as_ref().map_or(0, |(_, value)| *value);
    let needs_cash = e.cash < weekly_fee * 2000;
    let prefer_job = job.is_some()
        && (needs_cash
            || job_value * (r.recover.rest * 10 + r.self_study_fatigue)
                >= study_value * (r.recover.rest * 10 + r.job_fatigue));
    let mentor = lines
        .iter()
        .filter(|l| l.attr.as_deref().is_none_or(|a| !is_root(defs, a)))
        .filter_map(|l| {
            let person = l.mentor.as_ref()?;
            let need = l
                .tiers
                .iter()
                .take(if mode == 1 { 3 } else { 4 })
                .enumerate()
                .map(|(i, t)| t.bond.unwrap_or(r.tier_gate.bond[i]))
                .max()
                .unwrap_or(0);
            let affinity = e.affinity.get(person).copied().unwrap_or(0);
            if mode > 0 && affinity >= need {
                return None;
            }
            action_at(w, ActAction::Talk { person: person.clone() }).map(|step| (step, affinity))
        })
        .min_by_key(|(_, affinity)| *affinity);
    let jobs = s.act.done.iter().filter(|d| matches!(d.action, ActAction::Job { .. })).count();
    let rested = s.act.done.iter().any(|d| matches!(d.action, ActAction::Rest));
    let next_fatigue = if prefer_job { r.job_fatigue } else { r.self_study_fatigue } * 100;
    let should_rest = mode == 0 && !rested
        || mode > 0 && e.fatigue + next_fatigue - r.recover.weekly * 1000 > if mode == 1 { 50000 } else { 52000 };
    Ok(if mode == 0 && jobs < 2 && job.is_some() {
        job.map(|(_, _, step)| step)
    } else if should_rest {
        action_at(w, ActAction::Rest)
    } else if mode > 0 && needs_cash && job.is_some() {
        job.map(|(_, _, step)| step)
    } else if let Some((step, _)) = mentor {
        Some(step)
    } else if mode > 0 && prefer_job {
        job.map(|(_, _, step)| step)
    } else if mode > 0 {
        study.map(|(step, _)| step)
    } else {
        None
    })
}
