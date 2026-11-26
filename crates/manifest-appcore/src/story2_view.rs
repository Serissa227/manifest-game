//! 多轨道事件、实际结算效果与已知见闻的I5/I5b投影。
use crate::{
    story_view::*,
    views::{Ctx, PLAYER},
};
use manifest_core::{
    Command, World,
    story2::{ChapterDef, Choice, Effect, News, Stage, Status, TrackKind},
};
use serde_json::{Value, json};

fn chapter_for<'a>(ctx: Ctx<'a>, n: &News) -> Option<&'a ChapterDef> {
    let key = n.id.strip_prefix(&format!("{}:", n.track))?;
    ctx.names.story2.track(&n.track)?.chapter(key)
}
pub(crate) fn news_next<'a>(world: &'a World, n: &News) -> Option<&'a str> {
    let c = chapter_for(Ctx::plain(&world.defs), n)?;
    if n.timeout {
        return c.timeout.as_ref().map(|b| b.next.as_str());
    }
    if let Some(o) = n.choice.and_then(|i| c.choices.get(i as usize)) {
        return if n.success == Some(false) { o.fail.as_ref().map(|b| b.next.as_str()) } else { Some(&o.next) };
    }
    c.default.as_ref().map(|b| b.next.as_str())
}
pub(crate) fn news_effects<'a>(world: &'a World, n: &News) -> &'a [Effect] {
    world.story2_news_effects(n)
}

pub fn news(ctx: Ctx<'_>, world: &World, n: &News) -> Value {
    let date = world.defs.calendar.date_of(n.day);
    let t = ctx.names.story2.track(&n.track);
    let text = chapter_for(ctx, n)
        .and_then(|c| {
            if n.timeout {
                c.timeout.as_ref().and_then(|b| b.news.as_ref()).or(c.news.as_ref())
            } else if let Some(o) = n.choice.and_then(|i| c.choices.get(i as usize)) {
                if n.success == Some(false) {
                    o.fail.as_ref().and_then(|b| b.news.as_ref()).or(c.news.as_ref())
                } else {
                    o.news.as_ref().or(c.news.as_ref())
                }
            } else {
                c.default.as_ref().and_then(|b| b.news.as_ref()).or(c.news.as_ref())
            }
        })
        .unwrap_or(&n.text);
    let text = crate::navigation_view::visibility::redact_text(ctx, world, text);
    let replacement = (n.kind == manifest_core::story2::NewsKind::Letter)
        .then(|| {
            crate::ai_text_view::get(
                ctx,
                world,
                &manifest_core::summary::text::TextTarget::Letter {
                    id: n.id.clone(),
                    purpose: manifest_core::summary::text::letter_purpose(world, &n.id),
                },
            )
        })
        .flatten();
    let ai = replacement.as_ref().is_some_and(|(_, ai)| *ai);
    let text = replacement.map(|(text, _)| text).unwrap_or(text);
    let mut value = json!({"id":n.id,"day":[world.defs.rules.world.start_year+i64::from(date.year)-1,date.month,date.day],"text":text,"persons":n.persons,"kind":n.kind,"place":n.loc.map(|l|crate::navigation_view::visibility::place(ctx,world,l)),"track":n.track,"track_name":t.map(|t|t.name.clone()),"read":n.read});
    if n.kind == manifest_core::story2::NewsKind::Letter {
        value["ai"] = json!(ai);
    }
    value
}
pub fn gossip(ctx: Ctx<'_>, world: &World, loc: Option<manifest_core::LocId>, limit: Option<u32>) -> Value {
    let entries = world.known_news(loc);
    let unread = entries.iter().filter(|n| !n.read).count();
    json!({"items":entries.into_iter().take(limit.unwrap_or(100).min(500) as usize).map(|n|news(ctx,world,n)).collect::<Vec<_>>(),"unread":unread})
}

