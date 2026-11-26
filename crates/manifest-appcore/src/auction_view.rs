//! I9 拍卖视图。远方只下发公告；估值、预算与未鉴定真相留在内核。
use crate::{
    items_view::{item_line, label, world_date},
    views::{Ctx, PLAYER},
};
use manifest_core::{Command, LocId, World, auction::*};
use serde_json::{Value, json};

fn visible_session<'a>(world: &'a World, def: &AuctionDef) -> Option<&'a Session> {
    world
        .state
        .auctions
        .sessions
        .get(&def.key)
        .filter(|s| world.day() <= s.closes.saturating_add(def.announcement_days))
}
fn planned_open(world: &World, def: &AuctionDef) -> u32 {
    let year = world.defs.calendar.date_of(world.day()).year;
    let opens = def.opens(world, year).unwrap_or(world.day());
    if opens < world.day() { year.checked_add(1).and_then(|y| def.opens(world, y)).unwrap_or(opens) } else { opens }
}
/// 港口入口选择仍在进行的场次，否则取下一场；同日按稳定 key 排序。
pub(crate) fn port_auction(world: &World, loc: LocId) -> Option<String> {
    let day = world.day();
    let year = world.defs.calendar.date_of(day).year;
    world
        .defs
        .auctions
        .auctions
        .iter()
        .filter(|a| a.port == loc)
        .filter_map(|a| {
            let opens =
                world.state.auctions.sessions.get(&a.key).filter(|s| s.closes >= day).map(|s| s.opens).or_else(
                    || {
                        a.opens(world, year)
                            .filter(|opens| opens.saturating_add(a.days.saturating_sub(1)) >= day)
                            .or_else(|| year.checked_add(1).and_then(|next| a.opens(world, next)))
                    },
                )?;
            Some((opens, &a.key))
        })
        .min()
        .map(|(_, key)| key.clone())
}
fn summary(ctx: Ctx<'_>, world: &World, def: &AuctionDef) -> Value {
    let session = visible_session(world, def);
    let opens = session.map_or_else(|| planned_open(world, def), |s| s.opens);
    let closes = session.map_or(opens.saturating_add(def.days - 1), |s| s.closes);
    let phase = session.map_or(Phase::Upcoming, |s| s.phase(world.day(), def.preview_days));
    let text = ctx.names.auctions.get(&def.key).unwrap_or(def);
    let headline = session
        .and_then(|s| {
            s.lots
                .iter()
                .filter_map(|l| ctx.names.items.item(&l.item))
                .max_by(|a, b| a.rarity.cmp(&b.rarity).then_with(|| b.key.cmp(&a.key)))
        })
        .map(|i| i.name.as_str());
    json!({"key":def.key,"name":text.name,"loc":def.port.0,"loc_name":ctx.names.loc(def.port).name,
        "opens_on":world_date(world,opens),"closes_on":world_date(world,closes),
        "days_left":if phase==Phase::Open {closes.saturating_sub(world.day())+1}else{opens.saturating_sub(world.day())},
        "status":phase,"lots":session.map_or(0,|s|s.lots.len()),
        "headline":headline})
}
pub fn auctions(ctx: Ctx<'_>, world: &World, loc: Option<LocId>) -> Value {
    let mut defs: Vec<_> = world
        .defs
        .auctions
        .auctions
        .iter()
        .filter(|a| world.location_visible(a.port) && loc.is_none_or(|l| l == a.port))
        .collect();
    defs.sort_by_key(|a| (visible_session(world, a).map_or_else(|| planned_open(world, a), |s| s.opens), &a.key));
    json!({"auctions":defs.into_iter().map(|a|summary(ctx,world,a)).collect::<Vec<_>>()})
}
fn person(ctx: Ctx<'_>, world: &World, key: &str, captain: Option<&str>) -> Value {
    let you = key == "player";
    let name = if you {
        captain.unwrap_or(label(ctx, "船长", "Captain"))
    } else {
        ctx.names
            .auctions
            .people
            .get(key)
            .or_else(|| world.defs.auctions.people.get(key))
            .map_or(key, |p| p.name.as_str())
    };
    json!({"key":key,"name":name,"you":you})
}
fn inspection_note(ctx: Ctx<'_>, verdict: Authenticity) -> &'static str {
    match verdict {
        Authenticity::Genuine => {
            label(ctx, "材质与工艺符合来历。", "The material and workmanship support its provenance.")
        }
        Authenticity::Fake => {
            label(ctx, "材质或工艺与所称来历不符。", "The material or workmanship contradicts its provenance.")
        }
        Authenticity::Unsure => {
            label(ctx, "现有见识还不足以断定真伪。", "Your present knowledge cannot establish its authenticity.")
        }
    }
}
pub fn auction(ctx: Ctx<'_>, world: &World, key: &str, captain: Option<&str>) -> Option<Value> {
    let def = world.defs.auctions.get(key).filter(|a| world.location_visible(a.port))?;
    let text = ctx.names.auctions.get(key).unwrap_or(def);
    let mut result = summary(ctx, world, def);
    let here = world.at_item_shop(PLAYER, def.port);
    result["here"] = json!(here);
    result["cash"] = json!(world.agent(PLAYER).map_or(0, |a| a.cash));
    result["lots"] = json!([]);
    result["log"] = json!([]);
    let Some(session) =
        visible_session(world, def).filter(|s| here && s.phase(world.day(), def.preview_days) != Phase::Upcoming)
    else {
        return Some(result);
    };
    let lots:Vec<_>=session.lots.iter().filter_map(|l| {
        let line=item_line(ctx,world,PLAYER,&l.item)?;
        let leader=l.leader.as_ref().map(|k|person(ctx,world,k,captain));
        let winner=leader.clone().filter(|_|l.status==LotStatus::Sold).map(|mut p|{p["price"]=json!(l.current);p});
        let bid=Command::BidAuction {owner:PLAYER,auction:key.into(),lot:l.key.clone(),amount:l.next_min()}.validate(world);
        let inspect=Command::InspectLot {owner:PLAYER,auction:key.into(),lot:l.key.clone()}.validate(world);
        let detail=text.lot(&l.item,l.special);
        let lost=matches!(l.status,LotStatus::Sold|LotStatus::Passed)&&l.leader.as_deref()!=Some("player");
        let mut inspection=json!({"done":l.inspection.is_some(),"verdict":l.inspection,
            "note":l.inspection.map(|v|inspection_note(ctx,v)),"can_inspect":inspect.is_ok()});
        // 买到赝品后的追索线索只在真伪已鉴定后显示，未鉴定时仍不泄漏后台真相。
        if l.inspection==Some(Authenticity::Fake)&&l.status==LotStatus::Sold&&l.leader.as_deref()==Some("player")
            && let Some(note)=detail.as_ref().and_then(|d|d.fake_note.as_ref()) {inspection["note"]=json!(note);}
        if let Err(e)=inspect {inspection["blocked_reason"]=json!(ctx.error(&e));}
        let bidders:Vec<_>=l.bidders.iter().map(|(key,state)| {
            let identity=person(ctx,world,key,captain);
            let info=ctx.names.auctions.people.get(key).or_else(||world.defs.auctions.people.get(key));
            let mood=text.bidders.iter().find(|b|b.person==*key).and_then(|b|state.mood.and_then(|i|b.mood_lines.get(i)));
            json!({"key":key,"name":identity["name"],"portrait":info.and_then(|p|p.portrait.as_ref()),"active":state.active,"mood":mood})
        }).collect();
        let mut value=json!({"key":l.key,"line":line,"qty":1,"status":l.status,"reserve":l.reserve,"increment":l.increment,
            "current":l.current,"leader":leader,"next_min":l.next_min(),"bidders":bidders,"inspection":inspection,
            "winner":winner,"after_loss":detail.filter(|_|lost).map(|d|d.after_loss),"enabled":bid.is_ok()});
        if let Err(e)=bid {value["blocked_reason"]=json!(ctx.error(&e));}Some(value)
    }).collect();
    result["lots"] = json!(lots);
    result["log"] = json!(
        session
            .log
            .iter()
            .map(|e| {
                let who = e.bidder.as_ref().map(|k| person(ctx, world, k, captain));
                let name = who.as_ref().and_then(|p| p["name"].as_str()).unwrap_or("");
                let item = session
                    .lots
                    .iter()
                    .find(|l| l.key == e.lot)
                    .and_then(|l| ctx.names.items.item(&l.item))
                    .map_or(e.lot.as_str(), |i| i.name.as_str());
                let amount = e.amount.unwrap_or(0);
                let text = match e.kind {
                    AuctionEventKind::Bid => {
                        if ctx.tr.is_some() {
                            format!("{name} bids {amount} for {item}.")
                        } else {
                            format!("{name}为{item}出价 {amount}。")
                        }
                    }
                    AuctionEventKind::Sold => {
                        if ctx.tr.is_some() {
                            format!("{item} sold to {name} for {amount}.")
                        } else {
                            format!("{item}以 {amount} 成交，得主是{name}。")
                        }
                    }
                    AuctionEventKind::Passed => {
                        if ctx.tr.is_some() {
                            format!("{item} remained unsold.")
                        } else {
                            format!("{item}无人应价，流拍。")
                        }
                    }
                    AuctionEventKind::Inspected => {
                        if ctx.tr.is_some() {
                            format!("{item} inspected.")
                        } else {
                            format!("已鉴定{item}。")
                        }
                    }
                };
                json!({"lot":e.lot,"text":text})
            })
            .collect::<Vec<_>>()
    );
    Some(result)
}
