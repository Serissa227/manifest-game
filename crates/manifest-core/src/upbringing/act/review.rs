//! 主命、评定与即算事迹分。
use super::*;
use crate::story2::deeds::Deed;
impl World {
    pub fn act_person_perks<'a>(&'a self, person: &'a str) -> impl Iterator<Item = &'a ActPerkDef> {
        self.defs
            .upbringing
            .act_perks
            .iter()
            .filter(move |p| p.person == person && self.upbringing_family().is_some_and(|f| f.key == p.family))
    }
    pub fn act_perk_active(&self, perk: &ActPerkDef) -> bool {
        self.act_person_level(&perk.person) >= perk.level
            || perk.kind == "introduce" && self.state.story2.flags.contains(&perk.flag)
    }
    pub fn act_has_perk(&self, person: &str, kind: &str) -> bool {
        self.act_person_perks(person).any(|p| p.kind == kind && self.act_perk_active(p))
    }
    pub fn act_rival_candidate(&self, person: &str) -> bool {
        self.upbringing_academy()
            .and_then(|a| a.companions.get(person))
            .or_else(|| self.upbringing_family().and_then(|f| f.companions.get(person)))
            .is_some_and(|r| matches!(r, CompanionRole::Friend | CompanionRole::Classmate | CompanionRole::Rival))
    }
    pub(super) fn act_introduce(&mut self) {
        let flags: Vec<_> = self
            .act_people()
            .iter()
            .flat_map(|person| self.act_person_perks(person))
            .filter(|p| p.kind == "introduce" && self.act_perk_active(p))
            .map(|p| p.flag.clone())
            .collect();
        self.state.story2.flags.extend(flags);
    }
    pub fn act_rank(&self) -> u8 {
        self.state.upbringing.as_ref().map_or(1, |s| s.act.rank.max(1))
    }
    pub fn act_people(&self) -> Vec<String> {
        let mut people =
            self.upbringing_family().map(|f| f.companions.keys().cloned().collect::<BTreeSet<_>>()).unwrap_or_default();
        if let Some(a) = self.upbringing_academy() {
            people.extend(a.companions.keys().cloned());
        }
        let player = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        people.into_iter().filter(|p| Some(p.as_str()) != player && self.person_alive(p)).collect()
    }
    pub fn act_person_level(&self, person: &str) -> u8 {
        self.act_level_from_affinity(self.affection(person).map_or(0, |a| a.affinity))
    }
    pub fn act_level_from_affinity(&self, affinity: i64) -> u8 {
        self.act_rules().map_or(0, |r| r.score.people_levels.iter().filter(|v| affinity >= **v).count() as u8)
    }
    pub(super) fn act_init_origin(&mut self) {
        let snap = self.act_snapshot();
        let origin = ActOrigin {
            growth: snap.growth,
            skills: snap.skills,
            affinity: self
                .act_people()
                .into_iter()
                .map(|p| {
                    let a = self.affection(&p).map_or(0, |a| a.affinity);
                    (p, a)
                })
                .collect(),
            resolved: self.state.story2.flags.iter().filter(|k| k.ends_with("_resolved")).count() as u32,
        };
        if let Some(s) = &mut self.state.upbringing {
            s.act.origin = Some(origin);
            s.act.rank = 1;
        }
    }
    pub fn act_origin_growth(&self, key: &str) -> i64 {
        self.state
            .upbringing
            .as_ref()
            .and_then(|s| s.act.origin.as_ref())
            .and_then(|o| o.growth.get(key))
            .copied()
            .unwrap_or_else(|| {
                self.upbringing_family()
                    .map_or(0, |f| super::super::growth::opening_growth(&self.defs, f).get(key).copied().unwrap_or(0))
            })
    }
    fn act_goal_value(&self, g: &MissionGoal) -> (Option<String>, i64, i64) {
        match g {
            MissionGoal::Deed { deed, ge, .. } => (
                Some(format!("deed:{}", deed.key())),
                i64::from(self.state.story2.deeds.get(deed).copied().unwrap_or(0)),
                *ge,
            ),
            MissionGoal::Gain { attr, ge, .. } => (Some(format!("growth:{attr}")), self.upbringing_growth(attr), *ge),
            MissionGoal::Skill { skill, ge, .. } => {
                (Some(format!("skill:{skill}")), self.upbringing_skill_xp(skill), *ge)
            }
            MissionGoal::Duty { duty, ge, .. } => (
                Some(format!("duty:{duty}")),
                self.state.upbringing.as_ref().and_then(|s| s.act.family_duty.get(duty)).copied().map_or(0, i64::from),
                *ge,
            ),
            MissionGoal::Tier { line, ge, .. } => (
                None,
                self.state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.act.lines.get(line))
                    .map_or(0, |l| u8::BITS as i64 - i64::from(l.paid.leading_zeros())),
                *ge,
            ),
            MissionGoal::Affinity { person, ge, .. } => (None, self.affection(person).map_or(0, |a| a.affinity), *ge),
            MissionGoal::Contest { rank, .. } => (None, 0, i64::from(*rank)),
            MissionGoal::Flag { flag, .. } => (None, i64::from(self.upbringing_flag(flag)), 1),
        }
    }
    pub fn act_mission_goal(&self, m: &MissionDef, state: &MissionState, g: &MissionGoal) -> (i64, i64, bool) {
        if let MissionGoal::Contest { contest, rank, .. } = g {
            let have = self
                .state
                .upbringing
                .iter()
                .flat_map(|s| s.contest_results.values())
                .filter(|r| r.contest == *contest && [r.date[0], r.date[1]] == m.month)
                .map(|r| r.rank)
                .min()
                .unwrap_or(0);
            return (i64::from(have), i64::from(*rank), have > 0 && have <= *rank);
        }
        let (key, have, need) = self.act_goal_value(g);
        let have = (have - key.as_ref().and_then(|k| state.base.get(k)).copied().unwrap_or(0)).max(0);
        (have, need, have >= need)
    }
    pub fn act_mission_due(&self, m: &MissionDef) -> WorldDate {
        [m.month[0], m.month[1], self.act_rules().map_or(21, |r| r.missions.due_week * 7)]
    }
    pub(super) fn act_open_missions(&mut self) {
        let date = self.cast_date();
        let missions: Vec<_> = self
            .defs
            .upbringing
            .missions
            .iter()
            .filter(|m| {
                m.month == [date[0], date[1]]
                    && self.upbringing_family().is_some_and(|f| m.family == f.key)
                    && lessons::stage_key(m.stage, &m.academy) == self.act_stage_key()
                    && self.state.upbringing.as_ref().is_some_and(|s| !s.act.missions.contains_key(&m.key))
            })
            .cloned()
            .collect();
        for m in missions {
            let base = m
                .goals
                .iter()
                .filter_map(|g| {
                    let (k, v, _) = self.act_goal_value(g);
                    k.map(|k| (k, v))
                })
                .collect();
            if let Some(s) = &mut self.state.upbringing {
                s.act.missions.insert(
                    m.key,
                    MissionState { status: MissionStatus::Active, week: s.act.week, base, done_week: None },
                );
            }
        }
    }
    pub fn act_refresh_missions(&mut self) -> Result<(), CoreError> {
        if !self.act_review_running() {
            return Ok(());
        }
        let done: Vec<_> = self
            .state
            .upbringing
            .iter()
            .flat_map(|s| &s.act.missions)
            .filter(|(_, s)| s.status == MissionStatus::Active)
            .filter_map(|(k, s)| {
                self.defs
                    .upbringing
                    .missions
                    .iter()
                    .find(|m| m.key == *k)
                    .filter(|m| m.goals.iter().all(|g| self.act_mission_goal(m, s, g).2))
                    .cloned()
            })
            .collect();
        for m in done {
            let merit = m.merit.unwrap_or_else(|| self.act_rules().map_or(12, |r| r.missions.merit_done));
            if let Some(s) = &mut self.state.upbringing {
                s.act.merit += merit;
                if let Some(ms) = s.act.missions.get_mut(&m.key) {
                    ms.status = MissionStatus::Done;
                    ms.done_week = Some(s.act.week);
                }
            }
            for reward in m.reward {
                match reward {
                    MissionReward::Cash { value } => self.act_income(value)?,
                    MissionReward::Item { item, qty } => {
                        self.grant_item(OwnerId::Player, &item, qty).map_err(internal)?
                    }
                    MissionReward::Affinity { person, value } => {
                        self.change_affinity(&person, value).map_err(internal)?
                    }
                }
            }
            self.record_deed(Deed::UbMissionDone, 1);
        }
        Ok(())
    }
    pub(super) fn act_week_review(&mut self) -> Result<WeekK2, CoreError> {
        self.act_refresh_missions()?;
        let r = self.act_rules().cloned().unwrap_or_default();
        let date = self.cast_date();
        let week = self.state.upbringing.as_ref().map_or(0, |s| s.act.week);
        let mut out = WeekK2::default();
        if weekly::week_of(date[2]) + 1 == r.missions.due_week as u8 {
            let failed: Vec<_> = self
                .state
                .upbringing
                .iter()
                .flat_map(|s| &s.act.missions)
                .filter(|(_, s)| s.status == MissionStatus::Active)
                .filter_map(|(k, _)| {
                    self.defs.upbringing.missions.iter().find(|m| m.key == *k && m.month == [date[0], date[1]])
                })
                .cloned()
                .collect();
            for m in failed {
                if let Some(s) = &mut self.state.upbringing {
                    s.act.merit = (s.act.merit - r.missions.merit_fail).max(0);
                    if let Some(ms) = s.act.missions.get_mut(&m.key) {
                        ms.status = MissionStatus::Failed;
                        ms.done_week = Some(week);
                    }
                }
                self.change_affinity(&m.giver, -r.missions.giver_fail_affinity).map_err(internal)?;
            }
        }
        out.mission = self
            .state
            .upbringing
            .iter()
            .flat_map(|s| &s.act.missions)
            .find(|(_, m)| m.done_week == Some(week))
            .map(|(k, m)| MissionSummary { key: k.clone(), status: m.status });
        if weekly::week_of(date[2]) == 3 && r.reviews.contains(&date[1]) {
            let from = self.act_rank();
            let merit = self.state.upbringing.as_ref().map_or(0, |s| s.act.merit);
            let quarter = self.act_quarter_missions();
            let to = if from < 4 && merit >= r.ranks[usize::from(from)] {
                from + 1
            } else if from > 1 && quarter.len() == 3 && quarter.iter().all(|(_, s)| *s == MissionStatus::Failed) {
                from - 1
            } else {
                from
            };
            if let Some(s) = &mut self.state.upbringing {
                s.act.rank = to;
                s.act.reviews.push(ReviewRecord { week, merit, from, to });
            }
            for n in 2..=4 {
                let flag = format!("ub_rank_{n}");
                if n <= to {
                    self.state.story2.flags.insert(flag);
                } else {
                    self.state.story2.flags.remove(&flag);
                }
            }
            if to > from {
                self.record_deed(Deed::UbRankUp, 1);
            }
            out.review = Some(RankChange { from, to });
        }
        Ok(out)
    }
    pub fn act_quarter_missions(&self) -> Vec<(&MissionDef, MissionStatus)> {
        let date = self.cast_date();
        let first = (date[1] - 1) / 3 * 3 + 1;
        self.state
            .upbringing
            .iter()
            .flat_map(|s| &s.act.missions)
            .filter_map(|(key, s)| {
                self.defs
                    .upbringing
                    .missions
                    .iter()
                    .find(|m| m.key == *key && m.month[0] == date[0] && (first..first + 3).contains(&m.month[1]))
                    .map(|m| (m, s.status))
            })
            .collect()
    }
    pub fn act_savings(&self) -> SavingsView {
        let r = self.act_rules().cloned().unwrap_or_default();
        let cash = self.act_cash().max(0);
        let mut kept = cash - cash * (100 - r.savings.keep_pct) / 100;
        if r.savings.keep_max > 0 {
            kept = kept.min(r.savings.keep_max);
        }
        let given = cash - kept;
        SavingsView { cash, given, kept, score: (given / r.savings.score_per).min(r.savings.score_max) }
    }
    pub fn act_score(&self) -> ActScore {
        let r = self.act_rules().cloned().unwrap_or_default();
        let s = self.state.upbringing.as_ref();
        let origin = s.and_then(|s| s.act.origin.as_ref());
        let level = |v: i64| {
            self.defs.upbringing.rules.growth_table.iter().find(|b| b.from <= v && v <= b.to).map_or(1, |b| b.value)
        };
        let mut craft = Vec::new();
        let mut root = Vec::new();
        for (i, a) in self.defs.captain.attributes.iter().enumerate() {
            let group = self.defs.captain.group(i).map_or("", |g| g.key.as_str());
            if !["craft", "aptitude"].contains(&group) || a.key == "fortune" {
                continue;
            }
            let from = if a.key == "arcana" && self.act_origin_growth(&a.key) == 0 {
                0
            } else {
                level(self.act_origin_growth(&a.key))
            };
            let to = self.upbringing_projected(&a.key);
            let d = (to - from).max(0);
            let score = if group == "craft" {
                (0..d).map(|n| r.score.craft[(n as usize).min(4)]).sum()
            } else {
                d * r.score.root
            };
            let row = LevelScore { attr: a.key.clone(), from, to, score };
            if group == "craft" {
                craft.push(row);
            } else {
                root.push(row);
            }
        }
        let skill_xp = self.inventory(OwnerId::Player).map_or(0, |i| {
            i.skill_xp
                .iter()
                .map(|(k, v)| (v - origin.and_then(|o| o.skills.get(k)).copied().unwrap_or(0)).max(0))
                .sum::<i64>()
        });
        let academies = self
            .upbringing_family()
            .map(|f| f.stages.iter().filter_map(|s| s.academy.as_deref()).collect::<BTreeSet<_>>())
            .unwrap_or_default();
        let exams: Vec<_> = self
            .defs
            .upbringing
            .exams
            .iter()
            .filter(|e| e.academy.as_deref().is_some_and(|a| academies.contains(a)))
            .map(|e| {
                let state = s.and_then(|s| s.exams.get(&e.key));
                let passed = state.is_some_and(|s| s.passed);
                ExamScore { exam: e.key.clone(), passed, honor: passed && state.is_some_and(|s| s.attempts == 1) }
            })
            .collect();
        let mut best = BTreeMap::<(String, u32), u32>::new();
        for c in s.into_iter().flat_map(|s| s.contest_results.values()) {
            let v = best.entry((c.contest.clone(), c.date[0])).or_insert(c.rank);
            *v = (*v).min(c.rank);
        }
        let contests: Vec<_> = best
            .into_iter()
            .map(|((contest, year), rank)| ContestScore {
                contest,
                year,
                rank,
                score: rank.checked_sub(1).and_then(|n| r.score.contest.get(n as usize)).copied().unwrap_or(0),
            })
            .collect();
        let person_score = |n: u8| n.checked_sub(1).map_or(0, |i| r.score.people[usize::from(i)]);
        let people: Vec<_> = self
            .act_people()
            .into_iter()
            .map(|p| {
                let from = self.act_level_from_affinity(origin.and_then(|o| o.affinity.get(&p)).copied().unwrap_or(0));
                let to = self.act_person_level(&p);
                PersonScore { person: p, from, to, score: (person_score(to) - person_score(from)).max(0) }
            })
            .collect();
        let markers = s.map_or(0, |s| s.act.markers_seen);
        let resolved = (self.state.story2.flags.iter().filter(|k| k.ends_with("_resolved")).count() as u32)
            .saturating_sub(origin.map_or(0, |o| o.resolved));
        let duties = self
            .defs
            .upbringing
            .act_duties
            .iter()
            .filter(|d| {
                self.upbringing_family().is_some_and(|f| d.family == f.key)
                    && d.milestone > 0
                    && s.and_then(|s| s.act.family_duty.get(&d.key)).copied().unwrap_or(0) >= d.milestone
            })
            .count() as u32;
        let savings = self.act_savings().score;
        let voyages =
            s.map_or(0, |s| s.act.voyages.values().filter(|v| matches!(v, VoyageStatus::Done { .. })).count() as u32);
        let items: BTreeMap<String, i64> = [
            ("craft", craft.iter().map(|r| r.score).sum()),
            ("root", root.iter().map(|r| r.score).sum()),
            ("skill", skill_xp / r.score.skill_per),
            ("rank", r.score.rank[usize::from(self.act_rank() - 1)]),
            (
                "mission",
                s.map_or(0, |s| s.act.missions.values().filter(|m| m.status == MissionStatus::Done).count() as i64)
                    * r.score.mission,
            ),
            (
                "exam",
                exams
                    .iter()
                    .map(|e| i64::from(e.passed) * r.score.exam_pass + i64::from(e.honor) * r.score.exam_honor)
                    .sum(),
            ),
            ("contest", contest_score(&r.score, &contests)),
            ("people", people.iter().map(|p| p.score).sum()),
            (
                "deeds",
                i64::from(markers / r.score.marker_per)
                    + i64::from(resolved) * r.score.resolved
                    + i64::from(duties) * r.score.duty_milestone
                    + i64::from(voyages) * r.score.voyage
                    + savings,
            ),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v))
        .collect();
        let total = items.values().sum();
        let bands: BTreeMap<String, i64> =
            [("bing", r.bands.bing), ("yi", r.bands.yi), ("jia", r.bands.jia), ("te", r.bands.te)]
                .into_iter()
                .map(|(k, v)| (k.into(), v))
                .collect();
        let ordered =
            [("ding", 0), ("bing", r.bands.bing), ("yi", r.bands.yi), ("jia", r.bands.jia), ("te", r.bands.te)];
        let band = ordered.iter().rev().find(|(_, at)| total >= *at).map_or("ding", |(k, _)| *k).into();
        let next_band_at = ordered.iter().find(|(_, at)| *at > total).map(|(_, at)| *at);
        ActScore {
            items,
            total,
            band,
            next_band_at,
            bands,
            detail: ScoreDetail {
                craft,
                root,
                skill_xp,
                exams,
                contests,
                people,
                deeds: DeedsScore { markers, resolved, voyages, duties, savings },
            },
        }
    }
}

