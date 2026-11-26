//! 行动制读模型：只投影键、数值与已有结果，不生成玩家文案。
use crate::views::Ctx;
use manifest_core::{
    CommandError, OwnerId, Reason, World,
    error::REASON_CODES,
    text::TextArg,
    upbringing::{act::*, *},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// 与 act 内的稳定键配套的只读文字表；文字均取数据，不在代码里编写。
pub fn texts(ctx: Ctx<'_>) -> Option<BTreeMap<String, String>> {
    let defs = &ctx.names.upbringing;
    let mut out = BTreeMap::new();
    for line in &defs.lines {
        out.insert(format!("act:line:{}:name", line.key), line.name.clone());
    }
    for duty in &defs.act_duties {
        out.insert(format!("act:duty:{}:name", duty.key), duty.name.clone());
        out.insert(format!("act:duty:{}:desc", duty.key), duty.desc.clone());
    }
    for m in &defs.missions {
        out.insert(format!("act:mission:{}:text", m.key), m.text.clone());
    }
    for review in &defs.act_review {
        for (kind, names) in [("home", &review.rank_names_home), ("academy", &review.rank_names_academy)] {
            for (i, name) in names.iter().enumerate() {
                out.insert(format!("act:rank:{}:{kind}:{}", review.family, i + 1), name.clone());
            }
        }
    }
    for (pool, greeting) in defs.act_greetings.iter().enumerate() {
        for (line, text) in greeting.lines.iter().enumerate() {
            out.insert(format!("act:greet:{}:{pool}:{line}", greeting.family), text.clone());
        }
    }
    for v in &defs.act_voyages {
        out.insert(format!("act:voyage:{}:name", v.key), v.name.clone());
        out.insert(format!("act:voyage:{}:desc", v.key), v.desc.clone());
    }
    // 关口成绩的说法在文字表的 [act_gates] 一节（代码里不写字）；表里没有时不发，界面自己垫底。
    for grade in ["fail", "ok", "good"] {
        if let Some(text) = ctx.texts.and_then(|texts| texts.get(&format!("act_gates.{grade}"))) {
            out.insert(format!("act:gate:{grade}"), text.into());
        }
    }
    for tide in &defs.act_tides {
        for (field, text) in [("name", &tide.name), ("desc", &tide.desc)] {
            if let Some(text) = text {
                out.insert(format!("act:tide:{}:{}:{field}", tide.port, tide.key), text.clone());
            }
        }
    }
    if let Some(texts) = ctx.texts {
        for key in texts.keys() {
            if let Some(kind) = key.strip_prefix("act_perks.")
                && let Some(text) = texts.get(key)
            {
                out.insert(format!("act:perk:{kind}"), text.into());
            }
        }
    }
    (!out.is_empty()).then_some(out)
}

fn result(r: &SlotResult) -> Value {
    json!({"growth":r.growth,"skill":r.skills,"cash":r.cash,"fatigue":r.fatigue,"mood":r.mood,
        "affinity":r.affinity,"success":r.success})
}
fn free_skips(ctx: Ctx<'_>, skips: &[FreeSkip]) -> Vec<Value> {
    skips.iter().map(|skip| {
        let section = if REASON_CODES.iter().any(|(code, _)| *code == skip.reason) { "reasons" } else { "errors" };
        let vars: BTreeMap<_, _> = skip.args.iter().filter_map(|(key, arg)| {
            let value = if let Some((_, locale)) = ctx.tr {
                locale.arg_text(arg, &|_| None)
            } else {
                match arg {
                    TextArg::Text(value) => value.clone(),
                    TextArg::Int(value) => value.to_string(),
                    _ => return None,
                }
            };
            Some((key.as_str(), value))
        }).collect();
        let text = ctx.texts.or_else(|| ctx.tr.map(|(_, locale)| &locale.texts))
            .and_then(|texts| texts.get(&format!("{section}.{}", skip.reason)))
            .map(|template| manifest_data::locale::fill(template, &vars));
        json!({"step":skip.step,"place":skip.plan.place,"kind":skip.plan.action.kind(),
            "target":skip.plan.action.target(),"action":skip.plan.action,"reason":skip.reason,"args":skip.args,"reason_text":text})
    }).collect()
}
fn summary(ctx: Ctx<'_>, w: &World, s: &WeekSummary) -> Value {
    let affinity_changes: Vec<_> = s
        .affinity
        .iter()
        .map(|(person, value)| {
            let name = ctx.names.cast.person(person).or_else(|| w.defs.cast.person(person)).map(|p| &p.name);
            json!({"person":person,"name":name,"value":value})
        })
        .collect();
    json!({"week":s.week,"from":s.from,"to":s.to,"growth":s.growth,"skill":s.skills,"cash":s.cash,
        "fatigue":s.fatigue,"mood":s.mood,"affinity":s.affinity,"affinity_changes":affinity_changes,"lessons_ok":s.lessons_ok,"lessons_fail":s.lessons_fail,
        "points_used":s.points_used,"markers_seen":s.markers_seen,"ranks":s.k2.review,"merit":s.merit,"score_delta":s.score_delta,
        "free_template":{"applied":s.free_applied,"skipped":free_skips(ctx,&s.free_skipped)}})
}
pub fn view(ctx: Ctx<'_>, w: &World) -> Value {
    let Some(s) = &w.state.upbringing else { return Value::Null };
    let Some(r) = w.act_rules() else { return Value::Null };
    let a = &s.act;
    let key = w.act_stage_key();
    let today = w.cast_date();
    let from = w.act_week_date(a.week, false);
    let to = w.act_week_date(a.week, true);
    let before = a.opened.clone().unwrap_or_default();
    let stops = w.act_stops();
    // 与 stop_targets 的同名数组逐项对应，保留原有目标键的形状。
    let stop_target_names: BTreeMap<_, Vec<_>> = stops
        .iter()
        .filter(|(kind, _)| kind.as_str() == "tier_open")
        .map(|(kind, targets)| {
            let names = targets
                .iter()
                .map(|target| {
                    let key = target.rsplit_once(':').map_or(target.as_str(), |(line, _)| line);
                    ctx.names
                        .upbringing
                        .lines
                        .iter()
                        .find(|l| l.key == key)
                        .or_else(|| w.defs.upbringing.lines.iter().find(|l| l.key == key))
                        .map(|l| l.name.as_str())
                        .filter(|name| !name.trim().is_empty() && name.trim() != "（待写）")
                })
                .collect();
            (kind, names)
        })
        .collect();
    let stop_order =
        ["tier_open", "fee", "fatigue", "calendar", "mission_due", "key_marker", "restage", "blocked", "ill", "voyage"];
    let mut stop_kinds: Vec<_> = stops.keys().collect();
    stop_kinds.sort_by_key(|kind| stop_order.iter().position(|key| *key == kind.as_str()).unwrap_or(stop_order.len()));
    // `stops` 保持原来的形状（种类的字符串数组，现有界面在读）；每条的分类另放在 `stop_info`。
    let stop_views: Vec<_> = stop_kinds
        .iter()
        .copied()
        .map(|kind| json!({"kind":kind,"blocking":act_stop_blocking(kind),"targets":stops[kind]}))
        .collect();
    let slots:Vec<_>=w.act_lesson_days().iter().enumerate().map(|(i,day)| {
        let plan=w.act_lesson_plan().get(i);let line=plan.and_then(|p|w.defs.upbringing.lines.iter().find(|l|l.key==p.line));
        let activity=line.zip(plan).and_then(|(l,p)|l.tiers.get(usize::from(p.tier))).and_then(|t|w.defs.upbringing.activity(&t.activity));
        let mut date=from;date[2]+=u32::from(*day)-1;
        let past=s.stage_from.is_some_and(|d|d>from&&date<d) || (date<today && !s.last.iter().any(|r|r.index as usize==i));
        let settled=(!past).then(||s.last.iter().rev().find(|r|r.index as usize==i)).flatten();
        let gains:BTreeMap<String,[i64;2]>=activity.map(|act|act.gains.iter().map(|(k,range)| {
            let room=(w.upbringing_annual_cap()-if s.growth_year==today[0]{s.year_growth.get(k).copied().unwrap_or(0)}else{0}).max(0)*100;
            let max=(if w.defs.captain.attribute_index(k).and_then(|i|w.defs.captain.group(i)).is_some_and(|g|g.key=="conduct"){100}else{1000}-w.upbringing_growth(k)).max(0)*100;
            let scale=|v:i64|(v*w.upbringing_efficiency(act)/100*r.lesson_permille/10).min(room).min(max);
            (k.clone(),[scale(range[0]),scale(range[1])])
        }).collect()).unwrap_or_default();
        let expected=gains.values().map(|r|(r[0]+r[1])/2).max().unwrap_or(0);
        let mut value=json!({"index":i,"day":day,"kind":if i>0&&w.act_lesson_days()[i-1]==*day{"evening"}else{"day"},
            "date":date,"past":past,"line":plan.map(|p|&p.line),"tier":plan.map_or(0,|p|p.tier),"activity":activity.map(|a|&a.key),
            "with":plan.and_then(|p|p.with.as_ref()),"fee":activity.map_or(0,|a|w.act_lesson_fee(a)),
            "fatigue_x10":plan.and_then(|p|r.fatigue.get(usize::from(p.tier))).copied().unwrap_or(0),
            "yield":expected,"gains":gains,"success_pct":activity.map_or(0,|a|100-w.upbringing_risk(a)/100),"great_pct":null});
        if let Some(result)=settled {
            value["result"]=json!({"grade":if result.success==Some(false){"fail"}else{"ok"},"growth":result.growth,
                "skill":result.skills,"cash":result.cash,"fatigue":result.fatigue,"affinity":result.affinity});
        }
        value
    }).collect();
    let lines:Vec<_>=w.defs.upbringing.lines.iter().filter(|l|w.act_line_here(l) || w.act_voyage_def().is_some_and(|v|v.line==l.key)).map(|l| {
        let state=a.lines.get(&l.key).cloned().unwrap_or_default();
        let activity=l.tiers.first().and_then(|t|w.defs.upbringing.activity(&t.activity));
        let attr=l.attr.as_deref().or_else(||activity.and_then(|a|a.gains.iter().max_by_key(|(_,r)|r[1]).map(|(k,_)|k.as_str())));
        let used=if s.growth_year==today[0] {attr.and_then(|k|s.year_growth.get(k)).copied().unwrap_or(0)} else {0};
        let tiers:Vec<_>=l.tiers.iter().enumerate().map(|(i,t)|json!({"activity":t.activity,"open":w.act_tier_open(l,i as u8),
            "used":state.used&(1<<i)!=0,"new":w.act_tier_open(l,i as u8)&&state.seen&(1<<i)==0,
            "gain_need":null,"gain_have":null,"root_need":null,"root_have":null,"bond_need":null,"bond_have":null,
            "rank_need":null,"exam":null,"fee":null,"tool":null,"gift":null,"gate":t.gate})).collect();
        json!({"key":l.key,"stage":l.stage,"academy":(!l.academy.is_empty()).then_some(&l.academy),"place":l.place,
            "attr":l.attr,"side":l.side,"skill":l.skill,"root":l.root,"mentor":l.mentor,
            "tier":w.act_lesson_plan().iter().filter(|p|p.line==l.key).map(|p|i64::from(p.tier)).max().unwrap_or(-1),
            "tiers":tiers,"efficiency_pct":activity.map_or(100,|a|w.upbringing_efficiency(a)),"year_room":(w.upbringing_annual_cap()-used).max(0)})
    }).collect();
    let places:Vec<_>=w.act_places().iter().map(|p| {
        let localized = s.act.voyage.as_ref().and_then(|active| {
            ctx.names.upbringing.act_voyages.iter().find(|v|v.key==active.key)
                .and_then(|v|v.legs.get(usize::from(active.leg))).and_then(|leg|leg.places.iter().find(|place|place.key==p.key))
        }).or_else(|| {
            w.upbringing_academy().and_then(|a|ctx.names.upbringing.academies.iter().find(|localized|localized.key==a.key))
                .map(|a|a.places.as_slice())
                .or_else(||ctx.names.upbringing.family(&s.family).map(|f|f.places.as_slice()))
                .and_then(|places|places.iter().find(|place|place.key==p.key))
        }).unwrap_or(p);
        let people:Vec<_>=a.presence.iter().filter(|(_,at)|*at==&p.key).map(|(k,_)|json!({"key":k,"rank":w.act_person_level(k),"greeted":a.greeted.get(k)==Some(&a.week),"marker":w.act_marker_for_person(k)})).collect();
        let shop:Vec<_>=w.act_shop(&p.key).into_iter().map(|(item,price)|json!({"item":item,"price":price,"have":w.item_quantity(OwnerId::Player,&item),"name":item_name(ctx,w,&item)})).collect();
        let jobs:Vec<_>=w.act_job_tier(&p.key).iter().map(|activity| {
            let group=job_group(activity);let tier=activity.tier.as_ref();let income=activity.income.bounds().map(|v|v*r.job.income_permille/1000);
            let carry=a.carry.get(&format!("job:{group}")).copied().unwrap_or(0);
            let progress=(i64::from(w.upbringing_job_progress(group))*1000+carry)/r.job.progress_permille.max(1);
            let goods:Vec<_>=w.act_place_def(&p.key).and_then(|p|p.job_goods.get(group)).into_iter().flatten().map(|good| {
                let seen=a.goods_seen.get(good).copied().unwrap_or(0);
                let name=ctx.names.goods.iter().find(|g|g.key==*good).or_else(||w.defs.goods.iter().find(|g|g.key==*good)).map(|g|&g.name);
                json!({"good":good,"name":name,"seen":seen,"need":r.rumor.known_after,"known":seen>=r.rumor.known_after})
            }).collect();
            json!({"activity":activity.key,"group":group,"level":tier.map_or(1,|t|t.level),"income":income,"fatigue_x10":r.job_fatigue,
                "success_pct":100-w.upbringing_risk(activity)/100,"progress":progress,
                "next_at":tier.filter(|t|t.next>0).map(|t|i64::from(t.next)*1000/r.job.progress_permille.max(1)),"goods":goods})
        }).collect();
        let markers=a.markers.iter().any(|(key,m)|w.act_marker_visible(key)&&m.place==p.key);
        let actions:Vec<_>=w.act_place_actions(&p.key).into_iter().map(|action| {
            let text=action.reason.as_deref().and_then(|code| {
                let error=if action.kind=="gift" {
                    action.targets.first().zip(w.act_gift_items().first()).and_then(|(person,(item,_))| {
                        w.act_action_problem(&p.key,&ActAction::Gift{person:person.clone(),item:item.clone()}).err()
                    })
                } else {None};
                reason_text(ctx,w,code,action.cost,error)
            });
            let mut value=json!(action);
            value["reason_text"]=json!(text);
            value
        }).collect();
        json!({"key":p.key,"name":localized.name,"hint":localized.hint,"x":p.x,"y":p.y,"kind":p.kind,"venue":p.venue,"open":w.upbringing_place_open(p),
            "faded":people.is_empty()&&!markers&&shop.is_empty()&&jobs.is_empty(),"people":people,"actions":actions,"shop":shop,"jobs":jobs})
    }).collect();
    let markers: Vec<_> = a
        .markers
        .iter()
        .filter(|(track, _)| w.act_marker_visible(track))
        .map(|(track, m)| {
            let error = w.act_marker_problem(&m.place, track).err();
            let code = error.as_ref().map(CommandError::code);
            let text = code.and_then(|code| reason_text(ctx, w, code, 1, error));
            let deadline = w.act_marker_deadline(track).unwrap_or(w.day());
            let date = w.defs.calendar.date_of(deadline);
            let entered = w.state.story2.tracks.get(track).map_or(w.day(), |s| s.entered);
            let chapter = w.defs.story2.track(track).and_then(|t| t.chapter(&m.chapter));
            let missing = |conditions: &[manifest_core::story2::Condition]| {
                conditions
                    .iter()
                    .filter(|c| !w.story2_conditions(std::slice::from_ref(c), entered))
                    .map(|c| crate::story_log_view::requirement(ctx, w, c))
                    .collect::<Vec<_>>()
            };
            let choices: Vec<_> = chapter
                .into_iter()
                .flat_map(|c| &c.choices)
                .filter(|o| w.story2_choice_visible(o, entered)
                    && o.requires.iter().any(|c| !w.story2_conditions(std::slice::from_ref(c), entered)))
                .map(|o| json!({"key":o.key,"requires":missing(&o.requires)}))
                .collect();
            let objectives: Vec<_> = chapter.into_iter().flat_map(|c| &c.objectives)
                .filter(|o| !w.story2_objective_done(o, entered)).filter_map(|o| o.kind.condition())
                .map(|c| crate::story_log_view::requirement(ctx, w, &c)).collect();
            json!({"track":track,"chapter":m.chapter,"title":story_title(ctx,w,track,Some(&m.chapter)),
            "place":m.place,"person":m.person,"since":w.act_week_date(m.since_week,false),
            "expires":[w.defs.rules.world.start_year as u32+date.year-1,date.month,date.day],
            "weeks_left":week_index(&w.defs,deadline).saturating_sub(a.week)+1,"key":m.key,"missed":m.missed,
            "level":w.defs.upbringing.act_markers.iter().find(|d|d.track==*track).and_then(|d|d.levels.get(&m.chapter)),
            "openable":code.is_none(),"reason":code,"reason_text":text,
            "requirements":{"chapter":chapter.map(|c|missing(&c.when)).unwrap_or_default(),"objectives":objectives,"choices":choices}})
        })
        .collect();
    let family = w.upbringing_family().map(|f| f.key.as_str()).unwrap_or("");
    let done: Vec<_> = a
        .done
        .iter()
        .filter(|d| !matches!(d.action, ActAction::Duty { .. }))
        .map(|d| {
            json!({"place":d.place,"kind":d.action.kind(),
        "target":d.action.target(),"item":match &d.action{ActAction::Gift{item,..}=>Some(item),_=>None},"cost":d.cost,
        "greet":d.greet.map(|(pool,line)|format!("act:greet:{family}:{pool}:{line}")),"result":result(&d.result),"rumors":d.rumors})
        })
        .collect();
    let free_template: Vec<_> = w
        .act_free_template()
        .iter()
        .filter(|s| !matches!(s.action, ActAction::Duty { .. }))
        .map(|s| json!({"place":s.place,"kind":s.action.kind(),"target":s.action.target()}))
        .collect();
    let duty = w
        .act_free_template()
        .iter()
        .find_map(|s| if let ActAction::Duty { duty } = &s.action { Some(duty) } else { None });
    let duties: Vec<_> = w
        .defs
        .upbringing
        .act_duties
        .iter()
        .filter(|d| {
            d.family == family
                && match d.stage {
                    Stage::Home => key == "home",
                    Stage::Academy => key == format!("academy:{}", d.academy),
                }
        })
        .map(|d| {
            let error = w.act_duty_problem(&d.key).err();
            let code = error.as_ref().map(CommandError::code);
            let text = code.and_then(|code| reason_text(ctx, w, code, 0, error));
            json!({"key":d.key,"progress":a.family_duty.get(&d.key).copied().unwrap_or(0),"milestone":d.milestone,
                "enabled":code.is_none(),"reason":code,"reason_text":text})
        })
        .collect();
    let templates:Vec<_>=(0..r.templates).map(|slot|json!({"slot":slot,"lines":a.templates.get(&key).and_then(|t|t.get(usize::from(slot))).filter(|t|!t.is_empty()).map(|t|t.iter().map(|p|p.line.as_str()).collect::<Vec<_>>())})).collect();
    let gift_items: Vec<_> = w
        .act_gift_items()
        .into_iter()
        .map(|(item, qty)| json!({"item":item,"qty":qty,"name":item_name(ctx,w,&item)}))
        .collect();
    let calendar: Vec<_> = w
        .act_calendar()
        .into_iter()
        .map(|mark| {
            let name = calendar_name(ctx, w, &mark);
            let mut value = json!(mark);
            value["name"] = json!(name);
            value
        })
        .collect();
    let free_stop = w.act_free_stop().map(|stop| {
        let plan = stop.step.and_then(|step| w.act_free_template().get(usize::from(step)));
        let text = ctx.error(&stop.error);
        json!({"kind":stop.error.code(),"step":stop.step,"targets":stop.targets,"place":plan.map(|p|&p.place),
            "reason":stop.error.code(),"args":stop.error.args(),"reason_text":text})
    });
    let halt = free_stop.as_ref().filter(|stop| stop["step"].is_number()).cloned();
    let fixed_effect = |values: &[(&str, i64)]| -> Value {
        Value::Object(
            values.iter().filter(|(_, value)| *value != 0).map(|(key, value)| ((*key).into(), json!(value))).collect(),
        )
    };
    // 固定预告不含结算进位与上下限截断；成长用百分之一点，远足疲劳由十分之一点换算。
    let mut pray = fixed_effect(&[("fatigue", -r.recover.pray), ("mood", r.pray.mood)]);
    if r.pray.growth_permille / 10 != 0 {
        pray["growth"] = json!({(r.pray.attr.as_str()):r.pray.growth_permille/10});
    }
    let effects = json!({"rest":fixed_effect(&[("fatigue",-r.recover.rest)]),"pray":pray,
        "talk":fixed_effect(&[("affinity",r.talk.affinity),("mood",r.talk.mood)]),
        "excursion":fixed_effect(&[("fatigue",r.excursion_fatigue/10)])});
    let last_duty_result = (a.duty_week == Some(a.week))
        .then(|| a.done.iter().rev().find(|d| matches!(d.action, ActAction::Duty { .. })).map(|d| result(&d.result)))
        .flatten();
    let ledger = w.state.agents.get(&OwnerId::Player).map(|p| &p.ledger);
    let week_in =
        ledger.map_or(0, |l| (-l.balance(manifest_core::ledger::Account::OtherIncome) - before.cash_in_base).max(0));
    let week_out =
        ledger.map_or(0, |l| (l.balance(manifest_core::ledger::Account::OtherExpense) - before.cash_out_base).max(0));
    let cash = w.state.agents.get(&OwnerId::Player).map_or(0, |p| p.cash);
    let bonus_value = a.points_max.saturating_sub(w.act_points_base());
    let bonus: Vec<_> =
        (bonus_value > 0).then(|| json!({"kind":"constitution","value":bonus_value})).into_iter().collect();
    let mut value = json!({"enabled":true,"stages":r.stages,"phase":a.phase,
        "week":{"index":a.week,"from":from,"to":to,"day":w.act_day(),"stage":if key=="home"{"home"}else{"academy"},"academy":w.upbringing_academy().map(|a|&a.key)},
        "stops":stop_kinds,"stop_info":stop_views,"stop_targets":stops,"free_stop":free_stop,
        "lessons":{"slots":slots,"templates":templates,"fee_week":w.act_fee_week(),"fatigue_week_x10":w.act_fatigue_week_x10(),"defaults":w.act_lesson_plan()==w.act_default_lessons()},
        "lines":lines,"points":{"left":a.points,"max":a.points_max,"base":w.act_points_base(),"bonus":bonus},
        "money":{"cash":cash,"week_in":week_in,"week_out":week_out},
        "fatigue":{"value":s.fatigue,"week_delta":s.fatigue-before.fatigue,"projected":(s.fatigue+w.act_fatigue_week_x10()/10-r.recover.weekly).clamp(0,100),"fail_at":60,"ill_at":90,"ill_chance_pct":null},
        "mood":{"value":s.mood,"week_delta":s.mood-before.mood},"places":places,"markers":markers,"calendar":calendar,"gift_items":gift_items,
        "free":{"template":free_template,"duty":duty,"auto_ok":w.act_free_auto_ok(),"halt":halt,"done":done,
            "applied":a.free_applied,"skipped":free_skips(ctx,&a.free_skipped)},
        "family_duty":r.stages.iter().any(|s|s=="family_duty").then(||json!({"enabled":duties.iter().any(|d|d["enabled"]==true),
            "reason":duties.first().and_then(|d|d.get("reason")),"reason_text":duties.first().and_then(|d|d.get("reason_text")),
            "options":duties,"done_this_week":a.duty_week==Some(a.week),"last_result":last_duty_result})),
        "summary":(a.phase==ActPhase::Summary).then(||a.last_week.as_ref().map(|s|summary(ctx,w,s))).flatten(),
        "moment":null,"mission":null,"rank":null,"tide":null,"voyage":null,"score":null,"capital_preview":null,"effects":effects,
        "stop_target_names":stop_target_names});
    fill_k2(ctx, w, &mut value);
    fill_k3(ctx, w, &mut value);
    fill_k3b(w, &mut value);
    value
}

fn fill_k3b(w: &World, value: &mut Value) {
    value["voyage"] = Value::Null;
    value["voyages"] = json!([]);
    if !w.act_stage_on("voyage") {
        return;
    }
    let Some(s) = &w.state.upbringing else { return };
    value["voyages"] = json!(
        w.defs
            .upbringing
            .act_voyages
            .iter()
            .filter(|v| v.family == s.family)
            .map(|v| {
                let grade = match s.act.voyages.get(&v.key) {
                    Some(VoyageStatus::Done { grade }) => Some(grade),
                    _ => None,
                };
                json!({"key":v.key,"start":v.start,"weeks":v.weeks,"fee":v.fee,"status":w.act_voyage_status(v),"at_sea":v.at_sea(),
            "registration_open":w.act_voyage_registration_open(v),
            "missing":w.act_voyage_missing(v),"grade":grade})
            })
            .collect::<Vec<_>>()
    );
    if let (Some(active), Some(v), Some(leg)) = (&s.act.voyage, w.act_voyage_def(), w.act_voyage_leg()) {
        value["voyage"] = json!({"key":v.key,"leg":active.leg,"legs":v.weeks,"port":leg.port,"at_sea":v.at_sea(),
            "weeks_left":v.weeks-active.leg,"line":v.line,"tier":active.plan.first().map_or(0,|p|p.tier),
            "gate":{"game":v.gate.game,"attr":v.gate.attr,"chance_pct":w.act_voyage_chance(v)}});
    }
}

fn fill_k3(ctx: Ctx<'_>, w: &World, value: &mut Value) {
    let Some(s) = &w.state.upbringing else { return };
    let Some(r) = w.act_rules() else { return };
    let a = &s.act;
    if w.act_stage_on("tides") && !w.defs.upbringing.act_tides.is_empty() {
        let mut tide = json!(w.act_tide_effects());
        tide["next"] = json!(
            (1..=4)
                .map(|offset| {
                    let week = a.week + offset;
                    json!({"week":week,"kinds":w.act_tides_at(week).iter().map(|t|&t.key).collect::<Vec<_>>()})
                })
                .collect::<Vec<_>>()
        );
        value["tide"] = tide;
    }
    value["rumors"] = Value::Null;
    if w.act_stage_on("rumors") {
        // 周号沿用内核的零起编号；只列已通过听消息或寒暄获得的卡。
        let cards: Vec<_> = a
            .rumors
            .iter()
            .filter_map(|(key, week)| {
                let r = w.defs.upbringing.act_rumors.iter().find(|r| r.key == *key)?;
                let mut card = json!({"key":key,"port":r.port,"good":(!r.good.is_empty()).then_some(&r.good),
                    "kind":r.kind,"valid":r.valid,"week":week,"expired":r.valid[1]<w.cast_date()});
                // 语言包已处理缺译与过期覆盖；正文只随已听到的卡投影，再过叙事遮名。
                if let Some(text) = ctx
                    .names
                    .upbringing
                    .act_rumors
                    .iter()
                    .find(|localized| localized.key == *key)
                    .and_then(|localized| localized.text.as_deref())
                    .or(r.text.as_deref())
                    .filter(|text| !text.trim().is_empty())
                {
                    card["text"] = json!(crate::navigation_view::visibility::redact_narrative_text(ctx, w, text));
                }
                Some(card)
            })
            .collect();
        let goods: std::collections::BTreeSet<_> = w
            .defs
            .upbringing
            .act_places
            .iter()
            .filter(|p| w.upbringing_family().is_some_and(|f| f.key == p.family))
            .flat_map(|p| p.job_goods.values().flatten())
            .chain(a.goods_seen.keys())
            .collect();
        value["rumors"] = json!({"cards":cards,"goods":goods.iter().map(|good| {
            let seen=a.goods_seen.get(*good).copied().unwrap_or(0);
            json!({"good":good,"seen":seen,"need":r.rumor.known_after,"known":seen>=r.rumor.known_after})
        }).collect::<Vec<_>>(),"per_listen":r.rumor.per_listen+w.act_tide_effects().rumors,"cost":ActAction::Rumor.cost()});
    }
    value["people"] = json!(w.act_people().iter().map(|key| {
        let level=w.act_person_level(key);
        let class=value["capital_preview"]["rows"].as_array().and_then(|rows|rows.iter()
            .find(|row|row["key"].as_str()==Some(key.as_str()) && matches!(row["kind"].as_str(),Some("mate"|"ally"))))
            .and_then(|row|row["kind"].as_str())
            .or_else(||w.act_rival_candidate(key).then_some("rival"));
        let perks:Vec<_>=w.act_person_perks(key).map(|p| {
            let value=match p.kind.as_str() {
                "job_partner"=>Some(r.perk.job_partner_pct),
                "companion"=>Some(r.perk.companion_pct),
                "rumor"=>Some(1),
                _=>None,
            };
            json!({"level":p.level,"kind":p.kind,"line":(!p.line.is_empty()).then_some(&p.line),
                "flag":(!p.flag.is_empty()).then_some(&p.flag),"active":w.act_perk_active(p),"value":value})
        }).collect();
        json!({"key":key,"level":level,"affinity":w.affection(key).map_or(0,|a|a.affinity),
            "next_at":r.score.people_levels.get(usize::from(level)),"perks":perks,"class":class,"levels":r.score.people_levels})
    }).collect::<Vec<_>>());
    value["summary_k3"] =
        (a.phase == ActPhase::Summary).then_some(a.last_week.as_ref()).flatten().map_or(Value::Null, |s| {
            let mut summary = json!(&s.k3);
            // 存档省略空结果；视图仍明确给 null，供界面直接判断。
            summary["duty"] = json!(s.k3.duty);
            summary
        });
}

fn fill_k2(ctx: Ctx<'_>, w: &World, value: &mut Value) {
    let Some(s) = &w.state.upbringing else { return };
    let a = &s.act;
    let Some(r) = w.act_rules() else { return };
    let today = w.cast_date();
    let dues = w.act_tool_dues();
    let mut seen = std::collections::BTreeSet::new();
    if let Some(slots) = value["lessons"]["slots"].as_array_mut() {
        for (i, v) in slots.iter_mut().enumerate() {
            let Some(p) = w.act_lesson_plan().get(i) else { continue };
            let Some(l) = w.defs.upbringing.lines.iter().find(|l| l.key == p.line) else { continue };
            let t = &l.tiers[usize::from(p.tier)];
            let Some(activity) = w.defs.upbringing.activity(&t.activity) else { continue };
            let with = p.with.as_deref().filter(|person| w.act_presence(person) == Some(l.place.as_str()));
            let g = r.tier_yield[usize::from(p.tier)] * w.act_efficiency(l, activity, with) / 100;
            let cap = w.upbringing_annual_cap() * r.ladder.cap_pct_by_tier[usize::from(p.tier)] / 100;
            let mut gains = BTreeMap::new();
            for (attr, amount) in l.attr.iter().map(|k| (k, g)).chain(l.side.iter().map(|k| (k, g * r.side_pct / 100)))
            {
                let used = if s.growth_year == today[0] { s.year_growth.get(attr).copied().unwrap_or(0) } else { 0 };
                let n = amount.min((cap - used).max(0) * 100).min((1000 - w.upbringing_growth(attr)).max(0) * 100);
                gains.insert(attr, [n, n]);
            }
            v["gains"] = json!(gains);
            v["yield"] = json!(w.act_expected_yield(l, p.tier, with));
            v["fee"] = json!(if w.act_ill() || w.act_sailing() { 0 } else { w.act_tier_fee(l, p.tier) });
            v["fatigue_x10"] = json!(if w.act_ill() { 0 } else { r.fatigue[usize::from(p.tier)] });
            v["success_pct"] = json!(100 - w.act_fail_bp(activity) / 100);
            v["great_pct"] = json!(w.act_great_bp(with.is_some()) / 100);
            let key = (p.line.clone(), p.tier);
            v["tool_due"] = json!(if seen.insert(key.clone()) { dues.get(&key).copied().unwrap_or(0) } else { 0 });
            v["moment"] = Value::Null;
            v["moment_ok"] = Value::Null;
            if let Some(o) = a.outcomes.iter().find(|o| usize::from(o.slot) == i) {
                v["result"]["grade"] = json!(o.grade);
                v["result"]["moment"] = json!(o.moment);
                v["result"]["moment_ok"] = json!(o.moment_ok);
                v["moment"] = json!(o.moment);
                v["moment_ok"] = json!(o.moment_ok);
            }
        }
    }
    if let Some(lines) = value["lines"].as_array_mut() {
        for v in lines {
            let Some(l) = v["key"].as_str().and_then(|k| w.defs.upbringing.lines.iter().find(|l| l.key == k)) else {
                continue;
            };
            let used = l
                .attr
                .as_ref()
                .and_then(|k| s.year_growth.get(k))
                .copied()
                .filter(|_| s.growth_year == today[0])
                .unwrap_or(0);
            let cap = (0..l.tiers.len()).map(|i| r.ladder.cap_pct_by_tier[i]).max().unwrap_or(100);
            v["year_room"] = json!((w.upbringing_annual_cap() * cap / 100 - used).max(0));
            v["root_level"] = json!(w.act_root(l).map(|k| w.upbringing_projected(k)));
            v["clever"] = json!(if l.side.is_none() { "cash" } else { l.clever.as_deref().unwrap_or("side") });
            v["efficiency_pct"] = json!(
                l.tiers
                    .first()
                    .and_then(|t| w.defs.upbringing.activity(&t.activity))
                    .map_or(100, |a| w.act_efficiency(l, a, None))
            );
            v["master_cost"] = json!(
                l.tiers
                    .iter()
                    .position(|t| t.gate.as_deref() == Some("master_test"))
                    .map(|i| w.act_tier_status(l, i as u8).gift)
            );
            if let Some(tiers) = v["tiers"].as_array_mut() {
                for (i, t) in tiers.iter_mut().enumerate() {
                    if let Some(activity) = w.defs.upbringing.activity(&l.tiers[i].activity) {
                        t["success_pct"] = json!(100 - w.act_fail_bp(activity) / 100);
                        t["great_pct"] = json!(w.act_great_bp(false) / 100);
                    }
                    if let (Some(dst), Some(src)) =
                        (t.as_object_mut(), json!(w.act_tier_status(l, i as u8)).as_object())
                    {
                        dst.extend(src.clone());
                    }
                }
            }
        }
    }
    value["moment"]=a.moment.as_ref().and_then(|m|w.act_lesson_plan().get(usize::from(m.slot)).map(|p|(m,p))).and_then(|(m,p)|{
        let l=w.defs.upbringing.lines.iter().find(|l|l.key==p.line)?;
        let mut date=w.act_week_date(m.week,false);date[2]+=u32::from(m.day)-1;
        let options:Vec<_>=[MomentPick::Steady,MomentPick::Risky,MomentPick::Clever].into_iter().map(|pick|{
            let (attr,have,need,chance)=w.act_moment_test(l,pick);let steady=pick==MomentPick::Steady;let risky=pick==MomentPick::Risky;
            json!({"pick":pick,"chance_pct":(!steady).then_some(chance),"attr":(!steady).then_some(attr),"need_level":(!steady).then_some(need),"have_level":(!steady).then_some(have),
                "win_pct":if steady{r.moment.steady_pct}else if risky{r.moment.risky_win_pct}else{100},"lose_pct":risky.then_some(r.moment.risky_lose_pct),
                "convert":(pick==MomentPick::Clever).then_some(if l.side.is_none(){"cash"}else{l.clever.as_deref().unwrap_or("side")})})
        }).collect();
        Some(json!({"week":m.week,"slot":m.slot,"day":m.day,"date":date,"line":p.line,"tier":p.tier,"picked":m.pick,"options":options}))
    }).unwrap_or(Value::Null);
    // until 是最后一个病周；周末已过完本周课格，剩余周数只计后面的周。
    value["illness"] = json!(a.ill_until_week.map(|until| {
        json!({"until_week":until,"weeks_left":until.saturating_sub(a.week)+u32::from(w.act_day()<6)})
    }));
    let recover = if w.act_ill() { r.illness.recover } else { r.recover.weekly };
    value["fatigue"]["projected"] = json!((s.fatigue + w.act_fatigue_week_x10() / 10 - recover).clamp(0, 100));
    value["fatigue"]["ill_at"] = json!(r.illness.at);
    value["fatigue"]["ill_chance_pct"] =
        json!(if w.act_ill() { 0 } else { w.act_ill_chance(value["fatigue"]["projected"].as_i64().unwrap_or(0)) });
    let constitution =
        u8::from(w.upbringing_projected("constitution") >= r.bonus.constitution_level).min(r.points.bonus_max);
    let rank_bonus =
        if w.act_rank() >= 2 { r.rank_points.min(r.points.bonus_max.saturating_sub(constitution)) } else { 0 };
    value["points"]["bonus"] = json!(
        [("constitution", constitution), ("rank", rank_bonus)]
            .into_iter()
            .filter(|(_, v)| *v > 0)
            .map(|(k, v)| json!({"kind":k,"value":v}))
            .collect::<Vec<_>>()
    );
    value["jobs"]=json!(a.jobs.iter().map(|(group,points)|{
        let gain=["commerce","eloquence"].iter().map(|k|(w.upbringing_growth(k)-w.act_origin_growth(k)).max(0)).sum::<i64>();
        let i=(0..4).rev().find(|i|*points>=r.job_promote[*i]&&gain>=r.job_promote_gain[*i]).unwrap_or(0);
        json!({"group":group,"points":points,"level":i+1,"next_at":r.job_promote.get(i+1),"next_gain":r.job_promote_gain.get(i+1)})
    }).collect::<Vec<_>>());
    if let Some(places) = value["places"].as_array_mut() {
        for place in places {
            let key = place["key"].as_str().unwrap_or("").to_owned();
            if let Some(jobs) = place["jobs"].as_array_mut() {
                for job in jobs {
                    if let Some(activity) = job["activity"].as_str().and_then(|k| w.defs.upbringing.activity(k)) {
                        let i = w.act_job_level(activity);
                        let group = job_group(activity);
                        job["level"] = json!(i + 1);
                        let income = w.act_job_income(&key, activity);
                        job["income"] = json!([income, income]);
                        job["bonus_pct"] = json!(w.act_job_bonus_pct(&key, group));
                        job["progress"] = json!(a.jobs.get(group).copied().unwrap_or(0));
                        job["next_at"] = json!(r.job_promote.get(i + 1));
                        job["next_gain"] = json!(r.job_promote_gain.get(i + 1));
                    }
                }
            }
        }
    }
    let current = a
        .missions
        .iter()
        .filter_map(|(k, state)| {
            w.defs
                .upbringing
                .missions
                .iter()
                .find(|m| m.key == *k && m.month == [today[0], today[1]])
                .map(|m| (m, state))
        })
        .next();
    value["mission"]=current.map(|(m,state)|{
        let due=w.act_mission_due(m);let due_week=(due[1]-1)*4+(due[2]-1)/7;
        let now_week=(today[1]-1)*4+(today[2]-1)/7;
        let goals:Vec<_>=m.goals.iter().map(|g|{let (have,need,done)=w.act_mission_goal(m,state,g);let def=json!(g);let kind=def["kind"].clone();
            let target=["deed","line","attr","skill","person","duty","contest","flag"].into_iter().find_map(|k|def.get(k).cloned());
            json!({"kind":kind,"target":target,"label":def["label"],"have":have,"need":need,"done":done})}).collect();
        let reward:Vec<_>=m.reward.iter().map(|r|match r{MissionReward::Cash{value}=>json!({"kind":"cash","key":null,"qty":value}),MissionReward::Item{item,qty}=>json!({"kind":"item","key":item,"qty":qty}),MissionReward::Affinity{person,value}=>json!({"kind":"affinity","key":person,"qty":value})}).collect();
        json!({"key":m.key,"giver":m.giver,"month":m.month,"due":due,"weeks_left":due_week.saturating_sub(now_week)+u32::from(due_week>=now_week),"status":state.status,"merit":m.merit.unwrap_or(r.missions.merit_done),"goals":goals,"reward":reward})
    }).unwrap_or(Value::Null);
    let first = (today[1] - 1) / 3 * 3 + 1;
    let quarter:Vec<_>=(first..first+3).map(|month|{
        let m=w.act_quarter_missions().into_iter().find(|(m,_)|m.month[1]==month);
        json!({"key":m.map(|(m,_)|m.key.as_str()).unwrap_or(""),"month":[today[0],month],"status":m.map(|(_,s)|json!(s)).unwrap_or(json!("none"))})
    }).collect();
    let next_review = (a.week..a.week + 53).map(|week| w.act_week_date(week, true)).find(|date| {
        *date >= today
            && weekly::week_of(date[2]) == 3
            && r.reviews.contains(&date[1])
            && w.upbringing_family().is_some_and(|f| *date < f.graduation)
    });
    value["rank"] = json!({"level":w.act_rank(),"merit":a.merit,"next_at":r.ranks.get(usize::from(w.act_rank())),"next_review":next_review,
        "quarter":quarter,"down_risk":w.act_rank()>1&&quarter.iter().all(|q|q["status"]=="failed"),"names_key":if w.upbringing_academy().is_some(){"academy"}else{"home"}});
    value["score"] = json!(w.act_score());
    value["capital_preview"] = capital_preview(ctx, w);
    value["summary_k2"] = json!((a.phase == ActPhase::Summary).then(|| a.last_week.as_ref().map(|s| &s.k2)).flatten());
}

fn capital_preview(ctx: Ctx<'_>, w: &World) -> Value {
    let mut preview = json!(w.act_capital_preview());
    if let Some(rows) = preview["rows"].as_array_mut() {
        for row in rows {
            let key = row["key"].as_str().unwrap_or("");
            let name = match row["kind"].as_str() {
                Some("item") => ctx.names.items.item(key).or_else(|| w.defs.items.item(key)).map(|i| &i.name),
                Some("ship") => ctx.names.ships.iter().find(|s| s.key == key).map(|s| &s.name),
                Some("cargo") => ctx.names.goods.iter().find(|g| g.key == key).map(|g| &g.name),
                Some("license") => ctx.names.factions.iter().find(|f| f.key == key).map(|f| &f.name),
                Some("mate" | "ally") => ctx.names.cast.person(key).map(|p| &p.name),
                _ => None,
            };
            row["name"] = json!(name);
        }
    }
    preview["aspiration_name"] = json!(
        preview["aspiration"]
            .as_str()
            .and_then(|key| { ctx.names.upbringing.paths.iter().find(|path| path.key == key).map(|path| &path.name) })
    );
    preview
}

fn item_name<'a>(ctx: Ctx<'a>, w: &'a World, key: &'a str) -> &'a str {
    ctx.names.items.item(key).or_else(|| w.defs.items.item(key)).map_or(key, |item| item.name.as_str())
}

