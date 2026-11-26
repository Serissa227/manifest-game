//! 所有地点查询共用可见性，已知地点保持原 ID，不重排编号。
use crate::views::{Ctx, StaticView};
use manifest_core::{Cell, LocId, OwnerId, World};

pub fn filter_static(view: &mut StaticView, ctx: Ctx<'_>, world: Option<&World>) {
    let defs = ctx.names;
    // S02：独有船型的显示名也可能就是名船本名，公共缓存按尚未揭晓处理。
    if world.map_or(defs.rules.ships.s02_enabled, |w| w.defs.rules.ships.s02_enabled) {
        for hull in &mut view.ships {
            if hull.unique
                && let Some(ship) = defs
                    .legend_ships
                    .ships
                    .iter()
                    .find(|s| s.hull == hull.key && s.unrevealed_name.is_some() && s.reveal_flag.is_some())
            {
                hull.name = world
                    .map(|w| crate::legend_ships_view::legend_ship_name(w, ship))
                    .or(ship.unrevealed_name.as_deref())
                    .unwrap_or(&ship.name)
                    .into();
                if let Some(english) = ctx.en_defs().legend_ships.ship(&ship.key) {
                    hull.name_en = world
                        .map(|w| crate::legend_ships_view::legend_ship_name(w, english))
                        .or(english.unrevealed_name.as_deref())
                        .unwrap_or(&english.name)
                        .into();
                }
            }
            hull.description = redact_legend_names(ctx, world, &hull.description);
        }
    }
    if !defs.manual_navigation || !defs.navigation.hide_unknown_ports {
        return;
    }
    let visible = |id| world.is_some_and(|w| w.location_visible(LocId(id)));
    view.locations.retain(|l| visible(l.id));
    view.roads.retain(|r| visible(r.from) && visible(r.to));
    view.exchanges.retain(|e| visible(e.port));
    view.scenarios.retain(|s| visible(s.start));
    view.discoveries
        .retain(|d| world.is_some_and(|w| w.state.explore.discovered.contains_key(&manifest_core::DiscoveryId(d.id))));
    view.landmarks.retain(|l| {
        world.is_some_and(|w| {
            w.state.explore.is_revealed(w.defs.map.idx(Cell::new(l.x, l.y)))
                && l.discovery.as_ref().is_none_or(|key| {
                    w.defs.discoveries.iter().position(|d| &d.key == key).is_some_and(|i| {
                        w.state.explore.discovered.contains_key(&manifest_core::DiscoveryId::from_idx(i))
                    })
                })
        })
    });
    if let Some(world) = world {
        for loc in &mut view.locations {
            loc.lore = redact_text(ctx, world, &loc.lore);
        }
        for discovery in &mut view.discoveries {
            discovery.lore = redact_text(ctx, world, &discovery.lore);
        }
        for good in &mut view.goods {
            good.description = redact_text(ctx, world, &good.description);
        }
        for ship in &mut view.ships {
            ship.description = redact_text(ctx, world, &ship.description);
        }
    }
}

/// 隐藏世界的公共缓存不包含地点/发现物条目，也不能从其他条目的说明泄漏其名字。
pub fn public_static(view: &StaticView, ctx: Ctx<'_>) -> Result<serde_json::Value, serde_json::Error> {
    let mut public = view.clone();
    filter_static(&mut public, ctx, None);
    let mut value = serde_json::to_value(public)?;
    if !ctx.names.manual_navigation || !ctx.names.navigation.hide_unknown_ports {
        return Ok(value);
    }
    let zh = ctx.tr.map_or(ctx.names, |(zh, _)| &zh.defs);
    let mut hidden = Vec::new();
    let mut hidden_names = Vec::new();
    for defs in [ctx.names, ctx.en_defs(), zh] {
        for loc in &defs.locations {
            hidden_names.push(loc.name.as_str());
            let replacement = super::label(ctx, "未知地点", "Unknown destination");
            hidden.extend([(loc.name.as_str(), replacement), (loc.key.as_str(), replacement)]);
        }
        for discovery in &defs.discoveries {
            hidden_names.push(discovery.name.as_str());
            let replacement = super::label(ctx, "未知发现物", "Unknown discovery");
            hidden.extend([(discovery.name.as_str(), replacement), (discovery.key.as_str(), replacement)]);
        }
    }
    hidden.retain(|(name, _)| !name.is_empty());
    hidden.sort_by_key(|(name, replacement)| (std::cmp::Reverse(name.len()), *name, *replacement));
    hidden.dedup();
    hidden_names.retain(|name| !name.is_empty());
    hidden_names.sort_unstable();
    hidden_names.dedup();
    redact_public_static(&mut value, &hidden, &hidden_names);
    Ok(value)
}