fn contest_score(rules: &ScoreRules, contests: &[ContestScore]) -> i64 {
    (contests.iter().map(|c| c.score).sum::<i64>() / rules.contest_divisor).min(rules.contest_cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contest_score_truth_table() {
        println!("a,b,c,d,divisor,raw,at_cap,score,expected");
        for divisor in [1, 2] {
            let rules = ScoreRules { contest_divisor: divisor, ..Default::default() };
            let mut rows = 0;
            for a in 0..=16 {
                for b in 0..=16 - a {
                    for c in 0..=16 - a - b {
                        let d = 16 - a - b - c;
                        let contests: Vec<_> = [(b, 3), (c, 2), (d, 1)]
                            .into_iter()
                            .flat_map(|(count, rank)| {
                                (0..count).map(move |_| ContestScore {
                                    contest: String::new(),
                                    year: 1553,
                                    rank,
                                    score: rules.contest[(rank - 1) as usize],
                                })
                            })
                            .collect();
                        let raw = 2 * b + 4 * c + 6 * d;
                        let expected = if divisor == 1 { raw.min(48) } else { (raw / 2).min(48) };
                        let actual = contest_score(&rules, &contests);
                        println!("{a},{b},{c},{d},{divisor},{raw},{},{actual},{expected}", raw / divisor >= 48);
                        assert_eq!(actual, expected, "{a}/{b}/{c}/{d}; divisor={divisor}");
                        rows += 1;
                    }
                }
            }
            assert_eq!(rows, 969);
        }
    }
}
