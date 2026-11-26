//! U04 工作包 4（A12）：活动列表清爽、解锁一步步来。
//!
//! - 这一局永远排不上的活动：用 reach 的静态判定按本家庭的时间轮廓算出“最晚还能开始的日子”
//!   （别家专属、阶段或年龄已过、学院不对、门槛整段养成都到不了的为“永远不行”），再加几条结构检查
//!   （要本地老师的技能本家与本家的学院都没人教、社团不在本家的学院、技能注明不开放或没有传授来源）。不写白名单。
//! - 解锁通知：新活动（有门槛或打工阶段的）、地点、志向、考试开放，或评价升段时记一笔；开局时已开放的只记不报。
use super::*;
use crate::{
    StaticData, World,
    upbringing::reach::{Constraint, Reachability, constraints_of_activity},
};

/// 解锁通知在视图里算“刚刚”的天数。
pub const UNLOCK_NOTICE_DAYS: u32 = 10;

/// 评价分段（与视图的 D/C/B/A/S 一致）。
pub fn rating_rank(value: i64) -> &'static str {
    match value {
        800.. => "S",
        600.. => "A",
        400.. => "B",
        200.. => "C",
        _ => "D",
    }
}

/// 活动在静态判定里的全部约束：活动自身的门槛、年龄、阶段、学院，加上所选技能注明的开放旗标。
pub fn activity_constraints(defs: &StaticData, a: &ActivityDef) -> Vec<Constraint> {
    let mut cs = constraints_of_activity(a);
    if let Some(p) = a.selected_skill.as_ref().and_then(|k| defs.upbringing.skill_profiles.get(k)) {
        cs.extend(p.flags.iter().map(|f| Constraint::Flag { flag: f.clone(), value: true }));
    }
    cs
}

/// 结构上本家庭永远排不上（与日期无关）：技能不开放、要传授却没有传授来源、要本地老师而本家与本家学院都没人教、
/// 社团不在本家的学院。
fn structurally_impossible(defs: &StaticData, f: &FamilyDef, a: &ActivityDef) -> bool {
    let u = &defs.upbringing;
    // 改投路线的学院也算本家的（选了就去得了）。
    let academies: Vec<&AcademyDef> = std::iter::once(f)
        .chain(f.routed.iter().map(|(_, v)| v))
        .flat_map(|f| &f.stages)
        .filter_map(|s| s.academy.as_deref())
        .filter_map(|k| u.academy(k))
        .collect();
    if let Some(skill) = &a.selected_skill {
        let profile = u.skill_profiles.get(skill);
        if profile.is_some_and(|p| p.unavailable) {
            return true;
        }
        if let Some(choice) = &a.skill_choice {
            if choice.require_transmission && profile.is_none_or(|p| p.flags.is_empty()) {
                return true;
            }
            if choice.require_local_teacher {
                let mut people: BTreeSet<&String> = f.mentor_roles.values().chain(f.companions.keys()).collect();
                for ac in &academies {
                    people.extend(ac.mentor_roles.values().chain(ac.companions.keys()));
                    people.extend(ac.curriculum.iter().filter_map(|c| c.mentor.as_ref()));
                }
                let helper =
                    people.iter().any(|p| u.helper_levels.get(*p).and_then(|l| l.get(skill)).is_some_and(|v| *v > 0));
                let course =
                    academies.iter().any(|ac| ac.curriculum.iter().any(|c| c.skills.iter().any(|s| &s.skill == skill)));
                if !helper && !course {
                    return true;
                }
            }
        }
    }
    if let Some(club) = &a.club
        && !academies.iter().any(|ac| ac.clubs.iter().any(|c| &c.key == club))
    {
        return true;
    }
    a.kind == ActivityKind::Club
        && a.club.is_none()
        && !academies.iter().any(|ac| {
            ac.clubs.iter().any(|club| club.practice.iter().any(|k| k == &a.key || a.counts_as.as_ref() == Some(k)))
        })
}

/// 本家庭每个活动“最晚还能开始的日子”：那天之后再等也排不上；`None` 为这一局永远不行。
/// 静态判定对开始日单调（越晚越难），按天二分。只依赖定义，适合按定义缓存。
pub fn activity_deadlines(defs: &StaticData, family: &str) -> BTreeMap<String, Option<u32>> {
    let mut out = BTreeMap::new();
    let Some(f) = defs.upbringing.family(family) else { return out };
    let r = Reachability::profiles(defs);
    let first = f.stages.first().and_then(|s| crate::scenario::day_of(defs, s.from).ok()).unwrap_or(0);
    let last = r.family_end(family).unwrap_or(first);
    for a in &defs.upbringing.activities {
        if structurally_impossible(defs, f, a) {
            out.insert(a.key.clone(), None);
            continue;
        }
        let cs = activity_constraints(defs, a);
        let ok = |lo: u32| r.earliest_for(family, &cs, lo, Some(true)).is_ok_and(|d| d <= last);
        let deadline = if !ok(first) {
            None
        } else if ok(last) {
            Some(last)
        } else {
            let (mut good, mut bad) = (first, last);
            while bad - good > 1 {
                let mid = good + (bad - good) / 2;
                if ok(mid) {
                    good = mid;
                } else {
                    bad = mid;
                }
            }
            Some(good)
        };
        out.insert(a.key.clone(), deadline);
    }
    out
}

