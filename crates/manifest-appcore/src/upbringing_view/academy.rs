//! 小地图只公开当前位置的人物；远足未发现节点不泄露名称、危险和提示。
use super::*;
fn display_place<'a>(ctx: Ctx<'a>, key: &str) -> Option<&'a PlaceDef> {
    ctx.names
        .upbringing
        .families
        .iter()
        .flat_map(|f| &f.places)
        .chain(ctx.names.upbringing.academies.iter().flat_map(|a| &a.places))
        .find(|p| p.key == key)
}
pub(super) fn places(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    w.upbringing_places().iter().map(|place| {
        let d=display_place(ctx,&place.key).unwrap_or(place);
        let open=w.upbringing_place_open(place);
        let people=w.defs.cast.persons.iter().filter(|p|open&&w.state.cast.persons.get(&p.key).is_some_and(|s|s.met)
            &&w.upbringing_companion_present(&p.key,Some(&place.key),w.cast_date()))
            .map(|p|{let d=ctx.names.cast.person(&p.key).unwrap_or(p);json!({"key":p.key,"name":d.name,"portrait":d.portrait(w.cast_date())})}).collect::<Vec<_>>();
        json!({"key":place.key,"name":d.name,"x":place.x,"y":place.y,"kind":place.kind,"open":open,"people":people,"hint":d.hint})
    }).collect()
}
pub(super) fn excursions(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    w.defs.upbringing.excursions.iter().filter(|e|w.excursion_available(e))
        .map(|e| {
            let d=ctx.names.upbringing.excursion(&e.key).unwrap_or(e);
            let nodes=e.nodes.iter().map(|node| {
                let state=w.excursion_node_state(&e.key,&node.key);
                let seen=state!=NodeState::Unknown;
                let display=d.nodes.iter().find(|n|n.key==node.key).unwrap_or(node);
                json!({"key":node.key,"name":if seen{display.name.as_str()}else{"?"},"x":node.x,"y":node.y,"state":state,
                    "danger":if seen{node.danger}else{0},"hint":seen.then_some(display.hint.as_ref()).flatten(),
                    "links":if seen{node.links.clone()}else{Vec::new()}})
            }).collect::<Vec<_>>();
            json!({"key":e.key,"name":d.name,"nodes":nodes})
        }).collect()
}
pub(super) fn companions(ctx: Ctx<'_>, w: &World, player_name: Option<&str>) -> Vec<Value> {
    w.upbringing_companions().into_iter().filter_map(|(key,role)| {
        let p=crate::cast_view::companion(ctx,w,&key,player_name)?;
        Some(json!({"key":key,"name":p["name"],"portrait":p["portrait"],"role":role,"summary":p["summary"],"bond":p["bond"],"affinity":p["affinity"],
            "heart":p["heart"],"heart_stage":p["heart_stage"],"romance_open":!p["heart"].is_null(),"relation":p["relation"],"call_name":p["call_name"],
            "birthday":p["birthday"],"days_to_birthday":p["days_to_birthday"],"likes_known":p["likes_known"],"dislikes_known":p["dislikes_known"],
            "where_now":p["where"],"next_hint":null}))
    }).collect()
}
pub(super) fn calendar(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    let Some(loc) = w.upbringing_location() else { return Vec::new() };
    let culture = w
        .upbringing_academy()
        .map(|a| a.culture.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&w.defs.loc(loc).culture);
    let mut marks = Vec::new();
    let mut add = |date: manifest_core::scenario::WorldDate, kind: &str, key: &str, name: &str, heart: bool| {
        if let Ok(day) = manifest_core::scenario::day_of(&w.defs, date)
            && day >= w.day()
            && day - w.day() <= 120
        {
            marks.push(json!({"date":date,"days_left":day-w.day(),"kind":kind,"key":key,"name":name,"heart":heart,"note":null}));
        }
    };
    for f in w.defs.upbringing.festivals.iter().filter(|f| f.cultures.iter().any(|c| c == culture)) {
        let name =
            ctx.names.upbringing.festivals.iter().find(|d| d.key == f.key).map_or(f.name.as_str(), |d| d.name.as_str());
        for date in &f.dates {
            add(*date, "festival", &f.key, name, false);
        }
    }
    if let Some(a) = w.upbringing_academy() {
        let display = ctx.names.upbringing.academy(&a.key).unwrap_or(a);
        for m in &a.calendar {
            let name = display.calendar.iter().find(|d| d.key == m.key).map_or(m.name.as_str(), |d| d.name.as_str());
            add(m.date, &m.kind, &m.key, name, false);
        }
    }
    for key in w.upbringing_companions().keys() {
        let Some(p) = ctx.names.cast.person(key).filter(|p| p.born[0] != 0) else { continue };
        let year = w.cast_date()[0];
        for year in year..=year.saturating_add(1) {
            add(
                [year, p.born[1], p.born[2]],
                "birthday",
                key,
                &p.name,
                w.affection(key).is_some_and(|a| a.heart > 0)
                    && w.validate_romance(key, manifest_core::cast::relations::RomanceAction::Heart).is_ok(),
            );
        }
    }
    marks.extend(super::contest::calendar(ctx, w));
    marks.extend(super::milestones::calendar(ctx, w));
    marks.sort_by(|a, b| {
        a["days_left"]
            .as_u64()
            .cmp(&b["days_left"].as_u64())
            .then_with(|| a["kind"].as_str().cmp(&b["kind"].as_str()))
            .then_with(|| a["key"].as_str().cmp(&b["key"].as_str()))
    });
    marks
}
