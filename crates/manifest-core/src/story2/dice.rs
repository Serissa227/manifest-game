//! U02：选项 `requires` 里的属性、成长、技能门槛改成掷骰（世界规则 `[story] soft_requires` 打开时）。
//!
//! - 达到门槛必定成功，不掷骰；差得越多成功率越低，最低 5%。属性（含评价、品行、成长）与技能各一条曲线。
//! - 选项本身另有 `check` 时两者相乘，再夹在 5–95%；一个选项有几项门槛没达到时取最低的那项。
//! - 旗标、物品、关系、年龄、日期、金钱、主角限定、恋爱开放等条件不受影响，仍然锁住；
//!   数值门槛在数据里标 `hard = true` 的也照旧锁住（例如读一本书得会那门语言）。
//! - 掷骰用世界的确定性随机数，与原 `check` 共用同一个骰子：门槛都满足时，原检定的成败一点不变。
use super::{Choice, Condition, Pending};
use crate::{
    OwnerId, World,
    rng::{Domain, Rng},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 成功率的下限与上限（百分比）。
pub const CHANCE_FLOOR: i64 = 5;
pub const CHANCE_CEIL: i64 = 95;

/// 世界规则 `rules.toml` 的 `[story]` 段；缺省全关，经典世界与测试世界不受影响。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StoryRules {
    /// 总开关：打开后选项的数值门槛改成掷骰。
    pub soft_requires: bool,
    /// 属性、评价、品行与成长门槛的成功率曲线：`[差距占门槛的百分比, 成功率%]`，按差距递增。
    pub attr_curve: Vec<[i64; 2]>,
    /// 技能经验门槛的成功率曲线，格式同上。
    pub skill_curve: Vec<[i64; 2]>,
    /// 没有 `fail` 分支时的通用失败：养成期加的疲劳（0–100 刻度）。
    pub fail_fatigue: i64,
    /// 通用失败：养成期心情的变化（−100–100 刻度，通常为负）。
    pub fail_mood: i64,
    /// 通用失败的回应语句池，键见 [`World::story2_fail_pool`]；空串表示还没写。
    pub fail_lines: BTreeMap<String, Vec<String>>,
    /// 池子里没有可用语句时的通用语；空串表示还没写。
    pub fail_line: String,
}

impl Default for StoryRules {
    fn default() -> Self {
        Self {
            soft_requires: false,
            attr_curve: vec![[0, 80], [25, 45], [50, 10], [100, 5]],
            skill_curve: vec![[0, 75], [25, 40], [50, 8], [100, 5]],
            fail_fatigue: 3,
            fail_mood: -2,
            fail_lines: BTreeMap::new(),
            fail_line: String::new(),
        }
    }
}

impl StoryRules {
    /// 规则数值的封闭校验；返回问题列表。
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (name, curve) in [("attr_curve", &self.attr_curve), ("skill_curve", &self.skill_curve)] {
            let ok = curve.len() >= 2
                && curve.first().is_some_and(|p| p[0] == 0)
                && curve.last().is_some_and(|p| p[0] == 100)
                && curve.windows(2).all(|w| w[0][0] < w[1][0] && w[0][1] >= w[1][1])
                && curve.iter().all(|p| (CHANCE_FLOOR..=CHANCE_CEIL).contains(&p[1]));
            if !ok {
                out.push(format!(
                    "story.{name} 须从差距 0 到 100 严格递增、成功率单调不增且都在 {CHANCE_FLOOR}–{CHANCE_CEIL} 之间"
                ));
            }
        }
        if !(0..=20).contains(&self.fail_fatigue) || !(-20..=0).contains(&self.fail_mood) {
            out.push("story.fail_fatigue 须在 0–20、fail_mood 须在 −20–0 之间".into());
        }
        if self
            .fail_lines
            .iter()
            .any(|(k, lines)| !k.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') || lines.len() > 32)
            || self.fail_lines.values().flatten().chain([&self.fail_line]).any(|s| s.chars().count() > 300)
        {
            out.push("story.fail_lines 的键须为小写字母与下划线，每池至多 32 条、每条至多 300 字".into());
        }
        out
    }
}

