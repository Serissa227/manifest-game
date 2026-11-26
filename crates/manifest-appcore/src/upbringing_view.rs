//! I6 月程查询，只投影已经存在的养成状态；读视图不推进时间。
use crate::views::Ctx;
mod academy;
pub mod act;
mod activity;
mod contest;
mod contest_preview;
mod exam_progress;
mod goals;
mod journal;
mod milestones;
mod native_memory;
mod unlock;
pub use activity::auto_plan;
pub use contest::contest;
pub use contest_preview::{contest_outcome, contest_preview};
use manifest_core::{CommandError, OwnerId, World, upbringing::*};
use serde_json::{Value, json};
pub use unlock::UnlockNotices;

/// K01：技能的效果——生效中的这一级、下一级（还没到的写成“下一级”）；被叠加上限压住、没有读取点、开关关着的分别标出。
/// 技能没有效果数据时为 None（视图里不出现 `effects` 这一项）。
fn skill_effects_view(ctx: Ctx<'_>, w: &World, key: &str, level: u32) -> Option<Value> {
    let s = w.defs.story2.skill_effects.get(key)?;
    let enabled = w.skill_effects_enabled();
    let line = |e: &manifest_core::items::effects::Effect, now: bool| {
        let total = w.captain_effect_total(e.kind);
        let live = enabled && manifest_core::skills::has_reader(e.kind);
        json!({
            "kind": e.kind.key(),
            "text": crate::items_view::effect_text(ctx, e),
            "live": live,
            // 只给生效中的那一级标“已到上限”：合计（各来源先限单件）超过叠加上限时，写出实得
            "capped": (now && live && total.raw > total.applied).then_some(total.applied),
        })
    };
    let now: Vec<Value> = s.at(level).iter().map(|e| line(e, true)).collect();
    let next_level = (level < s.max_level.max(1)).then_some(level + 1);
    let next: Vec<Value> = next_level.map_or_else(Vec::new, |n| s.at(n).iter().map(|e| line(e, false)).collect());
    Some(json!({"enabled": enabled, "now": now, "next_level": next_level, "next": next}))
}

/// 心情条：U04 工作包 3 起带上回归中心、兴致与低谷门槛（没有心情规则的世界这几项为 null）。
fn mood_meter(w: &World, s: &UpbringingState) -> Value {
    let r = w.upbringing_mood_rules();
    json!({"value":s.mood,"max":100,"label":"心情","center":r.map(|r|r.center),"high":r.map(|r|r.high),"low":r.map(|r|r.low),
        "high_bonus_pct":r.map(|r|r.high_bonus_pct),"boosted":r.is_some_and(|r|s.mood>=r.high),"low_mood":s.low_mood,
        "efficiency_pct":w.upbringing_mood_pct(s.mood)})
}

pub fn upbringing(ctx: Ctx<'_>, w: &World) -> Value {
    upbringing_with_name(ctx, w, None)
}

