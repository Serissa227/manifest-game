//! I8：未获知的彼界整行省略，钥匙与规矩只随已知线索显示。
use crate::views::{Ctx, PLAYER};
use manifest_core::{realms::RealmStatus, story2::Status, *};
use serde_json::{Value, json};
fn item_keys(ctx: Ctx<'_>, w: &World, keys: &[String]) -> Vec<Value> {
    keys.iter()
        .filter_map(|k| {
            ctx.names.items.item(k).map(|i| json!({"item":k,"name":i.name,"have":w.item_quantity(PLAYER,k)>0}))
        })
        .collect()
}
pub(crate) fn realms(ctx: Ctx<'_>, w: &World) -> Value {
    json!({"realms":ctx.names.realms.realms.iter().filter_map(|r|{
        let state=w.realm_status(&r.key);if state==RealmStatus::Unknown{return None}
        // A11 的任选钥匙：组间任选、组内全部满足。走完某条故事线也算一组钥匙，线没开始时不报线名；
        // 旗标条件不出名字，只并进 met（与 key_items、also 一样不泄露私有条件）。
        let any=r.key_any.iter().map(|g|{
            let tracks=g.completed_tracks.iter().map(|k|{
                let s=w.state.story2.tracks.get(k);
                json!({"name":s.and_then(|_|ctx.names.story2.track(k)).map(|t|t.name.clone()),"done":s.is_some_and(|s|s.status==Status::Done)})
            }).collect::<Vec<_>>();
            let met=g.items.iter().all(|k|w.item_quantity(PLAYER,k)>0)
                &&g.flags.iter().all(|f|w.state.story2.flags.contains(f))
                &&tracks.iter().all(|t|t["done"]==true);
            json!({"items":item_keys(ctx,w,&g.items),"tracks":tracks,"met":met})
        }).collect::<Vec<_>>();
        Some(json!({"key":r.key,"name":r.name,"state":state,"hint":r.hint,
            "key_items":item_keys(ctx,w,&r.key_items),"key_any":any,"rules":r.rules}))
    }).collect::<Vec<_>>()})
}
