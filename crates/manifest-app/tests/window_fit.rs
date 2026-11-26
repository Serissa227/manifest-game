//! 桌面窗口的初始大小（网页自适应，决定见 docs/DECISIONS.md“网页自适应”）：配置里的 1440 × 900 放不进显示器的工作区时缩进去，
//! 不小于最小尺寸；最小尺寸与 tauri.conf.json 一致，并且放得进常见的小笔记本（1366 × 768 开 125% 缩放）。

use manifest_app::{MIN_WINDOW, fit_window};

const DESIRED: (f64, f64) = (1440.0, 900.0);

#[test]
fn a_window_that_fits_the_work_area_is_left_alone() {
    // 1920 × 1080（100%）：任务栏以外约 1920 × 1040，再减标题栏
    assert_eq!(fit_window(DESIRED, MIN_WINDOW, (1904.0, 1001.0)), None);
    assert_eq!(fit_window(DESIRED, MIN_WINDOW, (1440.0, 900.0)), None);
}

#[test]
fn a_window_too_big_for_the_screen_shrinks_to_92_percent_of_the_work_area() {
    // 1920 × 1080 开 150%：逻辑 1280 × 720，任务栏以外约 1280 × 680，减标题栏约 1264 × 649
    assert_eq!(fit_window(DESIRED, MIN_WINDOW, (1264.0, 649.0)), Some((1163.0, 597.0)));
    // 1366 × 768 开 125%：逻辑约 1093 × 614，放得下时只缩高度
    assert_eq!(fit_window(DESIRED, MIN_WINDOW, (1077.0, 543.0)), Some((991.0, 500.0)));
    // 只有高度放不下：宽度保持
    assert_eq!(fit_window(DESIRED, MIN_WINDOW, (1904.0, 700.0)), Some((1440.0, 644.0)));
}

#[test]
fn the_window_never_shrinks_below_the_minimum() {
    let got = fit_window(DESIRED, MIN_WINDOW, (640.0, 400.0));
    assert_eq!(got, Some(MIN_WINDOW));
}

#[test]
fn the_minimum_matches_the_tauri_config_and_fits_small_laptops() {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json 是 JSON");
    let win = &conf["app"]["windows"][0];
    assert_eq!(win["minWidth"].as_f64(), Some(MIN_WINDOW.0));
    assert_eq!(win["minHeight"].as_f64(), Some(MIN_WINDOW.1));
    assert_eq!(win["center"].as_bool(), Some(true));
    // 1366 × 768 开 125%（逻辑约 1093 × 614，任务栏以外约 1093 × 574，减标题栏约 1077 × 543）放得下最小尺寸
    assert!(MIN_WINDOW.0 <= 1077.0 && MIN_WINDOW.1 <= 543.0);
}