pub fn upbringing_with_name(ctx: Ctx<'_>, w: &World, player_name: Option<&str>) -> Value {
    let completed = w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Done)
        && w.defs.upbringing.endings.iter().any(|e| !e.weights.is_empty() || e.supplementary);
    let Some(s) = w.state.upbringing.as_ref().filter(|s| s.phase != Phase::Done || completed) else {
        return Value::Null;
    };
    let Some(f) = w.upbringing_family() else {
        return Value::Null;
    };
    // 显示用的家庭与内核取同一条改投路线（阶段名按 from 对上）。
    let display_family = w.upbringing_family_in(&ctx.names.upbringing).unwrap_or(f);
    let culture = w
        .upbringing_academy()
        .map(|a| a.culture.as_str())
        .filter(|c| !c.is_empty())
        .or_else(|| w.defs.locations.iter().find(|l| l.key == f.home).map(|l| l.culture.as_str()));
    let date = w.cast_date();
    let stage = w.upbringing_stage_on(date);
    let display_stage = stage.and_then(|active| display_family.stages.iter().find(|s| s.from == active.from));
    let identity = w.state.protagonist.as_ref();
    let person = identity.and_then(|i| i.protagonist.as_deref()).and_then(|p| ctx.names.cast.person(p));
    let key = identity.and_then(|i| i.protagonist.as_deref()).unwrap_or(&f.key);
    let born = identity.map_or(f.born, |i| i.born);
    let name = player_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| person.map_or(display_family.name.as_str(), |p| p.name.as_str()));
    let weekly = w.upbringing_weekly();
    let slots = if weekly {
        week_slots(ctx, w, s)
    } else {
        (0..3u8).map(|index| {
        let days=u32::from(w.defs.calendar.months()[date[1] as usize-1]);
        let bounds=schedule::bounds(days,index).unwrap_or([1,days]);
        let choice=s.plan.get(usize::from(index));
        json!({"index":index,"label":(["上旬","中旬","下旬"][usize::from(index)]),"from":[s.month[0],s.month[1],bounds[0]],"to":[s.month[0],s.month[1],bounds[1]],
            "lesson":choice.and_then(|p|p.lesson.as_ref()),"after":choice.and_then(|p|p.after.as_ref()),
            "result":s.last.iter().find(|r|r.index==index && index<s.next_slot).map(|r|activity::result(ctx,r)),
            "status":if index<s.next_slot{"done"}else if s.phase==Phase::Plan{"empty"}else if index==s.next_slot{"current"}else{"planned"}})
    }).collect::<Vec<_>>()
    };
    // U04 工作包 4：活动卡另带解锁差项（只差能练出来的项时）、是否“差一点”、名称是否还是占位键。
    let activity = |a: &ActivityDef| {
        let mut card = activity::activity(ctx, w, a);
        let (gap, near) = if card["enabled"] == true { (Value::Null, false) } else { unlock::gap(w, a) };
        let placeholder = ctx.names.upbringing.activity(&a.key).unwrap_or(a).name == a.key;
        if let Some(o) = card.as_object_mut() {
            o.insert("unlock_gap".into(), gap);
            o.insert("near".into(), near.into());
            o.insert("placeholder".into(), placeholder.into());
        }
        card
    };
    // 这一局永远排不上的（别家专属、阶段或年龄已过、门槛整段养成都到不了、没有老师……）按 reach 的静态判定折叠成计数。
    let deadlines = unlock::deadlines(w, &f.key);
    let available = w
        .defs
        .upbringing
        .activities
        .iter()
        .filter(|a| stage.is_some_and(|s| a.stage.allows(s.stage)))
        .filter(|a| a.place.academy.as_ref().is_none_or(|key| stage.and_then(|s| s.academy.as_ref()) == Some(key)))
        .filter(|a| {
            w.upbringing_location().is_some_and(|id| {
                let loc = w.defs.loc(id);
                a.place.at.as_ref().is_none_or(|key| key == &loc.key)
                    && a.place.culture.as_ref().is_none_or(|key| w.upbringing_culture_matches(key, &loc.culture))
            })
        })
        .collect::<Vec<_>>();
    let (hidden, available): (Vec<&ActivityDef>, Vec<&ActivityDef>) =
        available.into_iter().partition(|a| unlock::never(&deadlines, w, a));
    let lesson_list =
        |a: &ActivityDef| a.kind == ActivityKind::Lesson && stage.is_some_and(|s| s.stage == Stage::Academy);
    let hidden_lessons = hidden.iter().filter(|a| lesson_list(a)).count();
    let hidden_count = hidden.len() - hidden_lessons;
    let last = s.last.iter().map(|r| activity::result(ctx, r)).collect::<Vec<_>>();
    let growth = w
        .defs
        .captain
        .attributes
        .iter()
        .filter(|a| !a.hidden || (a.key == "arcana" && w.upbringing_flag("arcana_awakened")))
        .map(|a| json!({"attr":a.key,"value":w.upbringing_growth(&a.key),"projected":w.upbringing_projected(&a.key)}))
        .collect::<Vec<_>>();
    let ratings = ctx
        .names
        .captain
        .ratings
        .iter()
        .filter(|r| r.key != "arcane_rating" || w.upbringing_flag("arcana_awakened"))
        .map(|r| {
            let value = w.upbringing_rating(&r.key);
            let rank = match value {
                800.. => "S",
                600.. => "A",
                400.. => "B",
                200.. => "C",
                _ => "D",
            };
            json!({"key":r.key,"name":r.name,"value":value,"rank":rank})
        })
        .collect::<Vec<_>>();
    let threshold = w.defs.rules.items.xp_per_point.max(1);
    let skills = w
        .inventory(OwnerId::Player)
        .into_iter()
        .flat_map(|i| &i.skill_xp)
        .filter(|(_, xp)| **xp > 0)
        .map(|(key, xp)| {
            let (level, next) = if let Some(profile) = w.defs.upbringing.skill_profiles.get(key) {
                let level = w.upbringing_skill_level(key);
                (
                    i64::from(level),
                    profile.thresholds.get(level as usize).or(profile.thresholds.last()).copied().unwrap_or(0),
                )
            } else {
                let level = xp / threshold + 1;
                (level, level.saturating_mul(threshold))
            };
            let mut row = json!({"key":key,"name":activity::skill_name(ctx,key),"level":level,"xp":xp,"next":next});
            if let Some(effects) = skill_effects_view(ctx, w, key, u32::try_from(level).unwrap_or(0)) {
                row["effects"] = effects;
            }
            row
        })
        .collect::<Vec<_>>();
    let books=ctx.names.items.items.iter().filter(|i|i.read.is_some() && w.item_quantity(OwnerId::Player,&i.key)>0)
        .map(|i|json!({"key":i.key,"name":i.name,"days":i.read.as_ref().map_or(0,|r|r.days),"done":w.has_read_work(OwnerId::Player,i.work_key())})).collect::<Vec<_>>();
    let presets = [
        ("balanced", "均衡"),
        ("navigation", "领航"),
        ("trade", "交易"),
        ("combat", "战斗"),
        ("learning", "学问"),
        ("social", "社交"),
        ("previous", if weekly { "照上周" } else { "照上月" }),
    ]
    .into_iter()
    .map(|(key, name)| json!({"key":key,"name":name}))
    .collect::<Vec<_>>();
    // 这一阶段所在的城市（家乡期是家乡港，学院期是学院所在的城市）：前端按它挑养成主画面的城镇背景（城市的 CG、同文化的图）
    let town = w.upbringing_location().map(|id| {
        let loc = w.defs.loc(id);
        let name = ctx.names.locations.iter().find(|l| l.key == loc.key).map_or(loc.name.as_str(), |l| l.name.as_str());
        json!({"key":loc.key,"name":name,"culture":loc.culture})
    });
    let mut value = json!({"stage":stage.map(|s|s.stage),"stage_name":display_stage.map(|s|s.name.as_str()).unwrap_or(""),"home":ctx.names.locations.iter().find(|l|l.key==f.home).map(|l|l.name.as_str()).unwrap_or(&f.home),
        "culture":culture,"town":town,"academy":stage.and_then(|s|s.academy.as_ref()).map(|a|json!({"key":a,"name":ctx.names.upbringing.academy(a).map_or(a.as_str(),|d|d.name.as_str())})),"today":date,"phase":s.phase,
        "protagonist":{"key":key,"name":name,"age":identity.and_then(|i|i.age_on(date)).unwrap_or(0),"birthday":[born[1],born[2]],"portrait":person.and_then(|p|p.portrait(date)),"outfit":null,"season":w.defs.calendar.season_of(w.day()).index()},
        "meters":{"stamina":{"value":s.stamina,"max":100,"label":"体力"},"fatigue":{"value":s.fatigue,"max":100,"label":"疲劳"},"mood":mood_meter(w,s),"fame":{"value":s.fame,"max":100,"label":"名声"}},
        "cash":w.state.agents.get(&OwnerId::Player).map_or(0,|a|a.cash),"budget":w.upbringing_budget(),"growth":growth,"ratings":ratings,"skills":skills,"plan":plan_view(w,s,slots),
        "lessons":available.iter().filter(|a|a.kind==ActivityKind::Lesson && stage.is_some_and(|s|s.stage==Stage::Academy)).map(|a|activity(a)).collect::<Vec<_>>(),
        "activities":available.iter().filter(|a|a.kind!=ActivityKind::Lesson || stage.is_some_and(|s|s.stage==Stage::Home)).map(|a|activity(a)).collect::<Vec<_>>(),
        "places":academy::places(ctx,w),"excursions":academy::excursions(ctx,w),"companions":academy::companions(ctx,w,player_name),"calendar":academy::calendar(ctx,w),"exams":milestones::exams(ctx,w),"path":milestones::path(ctx,w),"memories":journal::memories(ctx,w),"letters":journal::letters(ctx,w),"diary":journal::diary(ctx,w),"presets":presets,"last":last,"books":books,"contests":contest::list(ctx,w),"goals":goals::goals(ctx,w),
        "hidden_count":hidden_count,"hidden_lessons":hidden_lessons,"unlocked_now":unlock::unlocked_now(ctx,w)});
    if w.act_running() {
        value["act"] = act::view(ctx, w);
    } else if w.act_rules().is_some_and(|r| r.enabled)
        && f.act
        && !s.act.on
        && w.upbringing_active()
        && !matches!(s.phase, Phase::Graduation | Phase::Done)
    {
        value["act_old_save"] = json!(true);
    }
    value["agenda"] = json!(w.upbringing_agenda());
    let cadence = w.upbringing_cadence_rules().cloned().unwrap_or_default();
    value["cadence"] = json!({"enabled":w.upbringing_cadence_enabled(), "used":s.cadence.used,
        "budget":[cadence.focus_per_week,cadence.short_per_week], "total":cadence.total_per_week});
    if let Some([start, end]) = crate::clock::upbringing_week(w) {
        value["week"] = json!({
            "number": start.div_ceil(crate::clock::UPBRINGING_WEEK_DAYS),
            "from": [date[0], date[1], start],
            "to": [date[0], date[1], end],
        });
        // 按周排程（U05）：每月固定 4 周，周条画 4 段。
        if weekly {
            value["week"]["count"] = json!(manifest_core::upbringing::weekly::WEEKS);
            value["week"]["month_days"] = json!(w.defs.calendar.month_days(w.day()));
        }
    }
    if completed
        && let Some(summary) = milestones::graduation(ctx, w).as_object()
        && let Some(view) = value.as_object_mut()
    {
        view.extend(summary.clone());
    }
    value
}

