//! U04 工作包 3（A11）：心情与疲劳的张力。
//!
//! - 每月月初心情向 `center` 回归 `monthly_step`（不越过中心）；心情已不低于 `high` 时改回归 `high_step`，
//!   兴致高涨要靠一直排开心的事来维持。
//! - 心情不低于 `high` 时活动收益 +`high_bonus_pct`%（比赛的心情加分照旧看 `contest_mood`）。
//! - 心情跌到 `low` 及以下时，每段低谷触发一次 `low_events`（闹脾气一类的事件），回到 `low` 以上再跌才再触发。
//! - 休息类活动只回疲劳和至多 `rest_mood_max` 点心情；每旬结算后疲劳自然恢复 `fatigue_recovery`。
//!
//! 规则没写（`rules.mood` 为空）的世界一律照旧，经典与测试世界逐字节不变。
use super::*;
use crate::World;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MoodRules {
    /// 回归的中心，也是开局心情。
    pub center: i64,
    /// 每月月初向中心回归的点数。
    pub monthly_step: i64,
    /// 心情不低于 `high` 时，月初回归改用的点数。
    pub high_step: i64,
    /// “兴致高”的门槛与它带来的活动收益加成（百分点）。
    pub high: i64,
    pub high_bonus_pct: i64,
    /// “闹脾气”的门槛与触发的事件（可用 `前缀*`）。
    pub low: i64,
    pub low_events: Vec<String>,
    /// 休息类活动至多回的心情。
    pub rest_mood_max: i64,
    /// 每旬结算后疲劳自然恢复的点数。
    pub fatigue_recovery: i64,
}
impl Default for MoodRules {
    fn default() -> Self {
        Self {
            center: 50,
            monthly_step: 10,
            high_step: 20,
            high: 80,
            high_bonus_pct: 10,
            low: 20,
            low_events: Vec::new(),
            rest_mood_max: 2,
            fatigue_recovery: 5,
        }
    }
}

impl World {
    pub fn upbringing_mood_rules(&self) -> Option<&MoodRules> {
        self.defs.upbringing.rules.mood.as_ref()
    }

    /// 心情带来的活动效率（百分比）。没有心情规则时沿用旧规则：低于 −30 打八折、不低于 40 加一成。
    pub fn upbringing_mood_pct(&self, mood: i64) -> i64 {
        match self.upbringing_mood_rules() {
            Some(r) if mood >= r.high => 100 + r.high_bonus_pct,
            _ if mood < -30 => 80,
            Some(_) => 100,
            None if mood >= 40 => 110,
            None => 100,
        }
    }

    /// 活动实际带来的心情：休息类封顶在 `rest_mood_max`；其余照数据。视图与结算共用。
    pub fn upbringing_activity_mood(&self, a: &ActivityDef) -> i64 {
        match self.upbringing_mood_rules() {
            Some(r) if a.kind == ActivityKind::Rest => a.mood.min(r.rest_mood_max),
            _ => a.mood,
        }
    }

    /// 月初的心情回归；在 `new_upbringing_day` 换月时调用。跳过养成时不动。
    pub(crate) fn settle_upbringing_mood_month(&mut self) {
        let Some(r) = self.defs.upbringing.rules.mood.clone() else { return };
        let Some(s) = &mut self.state.upbringing else { return };
        if s.skipping || s.phase == Phase::Done {
            return;
        }
        let step = if s.mood >= r.high { r.high_step } else { r.monthly_step };
        s.mood += (r.center - s.mood).clamp(-step, step);
    }

    /// 周首回归量是月量的四分之一，余数复用周程进位。
    pub(crate) fn settle_upbringing_mood_week(&mut self) {
        let Some(r) = self.defs.upbringing.rules.mood.clone() else { return };
        let Some(s) = &self.state.upbringing else { return };
        if s.skipping || s.phase == Phase::Done {
            return;
        }
        let amount = if s.mood >= r.high { r.high_step } else { r.monthly_step };
        let step = self.upbringing_carry("mood_return", amount, 2);
        if let Some(s) = &mut self.state.upbringing {
            s.mood += (r.center - s.mood).clamp(-step, step);
        }
    }
    /// 一旬结算之后：疲劳自然恢复（计入本旬结果），并检查是否进入新的心情低谷；返回要排进事件队列的模式。
    pub(crate) fn settle_upbringing_mood_slot(&mut self, result: &mut SlotResult) -> Vec<String> {
        let Some(r) = self.defs.upbringing.rules.mood.clone() else { return Vec::new() };
        let Some(s) = &mut self.state.upbringing else { return Vec::new() };
        let recovered = s.fatigue.clamp(0, r.fatigue_recovery.max(0));
        s.fatigue -= recovered;
        s.stamina = (100 - s.fatigue).clamp(0, 100);
        result.fatigue -= recovered;
        if s.mood > r.low {
            s.low_mood = false;
            return Vec::new();
        }
        if s.low_mood {
            return Vec::new();
        }
        s.low_mood = true;
        r.low_events
    }

    /// 按周（U05）一格结算之后：只检查是否进入新的心情低谷（自然恢复改在每周末做一次，见 `weekly`）。
    pub(crate) fn settle_upbringing_low_mood(&mut self) -> Vec<String> {
        let Some(r) = self.defs.upbringing.rules.mood.clone() else { return Vec::new() };
        let Some(s) = &mut self.state.upbringing else { return Vec::new() };
        if s.mood > r.low {
            s.low_mood = false;
            return Vec::new();
        }
        if s.low_mood {
            return Vec::new();
        }
        s.low_mood = true;
        r.low_events
    }

    /// 处在心情低谷里、且是低谷事件：事件排序时当作今天截止的限时事件，排在本旬最前。
    pub(crate) fn upbringing_low_mood_event(&self, key: &str) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| s.low_mood)
            && self
                .upbringing_mood_rules()
                .is_some_and(|r| r.low_events.iter().any(|p| super::activity_validation::event_matches(p, key)))
    }
}

pub(super) fn validate(defs: &crate::StaticData) -> Vec<String> {
    let Some(r) = &defs.upbringing.rules.mood else { return Vec::new() };
    let mut errors = Vec::new();
    if !(-100..=100).contains(&r.center)
        || !(0..=100).contains(&r.monthly_step)
        || !(0..=100).contains(&r.high_step)
        || !(-100..=100).contains(&r.high)
        || !(-100..=100).contains(&r.low)
        || r.low >= r.center
        || r.center >= r.high
        || !(0..=100).contains(&r.high_bonus_pct)
        || !(0..=100).contains(&r.rest_mood_max)
        || !(0..=100).contains(&r.fatigue_recovery)
    {
        errors.push("心情规则数值越界：须 −100 ≤ low < center < high ≤ 100，回归、加成、休息与疲劳恢复在 0–100".into());
    }
    for p in &r.low_events {
        if p.is_empty()
            || p.strip_suffix('*').unwrap_or(p).contains('*')
            || !defs.story2.tracks.iter().any(|t| super::activity_validation::event_matches(p, &t.key))
        {
            errors.push(format!("心情低谷事件 {p} 没有对应的故事轨道"));
        }
    }
    errors
}
