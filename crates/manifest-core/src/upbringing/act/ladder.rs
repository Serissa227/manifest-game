//! 阶梯的门槛、费用与成长；与旧活动循环分开。
use super::*;
use crate::story2::deeds::Deed;

#[derive(Clone, Debug, Serialize)]
pub struct RequiredLine {
    pub line: String,
    pub tier: u8,
    pub ok: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct TierStatus {
    pub gain_need: i64,
    pub gain_have: i64,
    pub root_need: i64,
    pub root_have: i64,
    pub bond_need: Option<i64>,
    pub bond_have: Option<i64>,
    pub rank_need: u8,
    pub rank_have: u8,
    pub exam: bool,
    pub paid: bool,
    pub master: Option<bool>,
    pub requires: Vec<RequiredLine>,
    pub missing: Vec<String>,
    pub fee: i64,
    pub tool: i64,
    pub gift: i64,
    pub yield_x100: i64,
}
impl World {
    /// 保留阶段、地点、设施、旗标与职业分支，只让阶梯接管数值门槛。
    pub fn act_activity_structural(&self, a: &ActivityDef, date: WorldDate) -> bool {
        let Some(stage) = self.upbringing_stage_on(date) else { return false };
        let Some(age) = self.state.protagonist.as_ref().and_then(|p| p.age_on(date)) else { return false };
        let loc = if a.kind == ActivityKind::Job {
            self.act_voyage_leg().and_then(|leg| self.defs.locations.iter().find(|l| l.key == leg.port))
        } else {
            None
        }
        .or_else(|| self.upbringing_location().map(|l| self.defs.loc(l)));
        let Some(loc) = loc else { return false };
        a.stage.allows(stage.stage)
            && a.age.is_none_or(|r| (r[0]..=r[1]).contains(&age))
            && a.unlock.flag.as_ref().is_none_or(|f| self.upbringing_flag(f))
            && a.tier.as_ref().is_none_or(|t| {
                t.branch.as_ref().is_none_or(|b| {
                    !self.defs.upbringing.activities.iter().filter_map(|a| a.tier.as_ref()).any(|other| {
                        other.group == t.group
                            && other.branch.as_ref().is_some_and(|v| v != b && self.upbringing_flag(v))
                    })
                })
            })
            && a.place.at.as_ref().is_none_or(|v| v == &loc.key)
            && a.place.culture.as_ref().is_none_or(|v| self.upbringing_culture_matches(v, &loc.culture))
            && a.place.academy.as_ref().is_none_or(|v| stage.academy.as_ref() == Some(v))
            && (a.kind != ActivityKind::Voyage || loc.is_port())
            && a.place.feature.as_deref().is_none_or(|f| match f {
                "dock" => loc.is_port(),
                "shipyard" => !loc.shipyard.is_empty(),
                "market" => !loc.market.is_empty(),
                "shop" => loc.shop,
                "school" => self.act_places().iter().any(|p| p.venue == "classroom"),
                "library" => self.act_places().iter().any(|p| p.venue == "library"),
                "lodging" => self.act_places().iter().any(|p| ["home", "dorm"].contains(&p.venue.as_str())),
                "settlement" => !loc.market.is_empty() || loc.is_port(),
                "workplace" => {
                    self.act_places().iter().any(|p| ["market", "dock", "workshop"].contains(&p.venue.as_str()))
                }
                "workshop" => self.act_places().iter().any(|p| p.venue == "workshop") || !loc.shipyard.is_empty(),
                _ => false,
            })
            && self.check_native_activity(a).is_ok()
    }
    pub fn act_root<'a>(&self, line: &'a LineDef) -> Option<&'a str> {
        line.root.as_deref().or_else(|| {
            line.attr.as_deref().filter(|k| {
                self.defs
                    .captain
                    .attribute_index(k)
                    .and_then(|i| self.defs.captain.group(i))
                    .is_some_and(|g| g.key == "aptitude")
            })
        })
    }
    pub fn act_efficiency(&self, line: &LineDef, a: &ActivityDef, with: Option<&str>) -> i64 {
        let r = self.act_rules().cloned().unwrap_or_default();
        let root = self.act_root(line).map_or(1, |k| self.upbringing_projected(k)).clamp(1, 10);
        let mood = self.state.upbringing.as_ref().map_or(50, |s| s.mood);
        let mood_pct = if mood >= r.mood_factor.high {
            r.mood_factor.high_pct
        } else if mood <= r.mood_factor.low {
            r.mood_factor.low_pct
        } else {
            100
        };
        let mut eff = (r.efficiency.base + r.efficiency.per_level * (root - 1)) * mood_pct / 100;
        eff = eff * (10000 + self.upbringing_activity_bonus_bp(a)) / 10000;
        if let Some(person) = with {
            let perk = if self.act_has_perk(person, "companion") { r.perk.companion_pct } else { 0 };
            eff = eff * (100 + r.with_pct + perk) / 100;
        }
        eff
    }
    pub fn act_tier_fee(&self, line: &LineDef, tier: u8) -> i64 {
        let t = &line.tiers[usize::from(tier)];
        let r = self.act_rules().cloned().unwrap_or_default();
        if let Some(fee) = t.fee {
            return fee;
        }
        if tier == 0 && self.defs.upbringing.activity(&t.activity).is_some_and(|a| a.cost == 0) {
            return 0;
        }
        let fee = r.fee_academy[usize::from(tier)];
        if line.stage == Stage::Home { (fee * r.fee_home_pct + 99) / 100 } else { fee }
    }
    pub fn act_paid(&self, line: &str, tier: u8) -> bool {
        self.state.upbringing.as_ref().and_then(|s| s.act.lines.get(line)).is_some_and(|l| l.paid & (1 << tier) != 0)
    }
    pub fn act_tier_status(&self, line: &LineDef, tier: u8) -> TierStatus {
        let r = self.act_rules().cloned().unwrap_or_default();
        let t = &line.tiers[usize::from(tier)];
        let i = usize::from(tier);
        let a = self.defs.upbringing.activity(&t.activity);
        let gain_need = self
            .defs
            .upbringing
            .act_line_gates
            .iter()
            .find(|g| g.line == line.key)
            .and_then(|g| g.gain.get(i))
            .copied()
            .unwrap_or(0);
        let gain_have =
            line.attr.as_deref().map_or(0, |k| (self.upbringing_growth(k) - self.act_origin_growth(k)).max(0));
        let root_have = self.act_root(line).map_or(1, |k| self.upbringing_projected(k));
        let mut teachers = self.defs.upbringing.act_perks.iter().filter(|p| {
            i == 2
                && p.kind == "teach"
                && p.line == line.key
                && self.upbringing_family().is_some_and(|f| f.key == p.family)
        });
        let taught = teachers.clone().any(|p| self.act_perk_active(p));
        let root_need = if taught { 0 } else { t.root.unwrap_or(r.tier_gate.root[i]) };
        let bond_have = line.mentor.as_deref().map(|p| self.affection(p).map_or(0, |a| a.affinity));
        let bond_need = line.mentor.as_ref().map(|_| t.bond.unwrap_or(r.tier_gate.bond[i]));
        let exam = self.upbringing_academy().is_some_and(|academy| {
            self.defs
                .upbringing
                .exams
                .iter()
                .filter(|e| e.academy.as_deref() == Some(&academy.key))
                .any(|e| self.state.upbringing.as_ref().and_then(|s| s.exams.get(&e.key)).is_some_and(|e| e.passed))
        });
        let requires = match &t.requires {
            Some(LineRequires::Lines(reqs)) => reqs
                .iter()
                .map(|r| RequiredLine { line: r.line.clone(), tier: r.tier, ok: self.act_paid(&r.line, r.tier) })
                .collect(),
            _ => Vec::new(),
        };
        let master = (t.gate.as_deref() == Some("master_test"))
            .then(|| self.state.upbringing.as_ref().and_then(|s| s.act.lines.get(&line.key)).is_some_and(|l| l.master));
        let paid = self.act_paid(&line.key, tier);
        let mut status = TierStatus {
            gain_need,
            gain_have,
            root_need,
            root_have,
            bond_need,
            bond_have,
            rank_need: r.tier_gate.rank[i],
            rank_have: self.act_rank(),
            exam,
            paid,
            master,
            requires,
            missing: Vec::new(),
            fee: self.act_tier_fee(line, tier),
            tool: t.tool.unwrap_or(r.tier_gate.tool[i]),
            gift: t.gift.unwrap_or(r.tier_gate.gift[i]),
            yield_x100: self.act_expected_yield(line, tier, None),
        };
        if !paid {
            let checks = [
                (
                    "structural",
                    self.act_line_here(line) && a.is_some_and(|a| self.act_activity_structural(a, self.cast_date())),
                ),
                ("gain", gain_have >= gain_need),
                ("root", root_have >= root_need),
                ("bond", bond_have.zip(bond_need).is_none_or(|(h, n)| h >= n)),
                ("rank", exam || self.act_rank() >= status.rank_need),
                (
                    "requires",
                    status.requires.iter().all(|r| r.ok)
                        && match &t.requires {
                            Some(LineRequires::Legacy(r)) => self.upbringing_requirements(r),
                            _ => true,
                        },
                ),
                ("master", master != Some(false)),
            ];
            status.missing = checks.into_iter().filter(|(_, ok)| !*ok).map(|(k, _)| k.into()).collect();
        } else if root_have < root_need && teachers.next().is_some() {
            // 教技只在到级时免根基；掉级后，已付器具费也不能继续绕过根基。
            status.missing.push("root".into());
        }
        if self
            .state
            .upbringing
            .as_ref()
            .and_then(|s| s.act.voyage.as_ref())
            .is_some_and(|v| v.plan.iter().any(|p| p.line == line.key && p.tier == tier))
        {
            status.missing.clear();
        }
        status
    }
    pub fn act_expected_yield(&self, line: &LineDef, tier: u8, with: Option<&str>) -> i64 {
        let Some(a) = self.defs.upbringing.activity(&line.tiers[usize::from(tier)].activity) else { return 0 };
        let r = self.act_rules().cloned().unwrap_or_default();
        let fail = self.act_fail_bp(a);
        let great = self.act_great_bp(with.is_some());
        let grade =
            fail * r.result.fail_pct + (10000 - fail) * (10000 * 100 + great * (r.result.great_pct - 100)) / 10000;
        r.tier_yield[usize::from(tier)] * self.act_efficiency(line, a, with) / 100 * grade / 1000000
    }
    pub fn act_tool_dues(&self) -> BTreeMap<(String, u8), i64> {
        let mut out = BTreeMap::new();
        if self.act_ill() || self.act_sailing() {
            return out;
        }
        for (i, p) in self.act_lesson_plan().iter().enumerate() {
            if self.act_lesson_days().get(i).is_some_and(|d| u32::from(*d) >= self.act_day())
                && !self.act_paid(&p.line, p.tier)
                && let Some(l) = self.defs.upbringing.lines.iter().find(|l| l.key == p.line)
            {
                let t = &l.tiers[usize::from(p.tier)];
                let cost = if p.tier == 0 {
                    0
                } else {
                    t.tool.unwrap_or_else(|| self.act_rules().map_or(0, |r| r.tier_gate.tool[usize::from(p.tier)]))
                };
                out.insert((p.line.clone(), p.tier), cost);
            }
        }
        out
    }
    pub(super) fn act_pay(&mut self, amount: i64) -> Result<(), CoreError> {
        if amount == 0 {
            return Ok(());
        }
        let sector = self
            .upbringing_location()
            .map(|loc| self.town_sector(loc))
            .unwrap_or(crate::circulation::Sector::Hinterland);
        self.book_external(
            OwnerId::Player,
            crate::treasury::Flow::Other,
            sector,
            crate::ledger::JournalEntry::new(
                self.day(),
                crate::ledger::Memo::Other,
                crate::ledger::CashClass::Operating,
            )
            .dr(crate::ledger::Account::OtherExpense, amount)
            .cr(crate::ledger::Account::Cash, amount),
        )
        .map(|_| ())
    }
    pub(super) fn act_master_test(&mut self, line: &str, play: bool) -> Result<(), CommandError> {
        if !matches!(self.act_phase(), ActPhase::Plan | ActPhase::Free) {
            return Err(reason("ub.act.phase"));
        }
        if self.act_ill() {
            return Err(reason("ub.act.ill"));
        }
        let l = self
            .defs
            .upbringing
            .lines
            .iter()
            .find(|l| l.key == line && self.act_line_here(l))
            .cloned()
            .ok_or_else(|| argument("ub.act.line", "slot", -1))?;
        let t = l
            .tiers
            .iter()
            .position(|t| t.gate.as_deref() == Some("master_test"))
            .ok_or_else(|| reason("ub.act.master"))?;
        if self.state.upbringing.as_ref().and_then(|s| s.act.lines.get(line)).is_some_and(|l| l.master) {
            return Err(reason("ub.act.master_done"));
        }
        if play {
            return Err(reason("ub.act.master_play"));
        }
        let status = self.act_tier_status(&l, t as u8);
        let missing = status.missing.iter().filter(|k| k.as_str() != "master").cloned().collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(crate::error::Reason::new("ub.act.master", "（待写）")
                .arg("missing", crate::text::TextArg::Text(missing.join(",")))
                .rule());
        }
        if self.act_cash() < status.gift {
            return Err(CommandError::InsufficientCash { need: status.gift, have: self.act_cash() });
        }
        self.act_pay(status.gift).map_err(|e| CommandError::Internal(e.to_string()))?;
        if let Some(s) = &mut self.state.upbringing {
            s.act.lines.entry(line.into()).or_default().master = true;
        }
        self.record_deed(Deed::UbMasterTest, 1);
        Ok(())
    }
    pub fn act_job_level(&self, a: &ActivityDef) -> usize {
        let group = job_group(a);
        let mut list: Vec<_> = self
            .defs
            .upbringing
            .activities
            .iter()
            .filter(|v| v.kind == ActivityKind::Job && job_group(v) == group)
            .collect();
        list.sort_by_key(|v| {
            (
                v.tier.as_ref().map_or(0, |t| t.level),
                !v.unlock.attrs.is_empty()
                    || !v.unlock.growth.is_empty()
                    || !v.unlock.rating.is_empty()
                    || !v.unlock.skills.is_empty(),
                &v.key,
            )
        });
        list.iter().position(|v| v.key == a.key).unwrap_or(0).min(3)
    }
    pub fn act_job_open(&self, a: &ActivityDef) -> bool {
        let r = self.act_rules().cloned().unwrap_or_default();
        let i = self.act_job_level(a);
        let points = self.state.upbringing.as_ref().and_then(|s| s.act.jobs.get(job_group(a))).copied().unwrap_or(0);
        let gain = ["commerce", "eloquence"]
            .iter()
            .map(|k| (self.upbringing_growth(k) - self.act_origin_growth(k)).max(0))
            .sum::<i64>();
        self.act_activity_structural(a, self.cast_date()) && points >= r.job_promote[i] && gain >= r.job_promote_gain[i]
    }
}
