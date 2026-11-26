//! 输出：map.txt、relief.txt、biomes.txt、seas.txt、rivers.toml、landmarks.toml，以及给 regions.toml 补 `mark`。

use super::grid::Grid;
use super::hydro::River;
use super::seas::mark_of;
use super::terrain::Terrain;
use anyhow::{Context, Result};
use std::fmt::Write as _;
use std::path::Path;

/// 写进 landmarks.toml 的一项。
pub struct LandmarkOut {
    pub key: String,
    pub name: String,
    pub category: String,
    pub kind: String,
    pub pos: (usize, usize),
    pub size: Option<(usize, usize)>,
    pub lore: String,
    pub discovery: Option<String>,
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn grid_text(header: &[String], w: usize, h: usize, f: impl Fn(usize, usize) -> char) -> String {
    let mut s = String::new();
    for l in header {
        let _ = writeln!(s, "// {l}");
    }
    for y in 0..h {
        let row: String = (0..w).map(|x| f(x, y)).collect();
        let _ = writeln!(s, "{row}");
    }
    s
}

pub fn map_txt(t: &Terrain, header: &[String]) -> String {
    let (w, h) = (t.land.w, t.land.h);
    grid_text(header, w, h, |x, y| {
        if t.land.get(x, y) {
            '#'
        } else if t.shallow.get(x, y) {
            '~'
        } else {
            '.'
        }
    })
}

pub fn relief_txt(t: &Terrain, r: &Grid<u8>, header: &[String]) -> String {
    let (w, h) = (t.land.w, t.land.h);
    grid_text(header, w, h, |x, y| if t.land.get(x, y) { (b'0' + r.get(x, y).min(9)) as char } else { '.' })
}

pub fn biomes_txt(t: &Terrain, b: &Grid<u8>, header: &[String]) -> String {
    let (w, h) = (t.land.w, t.land.h);
    grid_text(header, w, h, |x, y| if t.land.get(x, y) { b.get(x, y) as char } else { '.' })
}

pub fn seas_txt(t: &Terrain, owner: &Grid<u16>, header: &[String]) -> String {
    let (w, h) = (t.land.w, t.land.h);
    grid_text(header, w, h, |x, y| {
        if t.land.get(x, y) {
            '#'
        } else {
            let o = owner.get(x, y);
            if o == u16::MAX { '.' } else { mark_of(o as usize) }
        }
    })
}

pub fn rivers_toml(rivers: &[River], header: &[String]) -> String {
    let mut s = String::new();
    for line in header {
        let _ = writeln!(s, "# {line}");
    }
    for r in rivers {
        let _ = write!(
            s,
            "\n[[rivers]]\nkey = \"{}\"\nname = \"{}\"\nwidth = {}\npath = [\n",
            esc(&r.key),
            esc(&r.name),
            r.width
        );
        for chunk in r.path.chunks(12) {
            let pts: Vec<String> = chunk.iter().map(|(x, y)| format!("[{x}, {y}]")).collect();
            let _ = writeln!(s, "  {},", pts.join(", "));
        }
        s.push_str("]\n");
    }
    s
}

pub fn landmarks_toml(list: &[LandmarkOut], header: &[String]) -> String {
    let mut s = String::new();
    for line in header {
        let _ = writeln!(s, "# {line}");
    }
    for m in list {
        let _ = write!(
            s,
            "\n[[landmarks]]\nkey = \"{}\"\nname = \"{}\"\ncategory = \"{}\"\nkind = \"{}\"\npos = [{}, {}]\n",
            esc(&m.key),
            esc(&m.name),
            esc(&m.category),
            esc(&m.kind),
            m.pos.0,
            m.pos.1
        );
        if let Some((w, h)) = m.size {
            let _ = writeln!(s, "size = [{w}, {h}]");
        }
        if !m.lore.is_empty() {
            let _ = writeln!(s, "lore = \"{}\"", esc(&m.lore));
        }
        if let Some(d) = &m.discovery {
            let _ = writeln!(s, "discovery = \"{}\"", esc(d));
        }
    }
    s
}

/// 读 regions.toml 的海区 key（按顺序）。
pub fn region_keys(path: &Path) -> Result<Vec<String>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("读取 {}", path.display()))?;
    let mut keys = Vec::new();
    let mut in_block = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("[[") {
            in_block = t == "[[regions]]";
            continue;
        }
        if in_block
            && let Some(rest) = t.strip_prefix("key")
            && let Some(v) = rest.trim_start().strip_prefix('=')
        {
            let v = v.trim().trim_matches('"').to_string();
            keys.push(v);
            in_block = false;
        }
    }
    Ok(keys)
}

/// 给 regions.toml 的每个海区补上（或更正）`mark = "x"`，统一写在 rect 行之后。返回是否改动。
pub fn ensure_marks(path: &Path) -> Result<bool> {
    let text = std::fs::read_to_string(path)?;
    let crlf = text.contains('\r');
    let mut out: Vec<String> = Vec::new();
    let mut block: Option<usize> = None;
    let mut count = 0usize;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("[[") {
            block = (t == "[[regions]]").then_some(count);
            if block.is_some() {
                count += 1;
            }
            out.push(line.to_string());
            continue;
        }
        if let Some(i) = block {
            if t.starts_with("mark") && t.contains('=') {
                continue;
            }
            if t.starts_with("rect") && t.contains('=') {
                out.push(line.to_string());
                out.push(format!("mark = \"{}\"", mark_of(i)));
                continue;
            }
        }
        out.push(line.to_string());
    }
    let nl = if crlf { "\r\n" } else { "\n" };
    let mut s = out.join(nl);
    s.push_str(nl);
    let changed = s != text;
    if changed {
        std::fs::write(path, s)?;
    }
    Ok(changed)
}
