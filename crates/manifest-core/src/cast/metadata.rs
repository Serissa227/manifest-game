//! 人物内容元数据：保留作者格式，不把未实现的条件视作无条件生效。
use super::relations::TieDef;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TieMetadata {
    pub key: String,
    pub a: String,
    pub b: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraduationCondition {
    pub graduation: bool,
    pub no_promise_with_protagonist: Vec<String>,
    #[serde(default)]
    pub flag: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeferredTie {
    pub key: String,
    pub tie: TieDef,
    pub when: GraduationCondition,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticKind {
    PendingTrack,
    WaitingA6,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CastDiagnostic {
    pub kind: DiagnosticKind,
    pub file: String,
    pub item: String,
    pub field: String,
    pub target: String,
}

/// C6 的口头禅为单句，其余话题为句组；两种作者写法均无损归一成句组。
pub(super) fn lines<'de, D: Deserializer<'de>>(deserializer: D) -> Result<BTreeMap<String, Vec<String>>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Lines {
        One(String),
        Many(Vec<String>),
    }
    BTreeMap::<String, Lines>::deserialize(deserializer).map(|map| {
        map.into_iter()
            .map(|(key, value)| {
                (
                    key,
                    match value {
                        Lines::One(s) => vec![s],
                        Lines::Many(v) => v,
                    },
                )
            })
            .collect()
    })
}
