//! 可按语言重新格式化的文字（EXPANSION.md §12.1）：模板位置 + 参数。
//!
//! 内核不认识任何语言，只保存结构化的引用：离线模板生成的传闻、议价回复与编年史在状态里同时保存
//! 中文原文（`text`，旧版本与命令行照常使用）和一个 [`TextRef`]；显示层按当前语言取同一位置的模板，
//! 把参数换成该语言的名字后再填写。模型写的文字没有引用，原样显示。
//!
//! 命令被拒绝的原因同样可以带错误码与参数（见 [`crate::error::Reason`]），参数类型也是 [`TextArg`]。

use crate::diplomacy::DiploStatus;
use crate::error::CommandError;
use crate::ids::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 模板中的一个参数：名字类参数只存标识，显示时按语言取名字。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextArg {
    /// 与语言无关的文字（玩家输入的名字、模型写的标题等），原样显示
    Text(String),
    /// 整数（数量、金额的数值部分；英文按千位分组）
    Int(i64),
    /// 百分比（万分之一，例如 350 表示 3.5%）
    Percent(i64),
    Loc(LocId),
    Good(GoodId),
    Faction(FactionId),
    Region(RegionId),
    Event(EventTypeId),
    Discovery(DiscoveryId),
    Ship(ShipTypeId),
    Building(ColonyBuildingId),
    Mate(MateId),
    /// 所有者：玩家商号或商会
    Owner(OwnerId),
    /// 外交状态
    Status(DiploStatus),
    /// 纪年年份（年序，从 0 开始）
    Year(u32),
    /// 纪年日期（游戏日）
    Date(u32),
    /// 两个势力（“甲与乙”）
    Pair(FactionId, FactionId),
    /// 组合事件的标题（中文原文；显示时若能找到对应的记录，换成当前语言的标题）
    Composed(String),
    /// 固定用语（见 data/texts.toml [terms]），如“诸事平稳”“无人”
    Term(String),
    /// 列表（按语言的分隔符连接）
    List(Vec<TextArg>),
}

/// 文字引用：模板位置 + 参数。
///
/// `parts` 的每一段是“模板文件.小节#序号”，例如 `rumor.price_high#2`、`chronicle.opening#0`；
/// 显示时每段取当前语言同一位置的模板、填写参数，再按语言连接（中文直接相连，英文以空格相连）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRef {
    pub parts: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, TextArg>,
}

/// 引用的规模上限（防止被篡改的命令日志塞入过大的内容）。
const MAX_PARTS: usize = 8;
const MAX_PART_CHARS: usize = 80;
const MAX_ARGS: usize = 16;
const MAX_ITEMS: usize = 64;
const MAX_TEXT_CHARS: usize = 240;

impl TextRef {
    /// 一段模板位置：`file.section#index`。
    pub fn part(file: &str, section: &str, index: usize) -> String {
        format!("{file}.{section}#{index}")
    }

    /// 拆开一段模板位置：（文件, 小节, 序号）。
    pub fn split_part(part: &str) -> Option<(&str, &str, usize)> {
        let (path, idx) = part.rsplit_once('#')?;
        let (file, section) = path.split_once('.')?;
        Some((file, section, idx.parse().ok()?))
    }

    pub fn with(mut self, name: &str, arg: TextArg) -> Self {
        self.args.insert(name.to_string(), arg);
        self
    }

    /// 校验规模与格式（内容只用于显示，不影响任何数值）。
    pub fn check(&self) -> Result<(), CommandError> {
        let bad = |why: &str| Err(CommandError::OutOfRange(format!("文字引用无效：{why}")));
        if self.parts.is_empty() || self.parts.len() > MAX_PARTS {
            return bad("段数");
        }
        if self.parts.iter().any(|p| p.chars().count() > MAX_PART_CHARS || Self::split_part(p).is_none()) {
            return bad("模板位置");
        }
        if self.args.len() > MAX_ARGS
            || self.args.keys().any(|k| k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        {
            return bad("参数名");
        }
        fn arg_ok(a: &TextArg, depth: u8) -> bool {
            match a {
                TextArg::Text(s) | TextArg::Composed(s) | TextArg::Term(s) => {
                    s.chars().count() <= MAX_TEXT_CHARS && !s.chars().any(|c| c.is_control())
                }
                TextArg::List(items) => depth == 0 && items.len() <= MAX_ITEMS && items.iter().all(|x| arg_ok(x, 1)),
                _ => true,
            }
        }
        if !self.args.values().all(|a| arg_ok(a, 0)) {
            return bad("参数内容");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_round_trip_and_limits() {
        let p = TextRef::part("rumor", "price_high", 2);
        assert_eq!(p, "rumor.price_high#2");
        assert_eq!(TextRef::split_part(&p), Some(("rumor", "price_high", 2)));
        assert_eq!(TextRef::split_part("composed.dock_fire.titles#1"), Some(("composed", "dock_fire.titles", 1)));
        assert!(TextRef::split_part("rumor#1").is_none());
        let r = TextRef { parts: vec![p], args: BTreeMap::new() }.with("loc", TextArg::Loc(LocId(1)));
        assert!(r.check().is_ok());
        assert!(TextRef::default().check().is_err(), "至少一段");
        let nested = r.clone().with("x", TextArg::List(vec![TextArg::List(vec![])]));
        assert!(nested.check().is_err(), "列表不能嵌套");
        // 旧存档没有引用：缺省为空参数
        let v: TextRef = serde_json::from_str(r#"{"parts":["chronicle.opening#0"]}"#).unwrap();
        assert!(v.args.is_empty());
    }
}