fn redact_public_static(value: &mut serde_json::Value, hidden: &[(&str, &str)], hidden_names: &[&str]) {
    fn redact(value: &mut serde_json::Value, prose: bool, hidden: &[(&str, &str)], hidden_names: &[&str]) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    redact(
                        child,
                        matches!(
                            key.as_str(),
                            "name"
                                | "name_en"
                                | "description"
                                | "desc"
                                | "lore"
                                | "text"
                                | "title"
                                | "label"
                                | "hint"
                                | "prompt"
                                | "question"
                                | "summary"
                        ),
                        hidden,
                        hidden_names,
                    );
                }
            }
            serde_json::Value::Array(list) => {
                for child in list {
                    redact(child, prose, hidden, hidden_names);
                }
            }
            serde_json::Value::String(text) if prose => {
                for (name, replacement) in hidden {
                    *text = replace_key(text, name, replacement);
                }
                // 专名与其他词重叠时不生成残缺词（如 Cochin / Cochineal），公共字段先留空。
                // 按会话的 RPC 仍可补回完整商品、配方等名称。
                if hidden_names.iter().any(|name| text.contains(name)) {
                    text.clear();
                }
            }
            _ => {}
        }
    }
    // 行动文字表的键是动态标识符，整张表的字符串值都按叙事字段处理。
    if let Some(serde_json::Value::Object(texts)) = value.get_mut("upbringing_act_texts") {
        for text in texts.values_mut() {
            redact(text, true, hidden, hidden_names);
        }
    }
    redact(value, false, hidden, hidden_names);
}

/// JSON 视图只处理展示文案字段，机器 key、资源路径和枚举保持原样。
pub fn redact_prose(ctx: Ctx<'_>, world: &World, value: &mut serde_json::Value) {
    redact_prose_with(ctx, world, value, redact_text);
}

/// 作者写的叙事字段保留普通地名；机器 key、资源路径和枚举保持原样。
pub fn redact_narrative_prose(ctx: Ctx<'_>, world: &World, value: &mut serde_json::Value) {
    redact_prose_with(ctx, world, value, redact_narrative_text);
}

fn redact_prose_with(
    ctx: Ctx<'_>,
    world: &World,
    value: &mut serde_json::Value,
    redact: fn(Ctx<'_>, &World, &str) -> String,
) {
    fn visit(
        ctx: Ctx<'_>,
        world: &World,
        value: &mut serde_json::Value,
        prose: bool,
        redact: fn(Ctx<'_>, &World, &str) -> String,
    ) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    visit(
                        ctx,
                        world,
                        child,
                        matches!(
                            key.as_str(),
                            "text"
                                | "name"
                                | "title"
                                | "chapter_title"
                                | "desc"
                                | "description"
                                | "lore"
                                | "summary"
                                | "secret"
                                | "after"
                                | "hint"
                                | "reply"
                                | "memories"
                                | "place"
                                | "where"
                                | "next_hint"
                                | "line"
                                | "blocked_reason"
                        ) || world.defs.rules.ships.s02_enabled
                            && matches!(key.as_str(), "hull" | "acquire" | "sources"),
                        redact,
                    );
                }
            }
            serde_json::Value::Array(list) => {
                for child in list {
                    visit(ctx, world, child, prose, redact);
                }
            }
            serde_json::Value::String(text) if prose => *text = redact(ctx, world, text),
            _ => {}
        }
    }
    if world.hides_unknown_locations() || world.defs.rules.ships.s02_enabled {
        visit(ctx, world, value, false, redact);
    }
}

