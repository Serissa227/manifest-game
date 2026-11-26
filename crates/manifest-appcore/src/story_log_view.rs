//! 任务日志与门槛说明；名称来自当前语言，隐蔽轨道不在日志中提前出现。
use crate::{
    cast_view::{known, label},
    views::Ctx,
};
use manifest_core::{
    story2::{Condition, Objective, ObjectiveKind, Status, TrackKind},
    *,
};
use serde_json::{Value, json};

fn person(ctx: Ctx<'_>, key: &str) -> String {
    ctx.names.cast.person(key).map_or_else(|| key.into(), |p| p.name.clone())
}
pub(crate) fn attr(ctx: Ctx<'_>, key: &str) -> String {
    ctx.names.captain.check_index(key).map_or_else(
        || ctx.names.story2.skill_labels.iter().find(|s| s.key == key).map_or_else(|| key.into(), |s| s.name.clone()),
        |i| ctx.names.captain.check_name(i).into(),
    )
}
fn item(ctx: Ctx<'_>, key: &str) -> String {
    ctx.names.items.item(key).map_or_else(|| key.into(), |i| i.name.clone())
}
fn place(ctx: Ctx<'_>, w: &World, key: &str) -> String {
    ctx.names.locations.iter().enumerate().find(|(_, l)| l.key == key).map_or_else(
        || label(ctx, "未知地点", "Unknown destination").into(),
        |(i, l)| {
            let id = LocId::from_idx(i);
            if w.hides_unknown_locations() {
                return crate::navigation_view::visibility::place(ctx, w, id);
            }
            if w.state.explore.visited.contains(&id) || w.cast_player_place().is_some_and(|p| p.loc == id) {
                l.name.clone()
            } else {
                label(ctx, "尚未探明的地点", "Uncharted destination").into()
            }
        },
    )
}
fn flag(ctx: Ctx<'_>, w: &World, key: &str) -> String {
    ctx.names
        .story2
        .tracks
        .iter()
        .flat_map(|t| {
            t.chapters.iter().filter(|c| {
                w.state.story2.tracks.get(&t.key).is_some_and(|s| s.visited.contains(&c.key))
                    && (w.state.story2.news.get(&format!("{}:{}", t.key, c.key)).is_some_and(|n| n.known)
                        || w.state.story2.last.as_ref().is_some_and(|r| r.track == t.key && r.chapter == c.key))
            })
        })
        .find(|c| {
            manifest_core::story2::graph::branches(c)
                .iter()
                .flat_map(|b| &b.effects)
                .any(|e| matches!(e,manifest_core::story2::Effect::Flag{flag,..} if flag==key))
        })
        .map_or_else(|| label(ctx, "相关经历", "The required experience").into(), |c| c.title.clone())
}

