//! 数据引用、可练根基与正常游戏可写出的 K2 存档形状。
use super::*;
use crate::StaticData;
const BANDS: [&str; 5] = ["ding", "bing", "yi", "jia", "te"];
fn cycle(d: &StaticData, key: &str, tier: u8, visiting: &mut BTreeSet<(String, u8)>) -> bool {
    let node = (key.to_owned(), tier);
    if !visiting.insert(node.clone()) {
        return true;
    }
    let bad =
        d.upbringing.lines.iter().find(|l| l.key == key).and_then(|l| l.tiers.get(usize::from(tier))).is_some_and(
            |t| {
                if let Some(LineRequires::Lines(reqs)) = &t.requires {
                    reqs.iter().any(|r| cycle(d, &r.line, r.tier, visiting))
                } else {
                    false
                }
            },
        );
    visiting.remove(&node);
    bad
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut out = Vec::new();
    let Some(r) = &d.rules.upbringing.act else { return out };
    let group = |key: &str| d.captain.attribute_index(key).and_then(|i| d.captain.group(i)).map(|g| g.key.as_str());
    let mut gates = BTreeSet::new();
    for g in &d.upbringing.act_line_gates {
        if !gates.insert(&g.line)
            || d.upbringing.lines.iter().find(|l| l.key == g.line).is_none_or(|l| l.tiers.len() != g.gain.len())
        {
            out.push(format!("{}:{} 生成门槛重复或档数不符", g.source, g.line));
        }
    }
    let mut medians = BTreeSet::new();
    for m in &d.upbringing.act_medians {
        if !medians.insert((&m.family, &m.attr))
            || d.upbringing.family(&m.family).is_none()
            || group(&m.attr).is_none()
            || m.levels.len() != 49
        {
            out.push(format!("{}:{} 中位档位表无效", m.source, m.attr));
        }
    }
    for line in &d.upbringing.lines {
        let root = line.root.as_deref().or_else(|| line.attr.as_deref().filter(|a| group(a) == Some("aptitude")));
        let root_line = line.attr.as_deref().is_some_and(|a| group(a) == Some("aptitude"));
        if line.attr.as_deref().is_none_or(|a| ![Some("craft"), Some("aptitude")].contains(&group(a)))
            || root.is_some_and(|a| group(a) != Some("aptitude") || a == "fortune")
            || (root_line
                && (line.side.is_some() || line.skill.is_some() || line.root.is_some() || line.tiers.len() > 3))
            || line.clever.as_deref().is_some_and(|v| !["side", "cash"].contains(&v))
            || !gates.contains(&line.key)
            || line.tiers.iter().enumerate().any(|(i, t)| {
                t.gain.is_some()
                    || t.gate.is_some() && i + 1 != line.tiers.len()
                    || match &t.requires {
                        Some(LineRequires::Lines(reqs)) => reqs.iter().any(|r| {
                            d.upbringing
                                .lines
                                .iter()
                                .find(|l| l.key == r.line)
                                .is_none_or(|l| l.family != line.family || usize::from(r.tier) >= l.tiers.len())
                        }),
                        _ => false,
                    }
            })
            || line.tiers.iter().enumerate().any(|(i, _)| cycle(d, &line.key, i as u8, &mut BTreeSet::new()))
        {
            out.push(format!("{}:{} 阶梯字段、生成门槛或旁门无效", line.source, line.key));
        }
        for f in d.upbringing.family_variants().filter(|f| {
            f.key == line.family
                && f.stages.iter().any(|s| s.stage == line.stage && s.academy.as_deref().unwrap_or("") == line.academy)
        }) {
            if root.is_some_and(|root| {
                root != r.pray.attr
                    && !d.upbringing.lines.iter().any(|l| {
                        l.family == f.key
                            && l.attr.as_deref() == Some(root)
                            && f.stages
                                .iter()
                                .any(|s| s.stage == l.stage && s.academy.as_deref().unwrap_or("") == l.academy)
                    })
            }) {
                out.push(format!("{}:{} 根基在本路线无法练习", line.source, line.key));
            }
        }
    }
    for f in d.upbringing.families.iter().filter(|f| f.act) {
        for route in std::iter::once(f).chain(f.routed.iter().map(|(_, f)| f)) {
            for s in &route.stages {
                if !d
                    .upbringing
                    .lines
                    .iter()
                    .filter(|l| {
                        l.family == f.key && l.stage == s.stage && l.academy == s.academy.as_deref().unwrap_or("")
                    })
                    .any(|l| {
                        l.tiers
                            .first()
                            .and_then(|t| d.upbringing.activity(&t.activity))
                            .is_some_and(|a| a.cost == 0 && a.monthly_limit.is_none())
                    })
                {
                    out.push(format!("{}:{} 阶段缺少不限次的免费一档门", f.key, s.at));
                }
            }
        }
        if d.upbringing.act_review.iter().filter(|a| a.family == f.key).count() != 1 {
            out.push(format!("{} 缺少唯一身份表", f.key));
        }
        if let Some(c) = &f.completion {
            let mut averages = Vec::new();
            for band in BANDS {
                let mut values = Vec::new();
                for path in std::iter::once("").chain(c.paths.iter().map(String::as_str)) {
                    let rows: Vec<_> = d
                        .upbringing
                        .act_capital
                        .iter()
                        .filter(|a| a.family == f.key && a.path == path && a.band == band)
                        .collect();
                    if rows.len() != 1 {
                        out.push(format!("{}:{path}:{band} 资本行缺失或重复", f.key));
                        continue;
                    }
                    values.push(capital::definition_value(d, r, rows[0]));
                }
                let sum = values.iter().sum::<i64>();
                let n = values.len() as i64;
                if n > 0 {
                    if values.iter().any(|v| (v * n - sum).abs() * 100 > sum * r.capital_value.tolerance_pct) {
                        out.push(format!("{}:{band} 同档资本偏差超界", f.key));
                    }
                    averages.push(sum / n);
                }
            }
            if averages.windows(2).any(|w| w[0] >= w[1]) {
                out.push(format!("{} 五档资本未递增", f.key));
            }
        }
    }
    for c in &d.upbringing.act_capital {
        let ships: Vec<_> = c.ships.iter().filter_map(|k| d.ships.iter().find(|s| s.key == *k)).collect();
        if !BANDS.contains(&c.band.as_str())
            || d.upbringing.family(&c.family).is_none_or(|f| {
                !f.act || f.completion.as_ref().is_none_or(|v| !c.path.is_empty() && !v.paths.contains(&c.path))
            })
            || ships.len() != c.ships.len()
            || c.ship_condition.is_some_and(|v| !(1..=100).contains(&v) || ships.is_empty())
            || c.crew < ships.iter().map(|s| s.crew_min).sum::<i64>()
            || c.crew > ships.iter().map(|s| s.crew_max).sum::<i64>()
            || c.cash < 0
            || c.items.iter().any(|(k, v)| *v < 1 || d.items.item(k).is_none_or(|i| i.flags.key))
            || c.cargo.iter().any(|(k, v)| *v < 1 || !d.goods.iter().any(|g| g.key == *k))
            || c.licenses.iter().any(|k| !d.factions.iter().any(|f| f.key == *k))
        {
            out.push(format!("{}:{}:{} 资本引用或数量无效", c.source, c.path, c.band));
        }
    }
    for a in &d.upbringing.act_review {
        if d.upbringing.family(&a.family).is_none_or(|f| !f.act)
            || a.rank_items.iter().any(|(k, v)| *v < 1 || d.items.item(k).is_none())
            || a.rank_licenses.iter().any(|k| !d.factions.iter().any(|f| f.key == *k))
        {
            out.push(format!("{}:{} 身份奖励无效", a.source, a.family));
        }
    }
    for a in &d.upbringing.act_duties {
        if a.award.cash < 0
            || a.award.items.iter().any(|(k, v)| *v < 1 || d.items.item(k).is_none())
            || a.award.licenses.iter().any(|k| !d.factions.iter().any(|f| f.key == *k))
        {
            out.push(format!("{}:{} 家业奖励无效", a.source, a.key));
        }
    }
    let mut keys = BTreeSet::new();
    let mut months = BTreeSet::new();
    for m in &d.upbringing.missions {
        let family = d.upbringing.family(&m.family);
        let date = [m.month[0], m.month[1], 1];
        let route_ok = family.is_some_and(|f| {
            std::iter::once(f).chain(f.routed.iter().map(|(_, f)| f)).any(|f| {
                f.stages
                    .iter()
                    .rev()
                    .find(|s| s.from <= date)
                    .is_some_and(|s| s.stage == m.stage && s.academy.as_deref().unwrap_or("") == m.academy)
            })
        });
        let goal_ok = |g: &MissionGoal| match g {
            MissionGoal::Deed { deed, ge, .. } => *ge > 0 && !deed.reserved() && d.rules.quests.enabled,
            MissionGoal::Tier { line, ge, .. } => {
                *ge > 0
                    && d.upbringing
                        .lines
                        .iter()
                        .any(|l| l.key == *line && l.family == m.family && *ge <= l.tiers.len() as i64)
            }
            MissionGoal::Gain { attr, ge, .. } => *ge > 0 && group(attr).is_some(),
            MissionGoal::Skill { skill, ge, .. } => *ge > 0 && d.story2.skills.contains(skill),
            MissionGoal::Affinity { person, ge, .. } => *ge > 0 && d.cast.person(person).is_some(),
            MissionGoal::Duty { duty, ge, .. } => {
                *ge > 0 && d.upbringing.act_duties.iter().any(|a| a.key == *duty && a.family == m.family)
            }
            MissionGoal::Contest { contest, rank, .. } => {
                *rank > 0 && d.upbringing.contests.iter().any(|c| c.key == *contest)
            }
            MissionGoal::Flag { flag, .. } => !flag.is_empty(),
        };
        let reward_ok = |r: &MissionReward| match r {
            MissionReward::Cash { value } => *value > 0,
            MissionReward::Item { item, qty } => *qty > 0 && d.items.item(item).is_some(),
            MissionReward::Affinity { person, value } => *value > 0 && d.cast.person(person).is_some(),
        };
        if !keys.insert(&m.key)
            || !months.insert((&m.family, m.month, m.stage as u8, &m.academy))
            || !route_ok
            || family.is_none_or(|f| !f.act || f.stages.first().is_none_or(|s| date < s.from) || date >= f.graduation)
            || d.cast.person(&m.giver).is_none()
            || !(1..=4).contains(&m.goals.len())
            || !m.goals.iter().all(goal_ok)
            || !m.reward.iter().all(reward_ok)
        {
            out.push(format!("{}:{} 主命日期、目标或奖励无效", m.source, m.key));
        }
    }
    out
}
impl World {
    pub(crate) fn act_k2_snapshot_problem(&self) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let a = &s.act;
        let moment_pending = a
            .moment
            .as_ref()
            .is_some_and(|m| m.week == a.week && m.pick.is_none() && u32::from(m.day) == self.act_day());
        a.rank > 4
            || a.merit < 0
            || a.reviews.len() > 16
            || a.missions.len() > 48
            || (self.act_running() && (a.phase == ActPhase::Moment) != moment_pending)
            || a.moment.as_ref().is_some_and(|m| {
                m.slot >= 7
                    || (self.act_running() && self.act_lesson_days().get(usize::from(m.slot)) != Some(&m.day))
                    || m.week != a.week
            })
            || a.ill_until_week.is_some_and(|w| w < a.week)
            || a.lines.values().any(|l| l.paid > 15)
            || a.missions.iter().any(|(k, m)| {
                !self.defs.upbringing.missions.iter().any(|d| d.key == *k && d.family == s.family)
                    || m.week > a.week
                    || m.done_week.is_some_and(|w| w > a.week)
            })
            || a.reviews
                .iter()
                .any(|r| r.week > a.week || !(1..=4).contains(&r.from) || !(1..=4).contains(&r.to) || r.merit < 0)
            || a.outcomes.len() > 7
            || a.outcomes.iter().map(|o| o.slot).collect::<BTreeSet<_>>().len() != a.outcomes.len()
            || a.outcomes.iter().any(|o| o.slot >= 7)
            || a.jobs.keys().any(|g| {
                !self.defs.upbringing.activities.iter().any(|v| v.kind == ActivityKind::Job && job_group(v) == g)
            })
    }
}
