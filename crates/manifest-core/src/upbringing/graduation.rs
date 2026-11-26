//! 结业在真实日历到期后执行一次；所有资本分录与同行者在同一试算状态提交。
use super::{Phase, milestones::*};
use crate::{
    CommandError, CoreError, GoodId, LocId, OwnerId, RegionId, ShipTypeId, World,
    cast::{
        CastPlace,
        relations::{Bond, Relation},
    },
    circulation::Sector,
    ledger::{Account, CashClass, JournalEntry, Memo},
    treasury::Flow,
};

/// 结业成功后同时写入人物与故事状态的旗标。
pub const GRADUATED_FLAG: &str = "upbringing_graduated";

/// 远足许可：家乡期开始满一段时间后由引擎发放（任务单 U03），远足图与各家“第一次远足”都以它为条件。
pub const OUTING_PERMISSION_FLAG: &str = "outing_permission";

/// 秘术觉醒：成长、评价与秘术课都认它。学会任何法术（故事效果 `learn_spell`）时由引擎一并设上；各家的觉醒事件也可以直接设它（U03 / A3）。
pub const ARCANA_AWAKENED_FLAG: &str = "arcana_awakened";

/// 养成引擎固定设置的故事旗标；图检查与接口文档共用此登记表。
/// 只有世界定义了养成家庭时才有这些来源；资本旗标另从定义收集。
pub const ENGINE_FLAGS: &[&str] =
    &[GRADUATED_FLAG, OUTING_PERMISSION_FLAG, "ub_rank_2", "ub_rank_3", "ub_rank_4", "family_guarantee_used"];

/// 结业时按志向与约定的结果设置的旗标（志向未选、未达成，学院约定守住）；孤儿旗标检查据此认来源。
pub const GRADUATION_RESULT_FLAGS: &[&str] = &[
    "aspiration_unset",
    "aspiration_unfulfilled",
    "school_promise_kept",
    "ub_grade_ding",
    "ub_grade_bing",
    "ub_grade_yi",
    "ub_grade_jia",
    "ub_grade_te",
    "family_guarantee",
];

