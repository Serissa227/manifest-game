//! 解析 LLM 输出：先直接解析；失败则自动修复一次（去掉代码围栏与说明文字、截取 JSON 对象、
//! 删除尾随逗号、替换全角引号）后再解析；仍失败则放弃。

use crate::proposal::Proposal;
use manifest_data::ProposalKind;

/// 解析结果的来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseStage {
    Direct,
    Repaired,
}

/// 解析失败（附第一次与修复后的错误）。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("无法解析提案：{first}；修复后仍失败：{after_repair}")]
pub struct ParseError {
    pub first: String,
    pub after_repair: String,
}

fn parse_once(kind: ProposalKind, text: &str) -> Result<Proposal, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    Proposal::from_body(kind, value).map_err(|e| e.to_string())
}

/// 启发式修复。
pub fn repair(raw: &str) -> String {
    repair_with(raw, true)
}

/// `quotes` 为假时保留全角引号：中文对白里的“”常在字符串内部，统一替换会把合法的 JSON 改坏。
fn repair_with(raw: &str, quotes: bool) -> String {
    let mut s = raw.trim().to_string();
    // 去掉 ```json … ``` 围栏
    if let Some(start) = s.find("```") {
        let after = &s[start + 3..];
        let after = after.strip_prefix("json").unwrap_or(after);
        let body = match after.find("```") {
            Some(end) => &after[..end],
            None => after,
        };
        s = body.trim().to_string();
    }
    // 截取最外层的 JSON 对象
    if let (Some(a), Some(b)) = (s.find('{'), s.rfind('}'))
        && a < b
    {
        s = s[a..=b].to_string();
    }
    // 全角引号 → 半角（仅在结构位置常见）
    if quotes {
        s = s.replace(['“', '”'], "\"");
    }
    // 删除 `}` 或 `]` 前的尾随逗号
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut in_string = false;
    let mut escaped = false;
    for (i, &c) in chars.iter().enumerate() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == ',' {
            let next = chars[i + 1..].iter().find(|ch| !ch.is_whitespace());
            if matches!(next, Some('}') | Some(']')) {
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// 解析提案；最多修复一次：先保留全角引号修复，不行再连引号一起替换。
pub fn parse_proposal(kind: ProposalKind, raw: &str) -> Result<(Proposal, ParseStage), ParseError> {
    match parse_once(kind, raw) {
        Ok(p) => Ok((p, ParseStage::Direct)),
        Err(first) => {
            if let Ok(p) = parse_once(kind, &repair_with(raw, false)) {
                return Ok((p, ParseStage::Repaired));
            }
            match parse_once(kind, &repair(raw)) {
                Ok(p) => Ok((p, ParseStage::Repaired)),
                Err(after_repair) => Err(ParseError { first, after_repair }),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_repairs() {
        let (p, stage) = parse_proposal(ProposalKind::Rumor, r#"{"text":"听说"}"#).unwrap();
        assert_eq!(stage, ParseStage::Direct);
        assert!(matches!(p, Proposal::Rumor(_)));
        let raw = "好的，这是结果：\n```json\n{\"events\": [ {\"event\": \"festival\", \"params\": {\"loc\": \"a\",},}, ],}\n```";
        let (p, stage) = parse_proposal(ProposalKind::Director, raw).unwrap();
        assert_eq!(stage, ParseStage::Repaired);
        assert!(matches!(p, Proposal::Director(d) if d.events.len() == 1));
    }

    #[test]
    fn repair_keeps_full_width_quotes_inside_strings() {
        let raw = "好的，结果如下：
```json
{\"text\":\"他说：“风软了。”\"}
```";
        let (p, stage) = parse_proposal(ProposalKind::Rumor, raw).unwrap();
        assert_eq!(stage, ParseStage::Repaired);
        assert!(matches!(p, Proposal::Rumor(r) if r.text == "他说：“风软了。”"));
        let structural = "{“text”: “听说”}";
        assert!(
            matches!(parse_proposal(ProposalKind::Rumor, structural).unwrap().0, Proposal::Rumor(r) if r.text == "听说")
        );
    }

    #[test]
    fn rejects_garbage_and_unknown_fields() {
        assert!(parse_proposal(ProposalKind::Rumor, "not json {").is_err());
        assert!(parse_proposal(ProposalKind::Rumor, r#"{"text":"x","cash":100}"#).is_err());
        assert!(
            parse_proposal(ProposalKind::Director, r#"{"events":[{"event":"x","params":{"cash":1000000}}]}"#).is_err()
        );
    }
}