fn story_title(ctx: Ctx<'_>, w: &World, track: &str, chapter: Option<&str>) -> Option<String> {
    let track = ctx.names.story2.track(track)?;
    let title = chapter
        .and_then(|key| track.chapter(key))
        .map(|chapter| chapter.title.as_str())
        .filter(|title| !title.is_empty())
        .or_else(|| (!track.name.is_empty()).then_some(track.name.as_str()))?;
    Some(crate::navigation_view::visibility::redact_narrative_text(ctx, w, title))
}

fn calendar_name(ctx: Ctx<'_>, w: &World, mark: &ActCalendarMark) -> Option<String> {
    let defs = &ctx.names.upbringing;
    let name = match mark.kind.as_str() {
        "contest" => defs.contests.iter().find(|d| d.key == mark.key).map(|d| d.name.as_str()),
        "exam" => defs.exams.iter().find(|d| d.key == mark.key).map(|d| d.name.as_str()),
        "festival" => defs.festivals.iter().find(|d| d.key == mark.key).map(|d| d.name.as_str()),
        "voyage" => defs.act_voyages.iter().find(|d| d.key == mark.key).map(|d| d.name.as_str()),
        "academy" => w
            .upbringing_academy()
            .and_then(|a| defs.academy(&a.key))
            .and_then(|a| a.calendar.iter().find(|d| d.key == mark.key))
            .map(|d| d.name.as_str()),
        "marker_due" | "agenda" => {
            let chapter = if mark.kind == "marker_due" {
                w.state.upbringing.as_ref().and_then(|s| s.act.markers.get(&mark.key)).map(|m| m.chapter.as_str())
            } else {
                w.state.story2.tracks.get(&mark.key).map(|s| s.chapter.as_str())
            };
            return story_title(ctx, w, &mark.key, chapter);
        }
        _ => None,
    };
    name.filter(|name| !name.is_empty()).map(str::to_owned)
}

