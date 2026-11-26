//! 名次按固定种子、属性、练习及小游戏分数计算；同一比赛实例只能结算一次。
use super::*;
use crate::{
    CommandError, CoreError, OwnerId, World,
    rng::{Domain, Rng},
};
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}
/// 小游戏一次输入的成绩：原始分（0–100）、结算时加在实力上的分、竞渡的操舵记录。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContestPlay {
    pub game_score: i64,
    pub bonus: i64,
    pub steers: Vec<crate::navigation::Steering>,
}
/// 结算用到的随机数：主角的临场扰动、同分时的先后、各对手（按键排序）的分数与先后。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContestDraws {
    pub jitter: i64,
    pub tiebreak: u64,
    pub rivals: Vec<(String, i64, u64)>,
}
impl World {
    pub fn contest_occurrence(&self, key: &str) -> Option<(&ContestDef, WorldDate)> {
        self.defs
            .upbringing
            .contests
            .iter()
            .find_map(|c| c.dates.iter().copied().find(|d| occurrence_key(&c.key, *d) == key).map(|d| (c, d)))
    }
    pub fn contest_seed(&self, key: &str) -> u64 {
        let hash = blake3::hash(key.as_bytes());
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        // 保留 JS number 的精确整数范围；真实随机仍由内核派生。
        (u64::from_le_bytes(bytes) ^ self.state.seed) % 9_007_199_254_740_992
    }
    fn contest_rng(&self, key: &str) -> Rng {
        Rng::derive(self.contest_seed(key), 0, Domain::Upbringing, 0x434f4e54455354, 0)
    }
    pub fn contest_params(&self, key: &str) -> Result<Params, CommandError> {
        let (c, _) = self.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
        Ok(match &c.params {
            Params::Match(params) => Params::Match(params.shuffled(&mut self.contest_rng(key))),
            Params::Poem(p) => Params::Poem(p.clone()),
            Params::Rhythm(p) => Params::Rhythm(p.clone()),
            Params::Debate(p) => Params::Debate(p.clone()),
            Params::Race(p) => Params::Race(p.clone()),
            Params::Identify(p) => Params::Identify(p.clone()),
        })
    }
    pub fn contest_preparation(&self, c: &ContestDef) -> i64 {
        let counts = self.state.upbringing.as_ref().map(|s| &s.activity_counts);
        let practice = c
            .prep
            .activities
            .iter()
            .map(|a| counts.and_then(|m| m.get(a)).copied().unwrap_or(0))
            .map(i64::from)
            .sum::<i64>();
        let items = c.prep.items.iter().filter(|key| self.item_quantity(OwnerId::Player, key) > 0).count() as i64;
        let helpers = c
            .prep
            .companions
            .iter()
            .filter(|key| {
                self.state.cast.persons.get(*key).is_some_and(|s| s.met)
                    && self.upbringing_companion_present(key, None, self.cast_date())
            })
            .count() as i64;
        (practice.saturating_mul(c.prep.per_practice) + items * c.prep.item_bonus + helpers * c.prep.companion_bonus)
            .clamp(0, c.prep.cap)
    }
    pub fn contest_strength(&self, c: &ContestDef) -> i64 {
        let mood = self.state.upbringing.as_ref().map_or(0, |s| s.mood);
        let bonus = self.defs.upbringing.rules.contest_mood.iter().rev().find(|b| mood >= b.min).map_or(0, |b| b.value);
        (c.check.base + self.upbringing_projected(&c.check.attr) * c.check.coef + self.contest_preparation(c) + bonus)
            .clamp(5, 95)
    }
    pub fn contest_open(&self, c: &ContestDef, date: WorldDate) -> bool {
        let Ok(due) = crate::scenario::day_of(&self.defs, date) else { return false };
        self.upbringing_active()
            && self.day() <= due
            && self.day().saturating_add(c.open_days) >= due
            && self.contest_scheduled(c, date)
            && self.contest_here(c, date)
            && self.contest_weather_allowed(c)
            && self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| !s.contest_results.contains_key(&occurrence_key(&c.key, date)))
    }
    pub(crate) fn check_contest(&self, owner: OwnerId, key: &str, moves: &Moves) -> Result<ContestPlan, CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let (c, date) = self.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
        if !self.contest_open(c, date) {
            return Err(blocked("比赛尚未开放、地点不符或已经结算"));
        }
        if let Moves::Register { register } = moves {
            if !register || self.contest_registered(key) {
                return Err(blocked("报名无效或已经报名"));
            }
            let mut state = self.state.clone();
            if let Some(s) = &mut state.upbringing {
                s.contest_registrations.insert(key.into());
            }
            return Ok(ContestPlan { state });
        }
        let play = self.contest_play(key, moves)?;
        let mut trial = self.clone();
        // 主动提交小游戏也是明确参赛意愿；无输入的自动结算仍必须先报名。
        if c.registration_required
            && let Some(s) = &mut trial.state.upbringing
        {
            s.contest_registrations.insert(key.into());
        }
        trial.settle_contest(key, Some(play.game_score), Some(play.bonus))?;
        if let Some(result) = trial.state.upbringing.as_mut().and_then(|s| s.contest_results.get_mut(key)) {
            result.steers = play.steers;
        }
        Ok(ContestPlan { state: trial.state })
    }
    /// 按这一次输入算小游戏的成绩（与 `PlayContest` 结算同一条路径）。只读：不结算、不改状态；报名（`Moves::Register`）不是小游戏输入，会被拒绝。
    /// 竞渡的失手用比赛实例自己的种子决定，所以结算之前不要把竞渡的 `bonus` 给玩家看（会提前泄露失手与否）。
    pub fn contest_play(&self, key: &str, moves: &Moves) -> Result<ContestPlay, CommandError> {
        let (c, date) = self.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
        let mut steers = Vec::new();
        let mut race_bonus = None;
        let params = self.contest_params(key)?;
        let score = match (params.clone(), moves) {
            (Params::Race(p), Moves::Keys(choices)) => {
                let track = c.scoring.race.as_ref().ok_or_else(|| blocked("竞渡缺少赛道"))?;
                let run = p.run(track, self, self.contest_seed(key), choices)?;
                race_bonus = run.bonus;
                steers = run.steers;
                run.score
            }
            (Params::Match(p), Moves::Pairs(pairs)) => p.score(pairs)?,
            (Params::Poem(p), Moves::Choices(choices)) => p.score(&self.contest_poem_points(c, date), choices)?,
            (Params::Rhythm(p), Moves::Choices(taps)) => p.score(taps)?,
            (Params::Debate(p), Moves::Keys(cards)) => p.score(cards)?,
            (Params::Identify(p), Moves::Keys(answers)) => p.score(&c.scoring.answers, answers)?,
            // 未标记 JSON 的空列表先反序列化成 Pairs，节奏仍接受没有按键的合法零分输入。
            (Params::Rhythm(p), Moves::Pairs(pairs)) if pairs.is_empty() => p.score(&[])?,
            _ => return Err(blocked("小游戏输入形状与比赛种类不符")),
        };
        let bonus =
            self.authored_contest_bonus(c, &params, moves, race_bonus).unwrap_or(score * c.scoring.max_bonus / 100);
        Ok(ContestPlay { game_score: score, bonus, steers })
    }
    /// 结算用的随机数，只由比赛实例的种子决定（结算前后重算都一样）。只能在结算之后拿来讲清楚名次，结算前不要给玩家看。
    /// 对手的分在本场的年龄组区间（`contest_rival_range`，生日以比赛日为准）里取，预估胜算、结算、讲解名次用的都是这一个区间。
    pub fn contest_draws(&self, c: &ContestDef, date: WorldDate, key: &str) -> ContestDraws {
        let mut rng = self.contest_rng(key);
        let jitter = rng.range(-10, 10);
        let tiebreak = rng.below(u64::MAX);
        let [low, high] = self.contest_rival_range(c, date);
        let mut rivals = c.rivals.clone();
        rivals.sort();
        let rivals = rivals
            .into_iter()
            .map(|rival| {
                let score = rng.range(low, high);
                (rival, score, rng.below(u64::MAX))
            })
            .collect();
        ContestDraws { jitter, tiebreak, rivals }
    }
    pub(crate) fn settle_due_contests(&mut self) -> Result<(), CoreError> {
        if !self.upbringing_active() {
            return Ok(());
        }
        let date = self.cast_date();
        let keys = self
            .defs
            .upbringing
            .contests
            .iter()
            .filter(|c| {
                c.dates.contains(&date)
                    && self.contest_open(c, date)
                    && (!c.registration_required || self.contest_registered(&occurrence_key(&c.key, date)))
            })
            .map(|c| occurrence_key(&c.key, date))
            .collect::<Vec<_>>();
        for key in keys {
            let mut trial = self.clone();
            trial.settle_contest(&key, None, None).map_err(|e| CoreError::Internal(e.to_string()))?;
            self.state = trial.state;
        }
        Ok(())
    }
    fn settle_contest(
        &mut self,
        key: &str,
        game_score: Option<i64>,
        authored_bonus: Option<i64>,
    ) -> Result<(), CommandError> {
        let (c, date) = self.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
        if !self.contest_open(c, date) {
            return Err(blocked("比赛不能重复结算"));
        }
        let c = c.clone();
        let day = self.day();
        let draws = self.contest_draws(&c, date, key);
        let score = (self.contest_strength(&c)
            + authored_bonus.unwrap_or(game_score.unwrap_or(0) * c.scoring.max_bonus / 100)
            + draws.jitter)
            .clamp(0, 125);
        let rivals = draws.rivals.iter().map(|(rival, _, _)| rival.clone()).collect::<Vec<_>>();
        let mut ranks = vec![(score, draws.tiebreak, "$captain".to_owned())];
        for (rival, rival_score, tiebreak) in draws.rivals {
            ranks.push((rival_score, tiebreak, rival));
        }
        ranks.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)).then_with(|| a.2.cmp(&b.2)));
        let rank = ranks.iter().position(|r| r.2 == "$captain").ok_or_else(|| blocked("比赛缺少主角"))? as u32 + 1;
        let result = ContestResult {
            contest: c.key.clone(),
            date,
            day,
            rank,
            total: ranks.len() as u32,
            score,
            game_score,
            steers: Vec::new(),
        };
        if let Some(reward) = c.rewards.iter().find(|r| r.rank == rank) {
            for (attr, amount) in &reward.growth {
                self.gain_upbringing_growth(attr, *amount);
            }
            for (item, qty) in &reward.items {
                self.grant_item(OwnerId::Player, item, *qty)?;
            }
            if let Some(s) = &mut self.state.upbringing {
                s.fame = (s.fame + reward.fame).clamp(0, 100);
            }
            if let Some(memory) = &reward.memory {
                self.state.cast.flags.insert(memory.clone());
                self.state.story2.memories.insert(memory.clone(), c.name.clone());
                if let Some(s) = &mut self.state.upbringing {
                    s.flags.insert(memory.clone());
                    s.memory_days.entry(memory.clone()).or_insert(day);
                }
            }
        }
        self.record_deed(crate::story2::deeds::Deed::UbContestWin, u32::from(rank == 1));
        for rival in &rivals {
            self.state.cast.persons.entry(rival.clone()).or_default().met = true;
        }
        if let Some(s) = &mut self.state.upbringing {
            for (_, _, rival) in ranks.iter().skip(rank as usize) {
                let count = s.contest_wins.entry(rival.clone()).or_default();
                *count = count.saturating_add(1);
            }
            s.contest_results.insert(key.into(), result);
            for event in c.events {
                if !s.event_backlog.contains(&event) {
                    s.event_backlog.push(event);
                }
            }
        }
        Ok(())
    }
}
