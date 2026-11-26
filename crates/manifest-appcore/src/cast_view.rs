//! I5/I5b人物视图：读模型只用玩家已知的事实，不把世界的秘密状态透传给界面。
use crate::views::{Ctx, PLAYER};
use manifest_core::{
    cast::{
        PersonDef,
        interactions::Reaction,
        relations::{Relation, RomanceAction, TieState},
    },
    story2::{Effect, Status},
    *,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) fn label<'a>(ctx: Ctx<'_>, zh: &'a str, en: &'a str) -> &'a str {
    if ctx.tr.is_some() { en } else { zh }
}
pub(crate) fn known(w: &World, key: &str) -> bool {
    w.state.cast.persons.get(key).is_some_and(|p| p.met)
        || w.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(key)
}
pub(crate) fn relation_label(ctx: Ctx<'_>, relation: Relation) -> &'static str {
    let (zh, en) = match relation {
        Relation::Friends => ("朋友", "Friends"),
        Relation::Confidants => ("知己", "Confidants"),
        Relation::Sisters => ("姐妹 / 兄弟", "Siblings"),
        Relation::Sworn => ("结义", "Sworn companions"),
        Relation::Mentor => ("师徒", "Mentor"),
        Relation::Rivals => ("对手", "Rivals"),
        Relation::Enemies => ("宿敌", "Enemies"),
        Relation::Crush => ("在意", "Fondness"),
        Relation::Promise => ("约定", "Promise"),
        Relation::Dating => ("交往", "Dating"),
        Relation::Lovers => ("恋人", "Lovers"),
        Relation::Partners => ("伴侣", "Partners"),
    };
    label(ctx, zh, en)
}

fn is_player(w: &World, key: &str) -> bool {
    w.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(key)
}
/// 养成期的同窗／对手：本家各学段学院名册里的角色优先，其次家族同伴名单（如家乡的对手）。
/// 不随当前学段变，返乡探亲时已结羁绊的同窗也不改回生分的叫法；与称呼交接单的关系一致。
fn youth_peer(w: &World, key: &str) -> bool {
    let Some(family) = w.upbringing_family() else { return false };
    let role = family
        .stages
        .iter()
        .filter_map(|s| s.academy.as_deref())
        .filter_map(|k| w.defs.upbringing.academy(k))
        .find_map(|a| a.companions.get(key))
        .or_else(|| family.companions.get(key));
    matches!(role, Some(upbringing::CompanionRole::Classmate | upbringing::CompanionRole::Rival))
}
fn call_name(ctx: Ctx<'_>, w: &World, p: &PersonDef, player_name: Option<&str>) -> String {
    let bond = w.affection(&p.key).and_then(|a| a.bond);
    let rank = |s: &str| match s {
        "S" => 4,
        "A" => 3,
        "B" => 2,
        "C" => 1,
        _ => 0,
    };
    let current = bond.map_or(0, |b| {
        rank(match b {
            manifest_core::cast::relations::Bond::C => "C",
            manifest_core::cast::relations::Bond::B => "B",
            manifest_core::cast::relations::Bond::A => "A",
            manifest_core::cast::relations::Bond::S => "S",
        })
    });
    let matched =
        || p.names.iter().filter(|n| rank(&n.bond) <= current).max_by_key(|n| rank(&n.bond)).map(|n| n.name.clone());
    if w.upbringing_active() {
        let family = w.upbringing_family().map(|f| w.upbringing_family_in(&ctx.names.upbringing).unwrap_or(f));
        // 养成期：结了羁绊的同窗／对手 names → 家族 call_you → youth_name → 主角姓名。
        // 同窗随羁绊升级的改口不能被 call_you 盖住；没有羁绊、或该等级没有 names 时才用 call_you。
        // 家人、导师、朋友、笔友不看 names，始终先用 call_you。
        if bond.is_some()
            && youth_peer(w, &p.key)
            && let Some(name) = matched().filter(|s| !s.trim().is_empty())
        {
            return name;
        }
        if let Some(name) = family.and_then(|f| f.call_you.get(&p.key)).filter(|s| !s.trim().is_empty()) {
            return name.clone();
        }
        if let Some(name) = family.map(|f| f.youth_name.as_str()).filter(|s| !s.trim().is_empty()) {
            return name.into();
        }
        return player_name
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
            .or_else(|| {
                w.state
                    .protagonist
                    .as_ref()
                    .and_then(|i| i.protagonist.as_deref())
                    .and_then(|key| ctx.names.cast.person(key))
                    .map(|p| p.name.clone())
            })
            .unwrap_or_default();
    }
    matched().unwrap_or_else(|| label(ctx, "船长", "Captain").into())
}

fn relation_card(ctx: Ctx<'_>, w: &World, p: &PersonDef, player_name: Option<&str>) -> Value {
    let a = w.affection(&p.key);
    let heart = w.validate_romance(&p.key, RomanceAction::Heart).is_ok().then(|| a.map_or(0, |a| a.heart));
    let here = w.person_here(&p.key);
    let place = here.then(|| w.person_place(&p.key)).flatten().map(|at| {
        let name = &ctx.names.loc(at.loc).name;
        venue(ctx, at.loc, &at.venue).map_or_else(|| name.clone(), |venue| format!("{name} · {venue}"))
    });
    let relations: Vec<_> = w.visible_relations(&p.key).into_iter().map(|r| relation_label(ctx, r)).collect();
    json!({"key":p.key,"name":p.name,"portrait":p.portrait(w.cast_date()),"age":p.age_on(w.cast_date()).unwrap_or(0),"kind":p.kind,"role":p.role,"summary":p.summary,"where":place,
        "affinity":a.map_or(0,|a|a.affinity),"heart":heart,"heart_stage":heart.map(|v|if v>=80 {3}else if v>=50 {2}else if v>=20 {1}else{0}),
        "bond":a.and_then(|a|a.bond),"relation":relations,"call_name":call_name(ctx,w,p,player_name)})
}
fn card(ctx: Ctx<'_>, w: &World, p: &PersonDef, player_name: Option<&str>) -> Value {
    let mut value = relation_card(ctx, w, p, player_name);
    let requests = w
        .defs
        .story2
        .tracks
        .iter()
        .filter(|t| {
            t.kind == manifest_core::story2::TrackKind::Request
                && (p.tracks.contains(&t.key) || t.cast.contains(&p.key))
                && w.state.story2.tracks.get(&t.key).is_some_and(|s| s.status == Status::Active)
                && (!t.auto || w.state.story2.pending.iter().any(|q| q.track == t.key))
        })
        .count();
    value["can_recruit"] = json!(Command::RecruitPerson { owner: PLAYER, person: p.key.clone() }.validate(w).is_ok());
    value["requests"] = json!(requests);
    value
}
fn venue(ctx: Ctx<'_>, loc: manifest_core::LocId, v: &str) -> Option<String> {
    let city = &ctx.names.loc(loc).key;
    let place = ctx
        .names
        .upbringing
        .family_variants()
        .filter(|f| &f.home == city)
        .flat_map(|f| &f.places)
        .chain(ctx.names.upbringing.academies.iter().filter(|a| &a.at == city).flat_map(|a| &a.places))
        .find(|p| p.venue == v && !p.name.trim().is_empty());
    if let Some(place) = place {
        return Some(place.name.clone());
    }
    match v {
        "tavern" => Some(label(ctx, "酒馆", "Tavern").into()),
        "academy" => Some(label(ctx, "学院", "Academy").into()),
        "library" => Some(label(ctx, "图书馆", "Library").into()),
        "dock" => Some(label(ctx, "码头", "Quay").into()),
        // 这座城自己没有给这处场所起名时用的通称（先于下面“借别处同类场所的名字”的兜底，免得把别的城的专名安到这里）
        "trading_house" => Some(label(ctx, "商馆", "Trading house").into()),
        "church" => Some(label(ctx, "教堂", "Church").into()),
        "court" => Some(label(ctx, "宫廷", "Court").into()),
        "exchange" => Some(label(ctx, "交易所", "Exchange").into()),
        "garrison" => Some(label(ctx, "兵营", "Garrison").into()),
        "guildhall" => Some(label(ctx, "行会", "Guildhall").into()),
        "mosque" => Some(label(ctx, "清真寺", "Mosque").into()),
        "school" => Some(label(ctx, "学堂", "School").into()),
        "secret_room" => Some(label(ctx, "密室", "Hidden room").into()),
        "shipyard" => Some(label(ctx, "造船厂", "Shipyard").into()),
        "shore" => Some(label(ctx, "岸边", "Shore").into()),
        "stable" => Some(label(ctx, "马厩", "Stables").into()),
        "temple" => Some(label(ctx, "寺院", "Temple").into()),
        "theatre" => Some(label(ctx, "戏台", "Theatre").into()),
        _ => ctx
            .names
            .upbringing
            .family_variants()
            .flat_map(|f| &f.places)
            .chain(ctx.names.upbringing.academies.iter().flat_map(|a| &a.places))
            .find(|p| p.venue == v && !p.name.trim().is_empty())
            .map(|p| p.name.clone()),
    }
}

pub fn persons(ctx: Ctx<'_>, w: &World, loc: Option<LocId>) -> Value {
    persons_with_name(ctx, w, loc, None)
}

/// 自创姓名来自应用层存档元数据，不写入内核或改变重放哈希。
pub fn persons_with_name(ctx: Ctx<'_>, w: &World, loc: Option<LocId>, player_name: Option<&str>) -> Value {
    let mut list: Vec<_> = ctx
        .names
        .cast
        .persons
        .iter()
        .filter(|p| {
            known(w, &p.key)
                && !is_player(w, &p.key)
                && loc.is_none_or(|loc| w.person_place(&p.key).is_some_and(|at| at.loc == loc))
        })
        .collect();
    list.sort_by_key(|p| &p.key);
    let mut view = json!({"persons":list.into_iter().map(|p|card(ctx,w,p,player_name)).collect::<Vec<_>>()});
    // 与人物位置相同，只公开当面遇到的船；已见过人物不代表知道其当前航向。
    let fleets: Vec<_> = w
        .person_fleets()
        .into_iter()
        .filter(|f| known(w, &f.person) && w.person_here(&f.person) && loc.is_none_or(|loc| loc == f.loc))
        .collect();
    if !fleets.is_empty() {
        view["fleets"] = json!(fleets);
    }
    view
}

fn pair(a: &str, b: &str) -> (String, String) {
    if a < b { (a.into(), b.into()) } else { (b.into(), a.into()) }
}

/// 公布的初始关系加上已知见闻中的变更；未知的后续事件不能擦掉玩家上次听到的关系。
pub(crate) fn known_ties(w: &World) -> Vec<TieState> {
    let mut public = w.clone();
    public.state.cast.ties.clear();
    public.state.story2.removed_ties.clear();
    let mut ties: BTreeMap<_, _> = public
        .active_ties()
        .into_iter()
        .filter(|t| t.open && known(w, &t.a) && known(w, &t.b))
        .map(|t| (pair(&t.a, &t.b), t))
        .collect();
    let mut news = w.known_news(None);
    news.sort_by(|a, b| (a.day, &a.id).cmp(&(b.day, &b.id)));
    for n in news {
        for e in crate::story2_view::news_effects(w, n) {
            if let Effect::Tie { a, b, relation, remove } = e {
                if !known(w, a) || !known(w, b) {
                    continue;
                }
                let key = pair(a, b);
                if *remove {
                    ties.remove(&key);
                } else {
                    let date = w.defs.calendar.date_of(n.day);
                    ties.insert(
                        key,
                        TieState {
                            a: a.clone(),
                            b: b.clone(),
                            kind: *relation,
                            since: [
                                (w.defs.rules.world.start_year + i64::from(date.year) - 1) as u32,
                                date.month,
                                date.day,
                            ],
                            open: true,
                        },
                    );
                }
            }
        }
    }
    // 新存档另外记住亲眼看到但没有配套见闻文案的关系变化。
    for fact in &w.state.story2.known_ties {
        if !known(w, &fact.a) || !known(w, &fact.b) {
            continue;
        }
        let key = pair(&fact.a, &fact.b);
        if let Some(kind) = fact.kind {
            let date = w.defs.calendar.date_of(fact.day);
            ties.insert(
                key,
                TieState {
                    a: fact.a.clone(),
                    b: fact.b.clone(),
                    kind,
                    since: [(w.defs.rules.world.start_year + i64::from(date.year) - 1) as u32, date.month, date.day],
                    open: true,
                },
            );
        } else {
            ties.remove(&key);
        }
    }
    ties.into_values().collect()
}

pub fn relationships(ctx: Ctx<'_>, w: &World) -> Value {
    let identity = w.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
    let player_key = identity.unwrap_or("$captain");
    let player = identity.and_then(|p| ctx.names.cast.person(p));
    let mut nodes = vec![
        json!({"key":player_key,"name":player.map(|p|p.name.as_str()).unwrap_or_else(||label(ctx,"船长","Captain")),"portrait":player.and_then(|p|p.portrait(w.cast_date())),"kind":"protagonist"}),
    ];
    for p in &ctx.names.cast.persons {
        if known(w, &p.key) && !is_player(w, &p.key) {
            nodes.push(json!({"key":p.key,"name":p.name,"portrait":p.portrait(w.cast_date()),"kind":"person"}));
        }
    }
    nodes.sort_by(|a, b| a["key"].as_str().cmp(&b["key"].as_str()));
    let mut edges: Vec<_> = known_ties(w)
        .into_iter()
        .map(|t| json!({"a":t.a,"b":t.b,"kind":t.kind,"label":relation_label(ctx,t.kind),"since":t.since}))
        .collect();
    for p in w.state.cast.persons.keys() {
        if known(w, p) && !is_player(w, p) {
            for r in w.visible_relations(p) {
                edges.push(json!({"a":player_key,"b":p,"kind":r,"label":relation_label(ctx,r)}));
            }
        }
    }
    json!({"nodes":nodes,"edges":edges})
}

/// 旧记忆存的是原文；能定位到台词/信件时按当前显示定义重取，不改写历史存档。
fn memory(ctx: Ctx<'_>, w: &World, key: &str, text: &str) -> String {
    let same = |raw: &str| raw.chars().take(manifest_core::cast::interactions::MEMORY_CHARS).eq(text.chars());
    if let Some((raw, localized)) = w.defs.cast.person(key).zip(ctx.names.cast.person(key)) {
        for (topic, lines) in &raw.lines {
            if let Some(i) = lines.iter().position(|s| same(s))
                && let Some(line) = localized.lines.get(topic).and_then(|v| v.get(i))
            {
                return line.clone();
            }
        }
    }
    for raw in &w.defs.story2.tracks {
        let Some(localized) = ctx.names.story2.track(&raw.key) else {
            continue;
        };
        for c in &raw.chapters {
            let Some(translated) = localized.chapter(&c.key) else {
                continue;
            };
            for (branch, display) in
                manifest_core::story2::graph::branches(c).iter().zip(manifest_core::story2::graph::branches(translated))
            {
                for (effect, display) in branch.effects.iter().zip(display.effects) {
                    if let (Effect::Letter { person, text: raw }, Effect::Letter { text: translated, .. }) =
                        (effect, display)
                        && person == key
                        && same(raw)
                    {
                        return translated;
                    }
                }
            }
        }
    }
    if ctx.tr.is_some() {
        for (zh, en) in [
            ("一起打听了当地的传闻。", "We asked for news around town."),
            ("问起了对方正在挂念的事情。", "You asked about their concerns."),
            ("聊起了近来的见闻。", "We talked about recent news."),
            ("交换了读书的心得。", "We shared our thoughts on books."),
            ("仔细问过了这件事。", "You asked about the matter in detail."),
            ("获得了求见的许可。", "An audience was granted."),
            ("答应作为航海士与你同行。", "They agreed to join your crew."),
        ] {
            if text == zh {
                return en.into();
            }
        }
        for (raw, name) in w
            .defs
            .items
            .items
            .iter()
            .filter_map(|i| ctx.names.items.item(&i.key).map(|n| (&i.name, &n.name)))
            .chain(w.defs.goods.iter().zip(&ctx.names.goods).map(|(a, b)| (&a.name, &b.name)))
        {
            for (ending, translated) in
                [("记住了这份心意。", "They remembered your kindness."), ("是你亲手做的。", "You made it yourself.")]
            {
                if same(&format!("收到你送的{raw}。{ending}")) {
                    return format!("Received {name} from you. {translated}");
                }
            }
            if same(&format!("你送的《{raw}》，我已经读过了。")) {
                return format!("I have read {name}, the book you gave me.");
            }
        }
    }
    text.into()
}

struct Preferences {
    likes: Vec<String>,
    dislikes: Vec<String>,
    gifts: Vec<Value>,
}

fn preferences(ctx: Ctx<'_>, w: &World, key: &str) -> Option<Preferences> {
    let state = w.state.cast.persons.get(key);
    let known_items = state.map(|s| &s.interactions.likes_known);
    let mut likes = Vec::new();
    let mut dislikes = Vec::new();
    let mut gifts = Vec::new();
    for item in &ctx.names.items.items {
        let qty = w.item_available(PLAYER, &item.key);
        let raw = w.defs.items.item(&item.key)?;
        let mut tags = raw.tags.clone();
        tags.push(raw.kind.key().into());
        let reaction =
            known_items.filter(|keys| keys.contains(&item.key)).and_then(|_| w.gift_reaction(key, &item.key, &tags));
        match reaction {
            Some(Reaction::Love | Reaction::Like) => likes.push(item.name.clone()),
            Some(Reaction::Dislike | Reaction::Hate) => dislikes.push(item.name.clone()),
            _ => {}
        }
        if qty > 0 && !raw.protected() {
            gifts.push(json!({"item":item.key,"name":item.name,"qty":qty,"reaction":reaction.map_or("unknown",|r|match r{Reaction::Love=>"love",Reaction::Like=>"like",Reaction::Neutral=>"neutral",Reaction::Dislike=>"dislike",Reaction::Hate=>"hate"})}));
        }
    }
    for (i, good) in ctx.names.goods.iter().enumerate() {
        if known_items.is_some_and(|keys| keys.contains(&good.key)) {
            let category = &w.defs.goods[i].category;
            match w.gift_reaction(key, &good.key, std::slice::from_ref(category)) {
                Some(Reaction::Love | Reaction::Like) => likes.push(good.name.clone()),
                Some(Reaction::Dislike | Reaction::Hate) => dislikes.push(good.name.clone()),
                _ => {}
            }
        }
    }
    Some(Preferences { likes, dislikes, gifts })
}

fn birthday(w: &World, p: &PersonDef) -> (Option<[u32; 2]>, Option<u32>) {
    let birthday = p.birthday.or_else(|| (p.born[0] != 0).then_some([p.born[1], p.born[2]]));
    let days = birthday.and_then(|[month, day]| {
        (0..=w.defs.calendar.year_days()).find(|days| {
            let d = w.defs.calendar.date_of(w.day().saturating_add(*days));
            d.month == month && d.day == day
        })
    });
    (birthday, days)
}

/// 养成同伴栏只需要人物卡和已知偏好，不试算未展示的对话选项或构建完整小传。
pub(crate) fn companion(ctx: Ctx<'_>, w: &World, key: &str, player_name: Option<&str>) -> Option<Value> {
    if !known(w, key) || is_player(w, key) {
        return None;
    }
    let p = ctx.names.cast.person(key)?;
    let mut value = relation_card(ctx, w, p, player_name);
    let obj = value.as_object_mut()?;
    let Preferences { likes, dislikes, .. } = preferences(ctx, w, key)?;
    let (birthday, days) = birthday(w, p);
    obj.insert("likes_known".into(), json!(likes));
    obj.insert("dislikes_known".into(), json!(dislikes));
    obj.insert("birthday".into(), json!(birthday));
    obj.insert("days_to_birthday".into(), json!(days));
    crate::navigation_view::visibility::redact_prose(ctx, w, &mut value);
    Some(value)
}

pub fn person(ctx: Ctx<'_>, w: &World, key: &str) -> Option<Value> {
    person_with_name(ctx, w, key, None)
}

pub fn person_with_name(ctx: Ctx<'_>, w: &World, key: &str, player_name: Option<&str>) -> Option<Value> {
    if !known(w, key) || is_player(w, key) {
        return None;
    }
    let p = ctx.names.cast.person(key)?;
    let mut value = card(ctx, w, p, player_name);
    let obj = value.as_object_mut()?;
    obj.insert("here".into(), json!(w.person_here(key)));
    // persona是给角色的内在提示，不当作玩家已经读过的小传。
    let mut pages = vec![json!({"title":p.name,"text":if p.summary.is_empty() { &p.role } else { &p.summary }})];
    let flags = &w.state.story2.flags;
    let secret = (!p.secret.is_empty() && flags.contains(&format!("secret_{}_known", p.key))).then_some(&p.secret);
    // 只有明确获知、且已到结业或结局，才公开后日谈；时间流逝、亲密值都不能替代获知。
    let concluded = flags.contains("upbringing_graduated") || flags.contains("ending_reached");
    let after =
        (!p.after.is_empty() && concluded && flags.contains(&format!("after_{}_known", p.key))).then_some(&p.after);
    obj.insert("summary".into(), json!(p.summary));
    obj.insert("secret".into(), json!(secret));
    obj.insert("after".into(), json!(after));
    for text in [secret, after].into_iter().flatten() {
        pages.push(json!({"title":p.name,"text":text}));
    }
    for n in w.known_news(None).into_iter().rev().filter(|n| n.persons.iter().any(|p| p == key)) {
        let view = crate::story2_view::news(ctx, w, n);
        pages.push(json!({"title":view["track_name"],"text":view["text"]}));
    }
    obj.insert("bio_pages".into(), json!(pages));
    let state = w.state.cast.persons.get(key);
    if let Some(memory) = state.and_then(|s| s.school.as_ref()) {
        obj.insert("school_memory".into(), json!(memory));
    }
    let Preferences { likes, dislikes, gifts } = preferences(ctx, w, key)?;
    let mut topics = vec![
        ("chat".into(), label(ctx, "闲谈", "Chat").into()),
        ("gossip".into(), label(ctx, "打听传闻", "Ask for news").into()),
        ("request".into(), label(ctx, "问起请托", "Ask about requests").into()),
    ];
    for track in &p.tracks {
        if let Some(t) = ctx.names.story2.track(track) {
            topics.push((format!("ask:{track}"), t.name.clone()));
        }
    }
    if let Some(inv) = w.inventory(PLAYER) {
        for work in inv.bibliography.keys() {
            if let Some(book) = ctx.names.items.items.iter().find(|i| i.work_key() == work) {
                topics.push((format!("book:{work}"), book.name.clone()));
            }
        }
    }
    let topics: Vec<_> = topics
        .into_iter()
        .map(|(topic, name)| {
            let error = Command::Talk { owner: PLAYER, person: key.into(), topic: topic.clone() }.validate(w).err();
            let mut value = json!({"key":topic,"name":name,"enabled":error.is_none()});
            if let Some(e) = error {
                value["blocked_reason"] = json!(ctx.error(&e));
            }
            value
        })
        .collect();
    let (birthday, days) = birthday(w, p);
    obj.insert("likes_known".into(), json!(likes));
    obj.insert("dislikes_known".into(), json!(dislikes));
    obj.insert("gifts".into(), json!(gifts));
    obj.insert("topics".into(), json!(topics));
    obj.insert("birthday".into(), json!(birthday));
    obj.insert("days_to_birthday".into(), json!(days));
    obj.insert(
        "memories".into(),
        json!(
            state
                .map(|s| s.interactions.memories.iter().map(|text| memory(ctx, w, key, text)).collect::<Vec<_>>())
                .unwrap_or_default()
        ),
    );
    obj.insert("basis".into(), json!(p.basis));
    obj.insert("sources".into(), json!(p.sources));
    let ties:Vec<_>=known_ties(w).into_iter().filter_map(|t|{
        let other=if t.a==key {&t.b}else if t.b==key {&t.a}else{return None;};let person=ctx.names.cast.person(other)?;
        let tags:Vec<_>=w.defs.cast.ties.iter().filter(|d|pair(&d.a,&d.b)==pair(&t.a,&t.b)).flat_map(|d|&d.tags).filter(|s|["GL","BL","BG","GB"].contains(&s.as_str())).cloned().collect();
        Some(json!({"person":other,"name":person.name,"portrait":person.portrait(w.cast_date()),"kind":t.kind,"label":relation_label(ctx,t.kind),"since":t.since,"tags":tags}))
    }).collect();
    obj.insert("ties".into(), json!(ties));
    obj.insert(
        "news".into(),
        json!(
            w.known_news(None)
                .into_iter()
                .filter(|n| n.persons.iter().any(|p| p == key))
                .take(5)
                .map(|n| crate::story2_view::news(ctx, w, n))
                .collect::<Vec<_>>()
        ),
    );
    crate::navigation_view::visibility::redact_prose(ctx, w, &mut value);
    Some(value)
}

#[cfg(test)]
#[path = "cast_view_companion_tests.rs"]
mod companion_tests;
