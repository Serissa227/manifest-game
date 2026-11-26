//! E73 资源审计：与运行时 P02 清单相互独立，检查源资源与数据引用。

use crate::{Ctx, Outcome};
use anyhow::{Context, Result};
use manifest_data::assets::check_repository;
use std::path::Path;

pub(super) fn check(ctx: &Ctx) -> Result<Outcome> {
    let (_, report) = check_repository(&ctx.root)?;
    let fallback = report.fallbacks.values().map(Vec::len).sum::<usize>();
    let note = format!("{} 个文件，{fallback} 个回退键", report.files.len());
    for (world, keys) in &report.fallbacks {
        println!("资源回退 {world}（{}）：{}", keys.len(), keys.join("、"));
    }
    for (name, bytes) in &report.budget_bytes {
        println!("资源体积 {name}：{bytes} 字节");
    }
    Ok(if report.issues.is_empty() { Outcome::pass(note) } else { Outcome::fail(note, report.issues.join("\n")) })
}

pub(super) fn run(root: &Path, args: &[String]) -> Result<bool> {
    let (manifest, report) = check_repository(root)?;
    let output = serde_json::to_string_pretty(&serde_json::json!({ "manifest": manifest, "report": report }))?;
    if let [flag, path] = args
        && flag == "--out"
    {
        std::fs::write(path, &output).with_context(|| format!("无法写入 {path}"))?;
    } else if args.is_empty() {
        println!("{output}");
    } else {
        anyhow::bail!("用法：cargo xtask assets [--out 路径]");
    }
    Ok(report.issues.is_empty())
}