fn speaker(ctx: Ctx<'_>, world: &World, person: Option<&str>) -> SpeakerView {
    let key = if person == Some("captain") {
        world.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref())
    } else {
        person
    };
    let p = key.and_then(|p| ctx.names.cast.person(p));
    SpeakerView {
        kind: if person == Some("captain") {
            "captain"
        } else if p.is_some() {
            "portrait"
        } else {
            "none"
        },
        mate: None,
        asset: p.and_then(|p| p.portrait(world.cast_date())).map(str::to_owned),
        name: p.map(|p| p.name.clone()).unwrap_or_default(),
        person: p.map(|p| p.key.clone()),
        portrait: p.and_then(|p| p.portrait(world.cast_date())).map(str::to_owned),
    }
}
fn person_name(ctx: Ctx<'_>, key: &str) -> String {
    ctx.names.cast.person(key).map_or_else(|| key.into(), |p| p.name.clone())
}

fn outcome(ctx: Ctx<'_>, world: &World, e: &Effect, localized: Option<&Effect>) -> Option<StoryOutcomeView> {
    let mut v = StoryOutcomeView::default();
    match e {
        Effect::Growth { attr, value } => {
            v.kind = "growth";
            v.attr = Some(attr.clone());
            v.value = *value;
        }
        Effect::Skill { skill, value } => {
            v.kind = "skill";
            v.extra.skill = Some(skill.clone());
            v.extra.skill_name = Some(crate::story_log_view::attr(ctx, skill));
            v.value = *value;
        }
        Effect::Affinity { person, value } | Effect::Heart { person, value } => {
            v.kind = if matches!(e, Effect::Heart { .. }) { "heart" } else { "affinity" };
            v.extra.person = Some(person.clone());
            v.extra.person_name = Some(person_name(ctx, person));
            v.value = *value;
        }
        Effect::Relation { person, relation, remove } => {
            v.kind = "relation";
            v.extra.person = Some(person.clone());
            v.extra.person_name = Some(person_name(ctx, person));
            v.extra.relation = Some(*relation);
            v.value = if *remove { -1 } else { 1 };
            v.text = Some(crate::cast_view::relation_label(ctx, *relation).into());
        }
        Effect::Tie { a, b, relation, remove } => {
            v.kind = "relation";
            v.extra.person = Some(b.clone());
            v.extra.person_name = Some(person_name(ctx, b));
            v.extra.relation = Some(*relation);
            v.persons = vec![a.clone(), b.clone()];
            v.value = if *remove { -1 } else { 1 };
            v.text = Some(format!(
                "{} / {} · {}",
                person_name(ctx, a),
                person_name(ctx, b),
                crate::cast_view::relation_label(ctx, *relation)
            ));
        }
        Effect::Item { item, qty } => {
            v.kind = "item";
            v.extra.item = Some(item.clone());
            v.extra.item_name = Some(ctx.names.items.item(item).map_or_else(|| item.clone(), |i| i.name.clone()));
            v.value = *qty;
        }
        Effect::Memory { memory, title } => {
            v.kind = "memory";
            v.extra.memory = Some(memory.clone());
            v.extra.title = Some(
                match localized {
                    Some(Effect::Memory { title, .. }) => title,
                    _ => title,
                }
                .clone(),
            );
        }
        Effect::Title { title } => {
            v.kind = "title";
            v.extra.title = Some(title.clone());
        }
        Effect::Flag { flag, value } => {
            v.kind = "flag";
            v.extra.flag = Some(flag.clone());
            v.value = i64::from(*value);
        }
        Effect::Letter { person, text } => {
            v.kind = "letter";
            v.extra.person = Some(person.clone());
            v.extra.person_name = Some(person_name(ctx, person));
            v.text = Some(
                match localized {
                    Some(Effect::Letter { text, .. }) => text,
                    _ => text,
                }
                .clone(),
            );
        }
        Effect::Cash { value } => {
            v.kind = "cash";
            v.value = *value;
        }
        Effect::Fame { value } => {
            v.kind = "fame";
            v.value = *value;
        }
        Effect::Reputation { faction, value } => {
            v.kind = "reputation";
            v.faction = ctx.names.factions.iter().position(|f| &f.key == faction).map(|i| i as u16);
            v.value = *value;
        }
        Effect::Chart { region } => {
            v.kind = "chart";
            v.region = ctx.names.regions.iter().position(|r| &r.key == region).map(|i| i as u16);
        }
        Effect::Join { person } | Effect::Leave { person } => {
            v.kind = "mate";
            v.mate = world.person_mate(person).and_then(|id| ctx.names.mates.get(id.idx())).map(|m| m.key.clone());
            v.mate_name = Some(person_name(ctx, person));
            v.value = if matches!(e, Effect::Join { .. }) { 1 } else { -1 };
        }
        Effect::World { text, .. } => {
            v.kind = "news";
            v.text = Some(
                match localized {
                    Some(Effect::World { text, .. }) => text,
                    _ => text,
                }
                .clone(),
            );
        }
        // I5未定义这些内部状态变化的结果种类；羁绊、轨道与日程由各自视图反映。
        Effect::OpenRealm { .. }
        | Effect::EatOtherworld { .. }
        | Effect::Transform { .. }
        | Effect::LearnSpell { .. }
        | Effect::Bond { .. }
        | Effect::StartTrack { .. }
        | Effect::EndTrack { .. }
        | Effect::LegendShip { .. }
        | Effect::Schedule { .. } => {
            return None;
        }
    }
    Some(v)
}