/// 按差距比例在曲线上取成功率；达到门槛为 100（不掷骰），否则在 5–95 之间。
pub fn curve_chance(curve: &[[i64; 2]], have: i64, need: i64) -> i64 {
    if have >= need {
        return 100;
    }
    let gap = i128::from(need) - i128::from(have);
    // 差距按门槛的万分比计；门槛不是正数时，差一点也算差满。
    let gap_bp = if need > 0 { (gap * 10_000 / i128::from(need)).clamp(0, 10_000) as i64 } else { 10_000 };
    let mut chance = curve.last().map_or(CHANCE_FLOOR, |p| p[1]);
    for w in curve.windows(2) {
        let (x0, c0, x1, c1) = (w[0][0] * 100, w[0][1], w[1][0] * 100, w[1][1]);
        if gap_bp <= x1 && x1 > x0 {
            chance = c0 - (c0 - c1) * (gap_bp - x0).max(0) / (x1 - x0);
            break;
        }
    }
    chance.clamp(CHANCE_FLOOR, CHANCE_CEIL)
}

/// 一项没达到的软门槛。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SoftGap {
    /// 属性、评价或技能的 key
    pub key: String,
    pub have: i64,
    pub need: i64,
    /// 只看这一项时的成功率
    pub chance: i64,
    /// 通用失败语句池的键
    pub pool: String,
}

/// 一次掷骰：成功率与骰点都是 1–100 的百分刻度，骰点不大于成功率为成功。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Roll {
    pub chance: i64,
    pub roll: i64,
    pub success: bool,
    /// 选项的稳定 key
    pub choice: String,
}

/// 没有 `fail` 分支的掷骰失败：留在原节点，记下语句池与抽签数，以及实际扣掉的疲劳与心情。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoftFailure {
    pub pool: String,
    /// 显示层按 `pick % 可用语句数` 取一条；池子以后补写也不改变世界状态。
    pub pick: u32,
    pub fatigue: i64,
    pub mood: i64,
}

/// 本次事件（同一轨道、同一章节、同一次进入）里掷骰失败过的选项。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FailedChoices {
    pub chapter: String,
    pub entered: u32,
    pub choices: BTreeSet<String>,
}

impl Choice {
    /// `requires` 第 `index` 项在掷骰规则下是否不再锁死（只看条件种类与 `hard` 标记，不看开关）。
    pub fn soft_condition(&self, index: usize) -> bool {
        !self.hard.contains(&index)
            && self.requires.get(index).is_some_and(|c| {
                matches!(c, Condition::Attr { .. } | Condition::Growth { .. } | Condition::Skill { .. })
            })
    }
}

impl World {
    fn soft_requires(&self) -> bool {
        self.defs.rules.story.soft_requires
    }

    /// 选项的硬条件（开关关闭时就是全部 `requires`）是否都满足；软门槛留给掷骰。
    pub fn story2_choice_open(&self, choice: &Choice, entered: u32) -> bool {
        let soft = self.soft_requires();
        choice.requires.iter().enumerate().all(|(i, c)| {
            (soft && choice.soft_condition(i)) || self.story2_conditions(std::slice::from_ref(c), entered)
        })
    }

    /// 没达到的软门槛（开关关闭时为空），按 `requires` 的顺序。
    pub fn story2_soft_gaps(&self, choice: &Choice) -> Vec<SoftGap> {
        if !self.soft_requires() {
            return Vec::new();
        }
        let rules = &self.defs.rules.story;
        choice
            .requires
            .iter()
            .enumerate()
            .filter(|(i, _)| choice.soft_condition(*i))
            .filter_map(|(_, c)| {
                let (key, have, need) = self.story2_numeric(c)?;
                let curve = if matches!(c, Condition::Skill { .. }) { &rules.skill_curve } else { &rules.attr_curve };
                (have < need).then(|| SoftGap {
                    key: key.to_owned(),
                    have,
                    need,
                    chance: curve_chance(curve, have, need),
                    pool: self.story2_fail_pool(c),
                })
            })
            .collect()
    }

