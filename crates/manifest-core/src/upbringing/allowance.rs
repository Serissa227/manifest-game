//! 零用钱与月度收支预测：月初发零用钱（记为货币的外部来源），自动安排与视图共用同一份预算。
use super::*;
use crate::{
    CoreError, OwnerId, World,
    circulation::Sector,
    ledger::{Account, CashClass, JournalEntry, Memo},
    treasury::Flow,
};

/// 学院奖学金的状态：评价与品行都够了就按折扣收学费。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScholarshipStatus {
    pub academy: String,
    pub active: bool,
    pub discount_pct: i64,
    pub rating: String,
    pub min: i64,
    pub rating_now: i64,
    pub honor_min: i64,
    pub honor_now: i64,
}

/// 本月与下月的收支预测；钱数都是整数，按当前状态推算，不预支随机收入。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct UpbringingBudget {
    pub cash: i64,
    /// 本月月初发的零用钱（按本月一日所在阶段）与下月一日将发的零用钱。
    pub allowance: i64,
    pub allowance_next: i64,
    /// 一门收费课的学费（已计奖学金折扣）；不在学院或本院没有收费课时为 0。
    pub lesson_cost: i64,
    /// 本月还没结算的学院旬要付的学费（每旬一门收费课）。
    pub tuition_left: i64,
    /// 下个月三旬的学费，以及扣掉下月零用钱后须从现有的钱里留出的部分。
    pub tuition_next: i64,
    pub reserve: i64,
    /// 付完本月剩下的学费、留出下月的差额以后，还能花在课后活动上的钱（可能为负）。
    pub spendable: i64,
    /// 钱紧：可花的钱连一门课都不够，自动安排会先排打工。
    pub tight: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scholarship: Option<ScholarshipStatus>,
}

impl World {
    /// 家庭计划里某天所在的阶段（不看入学旗标，用于预测下个月）。
    fn upbringing_planned_stage(&self, date: WorldDate) -> Option<&StageDef> {
        self.upbringing_family()?.stages.iter().rev().find(|s| s.from <= date)
    }
    /// 某天所在阶段每月发的零用钱：家里给的，加上学院期学院另给的津贴。
    pub fn upbringing_allowance_on(&self, date: WorldDate) -> i64 {
        let Some(f) = self.upbringing_family() else { return 0 };
        let Some(stage) = self.upbringing_stage_on(date).or_else(|| self.upbringing_planned_stage(date)) else {
            return 0;
        };
        match stage.stage {
            Stage::Home => f.allowance.home,
            Stage::Academy => {
                f.allowance.academy
                    + stage.academy.as_deref().and_then(|k| self.defs.upbringing.academy(k)).map_or(0, |a| a.allowance)
            }
        }
        .max(0)
    }
    /// 奖学金是否生效：看该学院 `rules.scholarship` 的评价与品行门槛。
    pub fn upbringing_scholarship(&self, academy: &AcademyDef) -> Option<ScholarshipStatus> {
        let s = &academy.rules.as_ref()?.scholarship;
        let rating_now = self.upbringing_rating(&s.rating);
        let honor_now = self.upbringing_projected("honor");
        Some(ScholarshipStatus {
            academy: academy.key.clone(),
            active: rating_now >= s.min && honor_now >= s.honor_min,
            discount_pct: s.fee_discount_pct,
            rating: s.rating.clone(),
            min: s.min,
            rating_now,
            honor_min: s.honor_min,
            honor_now,
        })
    }
    /// 一门课在某所学院的实收学费：奖学金生效时按折扣收。
    pub fn upbringing_tuition(&self, a: &ActivityDef, academy: Option<&AcademyDef>) -> i64 {
        if a.kind != ActivityKind::Lesson {
            return a.cost;
        }
        match academy.and_then(|ac| self.upbringing_scholarship(ac)) {
            Some(s) if s.active => a.cost * (100 - s.discount_pct) / 100,
            _ => a.cost,
        }
    }
    /// 学院课表里最便宜的一门收费课（已计奖学金）；没有收费课时为 0。
    fn upbringing_lesson_cost(&self, academy: Option<&AcademyDef>) -> i64 {
        academy
            .map(|ac| {
                ac.curriculum.iter().map(|c| self.upbringing_tuition(c, Some(ac))).filter(|c| *c > 0).min().unwrap_or(0)
            })
            .unwrap_or(0)
    }
    /// 本月收支预测；不在养成期时返回全 0。
    pub fn upbringing_budget(&self) -> UpbringingBudget {
        let Some(s) = self.state.upbringing.as_ref() else { return UpbringingBudget::default() };
        let cash = self.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash);
        let month = s.month;
        let next = if month[1] >= 12 { [month[0] + 1, 1, 1] } else { [month[0], month[1] + 1, 1] };
        let lesson_cost = self.upbringing_lesson_cost(self.upbringing_academy());
        let tuition_left = if self.upbringing_weekly() {
            // 按周（U05）：本月余下的课业格按格重折成标准格，向上取整。
            (self.week_lessons_left() * lesson_cost + weekly::UNIT - 1).div_euclid(weekly::UNIT)
        } else {
            (s.next_slot..3)
                .filter(|index| {
                    let date = [month[0], month[1], 1 + u32::from(*index) * 10].max(self.cast_date());
                    self.upbringing_stage_on(date).is_some_and(|st| st.stage == Stage::Academy)
                })
                .count() as i64
                * lesson_cost
        };
        let next_stage = self.upbringing_planned_stage(next);
        let next_academy = next_stage
            .filter(|st| st.stage == Stage::Academy)
            .and_then(|st| st.academy.as_deref())
            .and_then(|k| self.defs.upbringing.academy(k));
        let tuition_next = 3 * self.upbringing_lesson_cost(next_academy);
        let graduating = self.upbringing_family().is_some_and(|f| next >= f.graduation);
        let allowance_next = if graduating { 0 } else { self.upbringing_allowance_on(next) };
        let reserve = if graduating { 0 } else { (tuition_next - allowance_next).max(0) };
        let spendable = cash - tuition_left - reserve;
        UpbringingBudget {
            cash,
            allowance: self.upbringing_allowance_on([month[0], month[1], 1]),
            allowance_next,
            lesson_cost,
            tuition_left,
            tuition_next,
            reserve,
            spendable,
            tight: spendable < lesson_cost.max(6),
            scholarship: self.upbringing_academy().and_then(|a| self.upbringing_scholarship(a)),
        }
    }
    /// 月初发零用钱：跳过养成、结业以后都不发；记为货币的外部来源（腹地）。
    pub(crate) fn pay_upbringing_allowance(&mut self) -> Result<(), CoreError> {
        if !self.upbringing_active()
            || self.upbringing_skipping()
            || self.state.upbringing.as_ref().is_none_or(|s| matches!(s.phase, Phase::Graduation | Phase::Done))
        {
            return Ok(());
        }
        let date = self.cast_date();
        let amount = self.upbringing_allowance_on([date[0], date[1], 1]);
        if amount <= 0 {
            return Ok(());
        }
        self.book_external(
            OwnerId::Player,
            Flow::UpbringingAllowance,
            Sector::Hinterland,
            JournalEntry::new(self.day(), Memo::Other, CashClass::Financing)
                .dr(Account::Cash, amount)
                .cr(Account::Capital, amount),
        )?;
        Ok(())
    }
}
