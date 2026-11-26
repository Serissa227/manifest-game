//! P11 第二阶段：`rules.toml [pacing]`（事件节奏的闸与预算）的加载、缺省与校验。
//! 寰宇显式开启；经典世界与其他数据包没有这一节，缺省关闭，行为与加这条规则之前相同。
use manifest_core::defs::PacingRules;
use std::path::{Path, PathBuf};

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

/// 复制经典世界的数据（不带 `worlds/`：这里只加载经典世界）。
fn copy_classic(from: &Path, to: &Path, top: bool) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            if !(top && e.file_name() == "worlds") {
                copy_classic(&p, &dest, false);
            }
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 在经典世界的 rules.toml 末尾接上一段再加载。
fn load_with(section: &str) -> Result<std::sync::Arc<manifest_core::StaticData>, String> {
    let tmp = tempfile::tempdir().unwrap();
    copy_classic(&data_dir(), tmp.path(), true);
    let path = tmp.path().join("rules.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("[pacing]"), "经典世界的 rules.toml 不该有 [pacing]");
    std::fs::write(&path, format!("{text}\n{section}")).unwrap();
    manifest_data::load(tmp.path()).map_err(|e| e.to_string())
}

#[test]
fn terra16_turns_the_gate_on_and_every_other_world_leaves_it_off() {
    let data = data_dir();
    let terra = manifest_data::load_world(&data, "terra16").unwrap();
    // 数值的来历见 docs/BALANCE.md（2026-11-10 · P11）。
    assert_eq!(
        terra.rules.pacing,
        PacingRules { enabled: true, daily: 2, window_days: 7, window_soft: 3, max_defer_days: 10 }
    );
    let worlds = manifest_data::list_worlds(&data).unwrap();
    assert!(worlds.iter().any(|w| w.key == "terra16") && worlds.len() >= 2, "{:?}", worlds.len());
    for key in worlds.iter().map(|w| w.key.as_str()).chain(["classic", "testbed"]).filter(|key| *key != "terra16") {
        let defs = manifest_data::load_world(&data, key).unwrap();
        assert_eq!(defs.rules.pacing, PacingRules::default(), "{key}");
        assert!(!defs.rules.pacing.enabled, "{key}");
    }
}

#[test]
fn the_pacing_section_fills_in_defaults_and_rejects_nonsense() {
    let off = PacingRules::default();
    assert_eq!((off.enabled, off.daily, off.window_days, off.window_soft, off.max_defer_days), (false, 2, 7, 3, 10));
    // 没有这一节：缺省关闭。
    assert_eq!(load_with("").unwrap().rules.pacing, off);
    // 只写开关：数值取缺省。
    let on = load_with("[pacing]\nenabled = true\n").unwrap();
    assert_eq!(on.rules.pacing, PacingRules { enabled: true, ..PacingRules::default() });
    // 全部写明。
    let custom =
        load_with("[pacing]\nenabled = true\ndaily = 1\nwindow_days = 14\nwindow_soft = 5\nmax_defer_days = 21\n")
            .unwrap();
    assert_eq!(
        custom.rules.pacing,
        PacingRules { enabled: true, daily: 1, window_days: 14, window_soft: 5, max_defer_days: 21 }
    );
    // 开着的时候上限不能是 0，错误说得出是哪个文件的哪一项；关着的时候不看数值。
    for field in ["daily", "window_days", "window_soft"] {
        let e = load_with(&format!("[pacing]\nenabled = true\n{field} = 0\n")).unwrap_err();
        assert!(e.contains("rules.toml") && e.contains(&format!("pacing.{field}")), "{field}：{e}");
    }
    assert!(load_with("[pacing]\nenabled = true\nmax_defer_days = 0\n").is_ok());
    assert!(load_with("[pacing]\nenabled = false\ndaily = 0\nwindow_days = 0\nwindow_soft = 0\n").is_ok());
    // 不认识的字段照旧拒绝。
    let e = load_with("[pacing]\nenabled = true\nweekly = 3\n").unwrap_err();
    assert!(e.contains("rules.toml") && e.contains("weekly"), "{e}");
}
