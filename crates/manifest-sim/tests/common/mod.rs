//! 集成测试共用：只加载一次 data/。

#![allow(dead_code)]

pub mod f9;
use manifest_core::StaticData;
use std::sync::{Arc, OnceLock};

pub fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"))).clone()
}

pub fn ai_content() -> Arc<manifest_data::AiContent> {
    static CONTENT: OnceLock<Arc<manifest_data::AiContent>> = OnceLock::new();
    CONTENT
        .get_or_init(|| {
            let dir = manifest_data::find_data_dir().unwrap_or_else(|| panic!("找不到 data/"));
            Arc::new(manifest_data::load_ai_content(&dir).unwrap_or_else(|e| panic!("{e}")))
        })
        .clone()
}
