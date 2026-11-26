//! 草稿固定基础文件与分片共用严格反序列化，不能因其不是条目清单而漏检。

use super::{WorldError, invalid, parse};

pub(super) const FILES: &[&str] = &[
    "rules.toml",
    "captain.toml",
    "caravans.toml",
    "futures.toml",
    "events.toml",
    "mates.toml",
    "effects.toml",
    "runtime_links.toml",
];

pub(super) fn validate(file: &str, text: &str) -> Result<(), WorldError> {
    match file.rsplit('/').next().unwrap_or_default() {
        "rules.toml" => {
            parse::<crate::raw::RulesFile>(file, text)?;
        }
        "captain.toml" => {
            parse::<crate::convert::captain::CaptainFile>(file, text)?;
        }
        "caravans.toml" => {
            parse::<crate::raw::CaravansFile>(file, text)?;
        }
        "futures.toml" => {
            parse::<crate::raw::FuturesFile>(file, text)?;
        }
        "events.toml" => {
            parse::<crate::raw::EventsFile>(file, text)?;
        }
        "mates.toml" => {
            parse::<crate::raw::MatesFile>(file, text)?;
        }
        "effects.toml" => {
            parse::<crate::convert::effects::EffectsFile>(file, text)?;
        }
        "runtime_links.toml" => {
            crate::convert::cast::validate_pending_text(text).map_err(|e| invalid(file, e))?;
        }
        _ => return Err(invalid(file, "未知基础配置")),
    }
    Ok(())
}