    /// 选项需要掷骰时的最终成功率（%）；不需要掷骰时为空。
    pub fn story2_choice_chance(&self, choice: &Choice) -> Option<i64> {
        let soft = self.story2_soft_gaps(choice).iter().map(|g| g.chance).min();
        match (&choice.check, soft) {
            (None, None) => None,
            (Some(check), None) => Some(self.story2_check_pct(check)),
            (None, Some(s)) => Some(s.clamp(CHANCE_FLOOR, CHANCE_CEIL)),
            (Some(check), Some(s)) => {
                Some((self.story2_check_pct(check).saturating_mul(s) / 100).clamp(CHANCE_FLOOR, CHANCE_CEIL))
            }
        }
    }

    /// 通用失败语句池的键：属性按属性组（`attr_aptitude` / `attr_craft` / `attr_conduct`），
    /// 评价按评价 key（`rating_naval` 等），技能按技能种类（`skill_language` 等）。
    pub fn story2_fail_pool(&self, c: &Condition) -> String {
        let skill = |key: &str| {
            self.defs.story2.skill_kinds.get(key).map_or_else(|| "skill".to_owned(), |kind| format!("skill_{kind}"))
        };
        match c {
            Condition::Skill { skill: key, .. } => skill(key),
            Condition::Attr { attr, .. } | Condition::Growth { attr, .. } => {
                if let Some(group) = self.defs.captain.attribute_index(attr).and_then(|i| self.defs.captain.group(i)) {
                    format!("attr_{}", group.key)
                } else if self.defs.captain.ratings.iter().any(|r| &r.key == attr) {
                    format!("rating_{attr}")
                } else {
                    skill(attr)
                }
            }
            _ => String::new(),
        }
    }

    /// 本次事件里这个选项是否已经掷骰失败过。
    pub fn story2_choice_failed(&self, track: &str, chapter: &str, entered: u32, choice: &str) -> bool {
        self.state
            .story2
            .failed_choices
            .get(track)
            .is_some_and(|f| f.chapter == chapter && f.entered == entered && f.choices.contains(choice))
    }

    fn story2_dice(&self, p: &Pending, choice: &Choice, salt: u64) -> Rng {
        let hash = blake3::hash(format!("story2:{}:{}:{}", p.track, p.chapter, choice.key).as_bytes());
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        Rng::derive(self.state.seed, p.day, Domain::Story, u64::from_le_bytes(bytes), salt)
    }

    /// 掷一次百面骰。与原检定的 `chance_bp(pct × 100)` 抽的是同一个数，所以满足门槛时成败不变。
    pub(crate) fn story2_roll(&self, p: &Pending, choice: &Choice, chance: i64) -> Roll {
        let draw = self.story2_dice(p, choice, 0x5332).below(10_000) as i64;
        Roll { chance, roll: draw / 100 + 1, success: draw < chance.saturating_mul(100), choice: choice.key.clone() }
    }

    /// 通用失败的语句抽签；与成败骰分开，补写语句不影响成败。
    pub(crate) fn story2_fail_pick(&self, p: &Pending, choice: &Choice) -> u32 {
        (self.story2_dice(p, choice, 0x5333).next_u64() >> 32) as u32
    }

    /// 通用失败的小代价：只在养成期扣疲劳与心情，返回实际变化；养成外没有这两项，什么也不扣。
    pub(crate) fn story2_fail_cost(&mut self) -> (i64, i64) {
        if !self.upbringing_active() {
            return (0, 0);
        }
        let (fatigue, mood) = (self.defs.rules.story.fail_fatigue, self.defs.rules.story.fail_mood);
        let Some(s) = self.state.upbringing.as_mut() else {
            return (0, 0);
        };
        let before = (s.fatigue, s.mood);
        s.fatigue = s.fatigue.saturating_add(fatigue).clamp(0, 100);
        s.mood = s.mood.saturating_add(mood).clamp(-100, 100);
        s.stamina = (100 - s.fatigue).clamp(0, 100);
        (s.fatigue - before.0, s.mood - before.1)
    }

