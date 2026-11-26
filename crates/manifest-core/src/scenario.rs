//! 世界开局请求、主角身份与推演参数；展示元数据不参与年龄判定。

use crate::captain::Birthday;
use crate::defs::{ScenarioDef, StaticData};
use crate::error::CoreError;
use crate::info::InfoMode;
use serde::{Deserialize, Serialize};

pub mod templates;

pub type WorldDate = [u32; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    F,
    M,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomCaptain {
    pub name: String,
    pub look: u32,
    pub gender: Gender,
    pub birthday: [u32; 2],
}

/// I1 的 JSON 请求；未给种子时使用 42，内核不读取时钟。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewGameRequest {
    pub scenario: String,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default = "classic")]
    pub world: String,
    #[serde(default)]
    pub protagonist: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub captain: Option<CustomCaptain>,
    #[serde(default)]
    pub skip_upbringing: bool,
    #[serde(default = "yes")]
    pub history: bool,
    #[serde(default = "carried")]
    pub info: InfoMode,
}

fn classic() -> String {
    "classic".into()
}
fn yes() -> bool {
    true
}
fn carried() -> InfoMode {
    InfoMode::Carried
}

impl Default for NewGameRequest {
    fn default() -> Self {
        Self {
            scenario: String::new(),
            seed: None,
            world: classic(),
            protagonist: None,
            template: None,
            captain: None,
            skip_upbringing: false,
            history: true,
            info: carried(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapProgress {
    pub day: u32,
    pub total: u32,
}

/// 真正参与关系规则的身份，存入 WorldState；不依赖姓名、外貌或槽位元数据。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtagonistIdentity {
    pub protagonist: Option<String>,
    pub template: Option<String>,
    pub born: WorldDate,
    pub gender: Gender,
}

impl ProtagonistIdentity {
    /// 故事身份统一使用具名主角或自创模板的原始 key。
    pub fn key(&self) -> Option<&str> {
        self.protagonist.as_deref().or(self.template.as_deref())
    }

    pub fn birthday(&self) -> Birthday {
        Birthday { year: i64::from(self.born[0]), month: self.born[1], day: self.born[2] }
    }

    /// 按实际生日计周岁；出生以前返回 None。
    pub fn age_on(&self, date: WorldDate) -> Option<u32> {
        let years = date[0].checked_sub(self.born[0])?;
        years.checked_sub(u32::from(date[1..] < self.born[1..]))
    }
}

/// 开局身份、可选身世预设与公开名册；不混入人物的私密人设。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct ProtagonistDef {
    pub key: String,
    pub born: WorldDate,
    pub gender: Gender,
    #[serde(default)]
    pub captain: Option<CaptainPreset>,
    #[serde(default)]
    pub card: Option<OpeningCard>,
}

/// 模板固定出生年份，玩家可以选择月份、日期与性别。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct TemplateDef {
    pub key: String,
    pub born: WorldDate,
    #[serde(default)]
    pub captain: Option<CaptainPreset>,
    #[serde(default)]
    pub card: Option<OpeningCard>,
}

/// 作者已有的公开名册文案；身份与玩法仍由严格开局定义决定。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct OpeningCard {
    pub key: String,
    pub name: String,
    pub name_en: Option<String>,
    pub gender: Option<Gender>,
    pub born: Option<WorldDate>,
    pub home: String,
    pub region: String,
    pub tagline: String,
    pub style: String,
    pub playstyle: String,
    pub tags: Vec<String>,
    pub difficulty: u8,
    pub strengths: Vec<String>,
    pub start_ship: String,
    pub known: Vec<String>,
    pub academy: OpeningAcademy,
    pub keepsake: String,
    pub portraits: Vec<OpeningPortrait>,
    pub bonds: Vec<OpeningBond>,
    pub family: String,
    pub activities: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct OpeningAcademy {
    pub key: String,
    pub name: String,
    pub city: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpeningPortrait {
    pub from_age: u32,
    pub asset: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpeningBond {
    pub person: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptainPreset {
    pub answers: Vec<String>,
    pub alloc: Vec<i64>,
    #[serde(default)]
    pub genius: Option<String>,
}

pub fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::InvalidStart(message.into())
}

/// 世界纪年日期转换为从 rules.world.start_year 起算的 tick。
pub fn day_of(defs: &StaticData, date: WorldDate) -> Result<u32, CoreError> {
    let year = i64::from(date[0]) - defs.rules.world.start_year + 1;
    let year = u32::try_from(year).map_err(|_| invalid("剧本日期早于世界起始年份"))?;
    defs.calendar
        .day_of(crate::calendar::Date { year, month: date[1], day: date[2] })
        .map_err(|e| invalid(e.to_string()))
}

pub fn identity(
    defs: &StaticData,
    scenario: &ScenarioDef,
    request: &NewGameRequest,
) -> Result<Option<ProtagonistIdentity>, CoreError> {
    if request.world != defs.world_key {
        return Err(CoreError::WorldMismatch { saved: request.world.clone(), current: defs.world_key.clone() });
    }
    if request.protagonist.is_some() && request.template.is_some() {
        return Err(invalid("protagonist 与 template 不能同时选择"));
    }
    if request.captain.is_some() != request.template.is_some() {
        return Err(invalid("自创模板必须与 captain 一起提供"));
    }
    let identity = if let Some(key) = &request.protagonist {
        if !scenario.protagonists.contains(key) {
            return Err(invalid(format!("剧本不允许主角“{key}”")));
        }
        let person = scenario
            .protagonist_defs
            .iter()
            .find(|p| &p.key == key)
            .ok_or_else(|| invalid(format!("缺少主角“{key}”的出生日期与性别定义")))?;
        Some(ProtagonistIdentity {
            protagonist: Some(key.clone()),
            template: None,
            born: person.born,
            gender: person.gender,
        })
    } else if let (Some(key), Some(captain)) = (&request.template, &request.captain) {
        if !scenario.templates.contains(key) {
            return Err(invalid(format!("剧本不允许模板“{key}”")));
        }
        let template = scenario
            .template_defs
            .iter()
            .find(|t| &t.key == key)
            .ok_or_else(|| invalid(format!("缺少模板“{key}”的出生年份定义")))?;
        let name = captain.name.trim();
        if name.is_empty() || name.chars().count() > 24 || name.chars().any(char::is_control) {
            return Err(invalid("主角姓名须为 1–24 个字且不能含控制字符"));
        }
        if captain.look > 24 || captain.look == 12 {
            return Err(invalid("自创主角须使用普通外貌（0–11、13–24）"));
        }
        let born = [template.born[0], captain.birthday[0], captain.birthday[1]];
        defs.calendar
            .day_of(crate::calendar::Date { year: born[0], month: born[1], day: born[2] })
            .map_err(|e| invalid(e.to_string()))?;
        Some(ProtagonistIdentity { protagonist: None, template: Some(key.clone()), born, gender: captain.gender })
    } else {
        if !scenario.protagonists.is_empty() || !scenario.templates.is_empty() {
            return Err(invalid("请选择剧本主角或自创模板"));
        }
        None
    };
    if identity.as_ref().is_some_and(|i| i.age_on(scenario.control_date).is_none()) {
        return Err(invalid("主角在控制日尚未出生"));
    }
    Ok(identity)
}