pub(crate) fn requirement(ctx: Ctx<'_>, w: &World, c: &Condition) -> String {
    use Condition::*;
    match c {
        Protagonist { .. } | ProtagonistIn { .. } => label(ctx, "出身条件", "Origin requirement").into(),
        RomanceOpen { romance_open } => {
            format!("{} · {}", person(ctx, romance_open), label(ctx, "可以谈恋爱", "Open to romance"))
        }
        Society { society, ge } => {
            if !w.society_known(society) {
                return label(ctx, "尚未获知的条件", "Unknown requirement").into();
            }
            format!("{} ≥ {ge}", ctx.names.societies.society(society).map_or("", |s| s.name.as_str()))
        }
        Spell { spell } => {
            if !w.spell_known(spell) {
                return label(ctx, "尚未获知的条件", "Unknown requirement").into();
            }
            ctx.names.arcana.spell(spell).map_or(String::new(), |s| s.name.clone())
        }
        Lineage { .. } => label(ctx, "族裔条件", "Lineage requirement").into(),
        Date { from, to } => format!(
            "{} {}–{}",
            label(ctx, "日期", "Date"),
            from.map_or_else(|| "…".into(), |d| format!("{}-{}-{}", d[0], d[1], d[2])),
            to.map_or_else(|| "…".into(), |d| format!("{}-{}-{}", d[0], d[1], d[2]))
        ),
        Flag { flag: key, value } => format!(
            "{}：{}",
            label(ctx, if *value { "已完成" } else { "未完成" }, if *value { "Completed" } else { "Not completed" }),
            flag(ctx, w, key)
        ),
        At { at, person: p } => format!(
            "{}：{}",
            p.as_ref().map_or_else(|| label(ctx, "到达", "Reach").into(), |p| person(ctx, p)),
            place(ctx, w, at)
        ),
        Age { person: p, ge, le } => format!(
            "{} {} {}{}",
            p.as_ref().map_or_else(|| label(ctx, "主角", "Captain").into(), |p| person(ctx, p)),
            label(ctx, "年龄", "age"),
            ge.map_or(String::new(), |n| format!("≥ {n}")),
            le.map_or(String::new(), |n| format!(" ≤ {n}"))
        ),
        Affinity { person: p, ge } => format!("{} · {} ≥ {ge}", person(ctx, p), label(ctx, "情谊", "Affinity")),
        Heart { person: p, ge } => format!("{} · {} ≥ {ge}", person(ctx, p), label(ctx, "心动", "Heart")),
        Bond { person: p, level } => format!("{} · {} {level:?}", person(ctx, p), label(ctx, "羁绊", "Bond")),
        NotBondS { person: p } => format!("{} · {}", person(ctx, p), label(ctx, "尚无S级约定", "No lifelong promise")),
        Wait { days } => format!("{} {days} {}", label(ctx, "等待", "Wait"), label(ctx, "天", "days")),
        Season { season } => [
            label(ctx, "春季", "Spring"),
            label(ctx, "夏季", "Summer"),
            label(ctx, "秋季", "Autumn"),
            label(ctx, "冬季", "Winter"),
        ]
        .get(*season as usize)
        .copied()
        .unwrap_or_default()
        .into(),
        Attr { attr: key, ge } | Growth { attr: key, ge } => format!("{} ≥ {ge}", attr(ctx, key)),
        Skill { skill, ge } => format!("{} · {} ≥ {ge}", label(ctx, "技能经验", "Skill XP"), attr(ctx, skill)),
        Cash { ge } => format!("{} ≥ {ge}", ctx.names.rules.world.currency),
        Fame { ge } => format!("{} ≥ {ge}", label(ctx, "名声", "Fame")),
        Reputation { faction, ge } => format!(
            "{} · {} ≥ {ge}",
            ctx.names.factions.iter().find(|f| &f.key == faction).map_or(faction.as_str(), |f| f.name.as_str()),
            label(ctx, "声望", "Reputation")
        ),
        Item { item: key, qty } => format!("{} × {qty}", item(ctx, key)),
        Equipped { item: key } => format!("{}：{}", label(ctx, "装备", "Equipped"), item(ctx, key)),
        Mate { mate } => format!(
            "{}：{}",
            label(ctx, "同行", "In the crew"),
            ctx.names.mates.iter().find(|m| &m.key == mate).map_or(mate.as_str(), |m| m.name.as_str())
        ),
        Relation { person: p, relation } => {
            format!("{} · {}", person(ctx, p), crate::cast_view::relation_label(ctx, *relation))
        }
        Tie { a, b, relation } => {
            format!("{} / {} · {}", person(ctx, a), person(ctx, b), crate::cast_view::relation_label(ctx, *relation))
        }
        Alive { person: p, value } => format!(
            "{} · {}",
            person(ctx, p),
            label(ctx, if *value { "在世" } else { "已故" }, if *value { "Alive" } else { "Deceased" })
        ),
        Read { work } => format!(
            "{}：{}",
            label(ctx, "读过", "Read"),
            ctx.names.items.items.iter().find(|i| i.work_key() == work).map_or(work.as_str(), |i| i.name.as_str())
        ),
        Books { category, ge } => format!(
            "{}{} ≥ {ge}",
            label(ctx, "读书册数", "Books read"),
            category.as_ref().map_or(String::new(), |c| format!(" · {c}"))
        ),
        Gifts { person: p, .. } => {
            format!("{} · {}", person(ctx, p), label(ctx, "满足赠礼累计要求", "Meet the gift requirement"))
        }
        Price { good, at, ge, le } => format!(
            "{} · {} {}{}",
            place(ctx, w, at),
            ctx.names.goods.iter().find(|g| &g.key == good).map_or(good.as_str(), |g| g.name.as_str()),
            ge.map_or(String::new(), |n| format!("≥ {n}")),
            le.map_or(String::new(), |n| format!(" ≤ {n}"))
        ),
        Location { culture, port } => format!(
            "{}{}",
            culture.as_deref().unwrap_or_default(),
            port.map_or("", |v| label(ctx, if v { "港口" } else { "陆上" }, if v { "port" } else { "inland" }))
        ),
        Visited { at: Some(at), .. }
        | HouseLevel { at: Some(at), .. }
        | Warehouse { at: Some(at), .. }
        | Industries { at: Some(at), .. }
        | Rank { at, .. } => place(ctx, w, at),
        Visited { ge, .. } | Warehouse { ge, .. } => format!("≥ {}", ge.unwrap_or(1)),
        PortsKnown { ge }
        | HouseLevel { ge, .. }
        | Industries { ge, .. }
        | Ships { ge }
        | ShipTier { ge }
        | Mates { ge }
        | Deed { ge, .. } => format!("≥ {ge}"),
        Post { post } => {
            ctx.names.captain.roles.iter().find(|r| &r.key == post).map_or_else(String::new, |r| r.name.clone())
        }
        Any { any } => any.iter().map(|c| requirement(ctx, w, c)).collect::<Vec<_>>().join("／"),
    }
}

