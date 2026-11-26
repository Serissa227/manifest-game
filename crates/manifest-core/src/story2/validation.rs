//! 作者数据的封闭引用与数值校验；供加载器和离线故事检查工具共用。
use super::*;
use crate::StaticData;

fn protagonist_key(d: &StaticData, candidate: &str) -> bool {
    key(candidate)
        && (d.cast.person(candidate).is_some_and(|p| p.kind == crate::cast::PersonKind::Protagonist)
            || d.scenarios.iter().any(|s| s.protagonists.iter().chain(&s.templates).any(|p| p == candidate)))
}

pub fn validate(defs: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut tracks = BTreeSet::new();
    for t in &defs.story2.tracks {
        if !key(&t.key) || !tracks.insert(&t.key) || t.name.trim().is_empty() || t.chapter(&t.start).is_none() {
            errors.push(format!("{}: 轨道key、名称或起点无效", t.key));
        }
        if t.auto
            && let Some(c) = t.chapter(&t.start)
            && start_may_be_unanswerable(c)
        {
            errors.push(format!(
                "{}:{}: 自动轨道的起始章每个选项都带门槛，且没有一个选项的年龄、日期门槛被章节条件涵盖，出现时可能回答不了",
                t.key, c.key
            ));
        }
        let mut chapters = BTreeSet::new();
        for c in &t.chapters {
            let mut check = |ok: bool, message: &str| {
                if !ok {
                    errors.push(format!("{}:{}: {message}", t.key, c.key));
                }
            };
            check(
                key(&c.key) && !["done", "failed"].contains(&c.key.as_str()) && chapters.insert(&c.key),
                "章节key无效或重复",
            );
            check(
                !c.title.trim().is_empty()
                    && c.title.chars().count() <= 100
                    && !c.text.trim().is_empty()
                    && c.text.chars().count() <= 4000,
                "章节文字为空或过长",
            );
            check(c.at.as_ref().is_none_or(|p| defs.locations.iter().any(|l| &l.key == p)), "章节引用未知地点");
            check(t.cast.iter().chain(&c.cast).all(|p| defs.cast.person(p).is_some()), "cast引用未知人物");
            if let Some(figure) = &c.figure {
                check(
                    defs.cast.figure(figure).is_some() || defs.cast.person(figure).is_some(),
                    &format!("{}：figure引用未知立绘或人物 {figure}", t.source),
                );
            }
            check(c.speaker.as_ref().is_none_or(|p| p == "captain" || defs.cast.person(p).is_some()), "说话人不存在");
            check(
                c.mood.as_ref().is_none_or(|m| ["cheerful", "tender", "tense", "sad", "mystic"].contains(&m.as_str())),
                "mood无效",
            );
            check(
                c.window.is_none_or(|w| w[0] <= w[1] && w.iter().all(|d| valid_date(defs, *d)) && c.default.is_some()),
                "窗口日期无效或缺少default分支",
            );
            check(
                c.stage.is_none()
                    || (c.window.is_some()
                        && c.default.is_some()
                        && c.at.is_some()
                        && c.news.as_ref().is_some_and(|n| !n.trim().is_empty())
                        && (!c.cast.is_empty() || !t.cast.is_empty())),
                "配角章必须给window/default/at/cast/news",
            );
            check(
                c.choices.is_empty() == matches!(c.stage, Some(Stage::Witness | Stage::Rumor)),
                "witness/rumor没有选项，其他章节必须有选项",
            );
            check(!(c.deadline.is_some() && c.deadline_days.is_some()), "deadline与deadline_days互斥");
            check(
                (c.deadline.is_none() && c.deadline_days.is_none()) || c.timeout.is_some(),
                "限期章节缺少timeout分支",
            );
            check(c.timeout.is_none() || c.deadline.is_some() || c.deadline_days.is_some(), "timeout分支缺少限期");
            check(c.deadline.is_none_or(|d| valid_date(defs, d)), "期限日期不存在");
            check(c.once || (c.family.is_some() && c.family_cooldown_days > 0), "可重复章节必须设置家族与非零冷却");
            check(c.family.as_ref().is_none_or(|s| key(s)), "家族key无效");
            let mut variants = BTreeSet::new();
            for v in &c.variants {
                check(key(&v.key) && variants.insert(&v.key), "变体key无效或重复");
                check(
                    v.text.as_ref().is_none_or(|s| !s.trim().is_empty() && s.chars().count() <= 4000),
                    "变体正文为空或过长",
                );
                check(
                    v.title.as_ref().is_none_or(|s| !s.trim().is_empty() && s.chars().count() <= 100),
                    "变体标题为空或过长",
                );
                check(
                    v.speaker.as_ref().is_none_or(|p| p == "captain" || defs.cast.person(p).is_some()),
                    "变体说话人不存在",
                );
                check(
                    v.mood
                        .as_ref()
                        .is_none_or(|m| ["cheerful", "tender", "tense", "sad", "mystic"].contains(&m.as_str())),
                    "变体mood无效",
                );
            }
            for cond in c
                .when
                .iter()
                .chain(c.choices.iter().flat_map(|o| &o.requires))
                .chain(c.variants.iter().flat_map(|v| &v.when))
            {
                if let Some(message) = condition_error(defs, cond) {
                    check(false, &message);
                }
            }
            for cond in c.choices.iter().flat_map(|o| &o.requires).chain(c.variants.iter().flat_map(|v| &v.when)) {
                check(!matches!(cond, Condition::Any { .. }), "any 只许用于章节 when 或 objectives");
            }
            for o in &c.objectives {
                check(
                    o.text.as_ref().is_none_or(|s| !s.trim().is_empty() && s.chars().count() <= 300),
                    "目标文字为空或过长",
                );
                let ok = match &o.kind {
                    ObjectiveKind::Goods { good, qty, at } => {
                        *qty > 0
                            && *qty <= 1_000_000
                            && defs.goods.iter().any(|g| &g.key == good)
                            && defs.locations.iter().any(|l| &l.key == at && l.is_port())
                    }
                    ObjectiveKind::Item { item, qty } => *qty > 0 && defs.items.item(item).is_some(),
                    ObjectiveKind::At { at } => defs.locations.iter().any(|l| &l.key == at),
                    ObjectiveKind::Person { person } => defs.cast.person(person).is_some(),
                    ObjectiveKind::Affinity { person, ge } => {
                        defs.cast.person(person).is_some() && (0..=100).contains(ge)
                    }
                    ObjectiveKind::Cash { ge } | ObjectiveKind::Fame { ge } => *ge >= 0,
                    ObjectiveKind::Wait { days } => *days > 0,
                    ObjectiveKind::Battle { wins } => *wins > 0,
                    ObjectiveKind::Discovery { discovery, .. } => defs.discoveries.iter().any(|d| &d.key == discovery),
                    ObjectiveKind::Any { any } => {
                        if let Some(message) = objective_any_error(defs, any) {
                            check(false, &message);
                        }
                        continue;
                    }
                    ObjectiveKind::Attr { .. }
                    | ObjectiveKind::Growth { .. }
                    | ObjectiveKind::Skill { .. }
                    | ObjectiveKind::Bond { .. }
                    | ObjectiveKind::Visited { .. }
                    | ObjectiveKind::PortsKnown { .. }
                    | ObjectiveKind::HouseLevel { .. }
                    | ObjectiveKind::Warehouse { .. }
                    | ObjectiveKind::Industries { .. }
                    | ObjectiveKind::Ships { .. }
                    | ObjectiveKind::ShipTier { .. }
                    | ObjectiveKind::Mates { .. }
                    | ObjectiveKind::Post { .. }
                    | ObjectiveKind::Rank { .. }
                    | ObjectiveKind::Deed { .. } => {
                        o.kind.condition().is_some_and(|c| condition_error(defs, &c).is_none())
                    }
                };
                check(ok, &format!("目标引用或数值无效：{:?}", o.kind));
            }
            let mut choices = BTreeSet::new();
            for o in &c.choices {
                check(
                    key(&o.key) && choices.insert(&o.key) && !o.text.trim().is_empty(),
                    "选项key无效、重复或文字为空",
                );
                check(o.reply.chars().count() <= 4000 && o.text.chars().count() <= 300, "选项文字过长");
                check(o.check.is_none() || o.fail.is_some(), "检定必须有fail分支");
                if let Some(k) = &o.check {
                    check(
                        defs.captain.check_index(&k.attr).is_some() || defs.story2.skills.contains(&k.attr),
                        "检定引用未知属性、评价或技能",
                    );
                    check((-100..=100).contains(&k.base) && (-100..=100).contains(&k.per), "检定系数越界");
                }
            }
            for b in c
                .default
                .iter()
                .cloned()
                .chain(c.timeout.iter().cloned())
                .chain(c.choices.iter().map(Choice::branch))
                .chain(c.choices.iter().filter_map(|o| o.fail.clone()))
            {
                check(
                    ["done", "failed"].contains(&b.next.as_str()) || t.chapter(&b.next).is_some(),
                    "分支引用未知章节",
                );
                check(b.effects.len() <= 32, "单分支效果超过32条");
                check(
                    b.news
                        .as_ref()
                        .or(c.news.as_ref())
                        .is_none_or(|n| !n.trim().is_empty() && n.chars().count() <= 1000),
                    "见闻文字为空或过长",
                );
                for e in &b.effects {
                    if let Some(message) = effect_error(defs, e) {
                        check(false, &message);
                    }
                    if let Some(message) = romance_error(defs, t, c, e) {
                        check(false, &message);
                    }
                }
            }
        }
    }
    errors.extend(super::guide_defs::structure(defs));
    errors
}