/// 停因只存错误码；从当前只读检查补回参数，文字仍走已有的语言通路。
fn reason_text(ctx: Ctx<'_>, w: &World, code: &str, cost: u8, error: Option<CommandError>) -> Option<String> {
    let error = error.filter(|error| error.code() == code);
    let Some((registered, _)) = REASON_CODES.iter().find(|(registered, _)| *registered == code) else {
        return error.as_ref().map(|error| ctx.error(error));
    };
    let mut reason =
        error.as_ref().and_then(CommandError::reason).cloned().unwrap_or_else(|| Reason::new(registered, code));
    if reason.args.is_empty() {
        reason = match code {
            "ub.act.points" => reason
                .arg("need", TextArg::Int(i64::from(cost)))
                .arg("have", TextArg::Int(w.state.upbringing.as_ref().map_or(0, |s| i64::from(s.act.points)))),
            "ub.act.phase" => reason.arg("phase", TextArg::Text(w.act_phase().key().into())),
            "ub.act.stage_off" => reason.arg("stage", TextArg::Text("family_duty".into())),
            _ => reason,
        };
    }
    if let Some(template) = ctx.texts.and_then(|texts| texts.get(&format!("reasons.{code}"))) {
        let vars: Option<BTreeMap<_, _>> = reason
            .args
            .iter()
            .map(|(key, value)| match value {
                TextArg::Int(value) => Some((*key, value.to_string())),
                TextArg::Text(value) => Some((*key, value.clone())),
                _ => None,
            })
            .collect();
        if let Some(vars) = vars {
            reason.zh = manifest_data::locale::fill(template, &vars);
        }
    }
    Some(ctx.reason(&reason))
}

#[cfg(test)]
#[path = "act_rumor_tests.rs"]
mod rumor_tests;
