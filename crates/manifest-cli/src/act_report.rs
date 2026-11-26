//! 结业报表的试玩档使用桌面应用的保存与读档入口。
use anyhow::{Context, Result, ensure};
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_core::{OwnerId, SaveFile};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};

pub fn app(data: &Path, dir: &Path) -> Result<AppState> {
    Ok(AppState::from_data_dir(
        data,
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths { settings_file: dir.join("report-settings.json"), saves_dir: dir.to_owned() },
    )?)
}
pub fn save(app: &AppState, slot: &str, save: &SaveFile) -> Result<Value> {
    // 先装入快照，再由应用原路写出 meta、存档与附属簿；最终读回也走 load_game。
    let file = app.paths().saves_dir.join(format!("{slot}.mfsave.zst"));
    manifest_sim::storage::write(&file, save, true)?;
    handlers::load_game(app, slot)?;
    handlers::save_game(app, slot)?;
    let overview = handlers::load_game(app, slot)?;
    let guard = app.game()?;
    let game = guard.as_ref().context("loaded_game")?;
    let w = &game.session.world;
    let capital = w.act_capital_preview();
    let fleet = w.flagship(OwnerId::Player).context("flagship")?;
    let here = w.fleet(fleet)?.docked_at().context("docked")?;
    let port = manifest_appcore::views::port_view(w, here);
    let guide = w.state.story2.tracks.get("guide_mio_voyage").context("guide_mio_voyage")?;
    let upbringing = manifest_appcore::upbringing_view::upbringing(manifest_appcore::views::Ctx::plain(&w.defs), w);
    ensure!(overview.mode == "voyage" && !w.upbringing_active(), "voyage");
    let graduation = w.state.upbringing.as_ref().and_then(|s| s.graduation.as_ref()).context("graduation")?;
    // 快照在养成刚结束时立即取得；读回同一日且没有航海命令，不假定结业事件的日期偏移。
    ensure!(w.day() == save.snapshot.day, "first_voyage_day");
    ensure!(save.log.is_empty(), "no_voyage_commands");
    ensure!(w.defs.loc(here).key == "shimoda_tosa", "shimoda");
    ensure!(guide.chapter == "v01_sell_grain", "guide_first_step");
    let expected = ["ding", "bing"].contains(&capital.band.as_str());
    ensure!(port.bank.guarantee.as_ref().is_some_and(|g| g.available) == expected, "guarantee_available");
    ensure!(port.bank.guarantee.is_some() == expected, "guarantee_presence");
    ensure!(upbringing["act_review"]["guarantee"] == serde_json::to_value(&capital.guarantee)?, "graduation_guarantee");
    let result = json!({"slot":slot,"day":overview.day,"graduation_day":graduation.day,"voyage_commands":save.log.len(),"date":w.cast_date(),"minute":game.minute,
        "mode":overview.mode,"phase":w.state.upbringing.as_ref().map(|s|s.phase),
        "port":w.defs.loc(here).key,"guide_chapter":guide.chapter,"guide_status":guide.status,
        "band":capital.band,"score":w.state.upbringing.as_ref().and_then(|s|s.graduation.as_ref()).and_then(|g|g.act.as_ref()).map(|a|a.score),
        "bank_guarantee":port.bank.guarantee,"preview_guarantee":capital.guarantee,
        "act_review_guarantee":upbringing["act_review"].get("guarantee"),
        "stored_guarantee":serde_json::to_value(&save.snapshot.upbringing)?.get("graduation").and_then(|g|g.get("act")).and_then(|a|a.get("guarantee")),
        "read_back":true});
    Ok(result)
}
