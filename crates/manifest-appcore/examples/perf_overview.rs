//! 概览（每天推给界面的那一份）的耗时诊断：读一个真实存档，分别给整份概览与它的几大块计时。
//! 2026-11-10 实测寰宇出海的存档，本机 release 服务端每次 `overview` 要 650–730 毫秒（响应只有 15 KB），
//! 每天结算后都要建一次——倍速“快”（半秒一天）根本跑不动。这个例子用来找时间花在哪一块、改完再量。
//!
//! `cargo run --release --locked -p manifest-appcore --example perf_overview -- <输出目录> <存档目录> <槽位> [次数]`
//! 存档目录是放着 `<槽位>.mfsave.zst` 的那个目录（只读：例子把它拷到输出目录里再读，不动原件）。
use manifest_appcore::{AppPaths, AppState, captain_view, handlers, story_view, views};
use manifest_core::OwnerId;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Instant};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// 跑 n 次，返回各次的毫秒数（升序）。
fn time(n: usize, mut run: impl FnMut()) -> Vec<f64> {
    let mut out: Vec<f64> = (0..n)
        .map(|_| {
            let start = Instant::now();
            run();
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    out.sort_by(|a, b| a.total_cmp(b));
    out
}

fn summary(name: &str, ms: &[f64]) -> Value {
    let median = ms[ms.len() / 2];
    eprintln!("{name:<28} 中位 {median:>9.3} ms   最快 {:>9.3}   最慢 {:>9.3}", ms[0], ms[ms.len() - 1]);
    json!({ "stage": name, "median_ms": median, "min_ms": ms[0], "max_ms": ms[ms.len() - 1], "runs": ms.len() })
}

/// 写时复制的几大块此刻在内存里的地址：各地状态的外壳、行情情报，以及每一地的市场。
/// 独占着改不会换地方，被拷过才会换（P12 起各地的市场按地点各自写时复制：外壳换了不等于市场都拷了，要逐地看）。
fn big_blocks(st: &AppState) -> Result<(usize, usize, Vec<usize>)> {
    let guard = st.game()?;
    let game = guard.as_ref().ok_or("没有对局")?;
    let state = &game.session.world.state;
    let markets = state
        .locations
        .iter()
        .map(|l| {
            let market: &std::collections::BTreeMap<_, _> = &l.market;
            std::ptr::from_ref(market) as usize
        })
        .collect();
    Ok((std::ptr::from_ref(&*state.locations) as usize, std::ptr::from_ref(&*state.info.known) as usize, markets))
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let out = args.next().ok_or("需要输出目录")?;
    let saves = args.next().ok_or("需要存档目录")?;
    let slot = args.next().ok_or("需要槽位")?;
    let runs: usize = args.next().map(|s| s.parse()).transpose()?.unwrap_or(7);
    let out = Path::new(&out);
    let app = out.join("app");
    std::fs::create_dir_all(app.join("saves"))?;
    // 只拷这一个槽位的几份文件（存档、meta、预测簿）
    for entry in std::fs::read_dir(&saves)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(&format!("{slot}.")) {
            std::fs::copy(entry.path(), app.join("saves").join(&name))?;
        }
    }
    let root = manifest_data::find_data_dir().ok_or("找不到数据目录")?;
    let st = AppState::from_data_dir(&root, Arc::new(manifest_ai::MemoryKeyStore::default()), AppPaths::in_dir(&app))?;
    let mut settings = handlers::get_settings(&st).settings;
    settings.autosave_days = 0;
    settings.language = Some(manifest_data::Locale::ZhCn);
    handlers::save_settings(&st, settings)?;
    let start = Instant::now();
    let first = handlers::load_game(&st, &slot)?;
    eprintln!(
        "读档 {:.0} ms：世界 {}，第 {} 天，{}",
        start.elapsed().as_secs_f64() * 1000.0,
        first.world_key,
        first.day,
        first.mode
    );
    let mut samples = Vec::new();
    samples.push(summary("handlers::overview", &time(runs, || drop(handlers::overview(&st)))));
    {
        let guard = st.game()?;
        let game = guard.as_ref().ok_or("没有对局")?;
        let ctx = st.ctx();
        samples.push(summary("Game::view_world", &time(runs, || drop(game.view_world()))));
        let world = game.view_world();
        let w: &manifest_core::World = &world;
        samples.push(summary(
            "views::overview_in",
            &time(runs, || drop(views::overview_in(ctx, w, 0, "off".into(), None))),
        ));
        samples.push(summary("story_view_in", &time(runs, || drop(story_view::story_view_in(ctx, w)))));
        samples.push(summary("profile_view", &time(runs, || drop(captain_view::profile_view(ctx, w)))));
        samples.push(summary(
            "total_assets",
            &time(runs, || {
                std::hint::black_box(w.total_assets(OwnerId::Player));
            }),
        ));
        samples.push(summary(
            "visible_locations",
            &time(runs, || {
                std::hint::black_box(w.visible_locations().count());
            }),
        ));
        samples.push(summary("World::clone", &time(3, || drop(w.clone()))));
        // 世界状态各块序列化后的大小（哪一块最重，整份拷贝的时间大致就花在哪儿）
        if let Ok(Value::Object(fields)) = serde_json::to_value(&w.state) {
            let mut sizes: Vec<(usize, String)> =
                fields.iter().map(|(k, v)| (serde_json::to_vec(v).map_or(0, |b| b.len()), k.clone())).collect();
            sizes.sort_by(|a, b| b.cmp(a));
            let total: usize = sizes.iter().map(|s| s.0).sum();
            eprintln!("世界状态 JSON 合计 {:.1} MB，最大的几块：", total as f64 / 1e6);
            for (bytes, key) in sizes.iter().take(14) {
                eprintln!(
                    "  {key:<24} {:>8.2} MB  {:>5.1}%",
                    *bytes as f64 / 1e6,
                    *bytes as f64 * 100.0 / total as f64
                );
            }
        }
        let o = views::overview_in(ctx, w, 0, "off".into(), None);
        let mut bytes = 0;
        samples.push(summary(
            "serde_json::to_vec",
            &time(runs, || bytes = serde_json::to_vec(&o).map(|v| v.len()).unwrap_or(0)),
        ));
        eprintln!("概览 JSON {bytes} 字节");
    }
    // 在港里过几天（“下一天”、旅店休息）之后再量：时刻不在结算水位上时，概览用的是投影出来的世界
    let days: usize = std::env::var("PERF_DAYS").ok().and_then(|s| s.parse().ok()).unwrap_or(2);
    // 每一步的耗时、过完之后的世界哈希（计时之外算）、这一步里两大块有没有被整块拷过：前后两版对照用
    let mut steps = Vec::new();
    for round in 1..=days {
        let before = big_blocks(&st)?;
        let start = Instant::now();
        let o = handlers::step(&st, 1)?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        let after = big_blocks(&st)?;
        let hash = {
            let guard = st.game()?;
            guard.as_ref().ok_or("没有对局")?.session.world.state_hash()
        };
        // 这一步里有几地的市场换了地方（被拷过）
        let markets_copied = before.2.iter().zip(&after.2).filter(|(a, b)| a != b).count();
        steps.push(json!({
            "day": o.day, "ms": ms, "hash": hash,
            "pending_story": o.story.as_ref().is_some_and(|s| s.pending.is_some()),
            "locations_copied": before.0 != after.0, "info_copied": before.1 != after.1,
            "markets_copied": markets_copied, "markets": after.2.len(),
        }));
        // 写时复制的两大块在这一天里有没有被整块拷过（日结时若还有别的拷贝共用着它们，第一次写就要整块拷一份）
        eprintln!(
            "step 1 天：{ms:.0} ms（第 {} 天，等回应：{:?}，待答剧情：{}；{} 地的市场被拷过（共 {} 地），行情情报{}整块拷贝）",
            o.day,
            o.awaiting,
            o.story.as_ref().is_some_and(|s| s.pending.is_some()),
            markets_copied,
            after.2.len(),
            if before.1 == after.1 { "没有" } else { "有" },
        );
        samples.push(summary(&format!("overview 过了 {round} 天"), &time(runs, || drop(handlers::overview(&st)))));
        let guard = st.game()?;
        let game = guard.as_ref().ok_or("没有对局")?;
        let owned = matches!(game.view_world(), std::borrow::Cow::Owned(_));
        eprintln!(
            "  时刻 {}，投影是{}；navigation.settled {} / minute {}",
            game.minute,
            if owned { "另算的一份（整份世界的拷贝）" } else { "原世界（借用）" },
            game.session.world.state.navigation.settled,
            game.session.world.state.navigation.minute
        );
        samples.push(summary(&format!("view_world 过了 {round} 天"), &time(runs, || drop(game.view_world()))));
        if round == days {
            let world = game.view_world();
            let w: &manifest_core::World = &world;
            let ctx = st.ctx();
            samples.push(summary(
                "overview_in（过完这些天）",
                &time(runs, || drop(views::overview_in(ctx, w, 0, "off".into(), None))),
            ));
            samples
                .push(summary("story_view_in（过完这些天）", &time(runs, || drop(story_view::story_view_in(ctx, w)))));
            samples
                .push(summary("profile_view（过完这些天）", &time(runs, || drop(captain_view::profile_view(ctx, w)))));
        }
    }
    // 出港（手动航行的世界）、走一小时再量：在海上时每次查询都要投影
    if first.mode == "voyage" {
        let fleet = {
            let guard = st.game()?;
            let game = guard.as_ref().ok_or("没有对局")?;
            game.session.world.flagship(OwnerId::Player)
        };
        if let Some(fleet) = fleet {
            let cmd = manifest_core::Command::Depart { owner: OwnerId::Player, fleet, minute: 0, heading: 180 };
            match handlers::submit(&st, cmd) {
                Ok(_) => {
                    handlers::set_speed(&st, 1)?;
                    for _ in 0..4 {
                        let _ = handlers::advance_clock(&st, 15)?;
                    }
                    handlers::set_speed(&st, 0)?;
                    samples.push(summary("overview 在海上", &time(runs, || drop(handlers::overview(&st)))));
                    let guard = st.game()?;
                    let game = guard.as_ref().ok_or("没有对局")?;
                    samples.push(summary("view_world 在海上", &time(runs, || drop(game.view_world()))));
                    let world = game.view_world();
                    let w: &manifest_core::World = &world;
                    let ctx = st.ctx();
                    samples.push(summary(
                        "overview_in 在海上",
                        &time(runs, || drop(views::overview_in(ctx, w, 0, "off".into(), None))),
                    ));
                }
                Err(e) => eprintln!("出港没成：{e:?}"),
            }
        }
    }
    serde_json::to_writer_pretty(
        std::io::BufWriter::new(std::fs::File::create(out.join("perf-overview.json"))?),
        &json!({
            "slot": slot, "world": first.world_key, "day": first.day, "mode": first.mode,
            "samples": samples, "steps": steps,
        }),
    )?;
    Ok(())
}