pub fn extend(ctx: Ctx<'_>, world: &World, view: &mut StoryView) {
    if world.defs.story2.tracks.is_empty() {
        return;
    }
    view.news_unread = Some(world.news_unread());
    // 旧剧情的 journal 没有故事 2.0；开场介绍同样按已走过的章节列入。
    for (key, state) in &world.state.story2.tracks {
        let Some(track) = ctx.names.story2.track(key) else { continue };
        for chapter in track.chapters.iter().filter(|c| state.visited.contains(&c.key)) {
            let id = format!("{key}:{}", chapter.key);
            let news = world.state.story2.news.get(&id);
            let last = world.state.story2.last.as_ref().filter(|r| r.track == *key && r.chapter == chapter.key);
            // 自治、超时和只听来的结果不能冒充亲身回应。
            if news.is_some_and(|n| {
                !n.known || n.kind != manifest_core::story2::NewsKind::Seen || n.timeout || n.choice.is_none()
            }) || (news.is_none()
                && last.is_none()
                && (track.auto || (state.failure.is_some() && state.chapter == chapter.key)))
            {
                continue;
            }
            let choice = last.and_then(|r| r.choice).or_else(|| news.and_then(|n| n.choice));
            let variant =
                last.and_then(|r| r.variant.as_ref()).and_then(|key| chapter.variants.iter().find(|v| &v.key == key));
            view.journal.push(StoryJournalView {
                // 没有见闻的章节只存了轨道最近进入日，没有保留逐章日期与选项。
                day: last.map(|r| r.day).or_else(|| news.map(|n| n.day)).unwrap_or(state.entered),
                kind: if key.starts_with("intro_") {
                    "intro"
                } else {
                    event_kind(track.kind, chapter.stage, track.academy)
                },
                title: variant.and_then(|v| v.title.clone()).unwrap_or_else(|| chapter.title.clone()),
                choice: choice
                    .and_then(|i| chapter.choices.get(i as usize))
                    .map(|c| c.text.clone())
                    .unwrap_or_default(),
                success: last.and_then(|r| r.success).or_else(|| news.and_then(|n| n.success)),
            });
        }
    }
    view.journal.sort_by_key(|entry| entry.day);
    if let Some(p) = &mut view.pending {
        p.extra.queue = Some(world.state.story2.pending.len());
    }
    if world.story2_is_front()
        && let Some(p) = world.pending_story2()
        && let Some(t) = ctx.names.story2.track(&p.track)
        && let Some(c) = t.chapter(&p.chapter)
    {
        let variant = p.variant.as_ref().and_then(|key| c.variants.iter().find(|v| &v.key == key));
        let cast = if c.cast.is_empty() { &t.cast } else { &c.cast };
        let entered = world.state.story2.tracks[&p.track].entered;
        view.pending =
            Some(StoryEventView {
                day: p.day,
                fleet: world.fleets_of(PLAYER).next().map_or(0, |f| f.id.0),
                kind: event_kind(t.kind, c.stage, t.academy),
                key: format!("{}:{}", t.key, c.key),
                chapter: None,
                total: None,
                story: Some(t.name.clone()),
                title: variant.and_then(|v| v.title.clone()).unwrap_or_else(|| c.title.clone()),
                text: variant.and_then(|v| v.text.clone()).unwrap_or_else(|| c.text.clone()),
                speaker: speaker(ctx, world, variant.and_then(|v| v.speaker.as_deref()).or(c.speaker.as_deref())),
                choices: c
                    .choices
                    .iter()
                    .filter(|o| world.story2_choice_visible(o, entered))
                    .enumerate()
                    .map(|(i, o)| StoryChoiceView {
                        key: Some(o.key.clone()),
                        text: o.text.clone(),
                        cost: 0,
                        give: None,
                        check: o.check.as_ref().map(|k| StoryCheckView {
                            attr: k.attr.clone(),
                            name: crate::story_log_view::attr(ctx, &k.attr),
                            pct: world.story2_check_pct(k),
                        }),
                        blocked: Command::StoryAnswer { owner: PLAYER, choice: i as u32 }
                            .validate(world)
                            .err()
                            .map(|e| ctx.error(&e)),
                        hint: o.hint.clone(),
                        requires: o
                            .requires
                            .iter()
                            .filter(|c| !c.hides_choice())
                            .map(|c| crate::story_log_view::requirement(ctx, world, c))
                            .collect(),
                        dice: dice_view(ctx, world, &p.track, &c.key, entered, o),
                    })
                    .collect(),
                extra: StoryEventExtra {
                    track: Some(t.key.clone()),
                    track_name: Some(t.name.clone()),
                    mood: variant.and_then(|v| v.mood.clone()).or_else(|| c.mood.clone()),
                    art: variant.and_then(|v| v.art.clone()).or_else(|| c.art.clone()),
                    place: c.at.as_ref().and_then(|key| ctx.names.locations.iter().position(|l| &l.key == key)).map(
                        |i| crate::navigation_view::visibility::place(ctx, world, manifest_core::LocId::from_idx(i)),
                    ),
                    night: Some(variant.and_then(|v| v.night).unwrap_or(c.night)),
                    queue: Some(
                        world.state.story2.pending.len().saturating_sub(1)
                            + usize::from(world.state.story.pending.is_some()),
                    ),
                    // 养成期时钟本来就等着回应，不需要“最后一天”的提醒
                    last_day: (world.pacing_enabled() && !world.upbringing_active() && world.pacing_last_chance(p))
                        .then_some(true),
                    cast: cast
                        .iter()
                        .filter_map(|key| ctx.names.cast.person(key))
                        .map(|p| StoryCastView {
                            person: p.key.clone(),
                            name: p.name.clone(),
                            portrait: p.portrait(world.cast_date()).map(str::to_owned),
                        })
                        .collect(),
                    figure: c.figure.as_ref().and_then(|key| {
                        let name = if ctx.names.cast.person(key).is_some() {
                            person_name(ctx, key)
                        } else {
                            ctx.names.cast.figure(key)?.name.clone()
                        };
                        Some(StoryFigureView {
                            key: key.clone(),
                            name: crate::navigation_view::visibility::redact_narrative_text(ctx, world, &name),
                        })
                    }),
                },
            });
    }
    if let Some(r) = &world.state.story2.last
        && view.last.as_ref().is_none_or(|old| old.day <= r.day)
        && let Some(t) = ctx.names.story2.track(&r.track)
        && let Some(c) = t.chapter(&r.chapter)
    {
        let variant = r.variant.as_ref().and_then(|key| c.variants.iter().find(|v| &v.key == key));
        let choice = r.choice.and_then(|i| c.choices.get(i as usize));
        let heard = r.news.as_ref().and_then(|id| world.state.story2.news.get(id)).filter(|n| n.known);
        let branch = if r.success == Some(false) {
            choice.and_then(|o| o.fail.as_ref())
        } else if choice.is_none() {
            c.default.as_ref()
        } else {
            None
        };
        let translated_effects =
            branch.map(|b| b.effects.as_slice()).or_else(|| choice.map(|o| o.effects.as_slice())).unwrap_or(&[]);
        let mut outcomes: Vec<_> = r
            .outcomes
            .iter()
            .enumerate()
            .filter_map(|(i, e)| outcome(ctx, world, e, translated_effects.get(i)))
            .collect();
        if let Some(n) = heard {
            outcomes.insert(
                0,
                StoryOutcomeView {
                    kind: "news",
                    text: Some(news(ctx, world, n)["text"].as_str().unwrap_or(&n.text).into()),
                    persons: n.persons.clone(),
                    ..Default::default()
                },
            );
        }
        if let Some(fail) = &r.soft_fail {
            // U02 通用失败：实际扣掉的疲劳与心情。
            for (kind, value) in [("fatigue", fail.fatigue), ("mood", fail.mood)] {
                if value != 0 {
                    outcomes.push(StoryOutcomeView { kind, value, ..Default::default() });
                }
            }
        }
        let reply = if let Some(fail) = &r.soft_fail {
            fail_line(ctx, fail)
        } else {
            choice
                .filter(|o| !o.reply.is_empty() && r.success != Some(false))
                .map(|o| o.reply.clone())
                .or_else(|| branch.and_then(|b| b.news.clone()))
                .or_else(|| heard.map(|n| news(ctx, world, n)["text"].as_str().unwrap_or(&n.text).into()))
                .unwrap_or_else(|| variant.and_then(|v| v.text.clone()).unwrap_or_else(|| c.text.clone()))
        };
        view.last_roll = r.roll.as_ref().map(|roll| RollView {
            chance: roll.chance,
            roll: roll.roll,
            success: roll.success,
            choice: roll.choice.clone(),
        });
        view.last = Some(StoryResultView {
            day: r.day,
            kind: event_kind(t.kind, c.stage, t.academy),
            key: format!("{}:{}", r.track, r.chapter),
            title: variant.and_then(|v| v.title.clone()).unwrap_or_else(|| c.title.clone()),
            choice: choice.map(|o| o.text.clone()),
            reply,
            success: r.success,
            outcomes,
            speaker: speaker(ctx, world, variant.and_then(|v| v.speaker.as_deref()).or(c.speaker.as_deref())),
            ended: world.state.story2.tracks.get(&r.track).is_some_and(|s| s.status != Status::Active),
        });
    }
}
/// 选项的掷骰信息：只在世界打开掷骰规则时给出，查询不改世界状态。
fn dice_view(ctx: Ctx<'_>, world: &World, track: &str, chapter: &str, entered: u32, o: &Choice) -> ChoiceDiceView {
    if !world.defs.rules.story.soft_requires {
        return ChoiceDiceView::default();
    }
    let gaps = world.story2_soft_gaps(o);
    let failed = !gaps.is_empty() && world.story2_choice_failed(track, chapter, entered, &o.key);
    ChoiceDiceView {
        // 硬条件没满足或本次已失败时不能掷骰，也就不给成功率。
        chance: (!failed && world.story2_choice_open(o, entered)).then(|| world.story2_choice_chance(o)).flatten(),
        failed,
        soft_gap: gaps
            .into_iter()
            .map(|g| SoftGapView {
                label: crate::story_log_view::attr(ctx, &g.key),
                key: g.key,
                have: g.have,
                need: g.need,
            })
            .collect(),
    }
}

/// 通用失败的回应：先取这一池里写好的语句，池子没写时用通用语；都没写时为空串，由前端自行处理。
fn fail_line(ctx: Ctx<'_>, fail: &manifest_core::story2::dice::SoftFailure) -> String {
    let rules = &ctx.names.rules.story;
    let written: Vec<&String> =
        rules.fail_lines.get(&fail.pool).into_iter().flatten().filter(|s| !s.trim().is_empty()).collect();
    if written.is_empty() {
        return rules.fail_line.clone();
    }
    written[fail.pick as usize % written.len()].clone()
}

fn event_kind(kind: TrackKind, stage: Option<Stage>, academy: bool) -> &'static str {
    if stage.is_some() {
        return "side";
    }
    if academy {
        return "upbringing";
    }
    match kind {
        TrackKind::Main => "chapter",
        TrackKind::History => "history",
        TrackKind::Request => "request",
        TrackKind::Encounter => "encounter",
        TrackKind::Guide => "guide",
    }
}