pub fn redact_story(ctx: Ctx<'_>, world: &World, view: &mut crate::story_view::StoryView) {
    if !world.hides_unknown_locations() && !world.defs.rules.ships.s02_enabled {
        return;
    }
    let redact = |text: &mut String| *text = redact_narrative_text(ctx, world, text);
    if let Some(line) = &mut view.line {
        redact(&mut line.name);
        if let Some(hint) = &mut line.hint {
            redact(hint);
        }
    }
    if let Some(event) = &mut view.pending {
        redact(&mut event.title);
        redact(&mut event.text);
        if let Some(story) = &mut event.story {
            redact(story);
        }
        if let Some(name) = &mut event.extra.track_name {
            redact(name);
        }
        for choice in &mut event.choices {
            redact(&mut choice.text);
            if let Some(text) = &mut choice.hint {
                redact(text);
            }
            for text in choice.blocked.iter_mut().chain(choice.requires.iter_mut()) {
                *text = redact_text(ctx, world, text);
            }
        }
    }
    if let Some(last) = &mut view.last {
        redact(&mut last.title);
        redact(&mut last.reply);
        if let Some(choice) = &mut last.choice {
            redact(choice);
        }
        for outcome in &mut last.outcomes {
            if let Some(text) = &mut outcome.text {
                if outcome.kind == "letter" {
                    redact(text);
                } else {
                    *text = redact_text(ctx, world, text);
                }
            }
            if let Some(title) = &mut outcome.extra.title {
                redact(title);
            }
            if world.hides_unknown_locations()
                && outcome
                    .discovery
                    .is_some_and(|id| !world.state.explore.discovered.contains_key(&manifest_core::DiscoveryId(id)))
            {
                outcome.discovery = None;
            }
        }
    }
    for entry in &mut view.journal {
        redact(&mut entry.title);
        redact(&mut entry.choice);
    }
}

/// 任务只能给未知目的地的大致方向，不返回 key、坐标或距离。
pub fn place(ctx: Ctx<'_>, world: &World, loc: LocId) -> String {
    if world.location_visible(loc) {
        return ctx.names.loc(loc).name.clone();
    }
    let Some(target) = world.defs.locations.get(loc.idx()) else { return String::new() };
    let origin = world.fleets_of(OwnerId::Player).next().map(|f| f.cell(&world.defs)).unwrap_or(target.cell);
    let dx = world.defs.map.topology().dx(origin.x, target.cell.x);
    let dy = i32::from(target.cell.y) - i32::from(origin.y);
    let (zh, en) = match (dx.signum(), dy.signum()) {
        (0, -1) => ("北方", "North"),
        (1, -1) => ("东北方", "Northeast"),
        (1, 0) => ("东方", "East"),
        (1, 1) => ("东南方", "Southeast"),
        (0, 1) => ("南方", "South"),
        (-1, 1) => ("西南方", "Southwest"),
        (-1, 0) => ("西方", "West"),
        (-1, -1) => ("西北方", "Northwest"),
        _ => ("附近", "Nearby"),
    };
    super::label(ctx, zh, en).into()
}

pub fn redact_text(ctx: Ctx<'_>, world: &World, text: &str) -> String {
    redact_text_with(ctx, world, text, |id| !world.location_visible(id))
}

/// 叙事遮未进入的秘境港口、未发现的发现物与未揭晓的名船。
pub fn redact_narrative_text(ctx: Ctx<'_>, world: &World, text: &str) -> String {
    redact_text_with(ctx, world, text, |id| {
        world
            .realm_key_at_port(id)
            .is_some_and(|key| world.realm_status(key) < manifest_core::realms::RealmStatus::Entered)
    })
}

fn redact_text_with(ctx: Ctx<'_>, world: &World, text: &str, hidden_location: impl Fn(LocId) -> bool) -> String {
    let mut text = redact_legend_names(ctx, Some(world), text);
    if !world.hides_unknown_locations() {
        return text;
    }
    let mut hidden: Vec<_> = world.defs.loc_ids().filter(|id| hidden_location(*id)).collect();
    // 长名字优先，避免共同前缀留下精确名称的片段。
    hidden.sort_by_key(|id| std::cmp::Reverse(ctx.names.loc(*id).name.len()));
    for id in hidden {
        let direction = place(ctx, world, id);
        for name in [&ctx.names.loc(id).name, &ctx.en_defs().loc(id).name, &world.defs.loc(id).name] {
            if !name.is_empty() {
                text = replace_key(&text, name, &direction);
            }
        }
        text = replace_key(&text, &world.defs.loc(id).key, &direction);
    }
    for id in world.defs.discovery_ids().filter(|id| !world.state.explore.discovered.contains_key(id)) {
        for name in [&ctx.names.discovery(id).name, &ctx.en_defs().discovery(id).name, &world.defs.discovery(id).name] {
            if !name.is_empty() {
                text = replace_key(&text, name, super::label(ctx, "未知发现物", "Unknown discovery"));
            }
        }
        text = replace_key(&text, &world.defs.discovery(id).key, super::label(ctx, "未知发现物", "Unknown discovery"));
    }
    text
}

