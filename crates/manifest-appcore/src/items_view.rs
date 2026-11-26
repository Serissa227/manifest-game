//! I4 / I9 共用的物品行；所有可执行标志都由内核命令校验推导。
use crate::views::{Ctx, PLAYER};
use manifest_core::{Command, World, ids::*, items::equipment::EquipSlot};
use serde_json::{Value, json};

/// 出处在数据层保留作者词表，视图统一到 I4 已有的本地化键。
pub fn basis(key: &str) -> &str {
    match key {
        "folklore" | "legendary" | "myth" => "legend",
        "invented" => "original",
        "literary" => "literature",
        other => other,
    }
}

pub fn label<'a>(ctx: Ctx<'_>, zh: &'a str, en: &'a str) -> &'a str {
    if ctx.tr.is_some() { en } else { zh }
}

pub(crate) fn effect_text(ctx: Ctx<'_>, e: &manifest_core::items::effects::Effect) -> String {
    use manifest_core::items::effects::EffectKind::*;
    if ctx.tr.is_none() {
        return e.text();
    }
    let name = match e.kind {
        SpeedPct => "Sailing speed",
        Upwind => "Upwind sailing",
        StormGuardPct => "Storm protection",
        FogSailing => "Fog sailing",
        Sight => "Sight",
        SupplyPct => "Supply savings",
        LandingPct => "Landing",
        TaxPct => "Tax savings",
        BargainPct => "Bargaining",
        PriceHint => "Market accuracy",
        DuelPct => "Dueling",
        BoardingPct => "Boarding",
        GunneryPct => "Gunnery",
        Ward => "Ward",
        MoraleDaily => "Daily morale",
        DiseaseGuardPct => "Disease protection",
        WagePct => "Wage savings",
        AffinityPct => "Affinity gain",
        FindPct => "Discovery search",
        ChartReveal => "Chart reveal",
        Arcana => "Spell power",
        Spell => "Spell",
        ActivityPct => "Activity rewards",
        FatiguePct => "Fatigue reduction",
    };
    let target =
        e.activity.as_ref().or(e.tag.as_ref()).or(e.culture.as_ref()).or(e.spell.as_ref()).or(e.region.as_ref());
    let target = target.map(|s| format!(" ({s})")).unwrap_or_default();
    let unit = if e.kind.key().ends_with("_pct") { "%" } else { "" };
    format!("{name}{target} +{}{unit}", e.value)
}

pub fn world_date(world: &World, day: u32) -> [i64; 3] {
    let d = world.defs.calendar.date_of(day);
    [world.defs.rules.world.start_year + i64::from(d.year) - 1, i64::from(d.month), i64::from(d.day)]
}

pub fn item_line(ctx: Ctx<'_>, world: &World, owner: OwnerId, key: &str) -> Option<Value> {
    let item = world.defs.items.item(key)?;
    let text = ctx.names.items.item(key).unwrap_or(item);
    let book = item.read.as_ref().map(|read| {
        let category = ctx
            .names
            .items
            .book_categories
            .iter()
            .find(|c| c.key == read.category)
            .or_else(|| world.defs.items.book_categories.iter().find(|c| c.key == read.category));
        json!({"category": read.category, "category_name": category.map(|c| c.name.as_str()).unwrap_or(&read.category),
            "lang": read.lang, "lang_name": read.lang.as_ref().and_then(|key| ctx.names.captain.abilities.iter().find(|a| a.key == *key).map(|a| &a.name)), "days": read.days, "read": world.has_read_work(owner,key),
            "can_read": world.choose_reading(owner,key,None).map(|r| serde_json::json!(r.mode)).unwrap_or(json!("no")), "published": item.published.as_ref().map(|p| p.0)})
    });
    let mut result = json!({
        "key": item.key, "name": text.name, "kind": item.kind, "rarity": item.rarity,
        "qty": world.item_quantity(owner, key), "equipped": world.item_equipped(owner, key), "icon": text.icon,
        "desc": text.desc, "lore": if text.lore.is_empty() {None} else {Some(&text.lore)},
        "tags": text.tags, "price": item.price,
        "bonus": item.bonus.iter().map(|(attr,value)| json!({"attr":attr,"value":value})).collect::<Vec<_>>(),
        "effects": item.effects.iter().chain(&item.uses).map(|e| json!({"kind":e.kind.key(),"text":effect_text(ctx,e)})).collect::<Vec<_>>(),
        "set": world.defs.items.sets.iter().find(|s| s.items.contains(&item.key)).map(|s| &s.key),
        "book": book, "key_item": item.protected(),
        "can_sell": !item.protected() && world.item_available(owner,key)>0,
        "can_give": !item.protected() && world.item_available(owner,key)>0,
        "can_use": Command::UseItem {owner,item:key.into(),target:None}.validate(world).is_ok(),
    });
    if let Some(source) = &text.basis {
        result["basis"] = json!(basis(source));
    }
    result["sources"] = json!(text.sources);
    crate::navigation_view::visibility::redact_prose(ctx, world, &mut result);
    Some(result)
}

pub fn inventory(ctx: Ctx<'_>, world: &World) -> Value {
    inventory_for(ctx, world, None)
}