impl World {
    /// 活动按门槛、阶段、年龄、地点与打工阶段算是否“开放”（不看钱与本月次数这类一时的限制）。
    pub fn upbringing_activity_open(&self, a: &ActivityDef, date: WorldDate) -> bool {
        let Some(stage) = self.upbringing_stage_on(date) else { return false };
        let age = self.state.protagonist.as_ref().and_then(|p| p.age_on(date));
        let Some(loc) = self.upbringing_location().and_then(|l| self.defs.locations.get(l.idx())) else {
            return false;
        };
        a.stage.allows(stage.stage)
            && a.age.is_none_or(|r| age.is_some_and(|age| age >= r[0] && age <= r[1]))
            && self.upbringing_unlock(&a.unlock, date)
            && a.tier.as_ref().is_none_or(|t| self.upbringing_job_progress(&t.group) >= t.after)
            && a.place.at.as_ref().is_none_or(|v| v == &loc.key)
            && a.place.culture.as_ref().is_none_or(|v| self.upbringing_culture_matches(v, &loc.culture))
            && a.place.academy.as_ref().is_none_or(|v| stage.academy.as_ref() == Some(v))
    }

    /// 当前开放着的、值得报一声的东西（键形如 `activity:<键>`、`place:<键>`、`path:<键>`、`exam:<键>`、`rating:<键>:<段>`）。
    fn upbringing_open_now(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        let date = self.cast_date();
        let u = &self.defs.upbringing;
        // 只靠阶段进门旗标开放的（本家专属、入学即有）不报：那是换了阶段，不是“解锁”。
        let entry: BTreeSet<&str> =
            u.family_variants().flat_map(|f| &f.stages).filter_map(|s| s.entry_flag.as_deref()).collect();
        for a in &u.activities {
            let numeric = !a.unlock.attrs.is_empty()
                || !a.unlock.growth.is_empty()
                || !a.unlock.rating.is_empty()
                || !a.unlock.skills.is_empty()
                || a.unlock.year.is_some();
            let story_flag = a.unlock.flag.as_deref().is_some_and(|f| !entry.contains(f));
            let gated = numeric || story_flag || a.tier.as_ref().is_some_and(|t| t.after > 0);
            if gated && self.upbringing_activity_open(a, date) {
                out.insert(format!("activity:{}", a.key));
            }
        }
        for p in self.upbringing_places() {
            if p.unlock != Unlock::default() && self.upbringing_place_open(p) {
                out.insert(format!("place:{}", p.key));
            }
        }
        if let Some(f) = self.upbringing_family() {
            for key in f.completion.iter().flat_map(|c| &c.paths) {
                if let Some(p) = u.paths.iter().find(|p| &p.key == key)
                    && self.upbringing_requirements(&p.requirements)
                    && (!p.hidden || self.upbringing_requirements(&p.reveal))
                {
                    out.insert(format!("path:{key}"));
                }
            }
        }
        for e in &u.exams {
            let academy_ok = e.academy.as_ref().is_none_or(|k| self.upbringing_academy().is_some_and(|a| &a.key == k));
            if academy_ok && self.upbringing_requirements(&e.requirements) {
                out.insert(format!("exam:{}", e.key));
            }
        }
        for r in &self.defs.captain.ratings {
            if r.key == "arcane_rating" && !self.upbringing_flag(super::ARCANA_AWAKENED_FLAG) {
                continue;
            }
            let rank = rating_rank(self.upbringing_rating(&r.key));
            if rank != "D" {
                out.insert(format!("rating:{}:{rank}", r.key));
            }
        }
        out
    }

    /// 记下新开放的东西：`seed` 时（开局）只记不报；之后新出现的记下日子，视图据此给 `unlocked_now`。
    pub(crate) fn refresh_upbringing_unlocks(&mut self, seed: bool) {
        if !self.upbringing_active() || self.upbringing_skipping() {
            return;
        }
        let open = self.upbringing_open_now();
        let today = self.day();
        if let Some(s) = &mut self.state.upbringing {
            for key in open {
                s.unlocks.entry(key).or_insert(if seed { None } else { Some(today) });
            }
        }
    }

    /// 最近 [`UNLOCK_NOTICE_DAYS`] 天内新开放的东西（按日子、键排序）。
    pub fn upbringing_unlocked_now(&self) -> Vec<(u32, &str)> {
        let today = self.day();
        let mut out: Vec<(u32, &str)> = self
            .state
            .upbringing
            .iter()
            .flat_map(|s| &s.unlocks)
            .filter_map(|(k, d)| d.filter(|d| today.saturating_sub(*d) < UNLOCK_NOTICE_DAYS).map(|d| (d, k.as_str())))
            .collect();
        out.sort();
        out
    }
}