    /// 记下本次事件里失败过的选项；换了章节或重新进入时旧记录作废。
    pub(crate) fn remember_failed_choice(&mut self, p: &Pending, entered: u32, choice: &str) {
        let entry = self.state.story2.failed_choices.entry(p.track.clone()).or_insert_with(|| FailedChoices {
            chapter: p.chapter.clone(),
            entered,
            choices: BTreeSet::new(),
        });
        if entry.chapter != p.chapter || entry.entered != entered {
            *entry = FailedChoices { chapter: p.chapter.clone(), entered, choices: BTreeSet::new() };
        }
        entry.choices.insert(choice.into());
    }

    /// 选项条件里数值门槛的（key, 现值, 门槛）；与 [`World::story2_conditions`] 用同一套取值。
    pub fn story2_numeric<'a>(&self, c: &'a Condition) -> Option<(&'a str, i64, i64)> {
        match c {
            Condition::Attr { attr, ge } => Some((attr, self.story2_check_value(attr), *ge)),
            Condition::Growth { attr, ge } => Some((
                attr,
                if self.upbringing_active() {
                    self.upbringing_growth(attr)
                } else {
                    self.inventory(OwnerId::Player).and_then(|i| i.attr_xp.get(attr)).copied().unwrap_or(0)
                },
                *ge,
            )),
            Condition::Skill { skill, ge } => Some((
                skill,
                self.inventory(OwnerId::Player).and_then(|i| i.skill_xp.get(skill)).copied().unwrap_or(0),
                *ge,
            )),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curves_guarantee_met_thresholds_never_rise_with_the_gap_and_keep_five_percent() {
        let rules = StoryRules::default();
        assert!(rules.problems().is_empty());
        for curve in [&rules.attr_curve, &rules.skill_curve] {
            for need in [1, 2, 4, 10, 60, 100, 240, 1000, i64::MAX] {
                assert_eq!(curve_chance(curve, need, need), 100);
                assert_eq!(curve_chance(curve, need.saturating_add(1), need), 100);
                let mut previous = 100;
                for have in (0..=100).map(|pct| (i128::from(need) * pct / 100) as i64).rev() {
                    let chance = curve_chance(curve, have, need);
                    assert!(chance <= previous, "{have}/{need}");
                    assert!(chance >= CHANCE_FLOOR && (chance <= CHANCE_CEIL || have >= need));
                    previous = chance;
                }
                assert_eq!(curve_chance(curve, 0, need), CHANCE_FLOOR);
                assert_eq!(curve_chance(curve, i64::MIN, need), CHANCE_FLOOR);
            }
        }
        // 举例：门槛 100 时差 1、10、25、40、50、75、100 对应的成功率。
        let attr = [99, 90, 75, 60, 50, 25, 0].map(|have| curve_chance(&rules.attr_curve, have, 100));
        let skill = [99, 90, 75, 60, 50, 25, 0].map(|have| curve_chance(&rules.skill_curve, have, 100));
        assert_eq!(attr, [79, 66, 45, 24, 10, 8, 5]);
        assert_eq!(skill, [74, 61, 40, 21, 8, 7, 5]);
        // 1–10 档的属性：差一档。
        assert_eq!(curve_chance(&rules.attr_curve, 3, 4), 45);
        assert_eq!(curve_chance(&rules.attr_curve, 1, 2), 10);
    }

    #[test]
    fn malformed_rules_are_reported() {
        let mut bad = StoryRules { attr_curve: vec![[0, 80], [50, 90], [100, 5]], ..StoryRules::default() };
        assert_eq!(bad.problems().len(), 1);
        bad.attr_curve = vec![[0, 99], [100, 5]];
        assert_eq!(bad.problems().len(), 1);
        bad.attr_curve = vec![[0, 80], [100, 4]];
        assert_eq!(bad.problems().len(), 1);
        bad = StoryRules { skill_curve: vec![[10, 80], [100, 5]], ..StoryRules::default() };
        assert_eq!(bad.problems().len(), 1);
        bad = StoryRules { fail_fatigue: 50, ..StoryRules::default() };
        assert_eq!(bad.problems().len(), 1);
        bad = StoryRules { fail_lines: [("Bad-Key".to_owned(), vec![])].into(), ..StoryRules::default() };
        assert_eq!(bad.problems().len(), 1);
    }
}
