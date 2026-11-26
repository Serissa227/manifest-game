//! 构建脚本：保证前端产物目录存在后交给 tauri-build。
//!
//! `tauri::generate_context!` 在编译期读取 `frontendDist`。前端尚未构建时
//! （例如全新克隆后直接 `cargo test`），写入一个占位页，避免编译失败；
//! `npm run build` 会用真正的产物覆盖它。

use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let dist = manifest_dir.join("..").join("..").join("frontend").join("dist");
    let index = dist.join("index.html");
    if !index.exists() {
        let _ = std::fs::create_dir_all(&dist);
        let _ = std::fs::write(
            &index,
            "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>Manifest</title>\
             <body>前端尚未构建：请在 frontend/ 下运行 npm run build。</body></html>",
        );
    }
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build();

    // Windows：tauri-build 只把含 Common Controls v6 清单的资源链接进可执行目标（bins）。
    // 集成测试的可执行文件同样链接 tauri，缺少该清单时会以 STATUS_ENTRYPOINT_NOT_FOUND 退出，
    // 因此把同一份资源也链接进测试目标。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
        for name in ["libresource.a", "resource.lib"] {
            let res = out.join(name);
            if res.is_file() {
                println!("cargo:rustc-link-arg-tests={}", res.display());
            }
        }
    }
}
