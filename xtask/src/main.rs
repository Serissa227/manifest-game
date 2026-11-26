//! Manifest 任务脚本。
//!
//! `cargo xtask verify` 保留原有 11 项检查，追加 E73 资源检查，
//! 每项打印 `[PASS] 名称`、`[FAIL] 名称` 或 `[SKIP] 名称`，最后打印 `通过数/总数`；
//! 全部通过时末行打印 `ALL CHECKS PASSED` 并以 0 退出。
//!
//! `cargo xtask worldgen` 按 `data/world/layout.toml` 生成世界地理图层（见 worldgen 模块）。

mod assets;
mod mapgen;
mod scan;
mod worldgen;

use anyhow::{Context, Result, bail};
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::Instant;

/// manifest-cli 子命令尚未实现时的退出码（与 manifest-cli 约定一致）。
const EXIT_NOT_IMPLEMENTED: i32 = 64;

/// 失败时打印的输出尾部行数。
const FAIL_TAIL_LINES: usize = 80;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Pass,
    Fail,
    Skip,
}

struct Outcome {
    status: Status,
    /// 附加说明（耗时、跳过原因等）
    note: String,
    /// 失败时展示的输出
    detail: String,
}

impl Outcome {
    fn pass(note: impl Into<String>) -> Self {
        Self { status: Status::Pass, note: note.into(), detail: String::new() }
    }
    fn fail(note: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { status: Status::Fail, note: note.into(), detail: detail.into() }
    }
    fn skip(note: impl Into<String>) -> Self {
        Self { status: Status::Skip, note: note.into(), detail: String::new() }
    }
}

struct Ctx {
    root: PathBuf,
    path_env: Option<OsString>,
}

impl Ctx {
    fn new() -> Result<Self> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().context("无法定位工作区根目录")?.to_path_buf();
        // Windows GNU 工具链下，Tauri 的资源编译需要 windres；若仓库内带有
        // w64devkit，则把它加到子进程 PATH 的最前面。
        let tools = root.join(".tools").join("w64devkit").join("bin");
        let path_env = if tools.is_dir() {
            let mut paths = vec![tools];
            if let Some(existing) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&existing));
            }
            Some(std::env::join_paths(paths).context("拼接 PATH 失败")?)
        } else {
            None
        };
        Ok(Self { root, path_env })
    }

    fn cargo(&self) -> Command {
        let cargo = std::env::var_os("CARGO").unwrap_or_else(|| OsString::from("cargo"));
        self.command(cargo)
    }

    fn npm(&self) -> Command {
        let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
        let mut cmd = self.command(OsString::from(npm));
        cmd.current_dir(self.root.join("frontend"));
        cmd
    }

    /// 检查 5–8 用的 release 版 manifest-cli：与 `cargo build` 放在同一个编译目录
    /// （设置了 `CARGO_TARGET_DIR` 时用它，相对路径按仓库根目录解释；否则是仓库下的 target/）。
    fn cli_binary(&self) -> PathBuf {
        let exe = if cfg!(windows) { "manifest-cli.exe" } else { "manifest-cli" };
        let target = match std::env::var_os("CARGO_TARGET_DIR").filter(|v| !v.is_empty()) {
            Some(dir) => {
                let dir = PathBuf::from(dir);
                if dir.is_absolute() { dir } else { self.root.join(dir) }
            }
            None => self.root.join("target"),
        };
        target.join("release").join(exe)
    }

    fn command(&self, program: impl Into<OsString>) -> Command {
        let mut cmd = Command::new(program.into());
        cmd.current_dir(&self.root);
        if let Some(path) = &self.path_env {
            cmd.env("PATH", path);
        }
        cmd
    }
}

/// 运行子进程，合并捕获 stdout 与 stderr。
struct RunResult {
    code: Option<i32>,
    output: String,
}

