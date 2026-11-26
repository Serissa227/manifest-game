//! 活动的每个数值和引用都在开局前封闭校验。
use super::*;
use crate::StaticData;
pub fn event_matches(pattern: &str, key: &str) -> bool {
    pattern.strip_suffix('*').map_or(key == pattern, |prefix| key.starts_with(prefix))
}
pub fn validate(defs: &StaticData) -> Vec<String> {
    let mut errors = super::mood::validate(defs);
    let rules = &defs.upbringing.rules;
    if !(0..=1000).contains(&rules.annual_growth_cap)
        || !(0..=100).contains(&rules.mentor_bonus_pct)
        || !(0..=100).contains(&rules.illness_fatigue)
        || !(0..=10_000).contains(&rules.illness_bp)
        || !(1..=365).contains(&rules.illness_days)
        || rules.outing_permission_days > 365
        || rules.contest_mood.iter().any(|b| !(-100..=100).contains(&b.min) || !(-30..=30).contains(&b.value))
        || rules.contest_mood.windows(2).any(|p| p[0].min >= p[1].min)
        || rules.illness_events.iter().any(|key| !defs.story2.tracks.iter().any(|t| event_matches(key, &t.key)))
    {
        errors.push("养成通用规则数值越界".into());
    }
    let table = &rules.growth_table;
    if table.is_empty()
        || table.first().is_none_or(|b| b.from != 0)
        || table.last().is_none_or(|b| b.to != 1000)
        || table.iter().any(|b| b.from > b.to || !(1..=10).contains(&b.value))
        || table.windows(2).any(|b| b[0].to + 1 != b[1].from || b[0].value > b[1].value)
    {
        errors.push("成长换算表必须无重叠、无缺口地覆盖 0–1000，属性值为 1–10".into());
    }
    // 年龄基线只给“一个小的基数”：资质、本领每组至多三档，品行至多三十。
    if rules
        .age_baseline
        .iter()
        .any(|(group, value)| !defs.captain.groups.iter().any(|g| &g.key == group) || !(0..=3).contains(value))
    {
        errors.push("年龄基线只能按已有属性组给 0–3 点".into());
    }
    let by_age = &rules.annual_growth_cap_by_age;
    if by_age.iter().any(|[age, cap]| !(0..=120).contains(age) || !(0..=1000).contains(cap))
        || by_age.windows(2).any(|w| w[0][0] >= w[1][0])
        || rules.exam_session_days > 366
        || rules.exam_notice_days > 366
    {
        errors.push("按年龄的成长上限须按年龄严格递增、上限 0–1000；考期与预告不超过一年".into());
    }
    let attr = |key: &str| defs.captain.attribute_index(key).is_some();
    let skill = |key: &str| defs.story2.skills.contains(key);
    let event = |pattern: &str| {
        !pattern.is_empty()
            && !pattern.strip_suffix('*').unwrap_or(pattern).contains('*')
            && defs.story2.tracks.iter().any(|t| event_matches(pattern, &t.key))
    };
    for a in &defs.upbringing.activities {
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("{}: {message}", a.key));
            }
        };
        let range = a.income.bounds();
        check(range[0] >= 0 && range[0] <= range[1] && range[1] <= 1_000_000, "收入区间无效");
        check(
            (0..=1_000_000).contains(&a.cost) && (-100..=100).contains(&a.fatigue) && (-100..=100).contains(&a.mood),
            "活动费用、疲劳或心情越界",
        );
        check(a.age.is_none_or(|r| r[0] <= r[1] && r[1] <= 150), "年龄区间无效");
        check(
            a.gains.iter().all(|(k, r)| attr(k) && r[0] <= r[1] && r[0] >= -1000 && r[1] <= 1000),
            "成长属性或区间无效",
        );
        check(a.skills.iter().all(|s| skill(&s.skill) && (0..=10_000).contains(&s.xp)), "技能引用或经验无效");
        check(
            a.items.iter().all(|(key, qty)| defs.items.item(key).is_some() && (1..=100).contains(qty)),
            "产物引用或数量无效",
        );
        check(a.mentor.as_ref().is_none_or(|p| defs.cast.person(p).is_some()), "导师引用未知人物");
        check(a.place.at.as_ref().is_none_or(|key| defs.locations.iter().any(|l| &l.key == key)), "活动引用未知地点");
        check(
            a.place.culture.as_ref().is_none_or(|key| super::native_validation::culture_exists(defs, key)),
            "活动引用未知文化",
        );
        check(a.place.academy.as_ref().is_none_or(|key| defs.upbringing.academy(key).is_some()), "活动引用未知学院");
        check(
            a.place.feature.as_deref().is_none_or(|f| {
                [
                    "dock",
                    "shipyard",
                    "market",
                    "shop",
                    "school",
                    "library",
                    "lodging",
                    "settlement",
                    "workplace",
                    "workshop",
                ]
                .contains(&f)
            }),
            "未知设施要求",
        );
        check(a.needs.iter().copied().collect::<BTreeSet<_>>().len() == a.needs.len(), "活动选择要求重复");
        check(a.kind != ActivityKind::Reading || a.needs.contains(&Need::Book), "读书活动必须声明 book 要求");
        check(a.kind != ActivityKind::Date || a.needs.contains(&Need::Companion), "同行活动必须声明 companion 要求");
        check(a.kind != ActivityKind::Free || a.needs.contains(&Need::Place), "自由行动必须声明 place 要求");
        check(a.kind != ActivityKind::Adventure || a.needs.contains(&Need::Excursion), "冒险必须声明 excursion 要求");
        check(a.events.iter().all(|p| event(p)), "活动事件池没有对应轨道");
        check(
            (0..=100).contains(&a.failure.income_pct)
                && (0..=100).contains(&a.failure.gains_pct)
                && (0..=100).contains(&a.failure.extra_fatigue)
                && (-100..=100).contains(&a.failure.mood)
                && a.failure.events.iter().all(|p| event(p)),
            "失败后果数值或事件引用无效",
        );
        check(
            a.unlock.attrs.keys().all(|k| attr(k))
                && a.unlock.growth.keys().all(|k| attr(k))
                && a.unlock.skills.keys().all(|k| skill(k))
                && a.unlock.rating.keys().all(|k| defs.captain.ratings.iter().any(|r| &r.key == k)),
            "门槛引用未知属性、技能或评价",
        );
        check(
            a.unlock.growth.values().all(|v| (0..=1000).contains(v))
                && a.unlock.rating.values().all(|v| (0..=1000).contains(v))
                && a.unlock.skills.values().all(|v| (0..=1_000_000).contains(v))
                && a.unlock.year.is_none_or(|y| y > 0 && y <= 20),
            "活动门槛越界",
        );
        if let Some(t) = &a.tier {
            check(
                a.kind == ActivityKind::Job
                    && (1..=3).contains(&t.level)
                    && (t.next == 0 || t.after <= t.next)
                    && !t.group.is_empty()
                    && !t.name.trim().is_empty(),
                "打工阶段定义无效",
            );
            check(t.branch.is_none() || t.level == 3, "职业分支只属于第三段打工");
        }
        if let Some(r) = &a.risk {
            check(
                (0..=10_000).contains(&r.failure_bp)
                    && (0..=1000).contains(&r.per)
                    && r.attr.as_deref().is_none_or(attr),
                "风险检定数值或属性无效",
            );
            check(r.success_events.iter().chain(&r.failure_events).all(|p| event(p)), "风险事件池没有对应轨道");
        }
    }
    let groups =
        defs.upbringing.activities.iter().filter_map(|a| a.tier.as_ref().map(|t| &t.group)).collect::<BTreeSet<_>>();
    for group in groups {
        let levels = defs
            .upbringing
            .activities
            .iter()
            .filter_map(|a| a.tier.as_ref())
            .filter(|t| &t.group == group)
            .map(|t| t.level)
            .collect::<BTreeSet<_>>();
        if levels != BTreeSet::from([1, 2, 3]) {
            errors.push(format!("{group}: 打工组必须定义入门、责任与职业三段"));
        }
    }
    errors
}