fn key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 起始章的每个选项都带 `requires`，而且没有哪个选项的年龄、日期门槛已被章节的 `when` / `window` 涵盖：
/// 章节可能在门槛满足之前出现，养成期的时钟会因此停住（U03 / A2）。其余门槛（情谊、钱等）由运行时兜底作罢。
pub fn start_may_be_unanswerable(c: &ChapterDef) -> bool {
    !c.choices.is_empty()
        && c.choices.iter().all(|o| !o.requires.is_empty())
        && !c.choices.iter().any(|o| o.requires.iter().all(|r| implied_by(r, &c.when, c.window)))
}

fn implied_by(r: &Condition, when: &[Condition], window: Option<[crate::scenario::WorldDate; 2]>) -> bool {
    match r {
        Condition::Age { person, ge, le } => {
            let (lo, hi) = when.iter().fold((0, u32::MAX), |(lo, hi), c| match c {
                Condition::Age { person: p, ge: g, le: l } if p == person => {
                    (lo.max(g.unwrap_or(0)), hi.min(l.unwrap_or(u32::MAX)))
                }
                _ => (lo, hi),
            });
            ge.is_none_or(|g| lo >= g) && le.is_none_or(|l| hi <= l)
        }
        Condition::Date { from, to } => {
            let (mut lo, mut hi) = ([0; 3], [u32::MAX; 3]);
            for c in when {
                if let Condition::Date { from: f, to: t } = c {
                    lo = lo.max(f.unwrap_or([0; 3]));
                    hi = hi.min(t.unwrap_or([u32::MAX; 3]));
                }
            }
            if let Some(w) = window {
                lo = lo.max(w[0]);
                hi = hi.min(w[1]);
            }
            from.is_none_or(|f| lo >= f) && to.is_none_or(|t| hi <= t)
        }
        _ => true,
    }
}
fn valid_date(d: &StaticData, date: crate::scenario::WorldDate) -> bool {
    d.calendar.day_of(crate::calendar::Date { year: date[0], month: date[1], day: date[2] }).is_ok()
}

