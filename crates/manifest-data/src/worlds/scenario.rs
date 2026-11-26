//! 剧本日期与开局选项：目录和完整加载共用同一份解析结果。

use super::{EffectiveWorld, WorldError, invalid, parse};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ScenarioCustom {
    pub templates: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScenarioInfo {
    pub key: String,
    pub name: String,
    pub description: String,
    pub start_loc: String,
    pub start_date: Option<[u32; 3]>,
    pub control_date: Option<[u32; 3]>,
    pub protagonists: Vec<String>,
    pub custom: ScenarioCustom,
    pub upbringing: bool,
    pub timeline: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Start {
    Location(String),
    Date([u32; 3]),
}

#[derive(Deserialize)]
struct Header {
    key: String,
    name: String,
    #[serde(default)]
    description: String,
    start: Option<Start>,
    start_date: Option<[u32; 3]>,
    start_loc: Option<String>,
    start_port: Option<String>,
    control: Option<[u32; 3]>,
    control_date: Option<[u32; 3]>,
    #[serde(default)]
    protagonists: Vec<String>,
    #[serde(default)]
    custom: ScenarioCustom,
    #[serde(default)]
    upbringing: bool,
    timeline: Option<String>,
}

impl EffectiveWorld {
    pub fn scenarios(&self) -> Result<Vec<ScenarioInfo>, WorldError> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        for file in self.files_in("scenarios") {
            let (info, _) = self.scenario_file(&file)?;
            if !seen.insert(info.key.clone()) {
                return Err(WorldError::DuplicateKey { file, key: info.key });
            }
            result.push(info);
        }
        Ok(result)
    }

    pub(crate) fn scenario_file(&self, file: &str) -> Result<(ScenarioInfo, String), WorldError> {
        let text = self.read(file)?;
        let h: Header = parse(file, &text)?;
        let (legacy_loc, legacy_date) = match h.start {
            Some(Start::Location(loc)) => (Some(loc), None),
            Some(Start::Date(date)) => (None, Some(date)),
            None => (None, None),
        };
        let mut locations = [legacy_loc, h.start_loc, h.start_port].into_iter().flatten();
        let start_loc = locations
            .next()
            .ok_or_else(|| invalid(file, "必须明确提供 start_loc 或 start_port（旧格式可用 start）"))?;
        if locations.any(|loc| loc != start_loc) {
            return Err(invalid(file, "start、start_loc、start_port 指向不同地点"));
        }
        if legacy_date.zip(h.start_date).is_some_and(|(a, b)| a != b) {
            return Err(invalid(file, "start 与 start_date 日期冲突"));
        }
        if h.control.zip(h.control_date).is_some_and(|(a, b)| a != b) {
            return Err(invalid(file, "control 与 control_date 日期冲突"));
        }
        let start_date = h.start_date.or(legacy_date);
        let control = h.control_date.or(h.control);
        if start_loc.trim().is_empty() {
            return Err(invalid(file, "start_loc 不能为空"));
        }
        for date in [start_date, control].into_iter().flatten() {
            self.manifest
                .calendar
                .day_of(manifest_core::calendar::Date { year: date[0], month: date[1], day: date[2] })
                .map_err(|e| invalid(file, e.to_string()))?;
        }
        if control.is_some() && start_date.is_none() {
            return Err(invalid(file, "control_date 必须与 start_date 一起提供"));
        }
        if start_date.zip(control).is_some_and(|(start, control)| control < start) {
            return Err(invalid(file, "control 不能早于 start"));
        }
        let info = ScenarioInfo {
            key: h.key,
            name: h.name,
            description: h.description,
            start_loc: start_loc.clone(),
            start_date,
            control_date: control.or(start_date),
            protagonists: h.protagonists,
            custom: h.custom,
            upbringing: h.upbringing,
            timeline: h.timeline,
        };
        let mut value: toml::Table = parse(file, &text)?;
        let mut changed = start_date.is_some();
        for key in [
            "start_loc",
            "start_port",
            "start_date",
            "control",
            "control_date",
            "protagonists",
            "custom",
            "upbringing",
            "timeline",
        ] {
            changed |= value.remove(key).is_some();
        }
        let legacy = if changed {
            value.insert("start".into(), start_loc.into());
            toml::to_string(&value).map_err(|e| invalid(file, e.to_string()))?
        } else {
            text
        };
        Ok((info, legacy))
    }
}
