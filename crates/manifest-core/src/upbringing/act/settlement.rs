//! 行动制独立结算；旧的 activity.rs 一行不改。
use super::*;
use crate::{
    ledger::{Account, CashClass, JournalEntry, Memo},
    treasury::Flow,
};
#[derive(Clone, Copy)]
pub(crate) struct ActScale {
    pub permille: i64,
    pub income_permille: i64,
    pub progress_permille: i64,
    pub fatigue_eighths: Option<i64>,
    pub fee: Option<i64>,
    pub success: Option<bool>,
    pub income: Option<i64>,
    pub voyage_task: bool,
}
impl ActScale {
    pub fn lesson(r: &ActRules, tier: u8) -> Self {
        Self {
            permille: r.lesson_permille,
            income_permille: r.lesson_permille,
            progress_permille: r.lesson_permille,
            fatigue_eighths: r.fatigue.get(usize::from(tier)).map(|v| v * 4 / 5),
            fee: None,
            success: None,
            income: None,
            voyage_task: false,
        }
    }
    pub fn job(r: &ActRules) -> Self {
        Self {
            permille: r.job.permille,
            income_permille: r.job.income_permille,
            progress_permille: r.job.progress_permille,
            fatigue_eighths: Some(r.job_fatigue * 4 / 5),
            fee: None,
            success: None,
            income: None,
            voyage_task: false,
        }
    }
    pub fn self_study(r: &ActRules) -> Self {
        Self {
            permille: r.self_study_permille,
            income_permille: 0,
            progress_permille: r.self_study_permille,
            fatigue_eighths: Some(r.self_study_fatigue * 4 / 5),
            fee: None,
            success: Some(true),
            income: None,
            voyage_task: false,
        }
    }
}
impl World {
    pub(super) fn act_carry(&mut self, key: &str, amount: i64, permille: i64) -> i64 {
        let Some(s) = &mut self.state.upbringing else { return 0 };
        let total = s.act.carry.get(key).copied().unwrap_or(0).saturating_add(amount.saturating_mul(permille));
        let rem = total.rem_euclid(1000);
        if rem == 0 {
            s.act.carry.remove(key);
        } else {
            s.act.carry.insert(key.into(), rem);
        }
        total.div_euclid(1000)
    }
    pub(crate) fn settle_upbringing_activity_scaled(
        &mut self,
        a: &ActivityDef,
        index: u8,
        column: u8,
        scale: ActScale,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        let cost = scale.fee.unwrap_or_else(|| self.upbringing_activity_cost(a));
        let ceiling = if scale.fee.is_some() { cost } else { (cost * scale.permille + 999) / 1000 };
        if self.act_cash() < ceiling
            || !scale.voyage_task
                && (!self.act_activity_open(a)
                    || a.monthly_limit.is_some_and(|limit| {
                        self.upbringing_monthly_used(a.monthly_limit_group.as_deref().unwrap_or(&a.key))
                            >= limit as usize
                    }))
        {
            result.success = Some(false);
            return Ok(Vec::new());
        }
        let loc = self.upbringing_location().ok_or_else(|| CoreError::Internal("养成活动缺少地点".into()))?;
        let cost = scale.fee.unwrap_or_else(|| self.act_carry("cost", cost, scale.permille));
        if cost > 0 {
            self.book_external(
                OwnerId::Player,
                Flow::Other,
                self.town_sector(loc),
                JournalEntry::new(self.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::OtherExpense, cost)
                    .cr(Account::Cash, cost),
            )?;
            result.cash -= cost;
        }
        let mut rng = self.upbringing_rng(&a.key, index, column);
        let success = scale.success.unwrap_or_else(|| !rng.chance_bp(self.upbringing_risk(a)));
        result.success = Some(result.success.unwrap_or(true) && success);
        let mut events = a.events.clone();
        if let Some(risk) = &a.risk {
            events.extend(if success { &risk.success_events } else { &risk.failure_events }.iter().cloned());
        }
        if !success {
            events.extend(a.failure.events.iter().cloned());
        }
        let [lo, hi] = a.income.bounds();
        let promised =
            scale.income.unwrap_or_else(|| rng.range(lo, hi)) * if success { 100 } else { a.failure.income_pct } / 100;
        let promised =
            if scale.income.is_some() { promised } else { self.act_carry("income", promised, scale.income_permille) };
        let income =
            if self.circulation_on() { promised.min(self.purse(loc).map_or(0, |p| p.money).max(0)) } else { promised };
        if income > 0 {
            self.book_external(
                OwnerId::Player,
                Flow::Other,
                self.town_sector(loc),
                JournalEntry::new(self.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::Cash, income)
                    .cr(Account::OtherIncome, income),
            )?;
            result.cash += income;
        }
        for (key, range) in &a.gains {
            let amount = rng.range(range[0], range[1]).saturating_mul(self.upbringing_efficiency(a)) / 100
                * if success { 100 } else { a.failure.gains_pct }
                / 100;
            let amount = self.act_carry(&format!("growth:{key}"), amount, scale.permille);
            *result.growth.entry(key.clone()).or_default() += self.gain_upbringing_growth(key, amount);
        }
        for skill in a.skills.iter().filter(|s| success && s.xp > 0) {
            let gained = self.act_carry(&format!("skill:{}", skill.skill), skill.xp, scale.permille);
            let xp = self
                .state
                .items
                .owners
                .entry(OwnerId::Player)
                .or_default()
                .skill_xp
                .entry(skill.skill.clone())
                .or_default();
            *xp = xp.saturating_add(gained);
            *result.skills.entry(skill.skill.clone()).or_default() += gained;
        }
        for (item, qty) in a.items.iter().filter(|_| success) {
            let qty = self.act_carry(&format!("item:{}:{item}", a.key), *qty, scale.permille);
            if qty == 0 {
                continue;
            }
            self.grant_item(OwnerId::Player, item, qty).map_err(internal)?;
            *result.items.entry(item.clone()).or_default() += qty;
        }
        if let Some(tier) = &a.tier {
            let progress = self.upbringing_job_progress(&tier.group);
            let step = self.act_carry(&format!("job:{}", tier.group), 1, scale.progress_permille).max(0) as u32;
            if let Some(s) = &mut self.state.upbringing {
                s.job_progress.insert(tier.group.clone(), progress.saturating_add(step));
                if let Some(branch) = &tier.branch {
                    s.flags.insert(branch.clone());
                }
            }
        }
        let relief = self.upbringing_fatigue_relief_bp(a);
        let fatigue = scale.fatigue_eighths.map_or(a.fatigue * scale.permille, |v| v * 125)
            + if success { 0 } else { a.failure.extra_fatigue * scale.permille };
        let fatigue = if fatigue > 0 { fatigue * (10_000 - relief) / 10_000 } else { fatigue };
        let fatigue = self.act_carry("fatigue", fatigue, 1);
        let mood = self.upbringing_activity_mood(a) + if success { 0 } else { a.failure.mood };
        let mood = self.act_carry("mood", mood, scale.permille);
        self.act_meters(fatigue, mood, result);
        let times = self.act_carry(&format!("count:{}", a.key), 1, scale.permille).max(0) as u32;
        let day = self.day();
        if let Some(s) = &mut self.state.upbringing {
            let count = s.activity_counts.entry(a.key.clone()).or_default();
            *count = count.saturating_add(times);
            let rules = &self.defs.upbringing.rules;
            if !s.act.on
                && s.fatigue >= rules.illness_fatigue
                && rng.chance_bp(rules.illness_bp * scale.permille / 1000)
            {
                s.ill_until = Some(day.saturating_add(rules.illness_days));
                events.extend(rules.illness_events.iter().cloned());
            }
        }
        if let Some(key) = &a.craft
            && success
        {
            let c = self
                .defs
                .upbringing
                .crafts
                .iter()
                .find(|c| &c.key == key)
                .cloned()
                .ok_or_else(|| CoreError::Internal("手作配方不存在".into()))?;
            let pieces = self.act_carry(&format!("craft:{}", a.key), 1, scale.permille).max(0);
            for _ in 0..pieces {
                for i in &c.materials {
                    self.take_item(OwnerId::Player, &i.item, i.qty);
                    *result.items.entry(i.item.clone()).or_default() -= i.qty;
                }
                self.grant_item(OwnerId::Player, &c.output.item, c.output.qty).map_err(internal)?;
                *result.items.entry(c.output.item.clone()).or_default() += c.output.qty;
            }
        }
        if let Some(base) = a.counts_as.as_ref().filter(|b| *b != &a.key) {
            let times = self.act_carry(&format!("count:{base}"), 1, scale.permille).max(0) as u32;
            if let Some(s) = &mut self.state.upbringing {
                let count = s.activity_counts.entry(base.clone()).or_default();
                *count = count.saturating_add(times);
            }
        }
        if a.kind == ActivityKind::Club
            && let Some(academy) = self.upbringing_academy()
        {
            events.extend(
                academy
                    .clubs
                    .iter()
                    .filter(|c| {
                        a.club.as_ref() == Some(&c.key)
                            || c.practice.iter().any(|k| k == &a.key || a.counts_as.as_ref() == Some(k))
                    })
                    .flat_map(|c| c.events.iter().cloned()),
            );
        }
        Ok(events)
    }
}
