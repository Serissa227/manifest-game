//! I8：法术目标与失败原因使用同一份只读命令校验。
use crate::views::{Ctx, PLAYER};
use manifest_core::{arcana::Target, *};
use serde_json::{Value, json};
pub(crate) fn arcana(ctx: Ctx<'_>, w: &World) -> Value {
    let spells:Vec<_>=ctx.names.arcana.spells.iter().filter(|s|w.spell_known(&s.key)).map(|s|{
        let targets:Vec<_>=s.effect.targets().into_iter().flat_map(|kind|match kind{
            "self"=>vec![Target::SelfTarget],"fleet"=>w.fleets_of(PLAYER).map(|f|Target::Fleet(f.id)).collect(),
            "port"=>w.presence(PLAYER).into_iter().map(Target::Port).collect(),
            "event"=>w.defs.history.events.iter().filter(|e|w.history_event_known(e)).map(|e|Target::Event(e.key.clone())).collect(),_=>vec![]}).collect();
        let ready=w.spell_ready(PLAYER,&s.key).and_then(|()|{
            targets.iter().map(|t|w.spell_target_ready(PLAYER,&s.key,t)).find(Result::is_ok).unwrap_or_else(||Err(Reason::new("arcana.target","法术目标条件未满足。").rule()))
        });
        let source = s.source.as_deref().filter(|s| !s.trim_start().starts_with("docs/"));
        let mut value=json!({"key":s.key,"name":s.name,"school":s.school,"rank":s.rank,"desc":s.desc,"cost":s.cost_note,
            "cooldown_left":w.spell_cooldown(&s.key),"targets":s.effect.targets(),"enabled":ready.is_ok(),"source":source});
        if let Err(e)=ready{value["blocked_reason"]=json!(ctx.error(&e));}value
    }).collect();
    let schools: Vec<_> = ctx
        .names
        .arcana
        .schools
        .iter()
        .filter(|school| w.defs.arcana.spells.iter().any(|s| s.school == school.key && w.spell_known(&s.key)))
        .map(|s| {
            let sources: Vec<_> = s.sources.iter().filter(|s| !s.trim_start().starts_with("docs/")).collect();
            json!({"key":s.key,"name":s.name,"level":w.school_level(&s.key),"basis":s.basis,"sources":sources})
        })
        .collect();
    json!({"schools":schools,"spells":spells})
}