impl World {
    pub fn upbringing_graduation_ready(&self) -> bool {
        self.upbringing_active()
            && self.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Graduation)
            && (self.upbringing_skipping()
                || (self.state.story2.pending.is_empty()
                    && self.state.story.pending.is_none()
                    && self.upbringing_family().and_then(|f| f.completion.as_ref()).is_none_or(|c| {
                        c.event.iter().chain(&c.family_event).all(|key| {
                            self.state.story2.tracks.get(key).is_some_and(|t| t.status == crate::story2::Status::Done)
                        })
                    })))
    }
    pub(crate) fn finish_upbringing(&mut self) -> Result<(), CoreError> {
        if !self.upbringing_graduation_ready() {
            return Ok(());
        }
        let mut trial = self.clone();
        trial.graduate().map_err(|e| CoreError::Internal(e.to_string()))?;
        self.state = trial.state;
        Ok(())
    }
    fn graduate(&mut self) -> Result<(), CommandError> {
        let f = self.upbringing_family().cloned().ok_or_else(|| CommandError::Precondition("结业家庭不存在".into()))?;
        self.apply_skipped_growth()?;
        let chosen = self.state.upbringing.as_ref().and_then(|s| s.path.clone());
        let path = chosen
            .as_ref()
            .and_then(|key| self.defs.upbringing.paths.iter().find(|p| &p.key == key))
            .filter(|p| self.upbringing_requirements(&p.requirements))
            .cloned();
        let completion = f.completion.clone();
        let act = self.act_review_on();
        let mut act_record = None;
        let capital = if act {
            let (c, record) = self.act_graduation_capital(path.as_ref().map_or("", |p| p.key.as_str()))?;
            act_record = Some(record);
            c
        } else {
            path.as_ref()
                .map(|p| p.capital.clone())
                .or_else(|| completion.as_ref().map(|c| c.capital.clone()))
                .unwrap_or_default()
        };
        self.return_training_fleet();
        self.settle_graduation_ties();
        // 结业资本可能招入新伙伴；校园记忆必须先按已有相识记录冻结。
        self.remember_schoolmates();
        let aspiration_flag = if chosen.is_none() {
            Some("aspiration_unset")
        } else if path.is_none() {
            Some("aspiration_unfulfilled")
        } else {
            None
        };
        if let Some(flag) = aspiration_flag {
            self.state.cast.flags.insert(flag.into());
            self.state.story2.flags.insert(flag.into());
        }
        if let Some(p) = &path {
            self.apply_upbringing_award(&p.award)?;
        }
        if self.state.cast.promise.is_some() {
            self.state.cast.flags.insert("school_promise_kept".into());
        }
        let ending = self.upbringing_best_ending().cloned();
        let near_miss = if self.defs.upbringing.endings.iter().any(|e| !e.weights.is_empty() || e.supplementary) {
            self.upbringing_near_misses()
        } else {
            Vec::new()
        };
        let supplementary = self
            .defs
            .upbringing
            .endings
            .iter()
            .filter(|e| {
                e.supplementary
                    && e.family.as_ref().is_none_or(|key| key == &f.key)
                    && self.upbringing_requirements(&e.requirements)
            })
            .cloned()
            .collect::<Vec<_>>();
        for e in &supplementary {
            // 支线只授予既有称号、旗标与回忆，避免叠加八份技能/资本奖励。
            self.state.cast.titles.extend(e.award.titles.iter().cloned());
            self.state.cast.flags.extend(e.award.flags.iter().cloned());
            self.state.story2.flags.extend(e.award.flags.iter().cloned());
            self.state.story2.memories.insert(e.key.clone(), e.title.clone());
            if let Some(s) = &mut self.state.upbringing {
                s.memory_days.entry(e.key.clone()).or_insert(self.state.day);
            }
        }
        if let Some(e) = &ending {
            self.apply_upbringing_award(&e.award)?;
        }
        let attrs = self.defs.captain.attributes.iter().map(|a| self.upbringing_projected(&a.key)).collect::<Vec<_>>();
        let born = self.state.protagonist.as_ref().map_or(f.born, |i| i.born);
        let day = self.day();
        let sign = self
            .defs
            .captain
            .sign_of_in(born[1], born[2], &self.defs.calendar)
            .map(|s| s.key.clone())
            .unwrap_or_default();
        let captain = self.agent_mut(OwnerId::Player)?.captain.get_or_insert_with(|| crate::captain::CaptainProfile {
            birthday: crate::captain::Birthday { year: i64::from(born[0]), month: born[1], day: born[2] },
            sign,
            answers: Vec::new(),
            attrs: Vec::new(),
            genius: None,
            learned: Vec::new(),
            teachers: Vec::new(),
            created: day,
        });
        captain.attrs = attrs;
        let at = capital.at.as_deref().unwrap_or(&f.home);
        let loc = self
            .defs
            .locations
            .iter()
            .position(|l| l.key == at)
            .map(LocId::from_idx)
            .ok_or(CommandError::WrongLocation)?;
        self.agent_mut(OwnerId::Player)?.home = loc;
        self.state.cast.place = Some(CastPlace { loc, venue: String::new() });
        self.state.cast.academy = false;
        if capital.cash > 0 {
            self.agent(OwnerId::Player)?.cash.checked_add(capital.cash).ok_or(CommandError::InvalidQuantity)?;
            self.book_external(
                OwnerId::Player,
                Flow::UpbringingCapital,
                Sector::Hinterland,
                JournalEntry::new(day, Memo::Opening, CashClass::Financing)
                    .dr(Account::Cash, capital.cash)
                    .cr(Account::Capital, capital.cash),
            )?;
        }
        let ships = capital
            .ships
            .iter()
            .map(|key| {
                self.defs
                    .ships
                    .iter()
                    .position(|s| &s.key == key)
                    .map(ShipTypeId::from_idx)
                    .ok_or_else(|| CommandError::NotFound(key.clone()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let fleet = if ships.is_empty() {
            None
        } else {
            Some(self.add_opening_fleet(OwnerId::Player, loc, &ships, capital.crew)?)
        };
        if let Some(id) = fleet {
            let ship = self.fleet_mut(id)?;
            ship.food = capital.food;
            ship.water = capital.water;
            // 养成期的场所到此为止：有了船队，人物“此刻在哪”跟着旗舰队走（cast_player_place 的回退），
            // 不再停在结业港；结业当天船就泊在结业港，门槛章照样成立。没有船时才留在结业港。
            self.state.cast.place = None;
        }
        let mut cargo_value = 0_i64;
        for (key, qty) in &capital.cargo {
            let good = self
                .defs
                .goods
                .iter()
                .position(|g| &g.key == key)
                .map(GoodId::from_idx)
                .ok_or_else(|| CommandError::NotFound(key.clone()))?;
            let value = self.defs.good(good).base_price.checked_mul(*qty).ok_or(CommandError::InvalidQuantity)?;
            cargo_value = cargo_value.checked_add(value).ok_or(CommandError::InvalidQuantity)?;
            let fleet = fleet.ok_or_else(|| CommandError::Precondition("结业货物缺少船队".into()))?;
            self.fleet_mut(fleet)?.cargo.insert(good, *qty);
            self.agent_mut(OwnerId::Player)?.book.add(good, *qty, value);
        }
        if cargo_value > 0 {
            self.agent_mut(OwnerId::Player)?
                .ledger
                .post(
                    JournalEntry::new(day, Memo::Opening, CashClass::Investing)
                        .dr(Account::Inventory, cargo_value)
                        .cr(Account::Capital, cargo_value),
                )
                .map_err(CoreError::from)?;
        }
        for region in &capital.regions {
            let id = self
                .defs
                .regions
                .iter()
                .position(|r| &r.key == region)
                .map(RegionId::from_idx)
                .ok_or_else(|| CommandError::NotFound(region.clone()))?;
            crate::story::apply(self, None, &crate::story::StoryEffect::Chart(id))?;
        }
        for (item, qty) in &capital.items {
            self.grant_item(OwnerId::Player, item, *qty)?;
        }
        self.grant_upbringing_extras(&capital)?;
        if act {
            self.act_graduate_k3(&capital);
        }
        self.grant_capital_condition(&capital, fleet)?;
        for person in &capital.allies {
            self.change_relation(person, Relation::Friends, false)?;
            self.state.cast.persons.entry(person.clone()).or_default().met = true;
        }
        let mut friends = capital.mates.clone();
        if !act && let Some(c) = completion {
            friends.extend(
                c.friends
                    .iter()
                    .filter(|f| {
                        self.affection(&f.person).is_some_and(|a| a.bond.is_some_and(|b| b >= Bond::A))
                            && self.upbringing_requirements(&f.when)
                    })
                    .map(|f| f.person.clone()),
            );
        }
        friends.sort();
        friends.dedup();
        friends.retain(|p| {
            self.person_alive(p)
                && self.defs.cast.person(p).and_then(|p| p.mate.as_ref()).is_some_and(|m| m.joinable)
                && self.person_mate(p).is_some_and(|id| self.state.mates.get(&id).is_none_or(|s| s.owner.is_none()))
        });
        for p in &friends {
            if let Some(id) = self.person_mate(p) {
                let s = self.state.mates.entry(id).or_insert_with(|| crate::mates::fresh_state(&self.defs, id));
                s.owner = Some(OwnerId::Player);
                s.hired_on = Some(day);
                s.role = crate::mates::MateRole::None;
                self.state.cast.persons.entry(p.clone()).or_default().met = true;
            }
        }
        self.state.cast.flags.insert(GRADUATED_FLAG.into());
        self.state.story2.flags.insert(GRADUATED_FLAG.into());
        if let Some(s) = &mut self.state.upbringing {
            s.phase = Phase::Done;
            s.graduation = Some(GraduationRecord {
                near_miss,
                supplementary: supplementary.into_iter().map(|e| e.key).collect(),
                day,
                ending: ending.map(|e| e.key),
                path: chosen,
                path_fulfilled: path.is_some(),
                cash: capital.cash,
                fleet,
                friends,
                act: act_record,
            });
            s.plan.clear();
            s.reading_slot = None;
            s.event_backlog.clear();
            s.event_permits.clear();
        }
        self.reconcile_light_world()?;
        self.refresh_trade_bonus();
        // 新交接的船队已在港口；立刻同步亲眼可见的货架，保持保存/读档一致。
        self.restock_items();
        Ok(())
    }
}