/// 目击、传闻与叙事只替换显示名字；不改船的 key，也不改已揭晓条目的正文。
fn redact_legend_names(ctx: Ctx<'_>, world: Option<&World>, text: &str) -> String {
    if !world.map_or(ctx.names.rules.ships.s02_enabled, |w| w.defs.rules.ships.s02_enabled) {
        return text.into();
    }
    let mut hidden = Vec::new();
    for ship in &ctx.names.legend_ships.ships {
        let (Some(alias), Some(flag)) = (&ship.unrevealed_name, &ship.reveal_flag) else { continue };
        if world.is_some_and(|w| w.state.story2.flags.contains(flag)) {
            continue;
        }
        for defs in [ctx.names, ctx.en_defs(), world.map_or(ctx.names, |w| w.defs.as_ref())] {
            if let Some(source) = defs.legend_ships.ship(&ship.key) {
                hidden.push((source.name.as_str(), alias.as_str()));
            }
            if let Some(hull) = defs.ships.iter().find(|h| h.unique && h.key == ship.hull) {
                hidden.push((hull.name.as_str(), alias.as_str()));
            }
        }
    }
    hidden.retain(|(name, alias)| !name.is_empty() && name != alias);
    hidden.sort_by_key(|(name, alias)| (std::cmp::Reverse(name.len()), *name, *alias));
    hidden.dedup();
    let mut text = text.to_owned();
    for (name, alias) in hidden {
        text = replace_key(&text, name, alias);
    }
    text
}

