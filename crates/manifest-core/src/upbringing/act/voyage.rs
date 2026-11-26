//! 见习出海只替换每周的课格与地点，不借实习船、不切换行动阶段。
use super::*;

impl ActVoyageDef {
    /// 回乡两项是河川与河口活动；其余航次出海，读模型统一给出这个分类。
    pub fn at_sea(&self) -> bool {
        !matches!(self.key.as_str(), "mio_voyage_6a" | "mio_voyage_6b")
    }
}

impl World {
    pub fn act_sailing(&self) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| s.act.voyage.is_some())
    }
    pub fn act_voyage_def(&self) -> Option<&ActVoyageDef> {
        let voyage = self.state.upbringing.as_ref()?.act.voyage.as_ref()?;
        self.defs.upbringing.act_voyages.iter().find(|v| v.key == voyage.key)
    }
    pub fn act_voyage_leg(&self) -> Option<&VoyageLeg> {
        let voyage = self.state.upbringing.as_ref()?.act.voyage.as_ref()?;
        self.act_voyage_def()?.legs.get(usize::from(voyage.leg))
    }
    pub fn act_places(&self) -> &[PlaceDef] {
        self.act_voyage_leg().map_or_else(|| self.upbringing_places(), |leg| leg.places.as_slice())
    }
    pub fn act_voyage_start_week(&self, voyage: &ActVoyageDef) -> u32 {
        crate::scenario::day_of(&self.defs, voyage.start).map_or(0, |d| week_index(&self.defs, d))
    }
    /// 报名沿用日历现有的四周预告范围，开始周起关闭。
    pub fn act_voyage_registration_open(&self, voyage: &ActVoyageDef) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| {
            let start = self.act_voyage_start_week(voyage);
            s.act.week < start && start <= s.act.week + 4
        })
    }
    pub fn act_voyage_missing(&self, voyage: &ActVoyageDef) -> Vec<String> {
        let mut missing = Vec::new();
        let r = &voyage.requires;
        let rank = r.rank.map(|rank| self.act_rank() >= rank);
        let person = r.person.as_ref().map(|(p, level)| self.act_person_level(p) >= *level);
        if !rank.into_iter().chain(person).any(|ok| ok) {
            if r.rank.is_some() {
                missing.push("rank".into());
            }
            if r.person.is_some() {
                missing.push("person".into());
            }
        }
        if r.after.as_ref().is_some_and(|key| {
            !self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| matches!(s.act.voyages.get(key), Some(VoyageStatus::Done { .. })))
        }) {
            missing.push("after".into());
        }
        if self.act_cash() < voyage.fee {
            missing.push("cash".into());
        }
        missing
    }
    pub fn act_voyage_status(&self, voyage: &ActVoyageDef) -> &'static str {
        if !self.act_stage_on("voyage") {
            return "locked";
        }
        let Some(s) = &self.state.upbringing else { return "locked" };
        if s.act.voyage.as_ref().is_some_and(|v| v.key == voyage.key) {
            return "sailing";
        }
        match s.act.voyages.get(&voyage.key) {
            Some(VoyageStatus::Done { .. }) => "done",
            Some(VoyageStatus::Joined) => "joined",
            None if s.act.week >= self.act_voyage_start_week(voyage) => "missed",
            None if voyage.excludes.iter().any(|key| s.act.voyages.contains_key(key)) => "locked",
            None if !self.act_voyage_registration_open(voyage) => "future",
            None if self.act_voyage_missing(voyage).is_empty() => "open",
            None => "locked",
        }
    }
    pub(super) fn act_join_voyage(&mut self, key: &str) -> Result<(), CommandError> {
        if !matches!(self.act_phase(), ActPhase::Plan | ActPhase::Free) {
            return Err(reason("ub.act.phase"));
        }
        let voyage = self
            .defs
            .upbringing
            .act_voyages
            .iter()
            .find(|v| v.key == key && self.upbringing_family().is_some_and(|f| f.key == v.family))
            .cloned()
            .ok_or_else(|| reason("ub.act.voyage_join"))?;
        if self.state.upbringing.as_ref().is_some_and(|s| s.act.week >= self.act_voyage_start_week(&voyage)) {
            return Err(reason("ub.act.voyage_closed"));
        }
        if self.act_voyage_status(&voyage) != "open" {
            return Err(crate::error::Reason::new("ub.act.voyage_join", "（待写）")
                .arg("missing", crate::text::TextArg::Text(self.act_voyage_missing(&voyage).join(",")))
                .rule());
        }
        self.act_pay(voyage.fee).map_err(|e| CommandError::Internal(e.to_string()))?;
        if let Some(s) = &mut self.state.upbringing {
            s.act.voyages.insert(key.into(), VoyageStatus::Joined);
        }
        Ok(())
    }
    pub(super) fn act_open_voyage_week(&mut self) {
        if !self.act_stage_on("voyage") {
            return;
        }
        let Some(s) = &self.state.upbringing else { return };
        let week = s.act.week;
        let active = s.act.voyage.clone();
        let voyage = active
            .as_ref()
            .and_then(|v| self.defs.upbringing.act_voyages.iter().find(|d| d.key == v.key))
            .or_else(|| {
                self.defs.upbringing.act_voyages.iter().find(|v| {
                    v.family == s.family
                        && self.act_voyage_start_week(v) == week
                        && s.act.voyages.get(&v.key) == Some(&VoyageStatus::Joined)
                })
            });
        let Some(voyage) = voyage else { return };
        let key = voyage.key.clone();
        let weeks = u32::from(voyage.weeks);
        let start_week = active.as_ref().map_or(week, |v| v.start_week);
        let line = self.defs.upbringing.lines.iter().find(|l| l.key == voyage.line);
        // 学院期仍认家乡已经开过的档；没有记录时从第一档起。
        let state = s.act.lines.get(&voyage.line).cloned().unwrap_or_default();
        let tier = line.map_or(0, |l| {
            (0..l.tiers.len())
                .rev()
                .find(|t| {
                    (state.used | state.paid) & (1 << t) != 0
                        || state.master && l.tiers[*t].gate.as_deref() == Some("master_test")
                        || self.act_tier_open(l, *t as u8)
                })
                .unwrap_or(0) as u8
        });
        // 后续各程沿用出发时的档；海上地点缺少岸上课堂，不能据此重算降档。
        let plan = active.as_ref().map_or_else(
            || {
                self.act_rules().map_or_else(Vec::new, |r| {
                    r.voyage
                        .task_days
                        .iter()
                        .map(|_| LessonPlan { line: voyage.line.clone(), tier, with: None })
                        .collect()
                })
            },
            |v| v.plan.clone(),
        );
        let deadlines: BTreeMap<_, _> = self
            .state
            .upbringing
            .as_ref()
            .into_iter()
            .flat_map(|s| s.act.markers.keys())
            .filter_map(|key| {
                self.act_marker_chapter_deadline(key)
                    .filter(|day| *day >= self.day())
                    .map(|day| (key.clone(), week_index(&self.defs, day)))
            })
            .collect();
        if let Some(s) = &mut self.state.upbringing {
            if active.is_none() {
                for (key, marker) in s.act.markers.iter_mut().filter(|(_, m)| m.hanging(week)) {
                    marker.expires_week += weeks;
                    if let Some(deadline) = deadlines.get(key) {
                        marker.expires_week = marker.expires_week.min(*deadline);
                    }
                }
            }
            s.act.voyage = Some(ActVoyage { key, leg: (week - start_week) as u8, start_week, plan });
        }
    }
    pub fn act_voyage_chance(&self, voyage: &ActVoyageDef) -> i64 {
        let have = self.upbringing_projected(&voyage.gate.attr);
        let month = self
            .upbringing_family()
            .and_then(|f| f.stages.first())
            .map_or(0, |s| ((self.cast_date()[0] - s.from[0]) * 12 + self.cast_date()[1] - s.from[1]) as usize);
        let need = self
            .defs
            .upbringing
            .act_medians
            .iter()
            .find(|m| m.family == voyage.family && m.attr == voyage.gate.attr)
            .and_then(|m| m.levels.get(month))
            .copied()
            .unwrap_or(have)
            + 1;
        crate::story2::dice::curve_chance(&self.defs.rules.story.attr_curve, have, need)
            .min(self.act_rules().map_or(90, |r| r.voyage.gate_max_pct))
    }
    pub(super) fn act_close_voyage_week(&mut self) -> Option<VoyageSummary> {
        let active = self.state.upbringing.as_ref()?.act.voyage.clone()?;
        let voyage = self.act_voyage_def()?.clone();
        let mut summary =
            VoyageSummary { key: active.key.clone(), leg: active.leg, legs: voyage.weeks, gate: None, merit: 0 };
        if active.leg + 1 == voyage.weeks {
            let chance = self.act_voyage_chance(&voyage);
            let roll =
                self.upbringing_rng(&format!("act:gate:{}", active.key), active.start_week as u8, 0).range(0, 99);
            let (grade, index) = if roll < chance {
                (GateGrade::Good, 2)
            } else if roll < chance + (100 - chance) / 2 {
                (GateGrade::Ok, 1)
            } else {
                (GateGrade::Fail, 0)
            };
            summary.gate = Some(grade);
            summary.merit = self.act_rules().map_or(0, |r| r.voyage.gate_merit[index]);
            if let Some(s) = &mut self.state.upbringing {
                s.act.merit += summary.merit;
                s.act.voyages.insert(active.key, VoyageStatus::Done { grade });
                s.act.voyage = None;
            }
            self.state.story2.flags.insert(voyage.flag);
            self.record_deed(crate::story2::deeds::Deed::UbVoyage, 1);
        }
        Some(summary)
    }
}
