//! P07：同一真实世界、种子与日数的月结、完整跳过养成及自由开局计时。
//! 仅测会话逐日推进；加载、克隆、序列化不计入月结和跳过耗时。
use manifest_core::{Command, OwnerId};
use manifest_sim::GameSession;
use serde_json::json;
use std::{path::PathBuf, time::Instant};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn main() -> Result<()> {
    let out = PathBuf::from(std::env::args().nth(1).ok_or("用法：perf_upbringing <输出目录> [--ten-year]")?);
    std::fs::create_dir_all(&out)?;
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().ok_or("找不到数据目录")?, "terra16")?;
    let scenario = defs.find_scenario("mio_1553").ok_or("缺少澪剧本")?;
    if std::env::args().nth(2).as_deref() == Some("--ten-year") {
        // 性能门槛超时时单独重跑同一完整十年；不重复或缩减正式的 8×5 矩阵。
        let result = manifest_sim::balance::run_one_scenario(
            defs.clone(),
            42,
            manifest_sim::bots::BotKind::Arbitrage,
            10,
            manifest_core::info::InfoMode::Carried,
            scenario,
            true,
        )?;
        assert_eq!(result.start_day, 1460);
        assert_eq!(result.audited_days, 1460 + 10 * defs.calendar.year_days());
        assert!(result.money_conserved);
        let seconds = result.observation_time.as_secs_f64();
        let limit = manifest_sim::balance::Thresholds::default().ten_year_secs;
        let report = json!({"world_hash":defs.meta.hash,"seed":42,"years":10,
            "observation_seconds":seconds,"limit_seconds":limit,"within_limit":seconds < limit,
            "audited_days":result.audited_days,"money_conserved":result.money_conserved,
            "trades":result.trades,"departures":result.departures});
        std::fs::write(out.join("ten-year.json"), serde_json::to_vec_pretty(&report)?)?;
        println!("{report}");
        return Ok(());
    }
    let mut game = GameSession::new(defs.clone(), scenario, 42)?;
    game.submit(Command::SkipUpbringing { owner: OwnerId::Player })?;
    let start_day = game.day();
    let snapshot = game.to_save();
    let mut months = Vec::new();
    for _ in 0..3 {
        let mut sample = GameSession::from_save(defs.clone(), snapshot.clone())?;
        let now = Instant::now();
        for _ in 0..30 {
            sample.advance_day()?;
        }
        months.push(now.elapsed().as_micros());
        assert_eq!(sample.day(), start_day + 30, "月结必须实际推进 30 日");
    }
    eprintln!("30 日三次采样（微秒）：{months:?}");
    let now = Instant::now();
    while game.world.upbringing_active() {
        game.advance_day()?;
    }
    let skip_us = now.elapsed().as_micros();
    assert_eq!(game.day(), start_day + 1460, "必须实际走完四年");
    assert!(game.world.money_conserved(), "结业资金守恒");
    manifest_core::testkit::check_invariants(&game.world)?;
    std::fs::write(out.join("graduation.json"), serde_json::to_vec(&game.to_save())?)?;
    eprintln!("完整跳过 1460 日（微秒）：{skip_us}");
    let now = Instant::now();
    let free = GameSession::new(defs.clone(), defs.find_scenario("free_1557").ok_or("缺少自由剧本")?, 42)?;
    let free_us = now.elapsed().as_micros();
    assert_eq!(free.start.bootstrap_days, 1460, "自由开局必须保留四年时间轴");
    manifest_core::testkit::check_invariants(&free.world)?;
    std::fs::write(out.join("free.json"), serde_json::to_vec(&free.to_save())?)?;
    let report = json!({"world_hash":defs.meta.hash,"seed":42,"month_days":30,"month_us":months,
        "skip_days":1460,"skip_us":skip_us,"free_us":free_us,
        "graduation_hash":game.world.state_hash(),"free_hash":free.world.state_hash(),
        "graduation_history":game.world.state.history.chronicle,"free_history":free.world.state.history.chronicle});
    std::fs::write(out.join("report.json"), serde_json::to_vec_pretty(&report)?)?;
    println!("{report}");
    Ok(())
}