pub fn condition_error(d: &StaticData, c: &Condition) -> Option<String> {
    let ok = match c {
        Condition::Any { any } => {
            if !d.rules.quests.enabled {
                return Some("any 需要启用 quests.enabled".into());
            }
            if !(2..=6).contains(&any.len()) {
                return Some("any 分支须有 2–6 个".into());
            }
            for branch in any {
                if matches!(branch, Condition::Any { .. }) {
                    return Some("any 不许嵌套 any".into());
                }
                if !matches!(
                    branch,
                    Condition::Cash { .. }
                        | Condition::Fame { .. }
                        | Condition::Reputation { .. }
                        | Condition::Item { .. }
                        | Condition::Equipped { .. }
                        | Condition::Mate { .. }
                        | Condition::Attr { .. }
                        | Condition::Growth { .. }
                        | Condition::Skill { .. }
                        | Condition::Visited { .. }
                        | Condition::PortsKnown { .. }
                        | Condition::HouseLevel { .. }
                        | Condition::Warehouse { .. }
                        | Condition::Industries { .. }
                        | Condition::Ships { .. }
                        | Condition::ShipTier { .. }
                        | Condition::Mates { .. }
                        | Condition::Post { .. }
                        | Condition::Rank { .. }
                        | Condition::Deed { .. }
                ) {
                    return Some(format!("any 条件分支种类不在白名单：{branch:?}"));
                }
                if let Some(message) = condition_error(d, branch) {
                    return Some(message);
                }
            }
            true
        }
        Condition::Protagonist { protagonist } => protagonist_key(d, protagonist),
        Condition::ProtagonistIn { protagonist_in } => {
            !protagonist_in.is_empty()
                && protagonist_in.iter().collect::<BTreeSet<_>>().len() == protagonist_in.len()
                && protagonist_in.iter().all(|p| protagonist_key(d, p))
        }
        Condition::RomanceOpen { romance_open } => d.cast.person(romance_open).is_some(),
        Condition::Society { society, ge } => {
            d.societies.society(society).is_some_and(|s| usize::from(*ge) <= s.ranks.len())
        }
        Condition::Spell { spell } => d.arcana.spell(spell).is_some(),
        Condition::Lineage { lineage, person } => {
            d.lineages.lineage(lineage).is_some() && person.as_ref().is_none_or(|p| d.cast.person(p).is_some())
        }
        Condition::Date { from, to } => {
            from.is_none_or(|d0| valid_date(d, d0))
                && to.is_none_or(|d0| valid_date(d, d0))
                && from.zip(*to).is_none_or(|(a, b)| a <= b)
        }
        Condition::Season { season } => *season < 4,
        Condition::Flag { flag, .. } => key(flag),
        Condition::At { at, person } => {
            d.locations.iter().any(|l| &l.key == at) && person.as_ref().is_none_or(|p| d.cast.person(p).is_some())
        }
        Condition::Age { person, ge, le } => {
            person.as_ref().is_none_or(|p| d.cast.person(p).is_some()) && ge.zip(*le).is_none_or(|(a, b)| a <= b)
        }
        Condition::Affinity { person, ge } | Condition::Heart { person, ge } => {
            d.cast.person(person).is_some() && (0..=100).contains(ge)
        }
        Condition::Bond { person, .. }
        | Condition::NotBondS { person }
        | Condition::Relation { person, .. }
        | Condition::Alive { person, .. } => d.cast.person(person).is_some(),
        Condition::Tie { a, b, .. } => a != b && d.cast.person(a).is_some() && d.cast.person(b).is_some(),
        Condition::Attr { attr, ge } => d.captain.check_index(attr).is_some() && *ge >= 0,
        Condition::Growth { attr, ge } => d.captain.attribute_index(attr).is_some() && *ge >= 0,
        Condition::Skill { skill, ge } => d.story2.skills.contains(skill) && *ge >= 0,
        Condition::Cash { ge } | Condition::Fame { ge } => *ge >= 0,
        Condition::Reputation { faction, ge } => {
            d.factions.iter().any(|f| &f.key == faction) && (-100..=100).contains(ge)
        }
        Condition::Item { item, qty } => d.items.item(item).is_some() && *qty > 0,
        Condition::Equipped { item } => d.items.item(item).is_some(),
        Condition::Mate { mate } => d.mates.iter().any(|m| &m.key == mate),
        Condition::Read { work } => d.items.items.iter().any(|i| i.read.is_some() && i.work_key() == work),
        Condition::Books { category, .. } => {
            category.as_ref().is_none_or(|c| d.items.book_categories.iter().any(|b| &b.key == c))
        }
        Condition::Gifts { person, value, category, qty, .. } => {
            d.cast.person(person).is_some() && value.is_none_or(|v| v >= 0) && (qty.is_none() || category.is_some())
        }
        Condition::Visited { at, ge } => {
            at.is_some() != ge.is_some()
                && at.as_ref().is_none_or(|k| d.find_loc(k).is_some())
                && ge.is_none_or(|g| g >= 1)
        }
        Condition::PortsKnown { ge } | Condition::Ships { ge } | Condition::Mates { ge } => *ge >= 1,
        Condition::HouseLevel { at, ge } => {
            *ge >= 1
                && (*ge as usize) <= d.rules.access.max_house()
                && at.as_ref().is_none_or(|k| d.find_loc(k).is_some_and(|id| crate::access::investable(d, id)))
        }
        Condition::Warehouse { at, ge } => {
            !(at.is_some() && ge.is_some())
                && at.as_ref().is_none_or(|k| d.find_loc(k).is_some())
                && ge.is_none_or(|g| g >= 1)
        }
        Condition::Industries { at, industry, ge } => {
            *ge >= 1
                && at.as_ref().is_none_or(|k| d.find_loc(k).is_some())
                && industry.as_ref().is_none_or(|k| d.industry_types.iter().any(|i| &i.key == k))
        }
        Condition::ShipTier { ge } => (*ge as usize) <= d.rules.shipyard_growth.price_tiers.len(),
        Condition::Post { post } => {
            ["captain", "accountant", "trader", "caravan_leader", "industry_manager"].contains(&post.as_str())
                || d.captain.roles.iter().any(|r| &r.key == post)
        }
        Condition::Rank { at, ge } => d
            .find_loc(at)
            .is_some_and(|id| (*ge as usize) < d.rules.access.rank_table(crate::access::investable(d, id)).len()),
        Condition::Deed { ge, .. } => d.rules.quests.enabled && (1..=10_000).contains(ge),
        Condition::Wait { .. } => true,
        Condition::Price { at, good, ge, le } => {
            d.locations.iter().any(|l| &l.key == at)
                && d.goods.iter().any(|g| &g.key == good)
                && ge.zip(*le).is_none_or(|(a, b)| a <= b)
        }
        Condition::Location { culture, .. } => {
            culture.as_ref().is_none_or(|c| d.locations.iter().any(|l| &l.culture == c))
        }
    };
    (!ok).then(|| format!("条件引用或数值无效：{c:?}"))
}