pub fn inventory_for(ctx: Ctx<'_>, world: &World, captain: Option<&crate::views::CaptainView>) -> Value {
    let inv = world.inventory(PLAYER);
    let items: Vec<_> = inv
        .into_iter()
        .flat_map(|i| i.quantities.keys())
        .filter_map(|key| item_line(ctx, world, PLAYER, key))
        .collect();
    let name = captain
        .map(|c| c.name.as_str())
        .or_else(|| {
            ctx.names.scenarios.get(world.state.scenario.idx()).and_then(|s| s.hero.as_ref()).map(|h| h.name.as_str())
        })
        .unwrap_or(label(ctx, "船长", "Captain"));
    let mut wearers = vec![wearer(world, "captain", name)];
    wearers.extend(world.defs.mates.iter().filter(|m| world.item_wearer(PLAYER, &m.key)).map(|m| {
        let name = ctx.names.mates.iter().find(|n| n.key == m.key).map_or(m.name.as_str(), |n| &n.name);
        wearer(world, &m.key, name)
    }));
    let reading = inv.and_then(|i| i.reading.as_ref()).map(|r| {
        let (done, total) = world.reading_days(PLAYER, r);
        let name = ctx
            .names
            .items
            .item(&r.source)
            .or_else(|| world.defs.items.item(&r.source))
            .map(|i| i.name.as_str())
            .unwrap_or(&r.source);
        json!({"book":r.source,"name":name,"done_days":done,"total_days":total,"mode":r.mode})
    });
    let mut recent: Vec<_> = inv.into_iter().flat_map(|i| i.bibliography.values()).collect();
    recent.sort_by(|a, b| b.day.cmp(&a.day).then_with(|| a.key.cmp(&b.key)));
    let mut view = json!({"items":items,"wearers":wearers,
        "reading":reading,"bibliography":{"read":world.books_read(PLAYER,None),"categories":world.defs.items.book_categories.iter()
            .map(|c|json!({"key":c.key,"name":ctx.names.items.book_categories.iter().find(|n|n.key==c.key).unwrap_or(c).name,
                "count":world.books_read(PLAYER,Some(&c.key))})).collect::<Vec<_>>(),
            "recent":recent.into_iter().take(10).map(|r|json!({"key":r.key,
                "name":ctx.names.items.item(&r.key).or_else(||world.defs.items.item(&r.key)).map(|i|i.name.as_str()).unwrap_or(&r.key),
                "on":world_date(world,r.day)})).collect::<Vec<_>>()},
        "sets":world.defs.items.sets.iter().map(|s| {
            let have=world.item_set_count(PLAYER,&s.key);
            json!({"key":s.key,"name":ctx.names.items.sets.iter().find(|n|n.key==s.key).unwrap_or(s).name,"items":s.items,"have":have,
                "bonus":s.bonus.iter().map(|e|effect_text(ctx,e)).collect::<Vec<_>>().join(label(ctx,"；","; ")),"done":have>=s.threshold()})
        }).collect::<Vec<_>>(),"gifts":{"count":world.gift_count(PLAYER,None),"value":world.gift_value(PLAYER,None),"kinds":world.gift_kinds(PLAYER,None)},
        "collection_value":world.collection_value(PLAYER)});
    crate::navigation_view::visibility::redact_prose(ctx, world, &mut view);
    view
}

fn wearer(world: &World, key: &str, name: &str) -> Value {
    let base = world.wearer_base_attrs(PLAYER, key);
    let equipped = world.wearer_attrs(PLAYER, key);
    let attrs: Vec<_> = world
        .defs
        .captain
        .attributes
        .iter()
        .zip(base)
        .zip(equipped)
        .filter(|((_, base), equipped)| base != equipped)
        .map(|((a, base), equipped)| json!({"attr":a.key,"base":base,"equipped":equipped}))
        .collect();
    let slots: Vec<_> = EquipSlot::ALL
        .iter()
        .map(|slot| {
            json!({"slot":slot,
        "item":world.equipped_item(PLAYER,key,*slot)})
        })
        .collect();
    json!({"key":key,"name":name,"portrait":null,"slots":slots,"attrs":attrs})
}

pub fn item_shop(ctx: Ctx<'_>, world: &World, loc: LocId) -> Value {
    if !world.location_visible(loc) || !world.effective_shop(loc) {
        return Value::Null;
    }
    let Some(shelf) = world.item_shelf(loc) else {
        return Value::Null;
    };
    // 远方的道具店不能用于探知尚未见过的物品。
    if !world.at_item_shop(PLAYER, loc) {
        return Value::Null;
    }
    let offers: Vec<_> = shelf
        .stock
        .iter()
        .filter_map(|(key, stock)| {
            let line = item_line(ctx, world, PLAYER, key)?;
            let price = world.item_buy_price(PLAYER, loc, key)?;
            let checked = Command::BuyItem { owner: PLAYER, loc, item: key.clone(), qty: 1, max_total: Some(price) }
                .validate(world);
            let mut offer = json!({"item":key,"stock":stock,"price":price,"line":line,"enabled":checked.is_ok()});
            if let Err(e) = checked {
                offer["blocked_reason"] = json!(ctx.error(&e));
            }
            Some(offer)
        })
        .collect();
    json!({"loc":loc.0,"name":format!("{} · {}",ctx.names.loc(loc).name,label(ctx,"道具店","Item shop")),
        "restock":world_date(world,shelf.restock),"offers":offers,"sell_bp":world.defs.rules.items.sell_bp})
}
