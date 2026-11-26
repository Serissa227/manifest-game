//! 后端显示文字：`data/texts.toml`（中文）与 `data/locales/<语言>/texts.toml`（键一一对应）。

use super::overrides::Missing;
use super::source::Source;
use crate::DataIssue;
use crate::ai_content::placeholders;
use manifest_core::error::{ERROR_CODES, REASON_CODES};
use std::collections::BTreeMap;

pub(crate) const ZH_FILE: &str = "texts.toml";

/// 一条文字：单个字符串或字符串列表（如季节、月名）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextValue {
    One(String),
    Many(Vec<String>),
}

/// 后端显示文字：键为“小节.键”（如 `terms.player`、`reasons.colony.busy`）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Texts {
    map: BTreeMap<String, TextValue>,
}

impl Texts {
    pub fn get(&self, key: &str) -> Option<&str> {
        match self.map.get(key)? {
            TextValue::One(s) => Some(s),
            TextValue::Many(_) => None,
        }
    }

    pub fn list(&self, key: &str) -> Option<&[String]> {
        match self.map.get(key)? {
            TextValue::Many(v) => Some(v),
            TextValue::One(_) => None,
        }
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.map.keys().map(String::as_str)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// 已登记却尚无中文正文的原因码；仅供校验提醒，不构成数据错误。
    pub fn placeholder_reasons(&self) -> Vec<&'static str> {
        let mut codes: Vec<_> = REASON_CODES
            .iter()
            .filter_map(|(code, _)| {
                self.get(&format!("reasons.{code}"))
                    .is_some_and(|text| matches!(text.trim(), "（待写）" | "(待写)" | "待写"))
                    .then_some(*code)
            })
            .collect();
        codes.sort_unstable();
        codes
    }

    /// 以 `other` 覆盖（缺失的键保留原值）。
    pub(crate) fn overlaid(&self, other: &Texts) -> Texts {
        let mut map = self.map.clone();
        for (k, v) in &other.map {
            map.insert(k.clone(), v.clone());
        }
        Texts { map }
    }
}

/// 允许为空的键（连接符）。
fn may_be_empty(key: &str) -> bool {
    key.ends_with("_sep")
}

/// 某条文字已知的全部参数（中文模板不一定都用到）。
fn known_vars(key: &str) -> &'static [&'static str] {
    if key == "calendar.date" {
        return &["era", "year", "month", "month_name", "day", "season"];
    }
    if key == "errors.rule" || key == "errors.range" {
        return &["reason"];
    }
    if let Some(code) = key.strip_prefix("reasons.") {
        return REASON_CODES.iter().find(|(c, _)| *c == code).map(|(_, a)| *a).unwrap_or(&[]);
    }
    if let Some(code) = key.strip_prefix("errors.") {
        return ERROR_CODES.iter().find(|(c, _)| *c == code).map(|(_, a)| *a).unwrap_or(&[]);
    }
    &[]
}

/// 把 TOML 表展开为“小节.键”。
fn flatten(file: &str, table: &toml::Table, issues: &mut Vec<DataIssue>) -> BTreeMap<String, TextValue> {
    let mut out = BTreeMap::new();
    for (section, v) in table {
        let Some(t) = v.as_table() else {
            issues.push(DataIssue {
                file: file.into(), item: section.clone(), message: "应为一个小节（表）".into()
            });
            continue;
        };
        for (k, v) in t {
            let key = format!("{section}.{k}");
            let value = match v {
                toml::Value::String(s) => TextValue::One(s.clone()),
                toml::Value::Array(items) => {
                    let list: Option<Vec<String>> = items.iter().map(|x| x.as_str().map(str::to_string)).collect();
                    match list {
                        Some(l) => TextValue::Many(l),
                        None => {
                            issues.push(DataIssue {
                                file: file.into(), item: key, message: "列表中只能是文字".into()
                            });
                            continue;
                        }
                    }
                }
                _ => {
                    issues.push(DataIssue {
                        file: file.into(), item: key, message: "应为文字或文字列表".into()
                    });
                    continue;
                }
            };
            let empty = match &value {
                TextValue::One(s) => s.trim().is_empty(),
                TextValue::Many(l) => l.is_empty() || l.iter().any(|s| s.trim().is_empty()),
            };
            if empty && !may_be_empty(&key) {
                issues.push(DataIssue { file: file.into(), item: key.clone(), message: "不能为空".into() });
            }
            out.insert(key, value);
        }
    }
    out
}

fn read_table(path: &Source<'_>, file: &str, issues: &mut Vec<DataIssue>) -> Option<toml::Table> {
    let text = match path.read() {
        Ok(t) => t,
        Err(e) => {
            issues.push(DataIssue {
                file: file.into(), item: String::new(), message: format!("无法读取文件：{e}")
            });
            return None;
        }
    };
    match text.parse::<toml::Table>() {
        Ok(t) => Some(t),
        Err(e) => {
            issues.push(DataIssue {
                file: file.into(),
                item: String::new(),
                message: format!("TOML 格式错误：{}", e.to_string().trim()),
            });
            None
        }
    }
}

