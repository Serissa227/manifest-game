//! 活动的封闭数值、门槛与打工阶段定义；区间同时接受固定整数。
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum AmountRange {
    Fixed(i64),
    Range([i64; 2]),
}
impl Default for AmountRange {
    fn default() -> Self {
        Self::Fixed(0)
    }
}
impl AmountRange {
    pub fn bounds(&self) -> [i64; 2] {
        match self {
            Self::Fixed(v) => [*v, *v],
            Self::Range(r) => *r,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActivityWhere {
    pub at: Option<String>,
    pub feature: Option<String>,
    pub culture: Option<String>,
    pub academy: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Unlock {
    pub attrs: BTreeMap<String, i64>,
    pub flag: Option<String>,
    pub year: Option<u32>,
    pub growth: BTreeMap<String, i64>,
    pub rating: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Need {
    Place,
    Companion,
    Book,
    Excursion,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivitySkill {
    pub skill: String,
    pub xp: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobTier {
    pub group: String,
    pub level: u8,
    pub name: String,
    pub after: u32,
    pub next: u32,
    #[serde(default)]
    pub branch: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActivityRisk {
    pub failure_bp: i64,
    pub min_bp: i64,
    pub max_bp: Option<i64>,
    pub attr: Option<String>,
    pub per: i64,
    pub success_events: Vec<String>,
    pub failure_events: Vec<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActivityFailure {
    pub income_pct: i64,
    pub gains_pct: i64,
    pub extra_fatigue: i64,
    pub mood: i64,
    pub events: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UpbringingRules {
    pub illness_events: Vec<String>,
    pub contest_mood: Vec<MoodBonus>,
    pub annual_growth_cap: i64,
    /// U02 工作包 4：每年每项成长上限按年龄递增，`[起始年龄, 上限]` 按年龄升序；空表时用 `annual_growth_cap`。
    pub annual_growth_cap_by_age: Vec<[i64; 2]>,
    /// U02 工作包 4：考期长度（天）。大于 0 时考试（含补考）只能在 `dates` 的某个考期内参加；0 保持旧规则。
    pub exam_session_days: u32,
    /// U02 工作包 4：考期提前几天在日历上倒计时。
    pub exam_notice_days: u32,
    pub mentor_bonus_pct: i64,
    pub illness_fatigue: i64,
    pub illness_bp: i64,
    pub illness_days: u32,
    pub growth_table: Vec<GrowthBand>,
    /// 家乡期开始满这么多天，引擎发放远足许可 `outing_permission`；0 表示不发放（U03 / A3）。
    pub outing_permission_days: u32,
    /// 自动安排的偏重预设所看的属性（按评价映射）；没写的预设只按活动标签偏重。
    pub auto_presets: BTreeMap<String, Vec<String>>,
    /// U02：十二岁的年龄基线，按属性组给的开局点（资质、本领每点一档，品行每点十）；
    /// 运气由生日决定、秘术须觉醒，都不吃基线。缺省为空，旧世界照旧从一档起步。
    pub age_baseline: BTreeMap<String, i64>,
    /// U02：中位成长曲线与门槛生成的参数（只供审计与生成工具读，运行时不用）。
    pub curve: GrowthCurveRules,
    /// U04 工作包 3：心情回归、兴致加成、低谷事件、休息与疲劳恢复；缺省为空，旧世界照旧。
    pub mood: Option<super::MoodRules>,
}

/// U02 工作包 2：中位成长曲线与门槛生成参数（`manifest_sim::upbringing_curve` 读取）。
/// 百分比一律为整数百分点；运行时不读，改了只影响审计与重新生成的门槛。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GrowthCurveRules {
    /// 家乡期每月可排的格数（每旬一格）。
    pub home_slots: i64,
    /// 学院期每月的课业格数。
    pub academy_lesson_slots: i64,
    /// 学院期每月的课后格数。
    pub academy_after_slots: i64,
    /// “均衡”安排同时照顾的练习目标数：某项每月成长 = 格数 × 相关活动的平均收益 ÷ 该数。
    pub focus: i64,
    /// 事件链首、链尾的门槛系数（相对当日中位预期）。
    pub chain_head_pct: i64,
    pub chain_tail_pct: i64,
    /// “够一够”的门槛系数与每家每年的条数。
    pub stretch_pct: i64,
    pub stretch_per_year: usize,
    /// 按键哈希的确定性抖动幅度（±百分点）。
    pub jitter_pct: i64,
    /// 开局头几个月的门槛再乘的系数。
    pub opening_months: i64,
    pub opening_pct: i64,
    /// 没有日期、整个养成期随机出现的日常池与节庆池，按这一天的中位预期定门槛。
    pub pool_date: [u32; 3],
}
impl Default for GrowthCurveRules {
    fn default() -> Self {
        Self {
            home_slots: 3,
            academy_lesson_slots: 3,
            academy_after_slots: 3,
            focus: 8,
            chain_head_pct: 80,
            chain_tail_pct: 100,
            stretch_pct: 120,
            stretch_per_year: 2,
            jitter_pct: 10,
            opening_months: 2,
            opening_pct: 60,
            pool_date: [1555, 1, 1],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodBonus {
    pub min: i64,
    pub value: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrowthBand {
    pub from: i64,
    pub to: i64,
    pub value: i64,
}
impl Default for UpbringingRules {
    fn default() -> Self {
        Self {
            illness_events: Vec::new(),
            contest_mood: Vec::new(),
            annual_growth_cap: 300,
            annual_growth_cap_by_age: Vec::new(),
            exam_session_days: 0,
            exam_notice_days: 120,
            mentor_bonus_pct: 10,
            illness_fatigue: 90,
            illness_bp: 1500,
            illness_days: 10,
            growth_table: (0..10)
                .map(|i| GrowthBand { from: i * 100, to: if i == 9 { 1000 } else { i * 100 + 99 }, value: i + 1 })
                .collect(),
            outing_permission_days: 0,
            auto_presets: BTreeMap::new(),
            age_baseline: BTreeMap::new(),
            curve: GrowthCurveRules::default(),
            mood: None,
        }
    }
}