impl RunResult {
    fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

fn run(mut cmd: Command) -> Result<RunResult> {
    cmd.stdin(Stdio::null());
    let out = cmd.output().with_context(|| format!("无法启动命令：{cmd:?}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&err);
    }
    Ok(RunResult { code: out.status.code(), output: text })
}

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

fn describe(cmd_line: &str, res: &RunResult) -> String {
    format!("$ {cmd_line}\n（退出码 {:?}）\n{}", res.code, tail(&res.output, FAIL_TAIL_LINES))
}

// ───────────────────────────── 各项检查 ─────────────────────────────

fn check_fmt(ctx: &Ctx) -> Result<Outcome> {
    let mut cmd = ctx.cargo();
    cmd.args(["fmt", "--all", "--", "--check"]);
    let res = run(cmd)?;
    Ok(if res.ok() {
        Outcome::pass("")
    } else {
        Outcome::fail("存在未格式化的代码", describe("cargo fmt --all -- --check", &res))
    })
}

fn check_clippy(ctx: &Ctx) -> Result<Outcome> {
    let mut cmd = ctx.cargo();
    cmd.args(["clippy", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"]);
    let res = run(cmd)?;
    Ok(if res.ok() {
        Outcome::pass("")
    } else {
        Outcome::fail(
            "clippy 报告警告或错误",
            describe("cargo clippy --workspace --all-targets --all-features -- -D warnings", &res),
        )
    })
}

fn check_test(ctx: &Ctx) -> Result<Outcome> {
    let mut cmd = ctx.cargo();
    cmd.args(["test", "--workspace", "--all-features"]);
    let res = run(cmd)?;
    let summary = test_summary(&res.output);
    Ok(if res.ok() {
        Outcome::pass(summary)
    } else {
        Outcome::fail(summary, describe("cargo test --workspace --all-features", &res))
    })
}

/// 汇总 cargo test 输出中的通过 / 失败 / 忽略数量。
fn test_summary(output: &str) -> String {
    let (mut passed, mut failed, mut ignored) = (0u64, 0u64, 0u64);
    for line in output.lines() {
        let Some(rest) = line.trim().strip_prefix("test result: ") else {
            continue;
        };
        // 形如 "ok. 12 passed; 0 failed; 0 ignored; ..."
        let rest = rest.trim_start_matches("ok.").trim_start_matches("FAILED.");
        for part in rest.split(';') {
            let mut it = part.split_whitespace();
            let (Some(num), Some(label)) = (it.next(), it.next()) else {
                continue;
            };
            let n: u64 = num.parse().unwrap_or(0);
            match label {
                "passed" => passed += n,
                "failed" => failed += n,
                "ignored" => ignored += n,
                _ => {}
            }
        }
    }
    format!("{passed} 通过，{failed} 失败，{ignored} 忽略")
}

fn check_forbidden(ctx: &Ctx) -> Result<Outcome> {
    let mut problems = scan::scan_sources(&ctx.root)?;
    problems.extend(core_dependency_problems(ctx)?);
    Ok(if problems.is_empty() {
        Outcome::pass("")
    } else {
        let n = problems.len();
        Outcome::fail(format!("发现 {n} 处违规"), problems.join("\n"))
    })
}

/// 禁止出现在 manifest-core 依赖树（普通依赖，含传递）中的 IO / async / 系统时间类 crate。
const CORE_DENIED_CRATES: &[&str] = &[
    "tokio",
    "tokio-util",
    "tokio-stream",
    "reqwest",
    "hyper",
    "hyper-util",
    "h2",
    "mio",
    "async-std",
    "async-io",
    "async-trait",
    "async-channel",
    "smol",
    "futures",
    "futures-util",
    "futures-core",
    "futures-executor",
    "futures-io",
    "ureq",
    "surf",
    "isahc",
    "curl",
    "socket2",
    "tempfile",
    "walkdir",
    "notify",
    "memmap2",
    "chrono",
    "time",
    "keyring",
    "wiremock",
];

fn core_dependency_problems(ctx: &Ctx) -> Result<Vec<String>> {
    let mut cmd = ctx.cargo();
    cmd.args(["metadata", "--format-version", "1", "--locked"]);
    let res = run(cmd)?;
    if !res.ok() {
        // --locked 失败时退回普通模式（首次运行尚无 Cargo.lock）
        let mut cmd = ctx.cargo();
        cmd.args(["metadata", "--format-version", "1"]);
        let res2 = run(cmd)?;
        if !res2.ok() {
            bail!("cargo metadata 失败：\n{}", tail(&res2.output, 20));
        }
        return core_dependency_problems_from(&res2.output);
    }
    core_dependency_problems_from(&res.output)
}

fn core_dependency_problems_from(output: &str) -> Result<Vec<String>> {
    // cargo metadata 的 JSON 在 stdout；stderr 可能混入警告，取第一个 '{' 开始的一行
    let json_line = output.lines().find(|l| l.trim_start().starts_with('{')).context("cargo metadata 没有输出 JSON")?;
    let meta: serde_json::Value = serde_json::from_str(json_line).context("解析 cargo metadata 失败")?;
    let packages = meta["packages"].as_array().context("metadata 缺少 packages")?;
    let name_of = |id: &str| -> String {
        packages
            .iter()
            .find(|p| p["id"].as_str() == Some(id))
            .and_then(|p| p["name"].as_str())
            .unwrap_or(id)
            .to_string()
    };
    let core_id = packages
        .iter()
        .find(|p| p["name"].as_str() == Some("manifest-core"))
        .and_then(|p| p["id"].as_str())
        .context("找不到 manifest-core")?
        .to_string();
    let nodes = meta["resolve"]["nodes"].as_array().context("metadata 缺少 resolve.nodes")?;
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut stack = vec![core_id];
    let mut names: BTreeSet<String> = BTreeSet::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        let Some(node) = nodes.iter().find(|n| n["id"].as_str() == Some(id.as_str())) else {
            continue;
        };
        for dep in node["deps"].as_array().into_iter().flatten() {
            let normal =
                dep["dep_kinds"].as_array().map(|kinds| kinds.iter().any(|k| k["kind"].is_null())).unwrap_or(false);
            if !normal {
                continue;
            }
            if let Some(pkg) = dep["pkg"].as_str() {
                names.insert(name_of(pkg));
                stack.push(pkg.to_string());
            }
        }
    }
    Ok(names
        .iter()
        .filter(|n| CORE_DENIED_CRATES.contains(&n.as_str()))
        .map(|n| format!("manifest-core 的依赖树中出现禁止的 IO/async crate：{n}"))
        .collect())
}

/// 构建 release 版 manifest-cli（检查 5–8 共用）。
fn build_cli(ctx: &Ctx) -> Result<Option<String>> {
    let mut cmd = ctx.cargo();
    cmd.args(["build", "--release", "-p", "manifest-cli"]);
    let res = run(cmd)?;
    Ok(if res.ok() { None } else { Some(describe("cargo build --release -p manifest-cli", &res)) })
}

fn run_cli(ctx: &Ctx, args: &[&str]) -> Result<(String, RunResult)> {
    let mut cmd = ctx.command(ctx.cli_binary());
    cmd.args(args);
    let line = format!("manifest-cli {}", args.join(" "));
    Ok((line, run(cmd)?))
}

fn cli_outcome(line: &str, res: &RunResult, extra: impl FnOnce(&str) -> Result<String, String>) -> Outcome {
    if res.code == Some(EXIT_NOT_IMPLEMENTED) {
        return Outcome::skip("子命令尚未实现");
    }
    if !res.ok() {
        return Outcome::fail("命令失败", describe(line, res));
    }
    if res.output.contains("panicked") {
        return Outcome::fail("输出中出现 panic", describe(line, res));
    }
    match extra(&res.output) {
        Ok(note) => Outcome::pass(note),
        Err(why) => Outcome::fail(why, describe(line, res)),
    }
}

fn check_validate_data(ctx: &Ctx, cli_err: &Option<String>) -> Result<Outcome> {
    if let Some(err) = cli_err {
        return Ok(Outcome::fail("manifest-cli 构建失败", err.clone()));
    }
    let (line, res) = run_cli(ctx, &["validate-data"])?;
    Ok(cli_outcome(&line, &res, |_| Ok(String::new())))
}

/// 校验所有具名世界（含 hidden / draft）；完整世界全检，草稿必须通过独立严格校验。
fn check_other_worlds(ctx: &Ctx, cli_err: &Option<String>) -> Result<Outcome> {
    if let Some(err) = cli_err {
        return Ok(Outcome::fail("manifest-cli 构建失败", err.clone()));
    }
    let directory = ctx.root.join("data").join("worlds");
    let mut keys = Vec::new();
    if directory.exists() {
        for entry in std::fs::read_dir(&directory)? {
            let entry = entry?;
            if entry.path().is_dir() {
                keys.push(entry.file_name().into_string().map_err(|_| anyhow::anyhow!("世界目录名不是 UTF-8"))?);
            }
        }
    }
    keys.sort();
    for key in &keys {
        let (line, res) = run_cli(ctx, &["validate-data", "--world", key])?;
        let outcome = other_world_outcome(&line, &res);
        if outcome.status != Status::Pass {
            return Ok(outcome);
        }
    }
    Ok(Outcome::pass(format!("{} 个世界：{}", keys.len(), keys.join("、"))))
}

fn other_world_outcome(line: &str, res: &RunResult) -> Outcome {
    if !res.ok() || res.output.contains("panicked") {
        Outcome::fail("世界数据校验失败", describe(line, res))
    } else if !res.output.lines().any(|l| l.starts_with("数据校验通过：") || l.starts_with("草稿数据校验通过："))
    {
        Outcome::fail("输出中没有数据校验通过结论", describe(line, res))
    } else {
        Outcome::pass("")
    }
}

fn check_simulate(ctx: &Ctx, cli_err: &Option<String>) -> Result<Outcome> {
    if let Some(err) = cli_err {
        return Ok(Outcome::fail("manifest-cli 构建失败", err.clone()));
    }
    let days = 3650u32;
    let days_arg = days.to_string();
    let (line, res) = run_cli(ctx, &["simulate", "--seed", "42", "--days", &days_arg])?;
    let expected_years = (days / 365) as usize;
    Ok(cli_outcome(&line, &res, |out| {
        let years = out.lines().filter(|l| l.starts_with("年度摘要")).count();
        if years == expected_years {
            Ok(format!("{years} 份年度摘要"))
        } else {
            Err(format!("应输出 {expected_years} 份年度摘要，实际 {years} 份"))
        }
    }))
}

fn check_replay(ctx: &Ctx, cli_err: &Option<String>) -> Result<Outcome> {
    if let Some(err) = cli_err {
        return Ok(Outcome::fail("manifest-cli 构建失败", err.clone()));
    }
    let (line, res) = run_cli(ctx, &["replay-check", "--seed", "7", "--days", "730", "--ai", "mock"])?;
    Ok(cli_outcome(&line, &res, |out| {
        if out.lines().any(|l| l.starts_with("重放一致")) {
            Ok(String::new())
        } else {
            Err("输出中没有“重放一致”结论".to_string())
        }
    }))
}

fn check_balance(ctx: &Ctx, cli_err: &Option<String>) -> Result<Outcome> {
    if let Some(err) = cli_err {
        return Ok(Outcome::fail("manifest-cli 构建失败", err.clone()));
    }
    let (line, res) = run_cli(ctx, &["balance", "--seeds", "20", "--years", "30"])?;
    Ok(cli_outcome(&line, &res, |out| {
        if out.lines().any(|l| l.starts_with("平衡检查全部通过")) {
            Ok(String::new())
        } else {
            Err("输出中没有“平衡检查全部通过”结论".to_string())
        }
    }))
}

fn check_frontend(ctx: &Ctx) -> Result<Outcome> {
    let frontend = ctx.root.join("frontend");
    if !frontend.join("package.json").is_file() {
        return Ok(Outcome::skip("frontend/package.json 不存在"));
    }
    if !frontend.join("node_modules").is_dir() {
        let has_lock = frontend.join("package-lock.json").is_file();
        let mut cmd = ctx.npm();
        cmd.arg(if has_lock { "ci" } else { "install" });
        let res = run(cmd)?;
        if !res.ok() {
            return Ok(Outcome::fail("安装前端依赖失败", describe("npm ci", &res)));
        }
    }
    for script in ["typecheck", "lint", "test", "build"] {
        let mut cmd = ctx.npm();
        cmd.args(["run", script]);
        let res = run(cmd)?;
        if !res.ok() {
            return Ok(Outcome::fail(format!("npm run {script} 失败"), describe(&format!("npm run {script}"), &res)));
        }
    }
    Ok(Outcome::pass("typecheck / lint / test / build"))
}

fn check_app_build(ctx: &Ctx) -> Result<Outcome> {
    let mut cmd = ctx.cargo();
    cmd.args(["build", "-p", "manifest-app", "--release"]);
    let res = run(cmd)?;
    Ok(if res.ok() {
        Outcome::pass("")
    } else {
        Outcome::fail("构建失败", describe("cargo build -p manifest-app --release", &res))
    })
}

// ───────────────────────────── 主流程 ─────────────────────────────

const CHECK_NAMES: [&str; 12] = [
    "cargo fmt --all -- --check",
    "cargo clippy --workspace --all-targets --all-features -- -D warnings",
    "cargo test --workspace --all-features",
    "禁用模式扫描",
    "manifest-cli validate-data",
    "manifest-cli simulate --seed 42 --days 3650",
    "manifest-cli replay-check --seed 7 --days 730 --ai mock",
    "manifest-cli balance --seeds 20 --years 30",
    "前端 typecheck / lint / test / build",
    "cargo build -p manifest-app --release",
    "其他世界的数据校验",
    "资源清单、引用、尺寸、许可与预算",
];

fn parse_only(args: &[String]) -> Result<Option<BTreeSet<usize>>> {
    let Some(pos) = args.iter().position(|a| a == "--only") else {
        return Ok(None);
    };
    let spec = args.get(pos + 1).context("--only 需要参数，例如 --only 1,2,5-7")?;
    let mut set = BTreeSet::new();
    for part in spec.split(',') {
        if let Some((a, b)) = part.split_once('-') {
            let (a, b): (usize, usize) = (a.trim().parse()?, b.trim().parse()?);
            set.extend(a..=b);
        } else {
            set.insert(part.trim().parse()?);
        }
    }
    Ok(Some(set))
}

fn verify(args: &[String]) -> Result<bool> {
    let ctx = Ctx::new()?;
    let only = parse_only(args)?;
    let selected = |n: usize| only.as_ref().is_none_or(|s| s.contains(&n));
    println!("Manifest verify（工作区：{}）", ctx.root.display());

    let total = CHECK_NAMES.len();
    let mut passed = 0usize;
    let mut cli_err: Option<Option<String>> = None;

    for (idx, name) in CHECK_NAMES.iter().enumerate() {
        let n = idx + 1;
        if !selected(n) {
            println!("[SKIP] {n}. {name}（本次未选择）");
            continue;
        }
        let started = Instant::now();
        if ((5..=8).contains(&n) || n == 11) && cli_err.is_none() {
            cli_err = Some(build_cli(&ctx)?);
        }
        let cli = cli_err.clone().unwrap_or(None);
        let outcome = match n {
            1 => check_fmt(&ctx)?,
            2 => check_clippy(&ctx)?,
            3 => check_test(&ctx)?,
            4 => check_forbidden(&ctx)?,
            5 => check_validate_data(&ctx, &cli)?,
            6 => check_simulate(&ctx, &cli)?,
            7 => check_replay(&ctx, &cli)?,
            8 => check_balance(&ctx, &cli)?,
            9 => check_frontend(&ctx)?,
            10 => check_app_build(&ctx)?,
            11 => check_other_worlds(&ctx, &cli)?,
            12 => assets::check(&ctx)?,
            _ => unreachable!("检查编号来自 CHECK_NAMES"),
        };
        let secs = started.elapsed().as_secs_f64();
        let tag = match outcome.status {
            Status::Pass => "PASS",
            Status::Fail => "FAIL",
            Status::Skip => "SKIP",
        };
        let note =
            if outcome.note.is_empty() { format!("{secs:.1}s") } else { format!("{}；{secs:.1}s", outcome.note) };
        println!("[{tag}] {n}. {name}（{note}）");
        if outcome.status == Status::Fail && !outcome.detail.is_empty() {
            for line in outcome.detail.lines() {
                println!("    │ {line}");
            }
        }
        if outcome.status == Status::Pass {
            passed += 1;
        }
    }

    println!("{passed}/{total}");
    if passed == total {
        println!("ALL CHECKS PASSED");
        Ok(true)
    } else {
        Ok(false)
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("verify") => verify(&args[1..]),
        Some("assets") => Ctx::new().and_then(|ctx| assets::run(&ctx.root, &args[1..])),
        Some("worldgen") => Ctx::new().and_then(|ctx| worldgen::run(&ctx.root, &args[1..])).map(|()| true),
        Some("mapgen") => Ctx::new().and_then(|ctx| mapgen::run(&ctx.root, &args[1..])).map(|()| true),
        _ => {
            eprintln!(
                "用法：cargo xtask verify [--only 1,2,5-7] | cargo xtask assets [--out 路径] | cargo xtask mapgen procedural|real [--config 路径] | cargo xtask worldgen [参数]"
            );
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(err) => {
            eprintln!("xtask 出错：{err:#}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_cargo_test_output() {
        let out = "test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured\n\
                   test result: FAILED. 3 passed; 2 failed; 0 ignored; 0 measured\n";
        assert_eq!(test_summary(out), "15 通过，2 失败，1 忽略");
    }

    #[test]
    fn parses_only_ranges() {
        let args = vec!["--only".to_string(), "1,3-5".to_string()];
        let set = parse_only(&args).unwrap().unwrap();
        assert_eq!(set.into_iter().collect::<Vec<_>>(), vec![1, 3, 4, 5]);
    }

    #[test]
    fn other_world_validation_never_skips_or_accepts_empty_success() {
        for code in [Some(EXIT_NOT_IMPLEMENTED), Some(1), None, Some(0)] {
            let res = RunResult { code, output: String::new() };
            assert!(other_world_outcome("validate-data --world broken", &res).status == Status::Fail);
        }
        let res = RunResult { code: Some(0), output: "数据校验通过：测试世界".into() };
        assert!(other_world_outcome("validate-data --world testbed", &res).status == Status::Pass);
        let draft = "草稿数据校验通过：terra16；不加载地图，不可开局";
        let res = RunResult { code: Some(0), output: draft.into() };
        assert!(other_world_outcome("validate-data --world terra16", &res).status == Status::Pass);
        for output in ["草稿世界，还不能加载：terra16".into(), format!("{draft}\npanicked")] {
            let res = RunResult { code: Some(0), output };
            assert!(other_world_outcome("validate-data --world terra16", &res).status == Status::Fail);
        }
    }
}
