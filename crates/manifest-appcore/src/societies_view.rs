//! I8：只列玩家已获知的结社与自身嫌疑，不返回私有门槛。
use crate::views::{Ctx, PLAYER};
use manifest_core::*;
use serde_json::{Value, json};
#[cfg(test)]
mod tests;
pub(crate) fn localized_reason(code: &str) -> bool {
    ["society.", "arcana.", "creature.", "lineage.", "realm.", "legend_ship."]
        .iter()
        .any(|prefix| code.starts_with(prefix))
}
pub(crate) fn societies(ctx: Ctx<'_>, w: &World) -> Value {
    let societies:Vec<_>=ctx.names.societies.societies.iter().filter(|s|w.society_known(&s.key)).map(|s|{
        let rank=w.society_rank(&s.key);let next=rank.and_then(|rank|s.ranks.get(rank as usize));
        let can=w.can_join_society(PLAYER,&s.key);
        let mut value=json!({"key":s.key,"name":s.name,"secrecy":s.secrecy,
            "known":if rank.is_some(){"member"}else if w.state.societies.met.contains(&s.key){"met"}else{"rumor"},
            "rank":rank,"rank_name":rank.and_then(|r|r.checked_sub(1)).and_then(|r|s.ranks.get(r as usize)).map(|r|&r.name),
            "ranks":s.ranks.iter().enumerate().map(|(i,r)|json!({"n":i+1,"name":r.name,"requirement":r.requirement,"reward":r.reward,"done":rank.is_some_and(|n|usize::from(n)>i)})).collect::<Vec<_>>(),
            "trial":next.and_then(|r|r.trial.as_ref().filter(|t|w.state.story2.tracks.contains_key(*t)).map(|track|json!({"track":track,"text":r.trial_text}))),
            "allies":s.allies.iter().filter(|k|w.society_known(k)).filter_map(|k|ctx.names.societies.society(k).map(|s|&s.name)).collect::<Vec<_>>(),"enemies":s.enemies.iter().filter(|k|w.society_known(k)).filter_map(|k|ctx.names.societies.society(k).map(|s|&s.name)).collect::<Vec<_>>(),
            "seat":s.seat.as_ref().and_then(|key|w.defs.find_loc(key)).filter(|l|w.location_visible(*l)).map(|l|&ctx.names.loc(l).name),
            "basis":s.basis,"sources":s.sources,"active":s.active.map(|[a,b]|format!("{a}–{b}")),"can_join":can.is_ok()});
        if let Err(e)=can{value["blocked_reason"]=json!(ctx.error(&e));}value
    }).collect();
    let suspicion:Vec<_>=w.state.societies.suspicion.iter().filter_map(|(id,value)|ctx.names.factions.get(id.idx()).map(|f|{
        let threshold=w.defs.societies.policies.iter().find(|p|p.faction==f.key).map_or(50,|p|p.threshold);
        json!({"faction":id.0,"name":f.name,"value":value,"level":if *value>=threshold{"high"}else if *value>0{"noticed"}else{"clear"}})
    })).collect();
    json!({"societies":societies,"suspicion":suspicion})
}
