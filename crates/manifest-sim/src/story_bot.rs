//! 离线故事机器人：作弊只准备前置资源，回应与自动分支仍走生产内核。
//! 这不是玩家命令；不注册到 Tauri、HTTP 或命令日志。
pub mod matrix;

use manifest_core::{
    cast::{CastPlace, relations::Bond},
    scenario::WorldDate,
    story2::{ChapterDef, Condition, ObjectiveKind, Stage, Status},
    *,
};
use serde::Serialize;
use std::{collections::BTreeSet, sync::Arc};

#[derive(Debug, thiserror::Error)]
pub enum BotError {
    #[error("{0}")]
    Blocked(String),
    #[error(transparent)]
    Command(#[from] CommandError),
    #[error(transparent)]
    Core(#[from] CoreError),
}

#[derive(Clone, Debug)]
pub enum Cheat {
    AdvanceTo(WorldDate),
    MoveTo(String),
    Satisfy(Condition),
}

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub path: Vec<String>,
    pub chapter: String,
    pub branch: String,
    pub next: Option<String>,
    pub error: Option<String>,
    /// 身份或恋爱门槛隐藏的分支不是内容执行错误。
    pub excluded: bool,
    pub resolved: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub track: String,
    pub done: bool,
    pub failed: bool,
    pub truncated: bool,
    pub reached: BTreeSet<String>,
    pub steps: Vec<Step>,
}

fn blocked(s: impl Into<String>) -> BotError {
    BotError::Blocked(s.into())
}

impl Cheat {
    pub fn apply(&self, w: &mut World, entered: u32) -> Result<(), BotError> {
        match self {
            Self::AdvanceTo(date) => {
                let day = w.story2_day(*date).ok_or_else(|| blocked("日期不在世界日历内"))?;
                w.state.day = w.day().max(day);
                if let Some(family) = w.upbringing_family() {
                    w.state.cast.academy = w.cast_date() < family.graduation
                        && w.upbringing_stage_on(w.cast_date())
                            .is_some_and(|s| s.stage == manifest_core::upbringing::Stage::Academy);
                }
            }
            Self::MoveTo(at) => {
                let loc = w
                    .defs
                    .locations
                    .iter()
                    .position(|l| &l.key == at)
                    .map(LocId::from_idx)
                    .ok_or_else(|| blocked(format!("地点不存在：{at}")))?;
                w.state.cast.place = Some(CastPlace { loc, venue: String::new() });
            }
            Self::Satisfy(c) => satisfy(w, c, entered)?,
        }
        Ok(())
    }
}

fn satisfy(w: &mut World, c: &Condition, entered: u32) -> Result<(), BotError> {
    use Condition::*;
    match c {
        Date { from: Some(d), .. } => Cheat::AdvanceTo(*d).apply(w, entered)?,
        Wait { days } => w.state.day = w.day().max(entered.saturating_add(*days)),
        Season { season } => {
            for _ in 0..w.defs.calendar.year_days() {
                if w.defs.calendar.season_of(w.day()).index() == *season as usize {
                    break;
                }
                w.state.day = w.day().saturating_add(1);
            }
        }
        Age { person, ge, .. } => {
            let born = person
                .as_ref()
                .and_then(|p| w.defs.cast.person(p).map(|p| p.born))
                .or_else(|| person.is_none().then(|| w.state.protagonist.as_ref().map(|p| p.born)).flatten())
                .ok_or_else(|| blocked("年龄条件缺少出生日期"))?;
            if born[0] == 0 {
                return Err(blocked("年龄条件引用出生年份未详的人物"));
            }
            if let Some(age) = ge {
                // 已满足的年龄下限可能早于世界纪元，准备条件时不必回退到该生日。
                let date = [born[0].saturating_add(*age), born[1], born[2]].max(w.cast_date());
                Cheat::AdvanceTo(date).apply(w, entered)?;
            }
        }
        At { at, person: None } => Cheat::MoveTo(at.clone()).apply(w, entered)?,
        Flag { flag, value } => {
            if *value {
                w.state.story2.flags.insert(flag.clone());
            } else {
                w.state.story2.flags.remove(flag);
            }
        }
        Affinity { person, ge } => {
            let have = w.affection(person).map_or(0, |a| a.affinity);
            if have < *ge {
                w.change_affinity(person, ge - have)?;
            }
        }
        Heart { person, ge } => {
            let have = w.affection(person).map_or(0, |a| a.heart);
            if have < *ge {
                w.change_heart(person, ge - have)?;
            }
        }
        Bond { person, level } => {
            let value = match level {
                self::Bond::C => 20,
                self::Bond::B => 50,
                self::Bond::A | self::Bond::S => 80,
            };
            satisfy(w, &Affinity { person: person.clone(), ge: value }, entered)?;
            for _ in 0..3 {
                w.remember_experience(person)?;
            }
            if *level == self::Bond::S {
                w.promise_to(person)?;
            }
        }
        Relation { person, relation } => w.change_relation(person, *relation, false)?,
        Tie { a, b, relation } => w.change_tie(a, b, *relation)?,
        Item { item, qty } => {
            let have = w.item_quantity(OwnerId::Player, item);
            if have < *qty {
                w.grant_item(OwnerId::Player, item, qty - have)?;
            }
        }
        Cash { ge } => {
            let a = w.state.agents.get_mut(&OwnerId::Player).ok_or_else(|| blocked("缺少玩家"))?;
            let delta = (*ge - a.cash).max(0);
            a.cash += delta;
            w.state.money.initial += delta;
        }
        Fame { ge } => {
            if w.upbringing_active() {
                if let Some(s) = &mut w.state.upbringing {
                    s.fame = s.fame.max(*ge).min(100);
                }
                return Ok(());
            }
            let a = w.state.agents.get_mut(&OwnerId::Player).ok_or_else(|| blocked("缺少玩家"))?;
            a.fame = a.fame.max(*ge);
        }
        Reputation { faction, ge } => {
            let faction = w
                .defs
                .factions
                .iter()
                .position(|f| &f.key == faction)
                .map(FactionId::from_idx)
                .ok_or_else(|| blocked("声望条件引用未知势力"))?;
            if !(-100..=100).contains(ge) {
                return Err(blocked("声望门槛超出允许范围"));
            }
            let agent = w.state.agents.get_mut(&OwnerId::Player).ok_or_else(|| blocked("缺少玩家"))?;
            let current = agent.reputation.get(&faction).copied().unwrap_or(0);
            if current < *ge {
                agent.reputation.insert(faction, *ge);
            }
        }
        Price { good, at, ge, le } => {
            let good = w.defs.find_good(good).ok_or_else(|| blocked("价格条件引用未知商品"))?;
            let loc = w.defs.find_loc(at).ok_or_else(|| blocked("价格条件引用未知地点"))?;
            let (low, high) = (ge.unwrap_or(i64::MIN), le.unwrap_or(i64::MAX));
            if low > high {
                return Err(blocked("价格门槛的上下界矛盾"));
            }
            let market = w
                .state
                .locations
                .get_mut(loc.idx())
                .and_then(|l| l.market.get_mut(&good))
                .ok_or_else(|| blocked("价格条件指定的货架不存在"))?;
            // 故事条件读取的是市场已记录价格；不改库存、基础价格或生产参数。
            market.price = market.price.clamp(low, high);
        }
        Attr { attr, ge } => {
            let indices: Vec<_> = if let Some(i) = w.defs.captain.attribute_index(attr) {
                vec![i]
            } else {
                w.defs
                    .captain
                    .ratings
                    .iter()
                    .find(|r| &r.key == attr)
                    .ok_or_else(|| blocked(format!("未知属性或评价：{attr}")))?
                    .weights
                    .iter()
                    .map(|(i, _)| *i)
                    .collect()
            };
            if w.upbringing_active() {
                for i in indices {
                    let key = &w.defs.captain.attributes[i].key;
                    // 运势仍由生日确定，秘术仍需要原有的觉醒旗标。
                    if key == "fortune" {
                        continue;
                    }
                    let conduct = w.defs.captain.group(i).is_some_and(|g| g.key == "conduct");
                    let direct = w.defs.captain.attribute_index(attr).is_some();
                    let amount = if conduct {
                        if direct { (*ge).min(100) } else { 100 }
                    } else if direct {
                        w.defs.upbringing.rules.growth_table.iter().find(|b| b.value >= *ge).map_or(1000, |b| b.from)
                    } else {
                        1000
                    };
                    if let Some(s) = &mut w.state.upbringing {
                        let value = s.growth.entry(key.clone()).or_default();
                        *value = (*value).max(amount).min(if conduct { 100 } else { 1000 });
                    }
                }
                return Ok(());
            }
            let born = w.state.protagonist.as_ref().map_or([1540, 1, 1], |p| p.born);
            let day = w.day();
            let len = w.defs.captain.attributes.len();
            let a = w.state.agents.get_mut(&OwnerId::Player).ok_or_else(|| blocked("缺少玩家"))?;
            let profile = a.captain.get_or_insert_with(|| manifest_core::captain::CaptainProfile {
                birthday: manifest_core::captain::Birthday { year: i64::from(born[0]), month: born[1], day: born[2] },
                sign: String::new(),
                answers: Vec::new(),
                attrs: vec![0; len],
                genius: None,
                learned: Vec::new(),
                teachers: Vec::new(),
                created: day,
            });
            for i in indices {
                let max = w.defs.captain.group(i).map_or(100, |g| g.range[1]);
                if let Some(value) = profile.attrs.get_mut(i) {
                    *value =
                        (*value).max(if w.defs.captain.attribute_index(attr).is_some() { *ge } else { max }).min(max);
                }
            }
        }
        Growth { attr, ge } => {
            if w.upbringing_active() {
                if attr == "fortune" {
                    return Ok(());
                }
                let max = w
                    .defs
                    .captain
                    .attribute_index(attr)
                    .and_then(|i| w.defs.captain.group(i))
                    .map_or(1000, |g| if g.key == "conduct" { 100 } else { 1000 });
                if let Some(s) = &mut w.state.upbringing {
                    let value = s.growth.entry(attr.clone()).or_default();
                    *value = (*value).max(*ge).min(max);
                }
                return Ok(());
            }
            w.state
                .items
                .owners
                .entry(OwnerId::Player)
                .or_default()
                .attr_xp
                .entry(attr.clone())
                .and_modify(|v| *v = (*v).max(*ge))
                .or_insert(*ge);
        }
        Skill { skill, ge } => {
            if !w.defs.story2.skills.contains(skill) {
                return Err(blocked(format!("未知技能：{skill}")));
            }
            w.state
                .items
                .owners
                .entry(OwnerId::Player)
                .or_default()
                .skill_xp
                .entry(skill.clone())
                .and_modify(|v| *v = (*v).max(*ge))
                .or_insert(*ge);
        }
        // 剩余条件必须已经成立；机器人不会改变人物的生日、取向、身份或日程来绕过规则。
        _ => {}
    }
    Ok(())
}

fn prepare_dates(w: &mut World, c: &ChapterDef, requires: &[Condition]) -> Result<(u32, Vec<Condition>), BotError> {
    let entered = w
        .state
        .story2
        .tracks
        .values()
        .find(|s| s.chapter == c.key && s.status == Status::Active)
        .map_or(w.day(), |s| s.entered);
    if let Some(window) = c.window {
        Cheat::AdvanceTo(window[0]).apply(w, entered)?;
    }
    let conditions: Vec<_> = c.when.iter().chain(requires).cloned().collect();
    // 先确定日期再准备好感等资源，避免按较早年龄错误触发门禁。
    for condition in &conditions {
        if matches!(
            condition,
            Condition::Date { .. } | Condition::Age { .. } | Condition::Wait { .. } | Condition::Season { .. }
        ) {
            satisfy(w, condition, entered)?;
        }
    }
    if let Some(day) = c.family.as_ref().and_then(|f| w.state.story2.families.get(f)) {
        w.state.day = w.day().max(day.saturating_add(c.family_cooldown_days.max(1)));
    }
    Ok((entered, conditions))
}

fn prepare_condition(w: &mut World, condition: &Condition, entered: u32) -> Result<(), BotError> {
    // 历史结果是外部前提；普通剧情旗标仍由已走过的分支产生，不能重写选择史。
    if let Condition::Flag { flag, .. } = condition
        && !w.defs.history.outcome_flags().any(|source| source == flag)
    {
        return Ok(());
    }
    satisfy(w, condition, entered)
}

fn prepare(w: &mut World, c: &ChapterDef, requires: &[Condition]) -> Result<(), BotError> {
    let (entered, conditions) = prepare_dates(w, c, requires)?;
    for condition in &conditions {
        prepare_condition(w, condition, entered)?;
    }
    for o in &c.objectives {
        match &o.kind {
            ObjectiveKind::Goods { good, qty, at } => {
                let loc = w
                    .defs
                    .locations
                    .iter()
                    .position(|l| &l.key == at)
                    .map(LocId::from_idx)
                    .ok_or_else(|| blocked(format!("交货地点不存在：{at}")))?;
                let id = w
                    .defs
                    .goods
                    .iter()
                    .position(|g| &g.key == good)
                    .map(GoodId::from_idx)
                    .ok_or_else(|| blocked(format!("商品不存在：{good}")))?;
                let fleet = w.flagship(OwnerId::Player).ok_or_else(|| blocked("交货缺少舰队"))?;
                let f = w.state.fleets.get_mut(&fleet).ok_or_else(|| blocked("舰队不存在"))?;
                f.location = manifest_core::world::FleetLocation::Docked(loc);
                let have = f.cargo.entry(id).or_default();
                *have = have.saturating_add(*qty);
            }
            ObjectiveKind::Item { item, qty } => {
                Cheat::Satisfy(Condition::Item { item: item.clone(), qty: *qty }).apply(w, entered)?
            }
            ObjectiveKind::At { at } => Cheat::MoveTo(at.clone()).apply(w, entered)?,
            ObjectiveKind::Person { person } => {
                let place = w.person_place(person).ok_or_else(|| blocked(format!("此日期找不到人物：{person}")))?;
                w.state.cast.place = Some(place);
            }
            ObjectiveKind::Affinity { person, ge } => {
                satisfy(w, &Condition::Affinity { person: person.clone(), ge: *ge }, entered)?
            }
            ObjectiveKind::Cash { ge } => satisfy(w, &Condition::Cash { ge: *ge }, entered)?,
            ObjectiveKind::Fame { ge } => satisfy(w, &Condition::Fame { ge: *ge }, entered)?,
            ObjectiveKind::Wait { days } => satisfy(w, &Condition::Wait { days: *days }, entered)?,
            ObjectiveKind::Attr { .. }
            | ObjectiveKind::Growth { .. }
            | ObjectiveKind::Skill { .. }
            | ObjectiveKind::Bond { .. }
            | ObjectiveKind::Visited { .. }
            | ObjectiveKind::PortsKnown { .. }
            | ObjectiveKind::HouseLevel { .. }
            | ObjectiveKind::Warehouse { .. }
            | ObjectiveKind::Industries { .. }
            | ObjectiveKind::Ships { .. }
            | ObjectiveKind::ShipTier { .. }
            | ObjectiveKind::Mates { .. }
            | ObjectiveKind::Post { .. }
            | ObjectiveKind::Rank { .. }
            | ObjectiveKind::Deed { .. }
            | ObjectiveKind::Any { .. } => {
                if let Some(c) = o.kind.condition() {
                    satisfy(w, &c, entered)?
                }
            }
            ObjectiveKind::Discovery { discovery, reported } => {
                let id = w
                    .defs
                    .discoveries
                    .iter()
                    .position(|d| &d.key == discovery)
                    .map(DiscoveryId::from_idx)
                    .ok_or_else(|| blocked(format!("发现物不存在：{discovery}")))?;
                w.state.explore.discovered.insert(id, w.day());
                if *reported {
                    w.state.explore.reported.insert(id);
                }
            }
            ObjectiveKind::Battle { wins } => {
                let fleet = w.flagship(OwnerId::Player).ok_or_else(|| blocked("海战目标缺少舰队"))?;
                for _ in 0..*wins {
                    w.push_log(manifest_core::log::LogEvent {
                        day: w.day(),
                        kind: manifest_core::log::LogKind::NavalBattle {
                            fleet,
                            owner: OwnerId::Player,
                            result: manifest_core::battle::BattleResult::Won,
                            cargo_lost: 0,
                            cash_lost: 0,
                            captured: 0,
                        },
                    });
                }
            }
        }
    }
    if let Some(at) = &c.at {
        Cheat::MoveTo(at.clone()).apply(w, entered)?;
    }
    if !w.story2_conditions(&conditions, entered) {
        let missing: Vec<_> =
            conditions.iter().filter(|c| !w.story2_conditions(std::slice::from_ref(*c), entered)).collect();
        return Err(blocked(format!("准备后条件仍不满足：{missing:?}，日期={:?}", w.cast_date())));
    }
    if !w.story2_objectives_done(c, entered) {
        return Err(blocked("目标仍未满足"));
    }
    if c.window.is_some_and(|window| w.cast_date() > window[1])
        || w.story2_deadline(c, entered).is_some_and(|d| w.day() > d)
    {
        return Err(blocked("准备目标时已错过章节窗口或限期"));
    }
    w.refresh_story2();
    Ok(())
}

/// 遍历可达状态并逐个尝试选项、默认与超时；预算耗尽会明确报告，绝不当作通过。
pub fn walk(initial: &World, track: &str, max_states: usize) -> Report {
    let mut report = Report {
        track: track.into(),
        done: false,
        failed: false,
        truncated: false,
        reached: BTreeSet::new(),
        steps: Vec::new(),
    };
    let mut first = initial.clone();
    // 逐条轨道的作弊遍历不受节奏的闸管（见 `matrix::isolated_defs`）：连同自动轨道一起在定义副本里关掉。
    if first.defs.rules.pacing.enabled || first.defs.story2.tracks.iter().any(|t| t.auto) {
        let d = Arc::make_mut(&mut first.defs);
        d.rules.pacing.enabled = false;
        for t in &mut d.story2.tracks {
            t.auto = false;
        }
    }
    first.state.story.pending = None;
    first.state.story2.tracks.clear();
    first.state.story2.pending.clear();
    first.state.story2.last = None;
    if let Err(e) = first.start_story2(track) {
        report.steps.push(Step {
            path: Vec::new(),
            chapter: String::new(),
            branch: "start".into(),
            next: None,
            error: Some(e.to_string()),
            excluded: false,
            resolved: Vec::new(),
        });
        return report;
    }
    let mut queue = vec![(first, Vec::<String>::new())];
    let mut seen = BTreeSet::new();
    let mut count = 0;
    while let Some((w, path)) = queue.pop() {
        if count >= max_states {
            report.truncated = true;
            break;
        }
        count += 1;
        let Some(state) = w.state.story2.tracks.get(track) else { continue };
        report.reached.extend(state.visited.iter().cloned());
        if state.status != Status::Active {
            report.done |= state.status == Status::Done;
            report.failed |= state.status == Status::Failed;
            continue;
        }
        let signature = w.state_hash();
        if !seen.insert(signature) {
            continue;
        }
        let Some(c) = w.defs.story2.track(track).and_then(|t| t.chapter(&state.chapter)).cloned() else {
            continue;
        };
        report.reached.insert(c.key.clone());
        let mut attempts: Vec<(String, Option<u32>)> =
            c.choices.iter().enumerate().map(|(i, o)| (o.key.clone(), Some(i as u32))).collect();
        if c.stage == Some(Stage::Witness) && c.choices.is_empty() {
            attempts.push(("continue".into(), Some(0)));
        }
        if c.default.is_some() && c.window.is_some() {
            attempts.push(("default".into(), None));
        }
        if c.timeout.is_some() {
            attempts.push(("timeout".into(), None));
        }
        for (branch, choice) in attempts {
            let mut trial = w.clone();
            // 隔离轨道的局部证明；跨轨道的优先级另由队列测试验证。
            trial.state.story2.tracks.retain(|k, _| k == track);
            let gate = if let Some(i) = choice {
                let requires = c.choices.get(i as usize).map_or(&[][..], |o| o.requires.as_slice());
                prepare_dates(&mut trial, &c, requires).ok()
            } else {
                let entered = trial.state.story2.tracks[track].entered;
                let due = if branch == "timeout" {
                    trial.story2_deadline(&c, entered)
                } else {
                    c.window.and_then(|window| trial.story2_day(window[1]))
                };
                due.filter(|due| *due >= trial.day()).map(|due| {
                    trial.state.day = due;
                    (entered, c.when.clone())
                })
            };
            if let Some(family) = trial.upbringing_family() {
                trial.state.cast.academy = trial.cast_date() < family.graduation
                    && trial
                        .upbringing_stage_on(trial.cast_date())
                        .is_some_and(|s| s.stage == manifest_core::upbringing::Stage::Academy);
            }
            if let Some((entered, conditions)) = gate
                && conditions.iter().any(|condition| {
                    condition.hides_choice() && !trial.story2_conditions(std::slice::from_ref(condition), entered)
                })
            {
                report.steps.push(Step {
                    path: path.clone(),
                    chapter: c.key.clone(),
                    branch: branch.clone(),
                    next: None,
                    error: None,
                    excluded: true,
                    resolved: Vec::new(),
                });
                continue;
            }
            let result = (|| -> Result<(), BotError> {
                if let Some(i) = choice {
                    let requires = c.choices.get(i as usize).map_or(&[][..], |o| o.requires.as_slice());
                    prepare(&mut trial, &c, requires)?;
                    if trial.pending_story2().is_none_or(|p| p.track != track || p.chapter != c.key) {
                        return Err(blocked("章节没有进入待决队列"));
                    }
                    let visible = if c.choices.is_empty() {
                        0
                    } else {
                        c.choices
                            .iter()
                            .enumerate()
                            .filter(|(_, o)| trial.story2_choice_visible(o, trial.state.story2.tracks[track].entered))
                            .position(|(raw, _)| raw == i as usize)
                            .ok_or_else(|| blocked("选项不对当前身份开放"))? as u32
                    };
                    Command::StoryAnswer { owner: OwnerId::Player, choice: visible }.apply(&mut trial)?;
                } else {
                    let entered = trial.state.story2.tracks[track].entered;
                    let due = if branch == "timeout" {
                        trial.story2_deadline(&c, entered)
                    } else {
                        c.window.and_then(|window| trial.story2_day(window[1]))
                    }
                    .ok_or_else(|| blocked("分支没有到期日"))?;
                    if due < trial.day() {
                        return Err(blocked("前章结束时分支日期已过"));
                    }
                    trial.state.day = due;
                    if branch == "default" {
                        if trial.story2_deadline(&c, entered).is_some_and(|d| d <= due) {
                            return Err(blocked("默认分支被同日或更早的超时分支覆盖"));
                        }
                        for condition in &c.when {
                            prepare_condition(&mut trial, condition, entered)?;
                        }
                        if trial.day() != due {
                            return Err(blocked("默认分支条件要求晚于窗口止日的日期"));
                        }
                    }
                    // 作弊审计只验证当前日期的默认/超时结算，不伪造一份养成月程。
                    if trial.upbringing_active() {
                        trial.close_story2_windows();
                    } else {
                        trial.end_day()?;
                    }
                    if let Some(failure) = trial.state.story2.tracks.get(track).and_then(|s| s.failure.as_ref()) {
                        return Err(blocked(failure.clone()));
                    }
                    if trial
                        .state
                        .story2
                        .tracks
                        .get(track)
                        .is_some_and(|s| s.status == Status::Active && s.chapter == c.key)
                    {
                        return Err(blocked("自动分支没有推进"));
                    }
                }
                Ok(())
            })();
            let next = trial.state.story2.tracks.get(track).map(|s| match s.status {
                Status::Done => "done".into(),
                Status::Failed => "failed".into(),
                Status::Waiting => "waiting".into(),
                Status::Active => s.chapter.clone(),
            });
            report.steps.push(Step {
                path: path.clone(),
                chapter: c.key.clone(),
                branch: branch.clone(),
                next: result.as_ref().ok().and(next),
                error: result.as_ref().err().map(ToString::to_string),
                excluded: false,
                resolved: trial
                    .state
                    .story2
                    .tracks
                    .get(track)
                    .map(|s| s.visited.difference(&state.visited).cloned().collect())
                    .unwrap_or_default(),
            });
            if result.is_ok() {
                let mut path = path.clone();
                path.push(format!("{}:{branch}", c.key));
                queue.push((trial, path));
            }
        }
    }
    report
}