fn objective_any_error(d: &StaticData, any: &[ObjectiveKind]) -> Option<String> {
    for branch in any {
        if matches!(branch, ObjectiveKind::Any { .. }) {
            return Some("any 不许嵌套 any".into());
        }
        if !matches!(
            branch,
            ObjectiveKind::Item { .. }
                | ObjectiveKind::Cash { .. }
                | ObjectiveKind::Fame { .. }
                | ObjectiveKind::Attr { .. }
                | ObjectiveKind::Growth { .. }
                | ObjectiveKind::Skill { .. }
                | ObjectiveKind::Visited { .. }
                | ObjectiveKind::PortsKnown { .. }
                | ObjectiveKind::HouseLevel { .. }
                | ObjectiveKind::Warehouse { .. }
                | ObjectiveKind::Industries { .. }
                | ObjectiveKind::Ships { .. }
                | ObjectiveKind::ShipTier { .. }
                | ObjectiveKind::Mates { .. }
                | ObjectiveKind::Post { .. }
                | ObjectiveKind::Rank { .. }
                | ObjectiveKind::Deed { .. }
        ) {
            return Some(format!("any 目标分支种类不在白名单：{branch:?}"));
        }
    }
    let condition = ObjectiveKind::Any { any: any.to_vec() }.condition()?;
    condition_error(d, &condition)
}