/// 读取中文 `data/texts.toml`，并核对：错误码与效果说明的键与内核一致、参数名合法。
/// 有问题时记入 `issues`，仍返回已读到的文字（宽松加载用）；文件读不了时返回 None。
pub(crate) fn load_zh(dir: &Source<'_>, issues: &mut Vec<DataIssue>) -> Option<Texts> {
    let table = read_table(&dir.join(ZH_FILE), ZH_FILE, issues)?;
    let map = flatten(ZH_FILE, &table, issues);
    let texts = Texts { map };
    let mut need = |key: String, allowed: Option<&[&str]>| match texts.map.get(&key) {
        None => issues.push(DataIssue { file: ZH_FILE.into(), item: key, message: "缺少这一条".into() }),
        Some(TextValue::One(s)) => {
            if let Some(allowed) = allowed {
                for p in placeholders(s) {
                    if !allowed.contains(&p.as_str()) {
                        issues.push(DataIssue {
                            file: ZH_FILE.into(),
                            item: key.clone(),
                            message: format!("使用了不存在的参数 {{{p}}}（可用：{}）", allowed.join("、")),
                        });
                    }
                }
            }
        }
        Some(TextValue::Many(_)) => {
            issues.push(DataIssue { file: ZH_FILE.into(), item: key, message: "应为文字".into() })
        }
    };
    for (code, args) in REASON_CODES {
        need(format!("reasons.{code}"), Some(*args));
    }
    for (code, args) in ERROR_CODES {
        need(format!("errors.{code}"), Some(*args));
    }
    need("errors.rule".into(), Some(&["reason"]));
    need("errors.range".into(), Some(&["reason"]));
    for (key, _) in manifest_core::summary::HINTS {
        need(format!("hints.{key}"), Some(&[]));
    }
    for key in ["player", "nobody", "quiet_year", "list_sep", "part_sep", "peace", "tension", "war", "truce"] {
        need(format!("terms.{key}"), Some(&[]));
    }
    need("terms.pair".into(), Some(&["a", "b"]));
    need("calendar.date".into(), Some(&["era", "year", "month", "month_name", "day", "season"]));
    need("calendar.year".into(), Some(&["year"]));
    for (key, n) in [("calendar.seasons", 4), ("calendar.months", 12)] {
        if texts.list(key).is_none_or(|l| l.len() != n) {
            issues.push(DataIssue {
                file: ZH_FILE.into(), item: key.into(), message: format!("应为 {n} 项的列表")
            });
        }
    }
    // 各条多余的键不报错：翻译时照抄即可
    let codes: Vec<String> = REASON_CODES.iter().map(|(c, _)| format!("reasons.{c}")).collect();
    for k in texts.map.keys().filter(|k| k.starts_with("reasons.")) {
        if !codes.contains(k) {
            issues.push(DataIssue {
                file: ZH_FILE.into(),
                item: k.clone(),
                message: "内核没有这个错误码（见 manifest-core error.rs 的 REASON_CODES）".into(),
            });
        }
    }
    Some(texts)
}

/// 读取某语言的 `texts.toml`：键必须在中文里存在，参数只能用中文模板里出现过的参数；列表项数一致。
/// 返回覆盖后的文字（缺失的键回退到中文）并记下缺失的键。
pub(crate) fn load_overlay(
    path: &Source<'_>,
    file: &str,
    zh: &Texts,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) -> Texts {
    if !path.is_file() {
        missing.extend(zh.keys().map(|k| Missing { file: file.to_string(), item: k.to_string() }));
        return zh.clone();
    }
    let Some(table) = read_table(path, file, issues) else { return zh.clone() };
    let map = flatten(file, &table, issues);
    for (k, v) in &map {
        match (zh.map.get(k), v) {
            (None, _) => issues.push(DataIssue {
                file: file.into(),
                item: k.clone(),
                message: format!("中文 data/{ZH_FILE} 中没有这一条"),
            }),
            (Some(TextValue::One(z)), TextValue::One(s)) => {
                // 可用参数：中文模板里出现的参数，加上这一条已知的全部参数（译文可以用中文没用到的参数）
                let mut allowed = placeholders(z);
                allowed.extend(known_vars(k).iter().map(|v| v.to_string()));
                for p in placeholders(s) {
                    if !allowed.contains(&p) {
                        issues.push(DataIssue {
                            file: file.into(),
                            item: k.clone(),
                            message: format!("使用了中文模板里没有的参数 {{{p}}}"),
                        });
                    }
                }
            }
            (Some(TextValue::Many(z)), TextValue::Many(s)) => {
                if z.len() != s.len() {
                    issues.push(DataIssue {
                        file: file.into(),
                        item: k.clone(),
                        message: format!("列表应有 {} 项（与中文一致），实际 {} 项", z.len(), s.len()),
                    });
                }
            }
            _ => issues.push(DataIssue {
                file: file.into(),
                item: k.clone(),
                message: "类型与中文不一致（文字 / 列表）".into(),
            }),
        }
    }
    for k in zh.keys() {
        if !map.contains_key(k) {
            missing.push(Missing { file: file.to_string(), item: k.to_string() });
        }
    }
    zh.overlaid(&Texts { map })
}