// key 只替换独立标识符，不能把短 key（如 edo）误当成英文单词内部的地名。
fn replace_key(text: &str, key: &str, replacement: &str) -> String {
    if key.is_empty() {
        return text.into();
    }
    let identifier = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut result = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, _) in text.match_indices(key) {
        let end = start + key.len();
        if text[..start].chars().next_back().is_some_and(identifier)
            || text[end..].chars().next().is_some_and(identifier)
        {
            continue;
        }
        result.push_str(&text[copied..start]);
        result.push_str(replacement);
        copied = end;
    }
    result.push_str(&text[copied..]);
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn location_keys_do_not_replace_parts_of_unrelated_words() {
        assert_eq!(super::replace_key("freedom edo {edo}", "edo", "East"), "freedom East {East}");
    }

    #[test]
    fn public_static_removes_hidden_references_from_other_display_fields_without_mutating_the_source() {
        use crate::views::{Ctx, static_view};
        use manifest_core::{
            Cell,
            defs::{DiscoveryDef, DiscoveryKind},
        };
        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        defs.manual_navigation = true;
        defs.navigation.hide_unknown_ports = true;
        defs.locations[0].name = "未见测试港".into();
        defs.locations[1].name = "Cochin".into();
        defs.discoveries.push(DiscoveryDef {
            key: "hidden_discovery".into(),
            name: "未见测试沉船".into(),
            cell: Cell::new(2, 2),
            kind: DiscoveryKind::Wreck,
            fame: 1,
            value: 1,
            lore: "这是发现物测试。".into(),
        });
        let mut view = static_view(&defs);
        // 同名的机器 key 仍必须原样保留，过滤只针对展示字段。
        view.goods[0].key = defs.locations[1].name.clone();
        view.goods[0].name_en = "Cochineal".into();
        view.goods[0].description = "未见测试港与未见测试沉船（hidden_discovery）。".into();
        view.ships[0].description = view.goods[0].description.clone();
        let before = serde_json::to_value(&view).unwrap();
        let public = super::public_static(&view, Ctx::plain(&defs)).unwrap();
        for field in ["locations", "discoveries", "landmarks", "roads", "exchanges", "scenarios"] {
            assert_eq!(public[field], serde_json::json!([]));
        }
        for field in ["goods", "ships"] {
            let text = public[field][0]["description"].as_str().unwrap();
            assert!(!text.contains("未见测试港") && !text.contains("未见测试沉船"));
            assert!(!text.contains("hidden_discovery"));
            assert_eq!(public[field][0]["key"], before[field][0]["key"]);
        }
        assert_eq!(public["goods"][0]["name_en"], "");
        assert_eq!(serde_json::to_value(&view).unwrap(), before);
        let world =
            manifest_core::World::new(std::sync::Arc::new(defs.clone()), manifest_core::ScenarioId(0), 42).unwrap();
        let mut personal = view.clone();
        super::filter_static(&mut personal, Ctx::plain(&defs), Some(&world));
        assert!(personal.locations.iter().any(|loc| loc.id == 0 && loc.name == "未见测试港"));
        assert_eq!(personal.goods[0].name_en, "Cochineal");
        assert!(public["locations"].as_array().unwrap().is_empty());
    }

    #[test]
    fn public_static_act_texts_redaction_truth_table() {
        use crate::views::{Ctx, static_view};
        use manifest_core::{
            Cell, LocId,
            defs::{DiscoveryDef, DiscoveryKind},
        };
        use serde_json::json;

        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        defs.manual_navigation = true;
        defs.navigation.hide_unknown_ports = true;
        defs.locations[1].name = "未见测试港".into();
        defs.discoveries.push(DiscoveryDef {
            key: "hidden_discovery".into(),
            name: "未见测试沉船".into(),
            cell: Cell::new(2, 2),
            kind: DiscoveryKind::Wreck,
            fame: 1,
            value: 1,
            lore: String::new(),
        });
        let world = manifest_core::World::new(std::sync::Arc::new(defs), manifest_core::ScenarioId(0), 42).unwrap();
        let defs = world.defs.as_ref();
        let ctx = Ctx::plain(defs);
        assert!(!world.location_visible(LocId(1)));
        assert!(world.realm_key_at_port(LocId(1)).is_none());
        let sensitive: Vec<_> = defs
            .locations
            .iter()
            .flat_map(|loc| [loc.name.as_str(), loc.key.as_str()])
            .chain(defs.discoveries.iter().flat_map(|discovery| [discovery.name.as_str(), discovery.key.as_str()]))
            .collect();
        let text = sensitive.join(" / ");
        let mut view = static_view(defs);
        view.upbringing_act_texts = Some(
            ["act:voyage:probe:desc", "act:tide:beta:probe:desc", "act:perk:probe", "other:dynamic:key"]
                .into_iter()
                .map(|key| (key.into(), text.clone()))
                .chain(std::iter::once(("act:voyage:probe:name".into(), "unchanged".into())))
                .collect(),
        );
        let before = serde_json::to_value(&view).unwrap();
        let public = super::public_static(&view, ctx).unwrap();
        let public_texts = public["upbringing_act_texts"].as_object().unwrap();
        assert_eq!(
            public_texts.keys().collect::<Vec<_>>(),
            before["upbringing_act_texts"].as_object().unwrap().keys().collect::<Vec<_>>()
        );
        for value in public_texts.values() {
            let value = value.as_str().unwrap();
            for &name in &sensitive {
                assert!(!value.contains(name), "{name}: {value}");
            }
        }
        assert!(public_texts["act:voyage:probe:desc"].as_str().unwrap().contains("未知地点"));
        assert!(public_texts["act:voyage:probe:desc"].as_str().unwrap().contains("未知发现物"));
        assert_eq!(public_texts["act:voyage:probe:name"], "unchanged");
        let mut personal = view.clone();
        super::filter_static(&mut personal, ctx, Some(&world));
        assert_eq!(personal.upbringing_act_texts, view.upbringing_act_texts);
        assert_eq!(super::redact_narrative_text(ctx, &world, &defs.locations[1].name), defs.locations[1].name);
        assert_eq!(serde_json::to_value(&view).unwrap(), before);

        // 路径 × 位置 × 是否含普通未访地名；末轴依次为不含、含。
        let expected = [[[false, true], [false, true], [false, false]], [[false, false]; 3]];
        let hidden = [(defs.locations[1].name.as_str(), "未知地点")];
        let hidden_names = [defs.locations[1].name.as_str()];
        println!("public | narrative_field | act_value | other_value | has_name | redacted");
        for (route, public_route) in [true, false].into_iter().enumerate() {
            for (placement, (path, narrative_field, act_value)) in [
                ("/text", true, false),
                ("/upbringing_act_texts/act:voyage:probe:desc", false, true),
                ("/other_texts/dynamic:key", false, false),
            ]
            .into_iter()
            .enumerate()
            {
                for (presence, has_name) in [false, true].into_iter().enumerate() {
                    let input = if has_name { defs.locations[1].name.as_str() } else { "unchanged" };
                    let mut value = json!({
                        "text": input,
                        "upbringing_act_texts": {"act:voyage:probe:desc": input},
                        "other_texts": {"dynamic:key": input},
                    });
                    if public_route {
                        super::redact_public_static(&mut value, &hidden, &hidden_names);
                    } else {
                        super::redact_narrative_prose(ctx, &world, &mut value);
                    }
                    let output = value.pointer(path).unwrap().as_str().unwrap();
                    let redacted = output != input;
                    println!(
                        "{public_route} | {narrative_field} | {act_value} | {} | {has_name} | {redacted}",
                        !narrative_field && !act_value
                    );
                    assert_eq!(redacted, expected[route][placement][presence], "{public_route} {path} {has_name}");
                    assert_eq!(output, if expected[route][placement][presence] { "未知地点" } else { input });
                }
            }
        }
    }
}
