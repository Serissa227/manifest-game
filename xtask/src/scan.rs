//! 禁用模式扫描（verify 第 4 项）。
//!
//! 所有模式字符串都用拼接构造，避免扫描器扫到自身源码。

use anyhow::Result;
use std::path::{Path, PathBuf};

/// 递归收集指定扩展名的文件，跳过构建产物与依赖目录。
fn collect_files(dir: &Path, exts: &[&str], out: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if matches!(name.as_str(), "target" | "node_modules" | "dist" | "gen" | ".git" | ".tools") {
                continue;
            }
            collect_files(&path, exts, out)?;
        } else if exts.iter().any(|ext| name.ends_with(ext)) {
            out.push(path);
        }
    }
    Ok(())
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).display().to_string()
}

fn is_test_path(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == "tests" || s == "benches"
    })
}

/// 去掉 `#[cfg(test)]` 修饰的条目（按花括号配对），得到非测试代码。
fn strip_cfg_test(src: &str) -> String {
    let marker = ["#[cfg(", "test)]"].concat();
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(pos) = rest.find(&marker) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos..];
        // 找到条目体的第一个 '{'，或者以 ';' 结尾的单行条目
        let brace = after.find('{');
        let semi = after.find(';');
        match (brace, semi) {
            (Some(b), Some(s)) if s < b => {
                rest = &after[s + 1..];
            }
            (Some(b), _) => {
                let bytes = after.as_bytes();
                let mut depth = 0i64;
                let mut end = after.len();
                for (i, &ch) in bytes.iter().enumerate().skip(b) {
                    if ch == b'{' {
                        depth += 1;
                    } else if ch == b'}' {
                        depth -= 1;
                        if depth == 0 {
                            end = i + 1;
                            break;
                        }
                    }
                }
                rest = &after[end..];
            }
            (None, Some(s)) => {
                rest = &after[s + 1..];
            }
            (None, None) => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// 查找作为独立单词出现的 token（前后不是标识符字符）。
fn contains_word(haystack: &str, word: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(word) {
        let i = start + pos;
        let before_ok = i == 0 || !is_ident(bytes[i - 1]);
        let j = i + word.len();
        let after_ok = j >= bytes.len() || !is_ident(bytes[j]);
        if before_ok && after_ok {
            return true;
        }
        start = i + word.len();
    }
    false
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn line_hits(src: &str, pred: impl Fn(&str) -> bool) -> Vec<usize> {
    src.lines().enumerate().filter(|(_, l)| pred(l)).map(|(i, _)| i + 1).collect()
}

pub fn scan_sources(root: &Path) -> Result<Vec<String>> {
    let mut problems = Vec::new();

    // ── Rust 源码 ──
    let mut rust_files = Vec::new();
    collect_files(&root.join("crates"), &[".rs"], &mut rust_files)?;
    collect_files(&root.join("xtask"), &[".rs"], &mut rust_files)?;

    let macro_bans = [["to", "do!"].concat(), ["unimple", "mented!"].concat(), ["db", "g!"].concat()];
    let ignore_attr = ["#[", "ignore"].concat();

    for file in &rust_files {
        let src = std::fs::read_to_string(file)?;
        let name = rel(root, file);

        // 非测试代码中不得出现 todo! / unimplemented! / dbg!
        if !is_test_path(root, file) {
            let non_test = strip_cfg_test(&src);
            for pat in &macro_bans {
                if non_test.contains(pat.as_str()) {
                    problems.push(format!("{name}：非测试代码中出现 {pat}"));
                }
            }
        }
        // 任何 Rust 测试都不得带忽略属性
        for line in line_hits(&src, |l| l.contains(ignore_attr.as_str())) {
            problems.push(format!("{name}:{line}：出现 {ignore_attr}]"));
        }
    }

    // ── manifest-core：无浮点、无 IO / async / 系统时间 / HashMap ──
    let core_dir = root.join("crates").join("manifest-core");
    let mut core_files = Vec::new();
    collect_files(&core_dir, &[".rs"], &mut core_files)?;
    let float_words = [["f", "32"].concat(), ["f", "64"].concat()];
    let core_bans = [
        ["std::", "fs"].concat(),
        ["std::", "net"].concat(),
        ["std::", "process"].concat(),
        ["std::", "time"].concat(),
        ["std::", "env"].concat(),
        ["std::", "thread"].concat(),
        ["System", "Time"].concat(),
        ["Instant", "::now"].concat(),
        ["Hash", "Map"].concat(),
        ["Hash", "Set"].concat(),
        [".aw", "ait"].concat(),
        ["print", "ln!"].concat(),
        ["eprint", "ln!"].concat(),
    ];
    let async_word = ["as", "ync"].concat();
    for file in &core_files {
        let src = std::fs::read_to_string(file)?;
        let name = rel(root, file);
        for word in &float_words {
            for line in line_hits(&src, |l| contains_word(l, word)) {
                problems.push(format!("{name}:{line}：manifest-core 中出现浮点类型 {word}"));
            }
        }
        for pat in &core_bans {
            for line in line_hits(&src, |l| l.contains(pat.as_str())) {
                problems.push(format!("{name}:{line}：manifest-core 中出现禁止的 {pat}"));
            }
        }
        for line in line_hits(&src, |l| contains_word(l, &async_word)) {
            problems.push(format!("{name}:{line}：manifest-core 中出现 {async_word}"));
        }
    }

    // ── 前端测试：不得有 .skip / .only ──
    let mut fe_files = Vec::new();
    collect_files(
        &root.join("frontend"),
        &[".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".test.js", ".test.jsx"],
        &mut fe_files,
    )?;
    let fe_bans = [[".", "skip"].concat(), [".", "only"].concat(), ["x", "it("].concat(), ["x", "describe("].concat()];
    for file in &fe_files {
        let src = std::fs::read_to_string(file)?;
        let name = rel(root, file);
        for pat in &fe_bans {
            for line in line_hits(&src, |l| l.contains(pat.as_str())) {
                problems.push(format!("{name}:{line}：前端测试中出现 {pat}"));
            }
        }
    }

    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_cfg_test_module() {
        let marker = ["#[cfg(", "test)]"].concat();
        let src = format!("fn a() {{}}\n{marker}\nmod tests {{ fn b() {{ let x = {{ 1 }}; }} }}\nfn c() {{}}\n");
        let out = strip_cfg_test(&src);
        assert!(out.contains("fn a()"));
        assert!(out.contains("fn c()"));
        assert!(!out.contains("fn b()"));
    }

    #[test]
    fn word_matching_respects_boundaries() {
        let w = ["f", "64"].concat();
        assert!(contains_word(&format!("let x: {w} = 1;"), &w));
        assert!(!contains_word(&format!("let x{w} = 1;"), &w));
        assert!(!contains_word(&format!("let {w}x = 1;"), &w));
    }
}