fn objective_text(ctx: Ctx<'_>, w: &World, o: &Objective) -> String {
    if let Some(text) = &o.text {
        return text.clone();
    }
    let text = match &o.kind {
        ObjectiveKind::Goods { good, qty, at } => format!(
            "{} {} × {qty} → {}",
            label(ctx, "交付", "Deliver"),
            ctx.names.goods.iter().find(|g| &g.key == good).map_or(good.as_str(), |g| g.name.as_str()),
            place(ctx, w, at)
        ),
        ObjectiveKind::Item { item: key, qty } => format!("{} {} × {qty}", label(ctx, "携带", "Carry"), item(ctx, key)),
        ObjectiveKind::At { at } => requirement(ctx, w, &Condition::At { at: at.clone(), person: None }),
        ObjectiveKind::Person { person: p } => format!("{} {}", label(ctx, "找到", "Find"), person(ctx, p)),
        ObjectiveKind::Affinity { person, ge } => {
            requirement(ctx, w, &Condition::Affinity { person: person.clone(), ge: *ge })
        }
        ObjectiveKind::Cash { ge } => requirement(ctx, w, &Condition::Cash { ge: *ge }),
        ObjectiveKind::Fame { ge } => requirement(ctx, w, &Condition::Fame { ge: *ge }),
        ObjectiveKind::Wait { days } => requirement(ctx, w, &Condition::Wait { days: *days }),
        ObjectiveKind::Battle { wins } => format!("{} {wins}", label(ctx, "赢得海战", "Win sea battles")),
        ObjectiveKind::Attr { .. }
        | ObjectiveKind::Growth { .. }
        | ObjectiveKind::Skill { .. }
        | ObjectiveKind::Bond { .. } => o.kind.condition().map_or_else(String::new, |c| requirement(ctx, w, &c)),
        ObjectiveKind::Discovery { discovery, reported } => format!(
            "{} {}",
            label(ctx, if *reported { "报告" } else { "发现" }, if *reported { "Report" } else { "Discover" }),
            ctx.names.discoveries.iter().find(|d| &d.key == discovery).map_or(discovery.as_str(), |d| d.name.as_str())
        ),
        ObjectiveKind::Visited { .. }
        | ObjectiveKind::PortsKnown { .. }
        | ObjectiveKind::HouseLevel { .. }
        | ObjectiveKind::Warehouse { .. }
        | ObjectiveKind::Industries { .. }
        | ObjectiveKind::Ships { .. }
        | ObjectiveKind::ShipTier { .. }
        | ObjectiveKind::Mates { .. }
        | ObjectiveKind::Post { .. }
        | ObjectiveKind::Rank { .. }
        | ObjectiveKind::Deed { .. } => o.kind.condition().map_or_else(String::new, |c| requirement(ctx, w, &c)),
        ObjectiveKind::Any { any } => any
            .iter()
            .map(|kind| objective_text(ctx, w, &Objective { text: None, kind: kind.clone() }))
            .collect::<Vec<_>>()
            .join("／"),
    };
    crate::navigation_view::visibility::redact_text(ctx, w, &text)
}

fn objective_done(w: &World, c: &manifest_core::story2::ChapterDef, index: usize, entered: u32) -> bool {
    let Some(mut check) = c.objectives.get(index).cloned() else {
        return false;
    };
    if let ObjectiveKind::Goods { good, qty, at } = &mut check.kind {
        let Some(total) = c
            .objectives
            .iter()
            .filter_map(|o| match &o.kind {
                ObjectiveKind::Goods { good: g, qty: q, at: a } if g == good && a == at => Some(*q),
                _ => None,
            })
            .try_fold(0i64, |a, b| a.checked_add(b))
        else {
            return false;
        };
        *qty = total;
    }
    w.story2_objective_done(&check, entered)
}

