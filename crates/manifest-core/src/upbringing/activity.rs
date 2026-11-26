//! 一旬的费用、检定和收益共用确定性随机域；收入只支付钱袋中的现款。
use super::*;
use crate::{
    CommandError, CoreError, LocId, OwnerId, World,
    ledger::{Account, CashClass, JournalEntry, Memo},
    rng::{Domain, Rng},
    treasury::Flow,
};
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}
#[cfg(test)]
mod tests;
impl World {
    pub fn upbringing_location(&self) -> Option<LocId> {
        self.cast_player_place().map(|p| p.loc)
    }
    pub fn upbringing_unlock(&self, u: &Unlock, date: WorldDate) -> bool {
        u.flag.as_ref().is_none_or(|f| self.upbringing_flag(f))
            && u.year.is_none_or(|year| {
                self.upbringing_stage_on(date).is_some_and(|s| date[0].saturating_sub(s.from[0]) + 1 >= year)
            })
            && u.attrs.iter().all(|(a, v)| self.upbringing_projected(a) >= *v)
            && u.growth.iter().all(|(a, v)| self.upbringing_growth(a) >= *v)
            && u.rating.iter().all(|(a, v)| self.upbringing_rating(a) >= *v)
            && u.skills.iter().all(|(a, v)| self.upbringing_skill_xp(a) >= *v)
    }
    pub fn upbringing_activity_available(&self, a: &ActivityDef, date: WorldDate) -> Result<(), CommandError> {
        let stage = self.upbringing_stage_on(date).ok_or_else(|| blocked("没有适用的养成阶段"))?;
        if !a.stage.allows(stage.stage) {
            return Err(blocked("活动不适用于当前阶段"));
        }
        let age =
            self.state.protagonist.as_ref().and_then(|p| p.age_on(date)).ok_or_else(|| blocked("主角年龄未确定"))?;
        if a.age.is_some_and(|range| age < range[0] || age > range[1]) {
            return Err(blocked("不符合活动的年龄要求"));
        }
        if !self.upbringing_unlock(&a.unlock, date) {
            return Err(blocked("尚未满足活动门槛"));
        }
        if let Some(tier) = &a.tier {
            let progress = self.upbringing_job_progress(&tier.group);
            if progress < tier.after {
                return Err(blocked("还没有积累足够的打工经历"));
            }
            if let Some(branch) = &tier.branch
                && self.defs.upbringing.activities.iter().filter_map(|a| a.tier.as_ref()).any(|other| {
                    other.group == tier.group
                        && other.branch.as_ref().is_some_and(|b| b != branch && self.upbringing_flag(b))
                })
            {
                return Err(blocked("已经选择了这份工作的另一条职业分支"));
            }
        }
        let loc = self
            .upbringing_location()
            .and_then(|l| self.defs.locations.get(l.idx()))
            .ok_or_else(|| blocked("没有可用的活动地点"))?;
        if a.place.at.as_ref().is_some_and(|v| v != &loc.key)
            || a.place.culture.as_ref().is_some_and(|v| !self.upbringing_culture_matches(v, &loc.culture))
            || a.place.academy.as_ref().is_some_and(|v| stage.academy.as_ref() != Some(v))
        {
            return Err(blocked("此处不提供这项活动"));
        }
        if a.kind == ActivityKind::Voyage && !loc.is_port() {
            return Err(blocked("实习航行需要港口"));
        }
        if a.place.feature.as_deref().is_some_and(|f| !match f {
            "dock" => loc.is_port(),
            "shipyard" => !loc.shipyard.is_empty(),
            "market" => !loc.market.is_empty(),
            "shop" => loc.shop,
            "school" => self.upbringing_places().iter().any(|p| p.venue == "classroom"),
            "library" => self.upbringing_places().iter().any(|p| p.venue == "library"),
            "lodging" => self.upbringing_places().iter().any(|p| ["home", "dorm"].contains(&p.venue.as_str())),
            "settlement" => !loc.market.is_empty() || loc.is_port(),
            "workplace" => {
                self.upbringing_places().iter().any(|p| ["market", "dock", "workshop"].contains(&p.venue.as_str()))
            }
            "workshop" => self.upbringing_places().iter().any(|p| p.venue == "workshop") || !loc.shipyard.is_empty(),
            _ => false,
        }) {
            return Err(blocked("当地缺少所需设施"));
        }
        let cash = self.state.agents.get(&OwnerId::Player).map_or(0, |p| p.cash);
        // 按周时一格只收“费用 × 格重”（向上取整作上界）；按旬时就是整笔费用。
        let cost = self.upbringing_slot_cost(a, date);
        if cash < cost {
            return Err(CommandError::InsufficientCash { need: cost, have: cash });
        }
        self.check_native_activity(a)
    }
    pub fn check_upbringing_choice(
        &self,
        a: &ActivityDef,
        choice: Option<&AfterChoice>,
        date: WorldDate,
    ) -> Result<(), CommandError> {
        self.upbringing_activity_available(a, date)?;
        for need in &a.needs {
            let supplied = match need {
                Need::Place => choice.and_then(|c| c.place.as_deref()).is_some(),
                Need::Companion => choice.and_then(|c| c.companion.as_deref()).is_some(),
                Need::Book => choice.and_then(|c| c.book.as_deref()).is_some(),
                Need::Excursion => choice.is_some_and(|c| c.excursion.is_some() && c.node.is_some()),
            };
            if !supplied {
                return Err(blocked("活动缺少地点、同行者、书目或远足选择"));
            }
        }
        if let Some(c) = choice {
            self.check_local_choice(a, c, date)?;
            if let Some(book) = &c.book {
                if !a.needs.contains(&Need::Book) {
                    return Err(blocked("这项活动不选择书目"));
                }
                self.choose_reading(OwnerId::Player, book, None)?;
            }
        }
        Ok(())
    }
    pub fn upbringing_efficiency(&self, a: &ActivityDef) -> i64 {
        let Some(s) = &self.state.upbringing else {
            return 100;
        };
        let fatigue = if s.fatigue >= 80 {
            60
        } else if s.fatigue >= 60 {
            80
        } else {
            100
        };
        let mood = self.upbringing_mood_pct(s.mood);
        let illness = if s.ill_until.is_some_and(|d| self.day() < d) { 50 } else { 100 };
        let mentor = if self
            .upbringing_mentor(a)
            .is_some_and(|p| self.person_place(p).is_some_and(|p| Some(p.loc) == self.upbringing_location()))
        {
            100 + self.defs.upbringing.rules.mentor_bonus_pct
        } else {
            100
        };
        let base = fatigue * mood / 100 * illness / 100 * mentor / 100;
        // U05：装备、技能、称号的“活动收益”（`activity_pct`）加在成长效率上；没有这类效果时原样返回。
        match self.upbringing_activity_bonus_bp(a) {
            0 => base,
            bonus => base * (10_000 + bonus) / 10_000,
        }
    }
    /// 这项活动吃到的“活动收益”效果（基点）：效果限定了活动的，按活动自己的 key 或它 `counts_as` 的那一项匹配，取较大的。
    pub fn upbringing_activity_bonus_bp(&self, a: &ActivityDef) -> i64 {
        self.upbringing_activity_hook(a, crate::captain::AttrHook::Activity)
    }
    /// 这项活动吃到的“疲劳减免”效果（基点）：只减活动带来的疲劳增量，不影响休息回的疲劳。
    pub fn upbringing_fatigue_relief_bp(&self, a: &ActivityDef) -> i64 {
        self.upbringing_activity_hook(a, crate::captain::AttrHook::Fatigue).clamp(0, 10_000)
    }
    fn upbringing_activity_hook(&self, a: &ActivityDef, hook: crate::captain::AttrHook) -> i64 {
        if !self.defs.items.enabled() && !self.skill_effects_enabled() {
            return 0;
        }
        let of = |key: &str| {
            let context = crate::items::effects::EffectContext { activity: Some(key), ..Default::default() };
            self.item_hook(OwnerId::Player, "captain", hook, &context)
        };
        let own = of(&a.key);
        a.counts_as.as_deref().filter(|base| *base != a.key).map_or(own, |base| own.max(of(base)))
    }
    pub fn upbringing_risk(&self, a: &ActivityDef) -> i64 {
        a.risk.as_ref().map_or(0, |r| {
            r.failure_bp
                .saturating_sub(r.attr.as_deref().map_or(0, |a| self.upbringing_projected(a)).saturating_mul(r.per))
                .clamp(r.min_bp, r.max_bp.unwrap_or(10_000))
        })
    }
    pub fn upbringing_gain_range(&self, a: &ActivityDef, key: &str) -> [i64; 2] {
        let Some(range) = a.gains.get(key) else {
            return [0, 0];
        };
        let efficiency = self.upbringing_efficiency(a);
        let year = self.cast_date()[0];
        let used = self
            .state
            .upbringing
            .as_ref()
            .filter(|s| s.growth_year == year)
            .and_then(|s| s.year_growth.get(key))
            .copied()
            .unwrap_or(0);
        let conduct = self
            .defs
            .captain
            .attribute_index(key)
            .and_then(|i| self.defs.captain.group(i))
            .is_some_and(|g| g.key == "conduct");
        if key == "fortune" || (key == "arcana" && !self.upbringing_flag(super::ARCANA_AWAKENED_FLAG)) {
            return [0, 0];
        }
        let value = self.upbringing_growth(key);
        let apply = |v: i64, pct: i64| {
            let gain = v.saturating_mul(efficiency) / 100 * pct / 100;
            let gain = if gain > 0 { gain.min((self.upbringing_annual_cap() - used).max(0)) } else { gain };
            value.saturating_add(gain).clamp(0, if conduct { 100 } else { 1000 }) - value
        };
        let success = [apply(range[0], 100), apply(range[1], 100)];
        let failed = [apply(range[0], a.failure.gains_pct), apply(range[1], a.failure.gains_pct)];
        match self.upbringing_risk(a) {
            0 => success,
            10_000 => failed,
            _ => [success[0].min(failed[0]), success[1].max(failed[1])],
        }
    }
    pub(crate) fn upbringing_rng(&self, key: &str, index: u8, column: u8) -> Rng {
        let hash = blake3::hash(key.as_bytes());
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        Rng::derive(
            self.state.seed,
            self.day(),
            Domain::Upbringing,
            u64::from_le_bytes(bytes),
            u64::from(index) * 256 + u64::from(column),
        )
    }
    /// 按旬结算一项活动（整格）。
    pub(crate) fn settle_upbringing_activity(
        &mut self,
        a: &ActivityDef,
        index: u8,
        column: u8,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        self.settle_upbringing_activity_weighted(a, index, column, weekly::UNIT, result)
    }
    /// 结算一项活动。`weight` 是格重（八分之几个标准格）：费用、收入、成长、经验、疲劳、心情、次数都乘格重，
    /// 余数各自进位（[`World::upbringing_carry`]）；整格（8）时与按旬的旧算法逐位相同。
    pub(crate) fn settle_upbringing_activity_weighted(
        &mut self,
        a: &ActivityDef,
        index: u8,
        column: u8,
        weight: i64,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        if let Err(e) = self.upbringing_activity_available(a, self.cast_date()) {
            result.success = Some(false);
            result.line = Some(e.to_string());
            return Ok(Vec::new());
        }
        let loc = self.upbringing_location().ok_or_else(|| CoreError::Internal("养成活动缺少地点".into()))?;
        let cost = self.upbringing_activity_cost(a);
        let cost = self.upbringing_carry("cost", cost, weight);
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
        let success = !rng.chance_bp(self.upbringing_risk(a));
        result.success = Some(result.success.unwrap_or(true) && success);
        let mut events = a.events.clone();
        if let Some(risk) = &a.risk {
            events.extend(if success { &risk.success_events } else { &risk.failure_events }.iter().cloned());
        }
        if !success {
            events.extend(a.failure.events.iter().cloned());
        }
        {
            let [lo, hi] = a.income.bounds();
            let promised = rng.range(lo, hi) * if success { 100 } else { a.failure.income_pct } / 100;
            let promised = self.upbringing_carry("income", promised, weight);
            let income = if self.circulation_on() {
                promised.min(self.purse(loc).map_or(0, |p| p.money).max(0))
            } else {
                promised
            };
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
                let amount = self.upbringing_carry(&format!("growth:{key}"), amount, weight);
                let gained = self.gain_upbringing_growth(key, amount);
                *result.growth.entry(key.clone()).or_default() += gained;
            }
            for skill in a.skills.iter().filter(|s| success && s.xp > 0) {
                let gained = self.upbringing_carry(&format!("skill:{}", skill.skill), skill.xp, weight);
                let inv = self.state.items.owners.entry(OwnerId::Player).or_default();
                let xp = inv.skill_xp.entry(skill.skill.clone()).or_default();
                *xp = xp.saturating_add(gained);
                *result.skills.entry(skill.skill.clone()).or_default() += gained;
            }
            for (item, qty) in a.items.iter().filter(|_| success) {
                let qty = self.upbringing_carry(&format!("item:{}:{item}", a.key), *qty, weight);
                if weight < weekly::UNIT && qty == 0 {
                    // 按周：攒满一件才发。
                    continue;
                }
                self.grant_item(OwnerId::Player, item, qty).map_err(|e| CoreError::Internal(e.to_string()))?;
                *result.items.entry(item.clone()).or_default() += qty;
            }
            if let Some(tier) = &a.tier {
                let progress = self.upbringing_job_progress(&tier.group);
                let step = self.upbringing_carry(&format!("job:{}", tier.group), 1, weight).max(0) as u32;
                if let Some(s) = &mut self.state.upbringing {
                    let n = s.job_progress.entry(tier.group.clone()).or_default();
                    *n = progress.saturating_add(step);
                }
                if let Some(branch) = &tier.branch
                    && let Some(s) = &mut self.state.upbringing
                {
                    s.flags.insert(branch.clone());
                }
            }
        }
        let day = self.day();
        let mood = self.upbringing_activity_mood(a);
        // 疲劳：活动带来的增量先吃“疲劳减免”（`fatigue_pct`），再乘格重进位；休息回的疲劳（负数）不减。
        let relief = self.upbringing_fatigue_relief_bp(a);
        let relieved = |v: i64| if v > 0 && relief > 0 { v * (10_000 - relief) / 10_000 } else { v };
        let fatigue = a.fatigue + if success { 0 } else { a.failure.extra_fatigue };
        let fatigue = if weight >= weekly::UNIT {
            relieved(fatigue)
        } else {
            // 按周：在八分之一的刻度上减免，小数不白白丢掉。
            self.upbringing_carry_eighths("fatigue", relieved(fatigue * weight))
        };
        let mood = self.upbringing_carry("mood", mood + if success { 0 } else { a.failure.mood }, weight);
        let times = self.upbringing_carry(&format!("count:{}", a.key), 1, weight).max(0) as u32;
        if let Some(s) = &mut self.state.upbringing {
            let before = (s.fatigue, s.mood);
            s.fatigue = (s.fatigue + fatigue).clamp(0, 100);
            s.mood = (s.mood + mood).clamp(-100, 100);
            s.stamina = (100 - s.fatigue).clamp(0, 100);
            result.fatigue += s.fatigue - before.0;
            result.mood += s.mood - before.1;
            let count = s.activity_counts.entry(a.key.clone()).or_default();
            *count = count.saturating_add(times);
            let rules = &self.defs.upbringing.rules;
            // 生病的机会按格重折算：一个月里掷的次数多了，总的机会不变。
            let illness_bp =
                if weight >= weekly::UNIT { rules.illness_bp } else { rules.illness_bp * weight / weekly::UNIT };
            if s.fatigue >= rules.illness_fatigue && rng.chance_bp(illness_bp) {
                s.ill_until = Some(day.saturating_add(rules.illness_days));
                events.extend(rules.illness_events.iter().cloned());
            }
        }
        self.settle_native_activity(a, success, weight, result)?;
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
