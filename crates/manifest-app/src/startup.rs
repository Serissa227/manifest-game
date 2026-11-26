//! 桌面实机检查的目录隔离与 WebView2 调试开关。

use std::path::PathBuf;
use tauri::{Manager, utils::config::WindowConfig};

// 与锁定的 wry 0.55.1 默认参数一致；自定义参数会替换它们，需连同自动播放参数保留。
const DEFAULT_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
    --autoplay-policy=no-user-gesture-required";

pub(super) struct StartupOptions {
    user_dir: Option<PathBuf>,
    debug_port: Option<u16>,
}

impl StartupOptions {
    pub(super) fn from_env() -> std::io::Result<Self> {
        let user_dir = std::env::var_os("MANIFEST_USER_DIR")
            .filter(|value| !value.is_empty())
            .map(|value| {
                let dir = std::path::absolute(value)?;
                std::fs::create_dir_all(&dir)?;
                Ok::<_, std::io::Error>(dir)
            })
            .transpose()?;
        let debug_port = std::env::var_os("MANIFEST_DEBUG_PORT").and_then(|value| {
            let port = value.to_str().and_then(|value| value.parse::<u16>().ok()).filter(|port| *port >= 1024);
            if port.is_none() {
                eprintln!("[manifest-app] ignoring invalid MANIFEST_DEBUG_PORT (expected integer 1024-65535)");
            }
            port
        });
        Ok(Self { user_dir, debug_port })
    }

    /// 覆盖目录存在时不调用缺省路径解析器，避免误用开发机上的目录；未覆盖时保持各类原路径。
    pub(super) fn user_directory(
        &self,
        default_dir: impl FnOnce() -> tauri::Result<PathBuf>,
    ) -> tauri::Result<PathBuf> {
        self.user_dir.clone().map_or_else(default_dir, Ok)
    }

    /// 参数必须在 WebView 创建前配置；覆盖资料目录时改为在 setup 中手动创建原本自动创建的窗口。
    pub(super) fn prepare_windows(&self, config: &mut tauri::Config) -> Vec<WindowConfig> {
        let mut windows = Vec::new();
        for window in &mut config.app.windows {
            if let Some(port) = self.debug_port {
                let args = window.additional_browser_args.get_or_insert_with(|| DEFAULT_BROWSER_ARGS.to_owned());
                args.push_str(&format!(" --remote-debugging-port={port}"));
            }
            if self.user_dir.is_some() && window.create {
                let mut manual_window = window.clone();
                // 配置文件的 data_directory 按系统目录解析；下方构建器直接接收统一解析后的绝对路径。
                manual_window.data_directory = None;
                windows.push(manual_window);
                window.create = false;
            }
        }
        windows
    }

    pub(super) fn create_windows(&self, app: &tauri::App, windows: Vec<WindowConfig>) -> tauri::Result<()> {
        for window in windows {
            let data_dir = self.user_directory(|| app.path().app_local_data_dir())?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?.data_directory(data_dir).build()?;
        }
        Ok(())
    }
}
