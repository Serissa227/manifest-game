//! 原生附表引用闭包；即使目标目录为空，也必须拒绝悬空引用。
use super::*;
use crate::StaticData;
pub fn culture_exists(d: &StaticData, key: &str) -> bool {
    d.locations.iter().any(|l| l.culture == key)
        || d.upbringing
            .culture_aliases
            .get(key)
            .is_some_and(|v| !v.is_empty() && v.iter().all(|k| d.locations.iter().any(|l| &l.culture == k)))
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let u = &d.upbringing;
    let mut errors = Vec::new();
    let person = |k: &str| d.cast.person(k).is_some();
    let skill = |k: &str| d.story2.skills.contains(k);
    let item = |k: &str| d.items.item(k).is_some();
    let attr = |k: &str| d.captain.attribute_index(k).is_some();
    let loc = |k: &str| d.locations.iter().any(|l| l.key == k);
    let rating = |k: &str| d.captain.ratings.iter().any(|r| r.key == k);
    let activity = |k: &str| u.activity(k).is_some();
    let contest = |k: &str| u.contests.iter().any(|c| c.key == k);
    let exam = |k: &str| u.exams.iter().any(|e| e.key == k);
    let event =
        |k: &str| !k.is_empty() && d.story2.tracks.iter().any(|t| super::activity_validation::event_matches(k, &t.key));
    let date = |v: WorldDate| crate::scenario::day_of(d, v).is_ok();
    let mut check = |ok: bool, key: &str, what: &str| {
        if !ok {
            errors.push(format!("{key}: {what}"));
        }
    };
    check(u.format_version.is_none_or(|v| v == 1), "upbringing", "未知原生格式版本");
    for (flag, grant) in &u.job_progress_flags {
        check(
            !flag.is_empty()
                && grant.at_least <= 10_000
                && u.activities.iter().any(|a| a.tier.as_ref().is_some_and(|t| t.group == grant.group)),
            flag,
            "打工进度映射无效",
        );
    }
    for (key, v) in &u.culture_aliases {
        check(
            !v.is_empty() && v.iter().all(|k| d.locations.iter().any(|l| &l.culture == k)),
            key,
            "文化映射引用未知文化",
        );
    }
    let mut keys = BTreeSet::new();
    for n in &u.notes {
        check(
            !n.key.is_empty() && keys.insert(&n.key) && !n.text.is_empty() && !n.source.is_empty(),
            &n.key,
            "作者附注重复或字段为空",
        );
    }
    for f in &u.families {
        check(f.mentor_roles.values().all(|p| person(p)), &f.key, "家庭导师引用未知人物");
    }
    for (person_key, skills) in &u.helper_levels {
        check(
            person(person_key) && skills.iter().all(|(key, level)| skill(key) && (1..=3).contains(level)),
            person_key,
            "同行技能等级引用无效",
        );
    }
    for (key, p) in &u.skill_profiles {
        check(
            skill(key)
                && !p.thresholds.is_empty()
                && p.thresholds.len() <= 3
                && p.thresholds.iter().all(|v| *v > 0)
                && p.thresholds.windows(2).all(|p| p[0] < p[1])
                && p.cultures.iter().all(|c| culture_exists(d, c)),
            key,
            "技能等级或文化引用无效",
        );
    }
    keys.clear();
    for c in &u.crafts {
        check(
            keys.insert(&c.key) && activity(&c.activity) && skill(&c.skill) && c.level <= 3,
            &c.key,
            "手作键重复或活动、技能引用无效",
        );
        check(
            !c.materials.is_empty()
                && c.materials
                    .iter()
                    .chain(std::iter::once(&c.output))
                    .all(|i| item(&i.item) && (1..=100).contains(&i.qty))
                && c.tools.iter().all(|i| item(i)),
            &c.key,
            "手作材料、工具或产物无效",
        );
        check(
            c.consume == "on_success"
                && attr(&c.check.attr)
                && (0..=100).contains(&c.check.base)
                && (0..=20).contains(&c.check.per),
            &c.key,
            "手作检定或消耗规则无效",
        );
    }
    for a in &u.activities {
        check(
            a.counts_as.as_deref().is_none_or(activity)
                && a.monthly_limit.is_none_or(|n| (1..=6).contains(&n))
                && a.monthly_limit_group.as_ref().is_none_or(|g| !g.is_empty()),
            &a.key,
            "活动别名或月度次数无效",
        );
        check(
            a.craft.as_ref().is_none_or(|k| u.crafts.iter().any(|c| &c.key == k))
                && a.club.as_ref().is_none_or(|k| u.academies.iter().flat_map(|a| &a.clubs).any(|c| &c.key == k)),
            &a.key,
            "活动引用未知配方或社团",
        );
        check(a.unlock.attrs.iter().all(|(k, v)| attr(k) && (0..=100).contains(v)), &a.key, "活动属性门槛无效");
        check(
            a.risk.as_ref().is_none_or(|r| {
                r.min_bp >= 0 && r.max_bp.unwrap_or(10_000) <= 10_000 && r.min_bp <= r.max_bp.unwrap_or(10_000)
            }),
            &a.key,
            "检定概率边界无效",
        );
        if let Some(c) = &a.skill_choice {
            check(
                !c.options.is_empty()
                    && c.options.iter().all(|s| skill(s))
                    && (1..=10_000).contains(&c.xp)
                    && a.selected_skill.as_ref().is_none_or(|k| c.options.contains(k)),
                &a.key,
                "技能选择引用无效",
            );
        }
        check(a.selected_skill.is_none() || a.skill_choice.is_some(), &a.key, "技能卡缺少选择表");
        check(
            a.tutorial.as_ref().is_none_or(|t| {
                a.kind == ActivityKind::Voyage && t.book_value == 0 && t.return_on_finish && t.temporary_fleet
            }),
            &a.key,
            "实习船必须零账值且归还",
        );
    }
    let places = u
        .families
        .iter()
        .flat_map(|f| &f.places)
        .chain(u.academies.iter().flat_map(|a| &a.places))
        .map(|p| &p.key)
        .collect::<BTreeSet<_>>();
    for a in &u.academies {
        check(a.exams.iter().all(|k| exam(k)), &a.key, "学院考试不存在");
        for mark in &a.calendar {
            check(
                mark.exam.as_deref().is_none_or(exam) && mark.contest.as_deref().is_none_or(contest),
                &a.key,
                "校历考试或比赛不存在",
            );
        }
        if let Some(g) = &a.graduation {
            check(
                event(&g.event) && places.contains(&g.promise_at) && date(g.date),
                &a.key,
                "结业事件、约定场所或日期无效",
            );
        }
        for p in &a.phases {
            check(
                date(p.from) && date(p.to) && p.from <= p.to && p.mentors.iter().all(|p| person(p)),
                &a.key,
                "学院分期日期或导师无效",
            );
        }
        for v in &a.visits {
            check(
                (loc(&v.at) || d.geography.places.offstage(&v.at).is_some())
                    && v.people.iter().all(|p| person(p))
                    && v.unlock.attrs.keys().all(|k| attr(k))
                    && v.unlock.skills.keys().all(|k| skill(k))
                    && v.unlock.rating.keys().all(|k| rating(k)),
                &a.key,
                "访问地点、人物或门槛无效",
            );
        }
        let mut clubs = BTreeSet::new();
        for c in &a.clubs {
            check(
                clubs.insert(&c.key)
                    && c.practice.iter().all(|k| activity(k))
                    && c.contests.iter().all(|k| contest(k))
                    && c.members.iter().all(|p| person(p))
                    && c.events.iter().all(|e| event(e)),
                &c.key,
                "社团键重复或引用无效",
            );
        }
        if let Some(r) = &a.rules {
            check(
                rating(&r.scholarship.rating)
                    && (0..=100).contains(&r.scholarship.fee_discount_pct)
                    && exam(&r.recommendation.exam)
                    && item(&r.recommendation.item),
                &a.key,
                "奖学金或推荐信引用无效",
            );
        }
    }
    for f in &u.festivals {
        check(
            f.events.iter().all(|e| event(e)) && f.contests.iter().all(|c| contest(c)),
            &f.key,
            "节日事件或比赛不存在",
        );
    }
    for (key, g) in &u.event_gates {
        check(
            d.story2.track(key).is_none_or(|t| !super::cadence::is_guide(t.kind)),
            key,
            "引导轨道不能登记养成事件门槛",
        );
        check(
            g.category.as_ref().is_none_or(|c| {
                !c.is_empty() && c.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            }),
            key,
            "事件类别须为非空英文小写、数字或下划线",
        );
        check(
            g.cooldown_weeks.is_none_or(|w| {
                (1..=192).contains(&w) && d.story2.track(key).and_then(|t| t.chapter(&t.start)).is_some_and(|c| !c.once)
            }),
            key,
            "事件冷却须为 1–192 周且仅可用于可重复轨道",
        );
        check(d.story2.track(key).is_some(), key, "短事件没有对应轨道");
        check(
            g.months.as_ref().is_none_or(|months| {
                !months.is_empty()
                    && months.iter().all(|month| (1..=12).contains(month))
                    && months.iter().collect::<BTreeSet<_>>().len() == months.len()
            }),
            key,
            "短事件月份须为1至12的非空不重复列表",
        );
        check(g.actors.iter().chain(&g.no_promise_with_protagonist).all(|p| person(p)), key, "短事件人物不存在");
        check(
            g.academy.as_ref().is_none_or(|k| u.academy(k).is_some())
                && g.activity.as_deref().is_none_or(activity)
                && g.festival.as_ref().is_none_or(|k| u.festivals.iter().any(|f| &f.key == k)),
            key,
            "短事件学院、活动或节日不存在",
        );
        check(
            g.mail_route.as_deref().is_none_or(event)
                && g.from.is_none_or(date)
                && g.actors_age.is_none_or(|r| r[0] <= r[1] && r[1] <= 150)
                && g.festival_window_days.is_none_or(|r| r[0] <= r[1] && r[0] >= -365 && r[1] <= 365)
                && g.check_result.as_deref().is_none_or(|s| ["success", "failure"].contains(&s)),
            key,
            "短事件日期、来信或检定门槛无效",
        );
    }
    for e in &u.excursions {
        check(
            !e.at.is_empty() || (!e.place.cultures.is_empty() || !e.place.academies.is_empty()),
            &e.key,
            "动态远足须限定文化或学院",
        );
        check(
            e.place.academies.iter().all(|k| u.academy(k).is_some())
                && e.place.cultures.iter().all(|c| culture_exists(d, c))
                && e.place.bind.as_deref().is_none_or(|v| matches!(v, "family_home" | "enrolled_academy")),
            &e.key,
            "远足地点绑定无效",
        );
        for n in &e.nodes {
            check(n.steps.is_empty() || n.steps.len() == 3, &n.key, "原生远足必须三步");
            for (i, s) in n.steps.iter().enumerate() {
                check(
                    ["unseen", "seen", "prepared"].get(i).is_some_and(|v| *v == s.from)
                        && ["seen", "prepared", "solved"].get(i).is_some_and(|v| *v == s.to)
                        && !s.consume_items
                        && requirement(d, &s.unlock)
                        && s.skills.iter().all(|s| skill(&s.skill) && (0..=10_000).contains(&s.xp))
                        && s.gains.iter().all(|(k, r)| attr(k) && r[0] <= r[1] && r[0] >= -1000 && r[1] <= 1000)
                        && s.items.iter().all(|v| item(&v.item) && (1..=100).contains(&v.qty)),
                    &n.key,
                    "远足步骤、门槛或收益无效",
                );
            }
            check(
                n.repeat.as_ref().is_none_or(|r| {
                    r.state == "solved"
                        && r.cooldown_days > 0
                        && r.income == 0
                        && r.gains.iter().all(|(k, v)| attr(k) && v[0] <= v[1] && v[0] >= -1000 && v[1] <= 1000)
                }),
                &n.key,
                "远足重复结算无效",
            );
            check(
                n.risk.as_ref().is_none_or(|r| {
                    attr(&r.check.attr)
                        && (0..=100).contains(&r.check.base)
                        && (0..=20).contains(&r.check.per)
                        && r.failure.state_unchanged
                }),
                &n.key,
                "远足风险无效",
            );
        }
    }
    if let Some(r) = &d.rules.upbringing.cadence {
        errors.extend(r.problems());
    }
    errors
}
fn requirement(d: &StaticData, r: &ExcursionRequirement) -> bool {
    r.any.iter().all(|r| requirement(d, r))
        && r.item.as_ref().is_none_or(|k| d.items.item(k).is_some() && (1..=100).contains(&r.qty))
        && r.attr.as_ref().is_none_or(|k| d.captain.attribute_index(k).is_some() && (0..=100).contains(&r.min))
        && r.skill.iter().chain(&r.companion_skill).all(|k| d.story2.skills.contains(k))
        && r.level <= 3
}
