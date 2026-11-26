//! 名船只展示已知图纸、传闻与实际所有权。
use crate::views::{Ctx, PLAYER};
use manifest_core::{
    legend_ships::{AcquireKind, LegendShipDef, Trait},
    *,
};
use serde_json::{Value, json};
fn trait_name(t: Trait) -> (&'static str, &'static str) {
    match t {
        Trait::Ghost => ("幽灵", "Ghost"),
        Trait::Oracle => ("神谕", "Oracle"),
        Trait::FogSail => ("雾航", "Fog sail"),
        Trait::StormRider => ("驭风暴", "Storm rider"),
        Trait::Armored => ("装甲", "Armored"),
        Trait::Ram => ("撞角", "Ram"),
        Trait::Paddle => ("明轮", "Paddle"),
        Trait::Giant => ("巨舰", "Giant"),
        Trait::ClipperHull => ("飞剪船体", "Clipper hull"),
        Trait::Sacred => ("受庇护", "Sacred"),
        Trait::FairWind => ("顺风", "Fair wind"),
        Trait::BoardingBridge => ("渡鸦吊桥", "Boarding bridge"),
        Trait::Salvage => ("拾遗", "Salvage"),
        Trait::Dread => ("震慑", "Dread"),
        Trait::NightHide => ("夜隐", "Night hide"),
        Trait::StormWard => ("镇浪", "Storm ward"),
        Trait::CalmFloor => ("无风行", "Calm sailing"),
        Trait::FreshKeep => ("不断鲜", "Fresh stores"),
        Trait::Lookout => ("瞭望", "Lookout"),
    }
}
pub(crate) fn legend_ships(ctx: Ctx<'_>, w: &World) -> Value {
    let loc = w.flagship(PLAYER).and_then(|f| w.fleet(f).ok()).and_then(|f| f.docked_at());
    let mut value = json!({"ships":ctx.names.legend_ships.ships.iter().filter_map(|s|{
        let state=w.legend_ship_state(&s.key);if state=="unknown"{return None}
        let can=match s.acquire.kind {
            AcquireKind::Witness if w.defs.rules.ships.s02_enabled => Err(Reason::new("legend_ship.witness","（待写）").rule()),
            AcquireKind::GrantStory if w.defs.rules.ships.s02_enabled => Err(Reason::new("legend_ship.granted","（待写）").rule()),
            _ => loc.ok_or_else(||Reason::new("legend_ship.away","旗舰未停在船厂。").rule()).and_then(|l|w.can_commission_ship(PLAYER,&s.key,l)),
        };
        let traits:Vec<_>=s.traits.iter().map(|t|{
            let (zh,en)=trait_name(*t);
            json!({"key":t,"name":if ctx.tr.is_some(){en}else{zh},"text":s.trait_notes.get(t).map(String::as_str).unwrap_or("")})
        }).collect();
        let hull=ctx.names.ships.iter().find(|h|h.key==s.hull).map(|h|h.name.as_str()).unwrap_or(&s.hull);
        let mut value=json!({"key":s.key,"name":legend_ship_name(w,s),"hull":hull,"traits":traits,"state":state,"lore":s.lore,
            "acquire":s.acquire_note,"basis":s.basis,"sources":s.sources,"can_commission":can.is_ok()});
        if w.defs.rules.ships.s02_enabled {
            value["acquire_kind"]=json!(s.acquire.kind);
        }
        if let Err(e)=can {
            value["blocked_reason"]=json!(ctx.error(&e));
            if w.defs.rules.ships.s02_enabled && s.acquire.kind != AcquireKind::Build {
                value["blocked_reason_code"]=json!(e.reason().map(|r|r.code));
            }
        }
        Some(value)
    }).collect::<Vec<_>>()});
    if w.defs.rules.ships.s02_enabled {
        crate::navigation_view::visibility::redact_prose(ctx, w, &mut value);
    }
    value
}

/// 所有名船身份显示共用揭晓旗标；传入当前语言的定义，缺字段时保持原名。
pub(crate) fn legend_ship_name<'a>(w: &World, s: &'a LegendShipDef) -> &'a str {
    if w.defs.rules.ships.s02_enabled
        && s.reveal_flag.as_ref().is_some_and(|flag| !w.state.story2.flags.contains(flag))
        && let Some(name) = &s.unrevealed_name
    {
        return name;
    }
    &s.name
}