/// 日程视图：按旬时照旧（月、能否编辑、三旬）；按周（U05）另带模式、本周序号、下一格与课表铺不上的原因。
fn plan_view(w: &World, s: &UpbringingState, slots: Vec<Value>) -> Value {
    if !w.upbringing_weekly() {
        return json!({"month":s.month,"editable":s.phase==Phase::Plan,"slots":slots});
    }
    // 按周时运行中也能改本周还没结算的格（改了写回常设课表）。
    let editable = w.upbringing_active() && !s.skipping && matches!(s.phase, Phase::Plan | Phase::Running);
    let problem = w.upbringing_timetable_problem().map(|(index, reason)| json!({"index":index,"reason":reason}));
    json!({"month":s.month,"editable":editable,"slots":slots,"mode":"week",
        "week":weekly::week_of(w.cast_date()[2])+1,"weeks":weekly::WEEKS,"next_slot":s.next_slot,
        "timetable_problem":problem})
}

/// 按周（U05）的本周各格：栏位（课业 / 课余 / 家乡的自由格）、结算日期、格重、本周排了什么、常设课表里是什么、
/// 是否落在换阶段之后（到那天按新阶段重排，现在不能排）、结算结果与状态。
fn week_slots(ctx: Ctx<'_>, w: &World, s: &UpbringingState) -> Vec<Value> {
    let today = w.cast_date();
    let now = w.upbringing_stage_on(today);
    let stage = now.map_or(Stage::Home, |st| st.stage);
    let table = s.weekly.timetable(stage);
    w.upbringing_week_slots()
        .into_iter()
        .map(|(def, date)| {
            let index = def.index;
            let locked = w.upbringing_stage_on(date).map(|st| st.from) != now.map(|st| st.from);
            let column = if def.lesson {
                "lesson"
            } else if stage == Stage::Academy {
                "after"
            } else {
                "free"
            };
            let choice = s.plan.get(usize::from(index));
            let planned = choice.is_some_and(|p| weekly::slot_activity(p).is_some());
            let standing = table.get(usize::from(index)).filter(|p| weekly::slot_activity(p).is_some());
            let status = if index < s.next_slot {
                "done"
            } else if locked {
                "locked"
            } else if !planned {
                "empty"
            } else if index == s.next_slot && s.phase == Phase::Running {
                "current"
            } else {
                "planned"
            };
            json!({"index":index,"label":format!("{} 日",date[2]),"column":column,"day":def.day,"weight":def.weight,
                "from":date,"to":date,"locked":locked,
                "lesson":choice.and_then(|p|p.lesson.as_ref()),"after":choice.and_then(|p|p.after.as_ref()),
                "timetable":standing.map(|p|json!({"lesson":p.lesson,"after":p.after})),
                "result":s.last.iter().find(|r|r.index==index && index<s.next_slot).map(|r|activity::result(ctx,r)),
                "status":status})
        })
        .collect()
}
