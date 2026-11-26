//! L01 的清单工具；所有显示 schema、哈希和校验都在 manifest-data 中。
use anyhow::{Context, Result, bail};
use manifest_core::StaticData;
use manifest_data::{Locale, LocaleBundle, locale::variant};
use std::{path::Path, sync::Arc};

pub(super) fn display(root: &Path, key: &str, locale: Locale, defs: &Arc<StaticData>) -> Result<LocaleBundle> {
    let world = manifest_data::resolve_world(root, key)?;
    let ai = manifest_data::ai_content::load_world_ai_content(&world)?;
    Ok(manifest_data::locale::load_world_locale(&world, locale, defs, &ai))
}

pub(super) fn export(root: &Path, key: &str, locale: &str, files: &[String]) -> Result<()> {
    if Locale::parse(locale) != Some(Locale::ZhCnGemini) {
        bail!("unsupported_variant:{locale}");
    }
    let world = manifest_data::resolve_world(root, key)?;
    let defs = manifest_data::load_world(root, key)?;
    let ai = manifest_data::ai_content::load_world_ai_content(&world)?;
    let export = variant::export_world(&world, &defs, &ai, files)?;
    println!("{}", serde_json::to_string_pretty(&export)?);
    Ok(())
}

pub(super) fn import(root: &Path, key: &str, input: &Path, prune_stale: bool) -> Result<()> {
    let input: variant::Import = serde_json::from_str(&std::fs::read_to_string(input).context("read_import")?)?;
    let world = manifest_data::resolve_world(root, key)?;
    let defs = manifest_data::load_world(root, key)?;
    let ai = manifest_data::ai_content::load_world_ai_content(&world)?;
    let report = variant::import_world(&world, &defs, &ai, input, prune_stale)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    if !report.rejected.is_empty() {
        bail!("rejected_entries:{}", report.rejected.len());
    }
    Ok(())
}
