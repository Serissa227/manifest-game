//! I7/I8：只输出已公开事件和玩家实际取得的情报。
use crate::views::{Ctx, PLAYER};
use manifest_core::{
    history::{EventDef, LeverKind, Observation, Payload},
    *,
};
use serde_json::{Value, json};

fn status(w: &World, e: &EventDef) -> &'static str {
    if w.history_outcome(&e.key).is_some() {
        "resolved"
    } else if e.window.is_some_and(|range| range[0] <= w.cast_date() && w.cast_date() <= range[1]) {
        "active"
    } else {
        "future"
    }
}
fn range(w: &World, o: Option<&Observation>, value: Option<i64>, bounded: bool) -> Value {
    let Some((o, v)) = o.zip(value).filter(|(o, _)| w.day().saturating_sub(o.day) <= 90) else {
        return if bounded { json!({"lo":0,"hi":100,"known":"unknown"}) } else { Value::Null };
    };
    if o.exact && w.day().saturating_sub(o.day) <= 30 {
        json!({"lo":v,"hi":v,"known":"exact"})
    } else {
        let lo = v.div_euclid(20) * 20;
        json!({"lo":if bounded {lo.max(0)} else {lo},"hi":if bounded {(lo+20).min(100)} else {lo+20},"known":"rough"})
    }
}
fn lever(w: &World, ctx: Ctx<'_>, e: &EventDef, l: &history::LeverDef) -> Option<Value> {
    if l.with.iter().chain(l.introducer.iter()).any(|p| !crate::cast_view::known(w, p)) {
        return None;
    }
    let port = l.port.as_ref().and_then(|p| w.defs.find_loc(p));
    if port.is_some_and(|p| !w.loc_known(p)) {
        return None;
    }
    if l.from.as_ref().and_then(|p| w.defs.find_loc(p)).is_some_and(|p| !w.loc_known(p)) {
        return None;
    }
    let observation = w.state.history.known_events.get(&e.key).filter(|o| w.day().saturating_sub(o.day) <= 90);
    let yours = w.history_owner_points(&e.key, &l.key, PLAYER);
    let points = observation.and_then(|o| o.values.get(&l.key)).copied().unwrap_or(yours).max(yours);
    let action = match l.kind {
        LeverKind::Deliver | LeverKind::Arms | LeverKind::Relief => "deliver",
        LeverKind::Money => "money",
        LeverKind::Negotiate => "goto",
        _ => "commit",
    };
    let payload = match l.kind {
        LeverKind::Money => Some(Payload::Money { amount: l.value_per_point }),
        LeverKind::Negotiate => l.terms.first().map(|term| Payload::Negotiate { term: term.clone() }),
        LeverKind::Deliver | LeverKind::Arms | LeverKind::Relief => {
            w.fleets_of(PLAYER).filter(|f| f.docked_at() == port).find_map(|f| {
                l.goods.iter().filter_map(|key| w.defs.find_good(key)).find_map(|good| {
                    let payload = Payload::Deliver { fleet: f.id, goods: vec![(good, 1)], donate: true };
                    Command::Contribute {
                        owner: PLAYER,
                        event: e.key.clone(),
                        lever: l.key.clone(),
                        payload: payload.clone(),
                    }
                    .validate(w)
                    .is_ok()
                    .then_some(payload)
                })
            })
        }
        _ => Some(Payload::Commit {}),
    };
    let check = payload.map(|payload| {
        Command::Contribute { owner: PLAYER, event: e.key.clone(), lever: l.key.clone(), payload }.validate(w)
    });
    let enabled = w.state.history.enabled
        && status(w, e) == "active"
        && !w.state.history.events.get(&e.key).is_some_and(|s| s.closed)
        && check.as_ref().is_some_and(|r| r.is_ok());
    let name = ctx.names.history.event(&e.key).and_then(|e| e.levers.iter().find(|v| v.key == l.key)).unwrap_or(l);
    let goods: Vec<_> = l
        .goods
        .iter()
        .filter_map(|key| w.defs.find_good(key))
        .map(|id| json!({"good":id.0,"name":ctx.names.good(id).name}))
        .collect();
    let risk = name
        .risk
        .clone()
        .or_else(|| (l.leak > 0).then(|| format!("{} {}%", crate::cast_view::label(ctx, "泄密", "Leak"), l.leak)));
    let mut v = json!({"key":l.key,"side":l.side,"kind":l.kind,"label":name.label,"where":port.map(|p|ctx.names.loc(p).name.clone()),"goods":goods,"progress":{"points":points,"max":l.max_points},"yours":yours,"risk":risk,"note":name.note,"action":action,"enabled":enabled});
    if !enabled {
        v["blocked_reason"] = json!(crate::cast_view::label(ctx, "条件尚未满足", "Requirements not met"));
    }
    Some(v)
}
fn event(w: &World, ctx: Ctx<'_>, e: &EventDef) -> Value {
    let n = ctx.names.history.event(&e.key).unwrap_or(e);
    let state = w.state.history.events.get(&e.key);
    let resolved = state.and_then(|s| s.outcome.as_ref());
    let observed = w.state.history.known_events.get(&e.key);
    let outcome=resolved.and_then(|key|n.outcomes.iter().find(|o|&o.key==key)).map(|o|json!({"key":o.key,"text":o.chronicle,"historical":o.key==e.history.outcome,"history":n.outcomes.iter().find(|o|o.key==e.history.outcome).map(|o|o.chronicle.as_str()).unwrap_or("")}));
    let sides: Vec<_> = n.sides.iter().map(|s| json!({"key":s.key,"name":s.name,"color":s.color})).collect();
    let levers: Vec<_> = e.levers.iter().filter_map(|l| lever(w, ctx, e, l)).collect();
    let balance = if resolved.is_some() {
        state.map(|s| json!({"lo":s.balance,"hi":s.balance,"known":"exact"})).unwrap_or(Value::Null)
    } else {
        range(w, observed, observed.map(|o| o.balance), false)
    };
    let mut why = n.why_hard.clone();
    if let Some(need) = &e.need {
        let kinds = e
            .levers
            .iter()
            .filter(|l| w.history_owner_points(&e.key, &l.key, PLAYER) > 0)
            .map(|l| (l.kind, l.mode))
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        why.push(format!("{} {kinds}/{}", crate::cast_view::label(ctx, "杠杆类别", "Lever kinds"), need.kinds));
    }
    if let Some(c) = &e.counter {
        why.push(format!(
            "{} {}% / {}",
            crate::cast_view::label(ctx, "反制比例与上限", "Counter rate and cap"),
            c.pct,
            c.max
        ));
    }
    if let Some(court) = &e.court
        && let Some(name) = e
            .campaign
            .as_deref()
            .and_then(|key| ctx.names.history.campaign(key))
            .and_then(|c| c.vars.iter().find(|v| v.key == court.var))
            .map(|v| v.name.as_str())
            .filter(|name| !name.trim().is_empty())
    {
        why.push(format!("{} {} ≥ {}", crate::cast_view::label(ctx, "朝议门槛", "Court threshold"), name, court.min));
    }
    let narration = serde_json::Map::from_iter(["opening", "progress", "ending"].into_iter().map(|phase| {
        let text = crate::ai_text_view::get(
            ctx,
            w,
            &manifest_core::summary::text::TextTarget::Narration { event: e.key.clone(), phase: phase.into() },
        )
        .map(|(text, _)| text);
        (phase.to_string(), json!(text))
    }));
    let sources: Vec<_> = n.sources.iter().filter(|s| !s.trim_start().starts_with("docs/")).collect();
    json!({"narration":narration,"key":e.key,"title":n.title,"summary":n.summary,"region":n.region,"date":e.date,"window":e.window,"days_left":e.date.and_then(|d|scenario::day_of(&w.defs,d).ok()).map(|d|d.saturating_sub(w.day())),"status":status(w,e),"campaign":e.campaign,"sides":sides,"balance":balance,"levers":levers,"why_hard":why,"outcome":outcome,"basis":n.basis,"sources":sources})
}
pub fn timeline(ctx: Ctx<'_>, w: &World) -> Value {
    if w.defs.history.is_empty() {
        return Value::Null;
    }
    let horizon = w.defs.calendar.year_days().saturating_mul(2);
    let mut events: Vec<_> = w
        .defs
        .history
        .events
        .iter()
        .filter(|e| w.history_event_known(e))
        .filter(|e| w.state.history.events.get(&e.key).is_none_or(|s| !s.closed))
        .filter(|e| match w.state.history.events.get(&e.key).and_then(|s| s.resolved_day) {
            Some(day) => w.day().saturating_sub(day) <= 90,
            None => {
                e.window.is_some_and(|r| r[0] <= w.cast_date() && w.cast_date() <= r[1])
                    || scenario::day_of(&w.defs, e.window.map_or(e.deadline(), |r| r[0]))
                        .is_ok_and(|day| day <= w.day().saturating_add(horizon))
            }
        })
        .collect();
    events.sort_by_key(|e| (e.deadline(), &e.key));
    let deviation = w
        .state
        .history
        .chronicle
        .iter()
        .filter(|r| r.deviates && w.defs.history.event(&r.event).is_some_and(|e| w.history_event_known(e)))
        .count();
    json!({"events":events.into_iter().map(|e|event(w,ctx,e)).collect::<Vec<_>>(),"deviation":deviation,"history_on":w.state.history.enabled})
}
pub fn campaign(ctx: Ctx<'_>, w: &World, key: &str) -> Option<Value> {
    let c = w.defs.history.campaign(key)?;
    let events: Vec<_> = w
        .defs
        .history
        .events
        .iter()
        .filter(|e| e.campaign.as_deref() == Some(key) && w.history_event_known(e))
        .collect();
    if events.is_empty() {
        return None;
    }
    let n = ctx.names.history.campaign(key).unwrap_or(c);
    let obs = w.state.history.known_campaigns.get(key);
    let vars:Vec<_>=c.vars.iter().enumerate().map(|(i,v)| {
        let gates:Vec<_>=v.gates.iter().filter_map(|g|w.defs.history.event(&g.event).filter(|e|w.history_event_known(e)).map(|e|json!({"event":e.key,"name":ctx.names.history.event(&e.key).unwrap_or(e).title,"passed":w.history_outcome(&g.event).map(|o|o==g.outcome)}))).collect();
        let cap=if gates.len()==v.gates.len(){w.campaign_cap(key,&v.key)}else{None};
        json!({"key":v.key,"name":n.vars[i].name,"kind":if v.idea.is_some(){"idea"}else{"force"},"court":v.court,"value":range(w,obs,obs.and_then(|o|o.values.get(&v.key)).copied(),true),"baseline":v.baseline(w.cast_date()[0]),"drift":v.drift,"cap":cap,"gates":gates})
    }).collect();
    let ending_visible = c
        .ending_event
        .as_ref()
        .and_then(|e| w.defs.history.event(e))
        .is_some_and(|e| w.history_event_known(e) && w.history_outcome(&e.key).is_some());
    let outlook = ending_visible
        .then(|| w.state.history.campaigns.get(key))
        .flatten()
        .map(|s| {
            n.endings
                .iter()
                .filter(|e| s.endings.contains(&e.key))
                .map(|e| e.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|s| !s.is_empty())
        .or_else(|| forecast(w, c, n, obs));
    let events: Vec<_> = events
        .into_iter()
        .map(|e| {
            let display = ctx.names.history.event(&e.key).unwrap_or(e);
            let outcome = w
                .history_outcome(&e.key)
                .and_then(|key| display.outcomes.iter().find(|o| o.key == key))
                .map(|o| if o.chronicle.trim().is_empty() { o.news.as_str() } else { o.chronicle.as_str() })
                .filter(|text| !text.trim().is_empty());
            json!({"key":e.key,"title":display.title,"date":e.date,"status":status(w,e),"outcome":outcome})
        })
        .collect();
    Some(
        json!({"key":c.key,"name":n.name,"summary":n.summary,"inertia":c.inertia,"vars":vars,"events":events,"outlook":outlook}),
    )
}

// 预测只读情报快照的区间中点；不会借用隐藏的实际变量或对手当日行动。
fn forecast(
    w: &World,
    c: &history::CampaignDef,
    n: &history::CampaignDef,
    obs: Option<&Observation>,
) -> Option<String> {
    let obs = obs.filter(|o| w.day().saturating_sub(o.day) <= 90)?;
    let final_event =
        c.ending_event.as_ref().and_then(|e| w.defs.history.event(e)).filter(|e| w.history_event_known(e))?;
    let value = |key: &str| -> Option<i64> {
        let r = range(w, Some(obs), obs.values.get(key).copied(), true);
        (r["known"] != "unknown").then(|| (r["lo"].as_i64().unwrap_or(0) + r["hi"].as_i64().unwrap_or(100)) / 2)
    };
    let mut score = final_event.base.unwrap_or(final_event.balance);
    for var in &final_event.base_vars {
        score += var.weight * (value(&var.var)? - 50) / 10;
    }
    let reported = w.state.history.known_events.get(&final_event.key).filter(|o| w.day().saturating_sub(o.day) <= 90);
    let points = |l: &history::LeverDef| {
        reported.and_then(|o| o.values.get(&l.key)).copied().unwrap_or(0).max(w.history_owner_points(
            &final_event.key,
            &l.key,
            PLAYER,
        ))
    };
    for l in &final_event.levers {
        score += points(l) * if l.side == final_event.sides[0].key { 1 } else { -1 };
    }
    if let Some(counter) = &final_event.counter {
        let opposing: i64 = final_event.levers.iter().filter(|l| l.side != counter.side).map(points).sum();
        score += (opposing * counter.pct / 100).min(counter.max)
            * if counter.side == final_event.sides[0].key { 1 } else { -1 };
    }
    let mut ordered: Vec<_> = final_event.outcomes.iter().collect();
    ordered.sort_by_key(|o| history::score_range(&o.when).map(|p| p.0));
    let historical = ordered.iter().position(|o| o.default)?;
    let mut chosen = ordered
        .iter()
        .position(|o| history::score_range(&o.when).is_some_and(|(lo, hi)| lo <= score && score <= hi))?;
    let side = &final_event.sides[usize::from(chosen < historical)].key;
    if let Some(need) = &final_event.need {
        let kinds = final_event
            .levers
            .iter()
            .filter(|l| points(l) > 0 && &l.side == side)
            .map(|l| (l.kind, l.mode))
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        if kinds < need.kinds {
            chosen = historical;
        }
    }
    if chosen != historical
        && let Some(court) = &final_event.court
    {
        let bonus: i64 =
            final_event.levers.iter().filter(|l| &l.side == side && points(l) > 0).map(|l| l.court_bonus).sum();
        // 预测使用已知门槛和加值，不提前读取未来裁定的随机数。
        if value(&court.var)? + bonus < court.min {
            chosen = match court.fail {
                history::CourtFail::Cancel => historical,
                history::CourtFail::Downgrade if chosen > historical => chosen - 1,
                history::CourtFail::Downgrade => chosen + 1,
            };
        }
    }
    let result = ordered[chosen];
    let mut texts = Vec::new();
    for court in &c.outlooks {
        if !court.survives.is_empty() && !court.survives.contains(&result.key) {
            continue;
        }
        let mut chosen = (&court.historical, -1);
        for key in &court.priority {
            let v = c.vars.iter().find(|v| v.key == *key)?;
            if v.gates.iter().any(|g| w.defs.history.event(&g.event).is_none_or(|e| !w.history_event_known(e))) {
                return None;
            }
            if v.gates.iter().any(|g| w.history_outcome(&g.event) != Some(g.outcome.as_str())) {
                continue;
            }
            let p = value(key)?;
            if p >= court.threshold && p > chosen.1 {
                chosen = (v.idea.as_ref()?, p);
            }
        }
        let ending =
            n.endings.iter().find(|e| e.outcome == result.key && e.court == court.key && &e.outlook == chosen.0)?;
        texts.push(ending.text.as_str());
    }
    (!texts.is_empty()).then(|| texts.join("\n"))
}
pub fn chronicle(ctx: Ctx<'_>, w: &World) -> Value {
    if w.defs.history.is_empty() {
        return Value::Null;
    }
    let entries:Vec<_>=w.state.history.chronicle.iter().filter_map(|r| {
        let e=w.defs.history.event(&r.event).filter(|e|w.history_event_known(e))?;
        let n=ctx.names.history.event(&e.key).unwrap_or(e);
        let o=n.outcomes.iter().find(|o|o.key==r.outcome)?;
        Some(json!({"date":crate::items_view::world_date(w,r.day),"text":o.chronicle,"history":n.outcomes.iter().find(|o|o.key==e.history.outcome).map(|o|o.chronicle.as_str()),"deviates":r.deviates}))
    }).chain(w.defs.history.campaigns.iter().filter_map(|c| {
        let e=c.ending_event.as_ref().and_then(|e|w.defs.history.event(e)).filter(|e|w.history_event_known(e))?;
        let s=w.state.history.campaigns.get(&c.key)?;
        let day=s.finished?;
        let n=ctx.names.history.campaign(&c.key).unwrap_or(c);
        let actual=n.endings.iter().filter(|e|s.endings.contains(&e.key)).map(|e|e.text.as_str()).collect::<Vec<_>>().join("\n");
        let historical=n.endings.iter().filter(|x|x.outcome==e.history.outcome && c.outlooks.iter().any(|o|o.key==x.court && o.historical==x.outlook)).map(|e|e.text.as_str()).collect::<Vec<_>>().join("\n");
        Some(json!({"date":crate::items_view::world_date(w,day),"text":actual,"history":historical,"deviates":w.history_outcome(&e.key)!=Some(&e.history.outcome) || c.outlooks.iter().any(|o|s.outlooks.get(&o.key).is_some_and(|v|v!=&o.historical))}))
    })).collect();
    let mut entries = entries;
    let years: std::collections::BTreeSet<_> =
        entries.iter().filter_map(|e| e["date"][0].as_u64().map(|y| y as u32)).collect();
    for year in years {
        let Some((text, ai)) =
            crate::ai_text_view::get(ctx, w, &manifest_core::summary::text::TextTarget::AltChronicle { year })
        else {
            continue;
        };
        let rows: Vec<_> = entries.iter().filter(|e| e["date"][0].as_u64() == Some(u64::from(year))).collect();
        let history = rows.iter().filter_map(|e| e["history"].as_str()).collect::<Vec<_>>().join("\n");
        let deviates = rows.iter().any(|e| e["deviates"] == true);
        let months = w.defs.calendar.months();
        entries.push(json!({"date":[year,months.len(),months.last().copied().unwrap_or(1)],"text":text,"history":history,"deviates":deviates,"annual":true,"ai":ai}));
    }
    entries.sort_by_key(|e| (e["date"][0].as_i64(), e["date"][1].as_i64(), e["date"][2].as_i64()));
    json!({"entries":entries})
}
pub fn ideas(ctx: Ctx<'_>, w: &World, loc: LocId) -> Option<Value> {
    let p = w.defs.locations.get(loc.idx()).filter(|_| w.loc_known(loc)).and_then(|l| w.defs.ideas.port(&l.key))?;
    let n = ctx.names.ideas.port(&p.key).unwrap_or(p);
    let here = w.presence(PLAYER).contains(&loc);
    let shares:Vec<_>=w.defs.ideas.ideas.iter().filter(|_|here).map(|i|json!({"idea":i.key,"name":ctx.names.ideas.idea(&i.key).unwrap_or(i).name,"share":w.idea_share(loc,&i.key).unwrap_or(0),"delta_year":w.idea_delta_year(loc,&i.key)})).collect();
    let modes:Vec<_>=p.modes.iter().enumerate().filter(|(_,m)|
        (here || m.mode==ideas::Mode::Protect && m.from.as_ref().and_then(|key|w.defs.find_loc(key)).is_some_and(|from|w.presence(PLAYER).contains(&from)))
        && m.person.as_ref().is_none_or(|p|crate::cast_view::known(w,p))).map(|(i,m)| {
        let check=Command::Propagate{owner:PLAYER,idea:m.idea.clone(),loc,mode:m.mode}.validate(w);
        let points=if here {w.propagation_points(loc,&m.idea,m.mode)}else{m.points};
        let mut value=json!({"mode":m.mode,"idea":m.idea,"label":n.modes[i].label,"needs":n.modes[i].needs,"points":points,"cap":m.cap,"enabled":check.is_ok()});
        if let Err(error)=check {value["blocked_reason"]=json!(ctx.error(&error));}
        value
    }).collect();
    Some(
        json!({"loc":loc.0,"name":ctx.names.loc(loc).name,"shares":shares,"modes":modes,"hostility":if here {n.hostility_note.as_deref()}else{None},"away":!here}),
    )
}
/// 这座港没有信仰与思想可看：玩家还没到过（`unvisited`），或者这里没有记载（`none`）。
/// 以前这时回的是空值，界面分不出“没有”和“还在取”，一直停在“载入中”。
/// 一并给出到过的、有记载的港，界面好指路；没到过的港不给名字。
pub fn ideas_none(ctx: Ctx<'_>, w: &World, loc: LocId) -> Value {
    let visited = w.defs.locations.get(loc.idx()).is_some() && w.loc_known(loc);
    let ports: Vec<_> = w
        .defs
        .locations
        .iter()
        .enumerate()
        .map(|(i, l)| (LocId::from_idx(i), l))
        .filter(|(id, l)| w.loc_known(*id) && w.defs.ideas.port(&l.key).is_some())
        .map(|(id, _)| json!({"id":id.0,"name":ctx.names.loc(id).name}))
        .collect();
    json!({"loc":loc.0,"name":visited.then(|| ctx.names.loc(loc).name.clone()),"none":if visited {"none"} else {"unvisited"},
        "ports":ports,"shares":[],"modes":[],"hostility":null,"away":!w.presence(PLAYER).contains(&loc)})
}
