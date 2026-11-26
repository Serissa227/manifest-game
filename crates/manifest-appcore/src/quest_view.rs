//! 统一任务读模型；只给种类、参数和数据里的文字，不生成玩家句子。
use crate::views::Ctx;
use manifest_core::{
    story2::{
        Condition, Effect, Objective, ObjectiveKind,
        guide_defs::Phase,
        quests::{QuestEntry, QuestKind, QuestStatus},
    },
    *,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize)]
pub struct PlaceRef {
    pub loc: Option<u16>,
    pub label: Option<String>,
    pub known: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ObjectiveRow {
    pub kind: &'static str,
    pub params: Value,
    pub labels: BTreeMap<String, Option<String>>,
    pub place: Option<PlaceRef>,
    pub have: i64,
    pub need: i64,
    pub done: bool,
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub any: Vec<ObjectiveRow>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Go {
    pub port: Option<PlaceRef>,
    pub place: Option<String>,
    pub panel: Option<String>,
    pub wait_until: Option<[u32; 3]>,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuestView {
    pub id: String,
    pub kind: QuestKind,
    pub status: QuestStatus,
    pub phase: Phase,
    pub title: Option<String>,
    pub chapter_title: Option<String>,
    pub hint: Option<String>,
    pub teaches: Vec<String>,
    pub rows: Vec<ObjectiveRow>,
    pub implicit: Vec<Value>,
    pub go: Option<Go>,
    pub rewards: Vec<Value>,
    pub rewards_hidden: bool,
    pub rewards_vary: bool,
    pub deadline: Option<[u32; 3]>,
    pub days_left: Option<i64>,
    pub pinned: bool,
    pub failure: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuestLog {
    pub quests: Vec<QuestView>,
    pub pinned: Option<String>,
    pub pinned_auto: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuestPin {
    pub id: String,
    pub kind: QuestKind,
    pub phase: Phase,
    pub title: Option<String>,
    pub hint: Option<String>,
    pub row: Option<Value>,
    pub progress: Value,
    pub go: Option<Go>,
    pub days_left: Option<i64>,
    pub auto: bool,
}

fn date(w: &World, day: u32) -> [u32; 3] {
    let d = w.defs.calendar.date_of(day);
    [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}

fn place(ctx: Ctx<'_>, w: &World, id: LocId) -> PlaceRef {
    let known = !w.hides_unknown_locations() || w.location_visible(id);
    PlaceRef { loc: known.then_some(id.0), label: known.then(|| ctx.names.loc(id).name.clone()), known }
}

fn named_place(ctx: Ctx<'_>, w: &World, key: &str) -> Option<PlaceRef> {
    w.defs.find_loc(key).map(|id| place(ctx, w, id))
}

fn bond(b: Option<manifest_core::cast::relations::Bond>) -> i64 {
    use manifest_core::cast::relations::Bond;
    match b {
        None => 0,
        Some(Bond::C) => 1,
        Some(Bond::B) => 2,
        Some(Bond::A) => 3,
        Some(Bond::S) => 4,
    }
}

fn label(ctx: Ctx<'_>, kind: &str, key: &str) -> Option<String> {
    match kind {
        "good" => ctx.names.goods.iter().find(|x| x.key == key).map(|x| x.name.clone()),
        "item" => ctx.names.items.item(key).map(|x| x.name.clone()),
        "person" => ctx.names.cast.person(key).map(|x| x.name.clone()),
        "faction" => ctx.names.factions.iter().find(|x| x.key == key).map(|x| x.name.clone()),
        "discovery" => ctx.names.discoveries.iter().find(|x| x.key == key).map(|x| x.name.clone()),
        "industry" => ctx.names.industry_types.iter().find(|x| x.key == key).map(|x| x.name.clone()),
        "post" => ctx.names.captain.roles.iter().find(|x| x.key == key).map(|x| x.name.clone()),
        "attr" | "skill" => Some(crate::story_log_view::attr(ctx, key)),
        _ => None,
    }
}

fn objective_row(ctx: Ctx<'_>, w: &World, o: &Objective, entered: u32, track: Option<&str>) -> ObjectiveRow {
    use ObjectiveKind::*;
    let condition = o.kind.condition();
    let new = condition.as_ref().and_then(|c| w.quest_condition_progress(c, entered, track));
    let done = w.story2_objective_done_in(o, entered, track);
    let (kind, mut params, dest, have, need) = match &o.kind {
        Goods { good, qty, at } => {
            let have = w.defs.goods.iter().position(|g| &g.key == good).map_or(0, |i| {
                w.fleets_of(OwnerId::Player)
                    .filter(|f| f.docked_at().is_some_and(|id| &w.defs.loc(id).key == at))
                    .fold(0i64, |sum, f| sum.saturating_add(f.cargo.get(&GoodId::from_idx(i)).copied().unwrap_or(0)))
            });
            ("deliver", json!({"good":good,"qty":qty}), Some(at.as_str()), have.min(*qty), *qty)
        }
        Item { item, qty } => {
            ("item", json!({"item":item,"qty":qty}), None, w.item_quantity(OwnerId::Player, item), *qty)
        }
        At { at } => ("at", json!({}), Some(at.as_str()), i64::from(done), 1),
        Person { person } => ("person", json!({"person":person}), None, i64::from(done), 1),
        Affinity { person, ge } => {
            ("affinity", json!({"person":person,"ge":ge}), None, w.affection(person).map_or(0, |a| a.affinity), *ge)
        }
        Cash { ge } => {
            ("cash", json!({"ge":ge}), None, w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash), *ge)
        }
        Fame { ge } => (
            "fame",
            json!({"ge":ge}),
            None,
            if w.upbringing_active() {
                w.state.upbringing.as_ref().map_or(0, |s| s.fame)
            } else {
                w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.fame)
            },
            *ge,
        ),
        Wait { days } => {
            ("wait", json!({"days":days}), None, i64::from(w.day().saturating_sub(entered)), i64::from(*days))
        }
        Battle { wins } => (
            "battle",
            json!({"wins":wins}),
            None,
            i64::from(w.deed_have(manifest_core::story2::deeds::Deed::BattleWin, true, track, entered)),
            i64::from(*wins),
        ),
        Discovery { discovery, reported } => {
            ("discovery", json!({"discovery":discovery,"reported":reported}), None, i64::from(done), 1)
        }
        Attr { attr, ge } => ("attr", json!({"attr":attr,"ge":ge}), None, w.story2_check_value(attr), *ge),
        Growth { attr, ge } => ("growth", json!({"attr":attr,"ge":ge}), None, w.upbringing_growth(attr), *ge),
        Skill { skill, ge } => (
            "skill",
            json!({"skill":skill,"ge":ge}),
            None,
            if w.upbringing_active() { w.upbringing_skill_xp(skill) } else { w.story2_check_value(skill) },
            *ge,
        ),
        Bond { person, level } => (
            "bond",
            json!({"person":person,"level":level}),
            None,
            bond(w.affection(person).and_then(|a| a.bond)),
            bond(Some(*level)),
        ),
        Visited { at, ge } => {
            ("visited", json!({"ge":ge}), at.as_deref(), new.map_or(0, |p| p.0), new.map_or(1, |p| p.1))
        }
        PortsKnown { ge } => ("ports_known", json!({"ge":ge}), None, new.map_or(0, |p| p.0), i64::from(*ge)),
        HouseLevel { at, ge } => {
            ("house_level", json!({"ge":ge}), at.as_deref(), new.map_or(0, |p| p.0), i64::from(*ge))
        }
        Warehouse { at, ge } => {
            ("warehouse", json!({"ge":ge}), at.as_deref(), new.map_or(0, |p| p.0), new.map_or(1, |p| p.1))
        }
        Industries { at, industry, ge } => {
            ("industries", json!({"industry":industry,"ge":ge}), at.as_deref(), new.map_or(0, |p| p.0), i64::from(*ge))
        }
        Ships { ge } => ("ships", json!({"ge":ge}), None, new.map_or(0, |p| p.0), i64::from(*ge)),
        ShipTier { ge } => ("ship_tier", json!({"ge":ge}), None, new.map_or(0, |p| p.0), i64::from(*ge)),
        Mates { ge } => ("mates", json!({"ge":ge}), None, new.map_or(0, |p| p.0), i64::from(*ge)),
        Post { post } => ("post", json!({"post":post}), None, new.map_or(0, |p| p.0), 1),
        Rank { at, ge } => ("rank", json!({"ge":ge}), Some(at.as_str()), new.map_or(0, |p| p.0), i64::from(*ge)),
        Deed { deed, ge, since_entered } => (
            "deed",
            json!({"deed":deed,"ge":ge,"since_entered":since_entered}),
            None,
            new.map_or(0, |p| p.0),
            i64::from(*ge),
        ),
        Any { .. } => ("any", json!({}), None, i64::from(done), 1),
    };
    if let Some(p) = params.as_object_mut() {
        p.retain(|_, v| !v.is_null());
    }
    let labels = params
        .as_object()
        .into_iter()
        .flat_map(|p| p.iter())
        .filter_map(|(kind, value)| {
            value
                .as_str()
                .filter(|_| {
                    ["good", "item", "person", "faction", "discovery", "industry", "post", "attr", "skill"]
                        .contains(&kind.as_str())
                })
                .map(|key| (kind.clone(), label(ctx, kind, key)))
        })
        .collect();
    ObjectiveRow {
        kind,
        params,
        labels,
        place: dest.and_then(|p| named_place(ctx, w, p)),
        have,
        need,
        done,
        text: o.text.clone(),
        any: if let Any { any } = &o.kind {
            any.iter()
                .map(|kind| objective_row(ctx, w, &Objective { text: None, kind: kind.clone() }, entered, track))
                .collect()
        } else {
            Vec::new()
        },
    }
}

fn rows(ctx: Ctx<'_>, w: &World, objectives: &[Objective], entered: u32, track: Option<&str>) -> Vec<ObjectiveRow> {
    let mut merged = Vec::<Objective>::new();
    for o in objectives {
        if let ObjectiveKind::Goods { good, at, qty } = &o.kind
            && let Some(old) = merged
                .iter_mut()
                .find(|old| matches!(&old.kind, ObjectiveKind::Goods { good: g, at: a, .. } if g == good && a == at))
            && let ObjectiveKind::Goods { qty: total, .. } = &mut old.kind
        {
            *total = total.saturating_add(*qty);
        } else {
            merged.push(o.clone());
        }
    }
    merged.iter().map(|o| objective_row(ctx, w, o, entered, track)).collect()
}

fn rewards(ctx: Ctx<'_>, effects: &[Effect]) -> Vec<Value> {
    effects.iter().filter_map(|e| Some(match e {
        Effect::Cash { value } => json!({"kind":"cash","value":value}),
        Effect::Fame { value } => json!({"kind":"fame","value":value}),
        Effect::Reputation { faction, value } => json!({"kind":"reputation","faction":faction,"label":label(ctx,"faction",faction),"value":value}),
        Effect::Item { item, qty } => json!({"kind":"item","item":item,"label":label(ctx,"item",item),"qty":qty}),
        Effect::Chart { region } => json!({"kind":"chart","region":region,"label":ctx.names.regions.iter().find(|r| &r.key==region).map(|r|&r.name)}),
        Effect::Skill { skill, value } => json!({"kind":"skill","skill":skill,"label":label(ctx,"skill",skill),"value":value}),
        Effect::Growth { attr, value } => json!({"kind":"growth","attr":attr,"label":label(ctx,"attr",attr),"value":value}),
        Effect::Join { person } => json!({"kind":"join","person":person,"label":label(ctx,"person",person)}),
        Effect::Memory { .. } => json!({"kind":"memory"}),
        _ => return None,
    })).collect()
}

fn story(ctx: Ctx<'_>, w: &World, e: &QuestEntry, q: &mut QuestView, key: &str) {
    if e.status == QuestStatus::Failed {
        use manifest_core::story2::{
            FAILURE_DEFAULT_MISSING, FAILURE_SETTLE_FAILED, FAILURE_TIMEOUT_MISSING, FAILURE_WINDOW_UNMET,
        };
        q.failure = Some(match w.state.story2.tracks.get(key).and_then(|s| s.failure.as_deref()) {
            Some(FAILURE_WINDOW_UNMET) => FAILURE_WINDOW_UNMET,
            Some(FAILURE_TIMEOUT_MISSING) => FAILURE_TIMEOUT_MISSING,
            Some(FAILURE_DEFAULT_MISSING) => FAILURE_DEFAULT_MISSING,
            Some(FAILURE_SETTLE_FAILED) => FAILURE_SETTLE_FAILED,
            _ => "other",
        });
    }
    let Some(t) = ctx.names.story2.track(key) else { return };
    let Some(c) = e.chapter.as_ref().and_then(|ch| t.chapter(ch)) else { return };
    q.title = Some(t.name.clone());
    q.chapter_title = Some(c.title.clone());
    q.hint = c.hint.clone();
    if e.private_progress {
        return;
    }
    q.teaches = c.teaches.clone();
    q.rows = rows(ctx, w, &c.objectives, e.entered, Some(key));
    if w.state.story2.completed_objectives.contains(&(key.into(), c.key.clone())) {
        for row in &mut q.rows {
            row.done = true;
        }
    }
    let mut places = BTreeSet::new();
    places.extend(c.at.iter().cloned());
    places.extend(c.when.iter().filter_map(|c| match c {
        Condition::At { at, person: None } => Some(at.clone()),
        _ => None,
    }));
    for p in &places {
        q.implicit.push(json!({"kind":"go_to","place":named_place(ctx,w,p),"done":w.cast_player_place().is_some_and(|here| &w.defs.loc(here.loc).key == p)}));
    }
    let waits = c
        .when
        .iter()
        .filter_map(|c| match c {
            Condition::Date { from: Some(d), .. } => w.story2_day(*d),
            Condition::Wait { days } => Some(e.entered.saturating_add(*days)),
            _ => None,
        })
        .chain(c.window.and_then(|win| w.story2_day(win[0])))
        .filter(|d| *d > w.day())
        .collect::<BTreeSet<_>>();
    for day in &waits {
        q.implicit.push(json!({"kind":"wait_until","date":date(w,*day),"days":i64::from(*day)-i64::from(w.day())}));
    }
    if let Some(due) = e.due {
        q.implicit.push(json!({"kind":"days_left","date":date(w,due),"days":i64::from(due)-i64::from(w.day())}));
    }
    let target = c.go.as_ref().and_then(|g| g.port.as_ref()).or(c.at.as_ref());
    if c.go.is_some() || c.at.is_some() {
        let at = places.iter().all(|p| w.cast_player_place().is_some_and(|here| &w.defs.loc(here.loc).key == p));
        let only_date = w.story2_conditions_in(
            &c.when
                .iter()
                .filter(|c| !matches!(c, Condition::Date { .. } | Condition::Wait { .. }))
                .cloned()
                .collect::<Vec<_>>(),
            e.entered,
            Some(key),
        ) && q.rows.iter().all(|r| r.done);
        q.go = Some(Go {
            port: target.and_then(|p| named_place(ctx, w, p)),
            place: c.go.as_ref().and_then(|g| g.place.clone()),
            panel: c.go.as_ref().and_then(|g| g.panel.clone()),
            wait_until: (at && only_date).then(|| waits.last().map(|d| date(w, *d))).flatten(),
        });
    }
    if e.kind == QuestKind::Guide {
        let visible = c.choices.iter().filter(|o| w.story2_choice_visible(o, e.entered)).collect::<Vec<_>>();
        if let Some(first) = visible.first() {
            q.rewards = rewards(ctx, &first.effects);
            q.rewards_vary = visible.iter().any(|o| o.effects != first.effects);
        }
    }
}

pub fn quest_log(ctx: Ctx<'_>, w: &World) -> QuestLog {
    let entries = w.quest_entries();
    let (pinned, pinned_auto) = w.quest_pin_id(&entries);
    let mut quests = Vec::new();
    for e in &entries {
        let mut q = QuestView {
            id: e.id.clone(),
            kind: e.kind,
            status: e.status,
            phase: e.phase,
            title: None,
            chapter_title: None,
            hint: None,
            teaches: Vec::new(),
            rows: Vec::new(),
            implicit: Vec::new(),
            go: None,
            rewards: Vec::new(),
            rewards_hidden: !matches!(e.kind, QuestKind::Guide | QuestKind::Contract | QuestKind::AnnualGoal),
            rewards_vary: false,
            deadline: e.due.map(|d| date(w, d)),
            days_left: e.due.map(|d| i64::from(d) - i64::from(w.day())),
            pinned: pinned.as_ref() == Some(&e.id),
            failure: None,
        };
        if let Some(key) = e.id.strip_prefix("track:") {
            story(ctx, w, e, &mut q, key);
        }
        if let Some(c) =
            e.id.strip_prefix("contract:")
                .and_then(|id| id.parse::<u32>().ok())
                .and_then(|id| w.state.contracts.get(&ContractId(id)))
        {
            let good = &w.defs.good(c.good).key;
            let have = w
                .fleets_of(OwnerId::Player)
                .fold(0i64, |sum, f| sum.saturating_add(f.cargo.get(&c.good).copied().unwrap_or(0)))
                .min(c.qty);
            q.rows.push(ObjectiveRow {
                kind: "deliver",
                params: json!({"good":good,"qty":c.qty}),
                labels: BTreeMap::from([("good".into(), label(ctx, "good", good))]),
                place: Some(place(ctx, w, c.to)),
                have,
                need: c.qty,
                done: have >= c.qty,
                text: None,
                any: Vec::new(),
            });
            q.implicit.push(json!({"kind":"go_to","place":place(ctx,w,c.to),"done":w.cast_player_place().is_some_and(|p|p.loc==c.to)}));
            q.implicit.push(json!({"kind":"days_left","date":date(w,c.deadline),"days":q.days_left}));
            q.go = Some(Go {
                port: Some(place(ctx, w, c.to)),
                place: None,
                panel: Some("guild".into()),
                wait_until: None,
            });
            let faction = &w.defs.faction(c.issuer).key;
            q.rewards = vec![
                json!({"kind":"cash","value":c.reward}),
                json!({"kind":"reputation","faction":faction,"label":label(ctx,"faction",faction),"value":w.defs.rules.contracts.reputation_gain}),
                json!({"kind":"penalty","value":c.penalty}),
            ];
        }
        if let Some(g) =
            e.id.strip_prefix("goal:").and_then(|key| ctx.names.upbringing.annual_goals.iter().find(|g| g.key == key))
        {
            q.hint = (!g.text.is_empty()).then(|| g.text.clone());
            q.rows = g.objectives.iter().map(|o| objective_row(ctx, w, o, e.entered, None)).collect();
            for (row, o) in q.rows.iter_mut().zip(&g.objectives) {
                let p = w.upbringing_goal_progress(o, e.entered);
                row.have = p.have;
                row.need = p.need;
                row.done = p.done;
            }
            q.go = Some(Go { port: None, place: None, panel: Some("ub_goals".into()), wait_until: None });
            q.rewards = rewards(ctx, &g.rewards);
            if let Some(due) = e.due {
                q.implicit.push(json!({"kind":"days_left","date":date(w,due),"days":q.days_left}));
            }
        }
        quests.push(q);
    }
    // 结构化目的地仍按可见性投影；作者填写的目标、标题与提示保留普通地名。
    let mut value = json!({"quests":quests});
    crate::navigation_view::visibility::redact_narrative_prose(ctx, w, &mut value);
    // 需要遮蔽的仅是数据文字；直接将遮蔽后的字段写回，避免反序列化整个契约。
    for (q, v) in quests.iter_mut().zip(value["quests"].as_array().into_iter().flatten()) {
        q.title = v["title"].as_str().map(str::to_owned);
        q.chapter_title = v["chapter_title"].as_str().map(str::to_owned);
        q.hint = v["hint"].as_str().map(str::to_owned);
        for (r, vr) in q.rows.iter_mut().zip(v["rows"].as_array().into_iter().flatten()) {
            r.text = vr["text"].as_str().map(str::to_owned);
        }
    }
    QuestLog { quests, pinned, pinned_auto }
}

pub fn quest_pin(ctx: Ctx<'_>, w: &World) -> Option<QuestPin> {
    if !w.defs.rules.quests.enabled {
        return None;
    }
    let log = quest_log(ctx, w);
    let q = log.quests.iter().find(|q| Some(&q.id) == log.pinned.as_ref())?;
    Some(QuestPin {
        id: q.id.clone(),
        kind: q.kind,
        phase: q.phase,
        title: q.title.clone(),
        hint: q.hint.clone(),
        row: q.rows.iter().find(|r| !r.done).map(|r| json!(r)).or_else(|| q.implicit.first().cloned()),
        progress: json!({"done":q.rows.iter().filter(|r|r.done).count(),"total":q.rows.len()}),
        go: q.go.clone(),
        days_left: q.days_left,
        auto: log.pinned_auto,
    })
}
