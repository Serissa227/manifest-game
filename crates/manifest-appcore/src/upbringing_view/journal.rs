//! 日记、回忆与信件只使用实际结算或已经获知的内容，不填造未见闻事件。
use super::*;
use std::collections::BTreeMap;
fn date(w: &World, day: u32) -> [u32; 3] {
    let d = w.defs.calendar.date_of(day);
    [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}
fn memory_copy<'a>(
    ctx: Ctx<'a>,
    w: &World,
    key: &str,
    title: &str,
) -> Option<(&'a manifest_core::story2::ChapterDef, String)> {
    for t in &w.defs.story2.tracks {
        for c in &t.chapters {
            let visited = w.state.story2.tracks.get(&t.key).is_some_and(|s| s.visited.contains(&c.key));
            let known = w.state.story2.news.values().any(|n| n.known && n.id == format!("{}:{}", t.key, c.key));
            if !visited && !known {
                continue;
            }
            let index=manifest_core::story2::graph::branches(c).into_iter().flat_map(|b|b.effects).position(|e|matches!(e,manifest_core::story2::Effect::Memory{memory,title:ref saved} if memory==key&&saved==title));
            let Some(index) = index else { continue };
            let display = ctx.names.story2.track(&t.key)?.chapter(&c.key)?;
            if let Some(manifest_core::story2::Effect::Memory { title, .. }) =
                manifest_core::story2::graph::branches(display).into_iter().flat_map(|b| b.effects).nth(index)
            {
                return Some((display, title));
            }
        }
    }
    None
}
pub(super) fn memories(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    let s = w.state.upbringing.as_ref();
    w.state.story2.memories.iter().map(|(key,title)|{
        let origin=memory_copy(ctx,w,key,title).map(|(c,title)|(title,c.text.clone(),c.art.clone()))
            .or_else(||super::native_memory::memory(ctx,w,key,title));
        let translated=origin.as_ref().map_or_else(||title.clone(),|(title,_,_)|title.clone());
        let day=s.and_then(|s|s.memory_days.get(key)).copied().or_else(||w.state.story2.news.values().filter(|n|n.known&&w.story2_news_effects(n).iter().any(|e|matches!(e,manifest_core::story2::Effect::Memory{memory,..} if memory==key))).map(|n|n.day).min()).unwrap_or(w.player_start_day());
        json!({"key":key,"title":translated,"date":date(w,day),"art":origin.as_ref().and_then(|(_,_,art)|art.as_deref()),"line":origin.as_ref().map_or(translated.as_str(),|(_,text,_)|text.as_str())})
    }).collect()
}
pub(super) fn letters(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    w.known_news(None).into_iter().filter(|n|n.kind==manifest_core::story2::NewsKind::Letter).map(|n|{
        let v=crate::story2_view::news(ctx,w,n);let from=n.persons.first().map(String::as_str).unwrap_or("");
        let arrived=w.state.upbringing.as_ref().and_then(|s|s.letter_arrivals.get(&n.id)).copied().unwrap_or(n.day);
        json!({"key":n.id,"from":from,"from_name":ctx.names.cast.person(from).map_or(from,|p|&p.name),"sent":date(w,n.day),"arrived":date(w,arrived),"title":ctx.names.story2.track(&n.track).map_or("",|t|t.name.as_str()),"body":v["text"],"read":n.read,"ai":v["ai"].as_bool().unwrap_or(false)})
    }).collect()
}
pub(super) fn diary(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    let mut months = BTreeMap::<[u32; 2], Vec<String>>::new();
    if let Some(s) = &w.state.upbringing {
        for entry in &s.journal {
            let d = date(w, entry.day);
            let result = super::activity::result(ctx, &entry.result);
            let mut text = result["title"].as_str().unwrap_or("").to_owned();
            if let Some(line) = result["line"].as_str() {
                text.push('\n');
                text.push_str(line);
            }
            months.entry([d[0], d[1]]).or_default().push(text);
        }
    }
    months
        .into_iter()
        .map(|(month, text)| {
            let replacement = crate::ai_text_view::get(
                ctx,
                w,
                &manifest_core::summary::text::TextTarget::Diary { year: month[0], month: month[1] },
            );
            let (text, ai) = replacement.unwrap_or_else(|| (text.join("\n"), false));
            json!({"month":month,"text":text,"ai":ai})
        })
        .collect()
}