pub(crate) fn effect_error(d: &StaticData, e: &Effect) -> Option<String> {
    let ok = match e {
        Effect::Affinity { person, value } | Effect::Heart { person, value } => {
            d.cast.person(person).is_some() && (-100..=100).contains(value)
        }
        Effect::Relation { person, .. } | Effect::Bond { person, .. } => d.cast.person(person).is_some(),
        Effect::Tie { a, b, .. } => a != b && d.cast.person(a).is_some() && d.cast.person(b).is_some(),
        Effect::Flag { flag, .. } => key(flag),
        Effect::OpenRealm { realm } | Effect::EatOtherworld { realm } => d.realms.realm(realm).is_some(),
        Effect::Transform { lineage } => {
            !d.lineages.is_empty()
                && lineage.as_ref().is_none_or(|k| d.lineages.lineage(k).is_some_and(|l| l.reversal.is_some()))
        }
        Effect::LearnSpell { spell } => d.arcana.spell(spell).is_some(),
        Effect::Letter { person, text } => {
            d.cast.person(person).is_some() && !text.trim().is_empty() && text.chars().count() <= 1000
        }
        Effect::Item { item, qty } => d.items.item(item).is_some() && qty.abs_diff(0) <= 10_000 && *qty != 0,
        Effect::Skill { skill, value } => d.story2.skills.contains(skill) && (0..=10_000).contains(value),
        Effect::Growth { attr, value } => d.captain.attribute_index(attr).is_some() && (0..=10_000).contains(value),
        Effect::Memory { memory, title } => key(memory) && !title.trim().is_empty() && title.chars().count() <= 100,
        Effect::Title { title } => !title.trim().is_empty() && title.chars().count() <= 100,
        Effect::StartTrack { track } | Effect::EndTrack { track } => d.story2.track(track).is_some(),
        Effect::Join { person } | Effect::Leave { person } => d.cast.person(person).is_some_and(|p| p.mate.is_some()),
        Effect::Schedule { person, at, until, .. } => {
            d.cast.person(person).is_some()
                && d.locations.iter().any(|l| &l.key == at)
                && until.is_none_or(|d0| valid_date(d, d0))
        }
        Effect::Cash { value } => value.abs_diff(0) <= 20_000,
        Effect::Fame { value } => (-20..=50).contains(value),
        Effect::Reputation { faction, value } => {
            d.factions.iter().any(|f| &f.key == faction) && (-20..=20).contains(value)
        }
        Effect::Chart { region } => d.regions.iter().any(|r| &r.key == region),
        Effect::LegendShip { ship } => {
            d.rules.ships.s02_enabled
                && d.legend_ships
                    .ship(ship)
                    .is_some_and(|s| s.acquire.kind == crate::legend_ships::AcquireKind::GrantStory)
        }
        Effect::World { title, text, effects } => {
            !title.trim().is_empty()
                && title.chars().count() <= d.composed.max_title_chars
                && !text.trim().is_empty()
                && text.chars().count() <= d.composed.max_text_chars
                && !effects.is_empty()
                && effects.len() <= d.composed.max_effects
                && crate::composed::strength(effects) <= d.composed.budget
                && effects.iter().all(|e| d.composed.bounds(e.effect).is_some())
        }
    };
    (!ok).then(|| format!("效果引用或数值无效：{e:?}"))
}

