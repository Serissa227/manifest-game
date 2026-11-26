//! P15：计时仅在命令行；同一条日结路径保留所有刷新及条件判定。
use anyhow::{Context, Result, bail};
use manifest_core::{Command, OwnerId, StaticData, World, tick::LightWorldStep, upbringing::week_index};
use std::{collections::BTreeMap, sync::Arc, time::Instant};

#[derive(clap::Args)]
pub struct Args {
    #[arg(long, default_value_t = 5, value_parser = clap::value_parser!(u32).range(1..=210))]
    weeks: u32,
    #[arg(long, default_value = "mio")]
    family: String,
}

fn label(step: LightWorldStep) -> &'static str {
    match step {
        LightWorldStep::History => "history_and_world_end",
        LightWorldStep::StoryWindows => "story_windows",
        LightWorldStep::UpbringingFinish => "upbringing_finish",
        LightWorldStep::UpbringingStart => "upbringing_start",
        LightWorldStep::WorldStart => "world_start",
        LightWorldStep::UpbringingEvents => "events_and_cadence",
        LightWorldStep::StoryRefresh => "story_refresh_conditions",
        LightWorldStep::Finish => "finish",
    }
}

fn answer(world: &mut World, answered: u64) -> Result<()> {
    let mut choices = if world.story2_is_front() {
        let pending = world.pending_story2().context("missing_pending")?;
        let chapter = world
            .defs
            .story2
            .track(&pending.track)
            .and_then(|t| t.chapter(&pending.chapter))
            .context("missing_chapter")?;
        let entered = world.state.story2.tracks.get(&pending.track).map_or(world.day(), |s| s.entered);
        let visible: Vec<_> = chapter.choices.iter().filter(|c| world.story2_choice_visible(c, entered)).collect();
        if visible.is_empty() {
            vec![0]
        } else {
            visible
                .iter()
                .enumerate()
                .filter(|(_, c)| world.story2_conditions(&c.requires, entered))
                .map(|(i, _)| i as u32)
                .collect()
        }
    } else {
        (0..manifest_core::story::MAX_CHOICES as u32).collect()
    };
    if !choices.is_empty() {
        let offset = (u64::from(world.day()) + answered) as usize % choices.len();
        choices.rotate_left(offset);
    }
    let command = choices
        .into_iter()
        .map(|choice| Command::StoryAnswer { owner: OwnerId::Player, choice })
        .find(|c| c.validate(world).is_ok())
        .context("no_open_choice")?;
    command.apply(world)?;
    Ok(())
}

pub fn run(defs: Arc<StaticData>, locale: &manifest_data::LocaleBundle, args: Args) -> Result<()> {
    let family = defs.upbringing.family(&args.family).context("unknown_family")?;
    let scenario = family.scenario.clone();
    let request = manifest_core::scenario::NewGameRequest {
        world: defs.world_key.clone(),
        scenario,
        protagonist: Some(args.family),
        seed: Some(42),
        ..Default::default()
    };
    let mut world = manifest_sim::GameSession::new_world(defs, request, |_| {})?.world;
    if !world.act_running() || !world.defs.rules.upbringing.light_world {
        bail!("requires_act_and_light_world");
    }
    let ctx = manifest_appcore::views::Ctx {
        texts: Some(&locale.texts),
        current: Some(locale),
        ..manifest_appcore::views::Ctx::plain(&locale.defs)
    };
    let mut samples = BTreeMap::<&str, Vec<u128>>::new();
    let mut day_view = 0;
    let mut day_bot = 0;
    let mut answered = 0;
    let started = Instant::now();
    while week_index(&world.defs, world.day()) < args.weeks && world.act_running() {
        let now = Instant::now();
        std::hint::black_box(manifest_appcore::upbringing_view::act::view(ctx, &world));
        let elapsed = now.elapsed().as_nanos();
        samples.entry("act_view").or_default().push(elapsed);
        day_view += elapsed;
        let now = Instant::now();
        let acted = if !world.state.story2.pending.is_empty() || world.state.story.pending.is_some() {
            answer(&mut world, answered)?;
            answered += 1;
            true
        } else {
            world.act_bot_step()?
        };
        let elapsed = now.elapsed().as_nanos();
        samples.entry("bot_action").or_default().push(elapsed);
        day_bot += elapsed;
        if acted {
            continue;
        }
        let day = world.day();
        let now = Instant::now();
        let mut last = now;
        let mut parts = BTreeMap::<&str, u128>::new();
        world.end_day_observed(|step| {
            let end = Instant::now();
            *parts.entry(label(step)).or_default() += end.duration_since(last).as_nanos();
            last = end;
        })?;
        let elapsed = now.elapsed().as_nanos();
        let measured: u128 = parts.values().sum();
        parts.insert("day_other", elapsed - measured);
        samples.entry("daily_total").or_default().push(elapsed);
        print!(
            "day={day} daily_ms={:.3} view_ms={:.3} bot_ms={:.3}",
            elapsed as f64 / 1e6,
            day_view as f64 / 1e6,
            day_bot as f64 / 1e6
        );
        for (key, value) in parts {
            samples.entry(key).or_default().push(value);
            print!(" {key}={:.3}", value as f64 / 1e6);
        }
        println!();
        day_view = 0;
        day_bot = 0;
    }
    let sum = |key| samples.get(key).map_or(0, |v| v.iter().sum::<u128>());
    let total = sum("daily_total") + sum("act_view") + sum("bot_action");
    println!("| segment | n | median_ms | p95_ms | share_pct |");
    println!("|---|---:|---:|---:|---:|");
    for (key, values) in &mut samples {
        values.sort_unstable();
        let median = values[values.len() / 2];
        let p95 = values[(values.len() * 95).div_ceil(100) - 1];
        let share = values.iter().sum::<u128>() as f64 * 100.0 / total as f64;
        println!("| {key} | {} | {:.3} | {:.3} | {share:.2} |", values.len(), median as f64 / 1e6, p95 as f64 / 1e6);
    }
    println!(
        "light_world_market=disabled elapsed_ms={:.3} week={} stage={} state_hash={}",
        started.elapsed().as_secs_f64() * 1000.0,
        week_index(&world.defs, world.day()),
        world.act_stage_key(),
        world.state_hash()
    );
    Ok(())
}