pub fn story_log(ctx: Ctx<'_>, w: &World) -> Value {
    let mut tracks = Vec::new();
    for (key, state) in &w.state.story2.tracks {
        let Some(t) = ctx.names.story2.track(key) else {
            continue;
        };
        let pending = w.state.story2.pending.iter().any(|p| &p.track == key);
        let disclosed = pending
            || t.kind == TrackKind::Main
            || w.state.story2.last.as_ref().is_some_and(|r| &r.track == key)
            || w.known_news(None).iter().any(|n| &n.track == key)
            || (!t.auto && t.cast.iter().any(|p| known(w, p)));
        if !disclosed {
            continue;
        }
        // 自治轨道可能已在远处继续发展；只展示最近一次已知的章节。
        let heard = w.known_news(None).into_iter().find(|n| &n.track == key);
        let private_progress = t.auto && t.kind != TrackKind::Main && !pending;
        let chapter = if private_progress {
            heard
                .and_then(|n| n.id.strip_prefix(&format!("{key}:")))
                .or_else(|| w.state.story2.last.as_ref().filter(|r| &r.track == key).map(|r| r.chapter.as_str()))
                .unwrap_or(&state.chapter)
        } else {
            &state.chapter
        };
        let Some(c) = t.chapter(chapter) else {
            continue;
        };
        let raw = w.defs.story2.track(key).and_then(|t| t.chapter(chapter));
        let status = if private_progress {
            heard.and_then(|n| crate::story2_view::news_next(w, n)).map_or("waiting", |next| match next {
                "done" => "done",
                "failed" => "failed",
                _ => "waiting",
            })
        } else {
            match state.status {
                Status::Done => "done",
                Status::Failed => "failed",
                Status::Active if pending => "active",
                Status::Active | Status::Waiting => "waiting",
            }
        };
        let mut due = w.story2_deadline(c, state.entered);
        if let Some(end) = c.window.and_then(|win| w.story2_day(win[1])) {
            due = Some(due.map_or(end, |d| d.min(end)));
        }
        if private_progress {
            due = None;
        }
        let deadline = due.map(|day| {
            let d = w.defs.calendar.date_of(day);
            [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
        });
        let objectives:Vec<_>=c.objectives.iter().enumerate().map(|(i,o)|{
            let dest=match &o.kind{ObjectiveKind::Goods{at,..}|ObjectiveKind::At{at}=>Some(place(ctx,w,at)),ObjectiveKind::Person{person:p} if known(w,p)&&w.person_here(p)=>w.person_place(p).map(|at|ctx.names.loc(at.loc).name.clone()),_=>None};
            json!({"text":objective_text(ctx,w,o),"done":w.state.story2.completed_objectives.contains(&(key.clone(),chapter.into())) || (!private_progress && raw.is_some_and(|c|objective_done(w,c,i,state.entered))),"place":dest,"deadline":deadline,"days_left":due.map(|d|i64::from(d)-i64::from(w.day()))})
        }).collect();
        tracks.push(json!({"key":key,"name":t.name,"kind":t.kind,"status":status,"chapter":chapter,"chapter_title":c.title,"objectives":objectives}));
    }
    if let Ok(Some(progress)) = w.legacy_story_track()
        && let Some(t) = ctx.names.stories.stories.iter().find(|s| s.key == progress.track)
    {
        let chapter = t.chapters.iter().find(|c| c.key == progress.chapter);
        tracks.push(json!({"key":t.key,"name":t.name,"kind":"main","status":if chapter.is_none(){"done"}else if progress.pending.is_some(){"active"}else{"waiting"},"chapter":progress.chapter,"chapter_title":chapter.map(|c|c.title.as_str()).unwrap_or_else(||label(ctx,"已完成","Completed")),"objectives":chapter.filter(|c|!c.hint.is_empty()).map(|c|vec![json!({"text":c.hint,"done":false})]).unwrap_or_default()}));
    }
    let mut value = json!({"tracks":tracks});
    if w.defs.rules.quests.enabled {
        let log = crate::quest_view::quest_log(ctx, w);
        value["quests"] = json!(log.quests);
        value["pinned"] = json!(log.pinned);
        value["pinned_auto"] = json!(log.pinned_auto);
    }
    crate::navigation_view::visibility::redact_narrative_prose(ctx, w, &mut value);
    value
}
