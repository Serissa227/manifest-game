use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActRules {
    pub enabled: bool,
    pub stages: Vec<String>,
    pub lessons: StageValues,
    pub lesson_days: LessonDays,
    pub points: ActPoints,
    pub bonus: ActBonus,
    pub lesson_permille: i64,
    pub self_study_permille: i64,
    pub job: JobScale,
    pub fatigue: Vec<i64>,
    pub job_fatigue: i64,
    pub self_study_fatigue: i64,
    pub excursion_fatigue: i64,
    pub recover: Recover,
    pub pray: Pray,
    pub talk: Social,
    pub with: Social,
    pub fatigue_stop: i64,
    pub marker: MarkerRules,
    pub templates: u8,
    pub tier_yield: [i64; 4],
    pub side_pct: i64,
    pub skill_pct: i64,
    pub self_study_pct: i64,
    pub efficiency: Efficiency,
    pub mood_factor: MoodFactor,
    pub with_pct: i64,
    pub tier_gate: TierGate,
    pub fee_academy: [i64; 4],
    pub fee_home_pct: i64,
    pub job_income: [i64; 4],
    pub job_promote: [u32; 4],
    pub job_promote_gain: [i64; 4],
    pub result: LessonResultRules,
    pub moment: MomentRules,
    pub illness: IllnessRules,
    pub missions: MissionRules,
    pub ranks: [i64; 4],
    pub rank_points: u8,
    pub reviews: Vec<u32>,
    pub score: ScoreRules,
    pub bands: Bands,
    pub savings: Savings,
    pub capital_value: CapitalValue,
    pub guarantee: Guarantee,
    pub skip_band: String,
    pub ladder: LadderRules,
    pub review: ReviewRules,
    pub rumor: RumorRules,
    pub perk: PerkRules,
    pub voyage: VoyageRules,
}
macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty = $value:expr),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
        #[serde(default, deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
        impl Default for $name { fn default() -> Self { Self { $($field: $value),* } } }
    };
}
record!(StageValues { home: u8 = 5, academy: u8 = 7 });
record!(LessonDays { home: Vec<u8> = vec![1,2,3,4,5], academy: Vec<u8> = vec![1,2,2,3,4,4,5] });
record!(ActPoints { home: u8 = 4, academy: u8 = 5, bonus_max: u8 = 2 });
record!(ActBonus { constitution_level: i64 = 5 });
record!(JobScale { permille: i64 = 100, income_permille: i64 = 250, progress_permille: i64 = 500 });
record!(Recover { weekly: i64 = 10, rest: i64 = 15, pray: i64 = 6 });
record!(Pray { mood: i64 = 4, attr: String = "resolve".into(), growth_permille: i64 = 1500 });
record!(Social { affinity: i64 = 2, mood: i64 = 0 });
record!(MarkerRules { weeks: u32 = 4, missed_cooldown_weeks: u32 = 8, rehang: u8 = 1 });
record!(Efficiency { base: i64 = 70, per_level: i64 = 5 });
record!(MoodFactor { high: i64 = 80, high_pct: i64 = 110, low: i64 = 20, low_pct: i64 = 80 });
record!(TierGate {
    gain_pct: [i64; 4] = [0, 7, 28, 75],
    root: [i64; 4] = [0, 0, 3, 5],
    bond: [i64; 4] = [0, 0, 15, 35],
    rank: [u8; 4] = [0, 0, 0, 2],
    tool: [i64; 4] = [0, 0, 30, 90],
    gift: [i64; 4] = [0, 0, 0, 60]
});
record!(LessonResultRules {
    fail_tired: i64 = 60,
    fail_tired_bp: i64 = 1500,
    fail_pct: i64 = 50,
    great_bp: i64 = 500,
    great_mood_bp: i64 = 500,
    great_with_bp: i64 = 500,
    great_pct: i64 = 160
});
record!(MomentRules {
    chance_pct: i64 = 35,
    pity_weeks: u32 = 4,
    steady_pct: i64 = 110,
    risky_win_pct: i64 = 180,
    risky_lose_pct: i64 = 50,
    risky_fatigue: i64 = 5,
    risky_bond: i64 = 2,
    risky_max_pct: i64 = 90,
    clever_pct: i64 = 50,
    clever_max_pct: i64 = 90,
    clever_cash_per_point: i64 = 4
});
record!(IllnessRules {
    at: i64 = 80,
    base: i64 = 70,
    pct_per_point: i64 = 4,
    weeks: u32 = 2,
    recover: i64 = 20,
    points: u8 = 1
});
record!(MissionRules { merit_done: i64 = 12, merit_fail: i64 = 5, giver_fail_affinity: i64 = 3, due_week: u32 = 3 });
record!(ScoreRules {
    craft: [i64; 5] = [4, 4, 4, 4, 2],
    root: i64 = 3,
    skill_per: i64 = 60,
    rank: [i64; 4] = [0, 10, 25, 45],
    mission: i64 = 2,
    exam_pass: i64 = 15,
    exam_honor: i64 = 10,
    contest: [i64; 3] = [6, 4, 2],
    contest_cap: i64 = 48,
    people_levels: [i64; 4] = [15, 35, 60, 85],
    people: [i64; 4] = [1, 2, 3, 4],
    marker_per: u32 = 2,
    resolved: i64 = 3,
    voyage: i64 = 5,
    duty_milestone: i64 = 2,
    contest_divisor: i64 = 1
});
record!(Bands { bing: i64 = 100, yi: i64 = 220, jia: i64 = 300, te: i64 = 420 });
record!(Savings { keep_pct: i64 = 50, score_per: i64 = 200, score_max: i64 = 15, keep_max: i64 = 1500 });
record!(CapitalValue {
    crew: i64 = 30,
    food: i64 = 3,
    water: i64 = 1,
    ally: i64 = 600,
    mate: i64 = 900,
    tolerance_pct: i64 = 5
});
record!(Guarantee { bands: Vec<String> = vec!["ding".into(),"bing".into()], amount: i64 = 1500, rate_pct: i64 = 50 });
record!(LadderRules { cap_pct_by_tier: [i64; 4] = [100, 100, 150, 150] });
record!(ReviewRules { opening_provision_days: i64 = 10 });
record!(RumorRules { per_listen: u32 = 1, known_after: u8 = 3 });
record!(PerkRules { job_partner_pct: i64 = 30, companion_pct: i64 = 10 });
record!(VoyageRules { task_days: Vec<u8> = vec![1, 3, 5], gate_merit: [i64; 3] = [0, 6, 10], gate_max_pct: i64 = 90 });
impl Default for ActRules {
    fn default() -> Self {
        Self {
            enabled: false,
            stages: vec!["core".into()],
            lessons: StageValues::default(),
            lesson_days: LessonDays::default(),
            points: ActPoints::default(),
            bonus: ActBonus::default(),
            lesson_permille: 100,
            self_study_permille: 50,
            job: JobScale::default(),
            fatigue: vec![15, 20, 30, 40],
            job_fatigue: 30,
            self_study_fatigue: 10,
            excursion_fatigue: 40,
            recover: Recover::default(),
            pray: Pray::default(),
            talk: Social { affinity: 5, mood: 2 },
            with: Social::default(),
            fatigue_stop: 60,
            marker: MarkerRules::default(),
            templates: 3,
            tier_yield: [125, 200, 313, 500],
            side_pct: 25,
            skill_pct: 100,
            self_study_pct: 50,
            efficiency: Efficiency::default(),
            mood_factor: MoodFactor::default(),
            with_pct: 5,
            tier_gate: TierGate::default(),
            fee_academy: [1, 2, 4, 9],
            fee_home_pct: 50,
            job_income: [5, 9, 15, 24],
            job_promote: [0, 8, 20, 40],
            job_promote_gain: [0, 0, 40, 120],
            result: LessonResultRules::default(),
            moment: MomentRules::default(),
            illness: IllnessRules::default(),
            missions: MissionRules::default(),
            ranks: [0, 60, 200, 380],
            rank_points: 1,
            reviews: vec![3, 6, 9, 12],
            score: ScoreRules::default(),
            bands: Bands::default(),
            savings: Savings::default(),
            capital_value: CapitalValue::default(),
            guarantee: Guarantee::default(),
            skip_band: "bing".into(),
            ladder: LadderRules::default(),
            review: ReviewRules::default(),
            rumor: RumorRules::default(),
            perk: PerkRules::default(),
            voyage: VoyageRules::default(),
        }
    }
}
impl ActRules {
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut check = |ok: bool, key: &str| {
            if !ok {
                out.push(format!("upbringing.act.{key} 无效"));
            }
        };
        for (count, days) in
            [(self.lessons.home, &self.lesson_days.home), (self.lessons.academy, &self.lesson_days.academy)]
        {
            check((1..=7).contains(&count) && usize::from(count) == days.len(), "lessons");
            check(
                days.iter().all(|d| (1..=5).contains(d))
                    && days.windows(2).all(|w| w[0] <= w[1])
                    && !(1..=5).any(|d| days.iter().filter(|v| **v == d).count() > 2),
                "lesson_days",
            );
        }
        check(
            (1..=9).contains(&self.points.home) && (1..=9).contains(&self.points.academy) && self.points.bonus_max <= 3,
            "points",
        );
        check(
            [
                self.lesson_permille,
                self.self_study_permille,
                self.job.permille,
                self.job.income_permille,
                self.job.progress_permille,
            ]
            .iter()
            .all(|p| (1..=1000).contains(p)),
            "permille",
        );
        check((0..=5000).contains(&self.pray.growth_permille), "pray");
        check(
            self.fatigue.len() == 4
                && self
                    .fatigue
                    .iter()
                    .chain([&self.job_fatigue, &self.self_study_fatigue, &self.excursion_fatigue])
                    .all(|n| (0..=1000).contains(n) && n % 5 == 0),
            "fatigue",
        );
        check(
            self.stages.iter().any(|s| s == "core")
                && self.stages.iter().all(|s| {
                    ["core", "ladder", "review", "tides", "voyage", "rumors", "family_duty"].contains(&s.as_str())
                })
                && self.stages.iter().collect::<std::collections::BTreeSet<_>>().len() == self.stages.len(),
            "stages",
        );
        check(
            [self.recover.weekly, self.recover.rest, self.recover.pray].iter().all(|v| (0..=100).contains(v))
                && (0..=100).contains(&self.fatigue_stop),
            "recover",
        );
        check(
            (1..=52).contains(&self.marker.weeks)
                && (1..=52).contains(&self.marker.missed_cooldown_weeks)
                && self.marker.rehang <= 10,
            "marker",
        );
        check((1..=3).contains(&self.templates), "templates");
        check(
            (0..=10).contains(&self.bonus.constitution_level)
                && [self.talk.affinity, self.with.affinity].iter().all(|v| (0..=100).contains(v))
                && [self.talk.mood, self.with.mood, self.pray.mood].iter().all(|v| (-100..=100).contains(v)),
            "social",
        );
        // 固定数组由反序列化保证长度；这里只挡除零与日期计算的非法输入。
        check(
            self.score.skill_per > 0
                && self.score.marker_per > 0
                && self.savings.score_per > 0
                && self.score.contest_divisor > 0,
            "score_divisor",
        );
        check((1..=4).contains(&self.missions.due_week), "missions.due_week");
        check(self.rumor.per_listen >= 1 && self.rumor.known_after >= 1, "rumor");
        check(
            !self.voyage.task_days.is_empty()
                && self.voyage.task_days.iter().all(|d| (1..=5).contains(d))
                && self.voyage.task_days.windows(2).all(|w| w[0] <= w[1]),
            "voyage.task_days",
        );
        out
    }
    /// 成长可达检查只放宽；收入与家业不按活动区间折算。
    pub fn monthly_slots_bound(&self) -> i64 {
        let lessons = i64::from(self.lessons.home.max(self.lessons.academy));
        let points = i64::from(self.points.home.max(self.points.academy) + self.points.bonus_max);
        ((4 * (lessons * self.lesson_permille + points * self.job.permille.max(self.self_study_permille)) + 999) / 1000)
            .max(6)
    }
    pub fn ladder_monthly_bound(&self, duty: i64) -> i64 {
        let eff = (self.efficiency.base + self.efficiency.per_level * 9) * self.mood_factor.high_pct / 100
            * (100 + self.with_pct + self.perk.companion_pct)
            / 100;
        let lesson = self.tier_yield[3] * 10 * eff / 100 * self.result.great_pct / 100;
        let lessons = i64::from(self.lessons.home.max(self.lessons.academy));
        let points = i64::from(self.points.home.max(self.points.academy) + self.points.bonus_max);
        let week = (lessons - 1) * lesson
            + lesson * self.moment.risky_win_pct / 100
            + points * self.tier_yield[1] * 10 * eff / 100 * self.self_study_pct / 100
            + duty * 1000
            + self.pray.growth_permille * points;
        (4 * week + 999) / 1000
    }
}
