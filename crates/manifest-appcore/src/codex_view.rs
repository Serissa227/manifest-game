//! I4 图鉴只展示玩家已经见过的内容；书目按作品去重，物品按版本保留。
use crate::items_view::{basis, label};
use crate::views::{Ctx, PLAYER};
use manifest_core::{
    World,
    items::{ItemDef, ItemKind},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn codex(ctx: Ctx<'_>, world: &World, category: Option<&str>) -> Value {
    let inv = world.inventory(PLAYER);
    let seen = |key: &str| inv.is_some_and(|i| i.seen.contains(key) || i.acquired.contains(key));
    let got = |key: &str| inv.is_some_and(|i| i.acquired.contains(key));
    let mut works = BTreeMap::<&str, Vec<&ItemDef>>::new();
    for item in world.defs.items.items.iter().filter(|i| i.kind == ItemKind::Book) {
        works.entry(item.work_key()).or_default().push(item);
    }
    let category = if category == Some("books") { "books" } else { "items" };
    let mut entries: Vec<_> = if category == "books" {
        works
            .iter()
            .filter_map(|(work, editions)| {
                let record = inv.and_then(|i| i.bibliography.get(*work));
                // 优先已读版本，其次已见版本；只见译本时不泄露未见原版的内容。
                let item = editions
                    .iter()
                    .min_by_key(|i| (record.is_none_or(|r| r.key != i.key), !seen(&i.key), i.key.as_str()))
                    .copied();
                item.map(|item| {
                    entry(
                        ctx,
                        item,
                        work,
                        if record.is_some() {
                            "got"
                        } else if seen(&item.key) {
                            "seen"
                        } else {
                            "unknown"
                        },
                    )
                })
            })
            .collect()
    } else {
        world
            .defs
            .items
            .items
            .iter()
            .map(|item| {
                entry(
                    ctx,
                    item,
                    &item.key,
                    if got(&item.key) {
                        "got"
                    } else if seen(&item.key) {
                        "seen"
                    } else {
                        "unknown"
                    },
                )
            })
            .collect()
    };
    entries.sort_by(|a, b| a["key"].as_str().cmp(&b["key"].as_str()));
    json!({"categories":[
        {"key":"items","name":label(ctx,"物品","Items"),"got":world.defs.items.items.iter().filter(|i|got(&i.key)).count(),"total":world.defs.items.items.len()},
        {"key":"books","name":label(ctx,"书目","Books"),"got":world.books_read(PLAYER,None),"total":works.len()}],
        "category":category,"entries":entries})
}

fn entry(ctx: Ctx<'_>, item: &ItemDef, key: &str, state: &str) -> Value {
    if state == "unknown" {
        return json!({"key":key,"name":label(ctx,"？？？","???"),"state":state,"icon":null,"desc":null,"basis":null,"sources":[],"changed":null});
    }
    let text = ctx.names.items.item(&item.key).unwrap_or(item);
    json!({"key":key,"name":text.name,"state":state,"icon":text.icon,"desc":text.desc,
        "basis":text.basis.as_deref().map(basis),"sources":text.sources,"changed":null})
}
