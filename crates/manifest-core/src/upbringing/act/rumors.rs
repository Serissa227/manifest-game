//! 见闻卡、识货基线与结业交接；结果只记录键。
use super::*;
impl World {
    /// 地点所属港从未配过普通听闻卡时，不提供听消息入口；已听完的仍保留。
    pub(super) fn act_rumor_place(&self, place: &str) -> bool {
        let port = self
            .act_voyage_leg()
            .map(|leg| leg.port.as_str())
            .or_else(|| self.upbringing_location().map(|loc| self.defs.loc(loc).key.as_str()));
        self.act_stage_on("rumors")
            && self.act_places().iter().any(|p| p.key == place)
            && self
                .defs
                .upbringing
                .act_rumors
                .iter()
                .any(|r| r.person.is_empty() && port.is_some_and(|port| r.heard.iter().any(|heard| heard == port)))
    }
    pub fn act_rumor_candidates(&self, person: &str) -> Vec<&ActRumorDef> {
        if !self.act_stage_on("rumors") {
            return Vec::new();
        }
        let loc = self
            .act_voyage_leg()
            .and_then(|leg| self.defs.locations.iter().find(|l| l.key == leg.port))
            .or_else(|| self.upbringing_location().map(|l| self.defs.loc(l)));
        let Some(loc) = loc else {
            return Vec::new();
        };
        let today = self.cast_date();
        self.defs
            .upbringing
            .act_rumors
            .iter()
            .filter(|r| {
                r.person == person
                    && r.heard.contains(&loc.key)
                    && r.heard_from.is_none_or(|from| today >= from)
                    && today <= r.valid[1]
                    && self.state.upbringing.as_ref().is_some_and(|s| !s.act.rumors.contains_key(&r.key))
            })
            .collect()
    }
    pub(super) fn act_hear_rumors(&mut self, person: &str) -> Vec<String> {
        let mut candidates: Vec<_> = self.act_rumor_candidates(person).iter().map(|r| r.key.clone()).collect();
        candidates.sort();
        let week = self.state.upbringing.as_ref().map_or(0, |s| s.act.week);
        let count = if person.is_empty() {
            self.act_rules().map_or(1, |r| r.rumor.per_listen) + self.act_tide_effects().rumors
        } else {
            1
        };
        let nth = self
            .state
            .upbringing
            .as_ref()
            .map_or(0, |s| s.act.done.iter().filter(|d| matches!(d.action, ActAction::Rumor)).count());
        let mut rng = self.upbringing_rng("act:rumor", week as u8, nth as u8);
        let mut picked = Vec::new();
        for _ in 0..(count as usize).min(candidates.len()) {
            let i = rng.range(0, candidates.len() as i64 - 1) as usize;
            picked.push(candidates.remove(i));
        }
        if let Some(s) = &mut self.state.upbringing {
            for key in &picked {
                s.act.rumors.insert(key.clone(), week);
            }
        }
        picked
    }
    pub(super) fn act_see_goods(&mut self, place: &str, group: &str) {
        if !self.act_stage_on("rumors") {
            return;
        }
        let goods = self.act_place_def(place).and_then(|p| p.job_goods.get(group)).cloned().unwrap_or_default();
        let need = self.act_rules().map_or(3, |r| r.rumor.known_after);
        if let Some(s) = &mut self.state.upbringing {
            for good in goods {
                let n = s.act.goods_seen.entry(good).or_default();
                *n = n.saturating_add(1).min(need);
            }
        }
    }
    pub(super) fn act_week_k3(&self) -> WeekK3 {
        let Some(s) = &self.state.upbringing else {
            return WeekK3::default();
        };
        let Some(before) = &s.act.opened else {
            return WeekK3::default();
        };
        let need = self.act_rules().map_or(3, |r| r.rumor.known_after);
        let duty_milestones: Vec<_> = self
            .defs
            .upbringing
            .act_duties
            .iter()
            .filter(|d| {
                d.milestone > 0
                    && s.act.family_duty.get(&d.key) == Some(&d.milestone)
                    && s.act.done.iter().any(|r| matches!(&r.action, ActAction::Duty { duty } if duty == &d.key))
            })
            .map(|d| d.key.clone())
            .collect();
        // 周初会清空 done；小结须在结账时保存家业结果。
        let duty = s.act.done.iter().find_map(|record| {
            let ActAction::Duty { duty } = &record.action else { return None };
            Some(DutySummary {
                key: duty.clone(),
                success: record.result.success == Some(true),
                cash: record.result.cash,
                fame: record.fame,
                milestone: duty_milestones.contains(duty),
            })
        });
        WeekK3 {
            rumors: s.act.rumors.iter().filter(|(_, w)| **w == s.act.week).map(|(key, _)| key.clone()).collect(),
            goods: s
                .act
                .goods_seen
                .iter()
                .filter(|(key, n)| **n >= need && before.goods_seen.get(*key).copied().unwrap_or(0) < need)
                .map(|(key, _)| key.clone())
                .collect(),
            levels: self
                .act_people()
                .into_iter()
                .filter_map(|p| {
                    let old = self.act_level_from_affinity(before.affinity.get(&p).copied().unwrap_or(0));
                    let new = self.act_person_level(&p);
                    (old != new).then_some((p, [old, new]))
                })
                .collect(),
            duty_milestones,
            duty,
            voyage: None,
        }
    }
    /// 结业不再处于 act_running，不能用行动阶段开关挡住已经获得的见闻与识货。
    pub fn act_valid_rumors(&self) -> Vec<&ActRumorDef> {
        self.state
            .upbringing
            .as_ref()
            .into_iter()
            .flat_map(|s| s.act.rumors.keys())
            .filter_map(|key| self.defs.upbringing.act_rumors.iter().find(|r| &r.key == key))
            .filter(|r| r.valid[1] >= self.cast_date())
            .collect()
    }
    pub fn act_known_goods(&self) -> Vec<&str> {
        let need = self.act_rules().map_or(3, |r| r.rumor.known_after);
        self.state
            .upbringing
            .as_ref()
            .into_iter()
            .flat_map(|s| &s.act.goods_seen)
            .filter(|(_, n)| **n >= need)
            .map(|(key, _)| key.as_str())
            .collect()
    }
    pub(crate) fn act_graduate_k3(&mut self, capital: &Capital) {
        let mut flags: Vec<_> = self.act_known_goods().into_iter().map(|g| format!("known_good:{g}")).collect();
        flags.extend(
            self.act_people()
                .into_iter()
                .filter(|p| self.act_rival_candidate(p) && !capital.mates.contains(p) && !capital.allies.contains(p))
                .map(|p| format!("rival:{p}")),
        );
        self.state.story2.flags.extend(flags);
        if self.info_mode() == crate::info::InfoMode::Carried {
            let ports: BTreeSet<_> = self
                .act_valid_rumors()
                .iter()
                .filter_map(|r| self.defs.locations.iter().position(|l| l.key == r.port).map(crate::LocId::from_idx))
                .collect();
            for port in ports {
                self.learn(OwnerId::Player, self.take_snapshot(port, crate::info::InfoSource::Report));
            }
        }
    }
}