fn romance_error(d: &StaticData, t: &TrackDef, c: &ChapterDef, e: &Effect) -> Option<String> {
    use crate::cast::{PersonKind, relations};
    let (person, relation) = match e {
        Effect::Heart { person, .. } => (Some(person), Some(Relation::Crush)),
        Effect::Relation { person, relation, remove: false } => (Some(person), Some(*relation)),
        Effect::Tie { a, b, relation, remove: false } => {
            if let Some(action) = relations::action(*relation) {
                let (a, b) = d.cast.person(a).zip(d.cast.person(b))?;
                if a.kind == PersonKind::Historical || b.kind == PersonKind::Historical {
                    return Some("故事效果不得给历史人物编造恋情".into());
                }
                if let Some(w) = c.window {
                    let mut left = relations::actor(a, w[0]);
                    left.authority |= relations::declared_mentor(&d.cast, &a.key, &b.key, w[0]);
                    if let Err(e) = relations::romance_gate(&left, &relations::actor(b, w[0]), action, t.academy) {
                        return Some(e.to_string());
                    }
                }
            }
            (None, Some(*relation))
        }
        _ => (None, None),
    };
    if relation.and_then(relations::action).is_some()
        && person.and_then(|p| d.cast.person(p)).is_some_and(|p| p.kind == PersonKind::Historical)
    {
        return Some("历史人物不开放恋爱效果".into());
    }
    if t.academy && matches!(relation, Some(Relation::Lovers | Relation::Partners)) {
        return Some("学院期不能建立成年恋人或伴侣关系".into());
    }
    None
}
