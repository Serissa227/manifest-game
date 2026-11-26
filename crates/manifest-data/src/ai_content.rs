//! AI 内容：提示词模板（`data/prompts/`，带版本号）与离线降级模板（`data/templates/`）。
//!
//! 模板中的变量写作 `{name}`；加载时检查只使用了该类模板允许的变量。

use crate::{DataError, DataIssue};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// 提案类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalKind {
    /// 世界事件导演
    Director,
    /// 传闻与新闻
    Rumor,
    /// 议价对话
    Bargain,
    /// 商会战略备忘
    Strategy,
    /// 委托合同
    Contract,
    /// 编年史
    Chronicle,
    /// 组合事件：模型在结构约束下从效果词表中组合事件
    Composed,
    /// 商会展望（ECONOMY.md 8.2）：几种商品的看法、预测方法与一句备忘
    Outlook,
    /// 市场月报（8.5）：某海区上个月的行情
    MarketReport,
    /// 预测复盘点评（8.6）：按需、只返回文字，不进命令日志
    Review,
    /// 身世序章（8.7）：按需、只返回文字，不进命令日志
    Prologue,
    /// 人物自由对话
    Persona,
    /// 封闭日常模板
    Daily,
    Narration,
    Letter,
    AltChronicle,
    Diary,
    Ripple,
}

impl ProposalKind {
    pub const ALL: [ProposalKind; 18] = [
        ProposalKind::Director,
        ProposalKind::Rumor,
        ProposalKind::Bargain,
        ProposalKind::Strategy,
        ProposalKind::Contract,
        ProposalKind::Chronicle,
        ProposalKind::Composed,
        ProposalKind::Outlook,
        ProposalKind::MarketReport,
        ProposalKind::Review,
        ProposalKind::Prologue,
        ProposalKind::Persona,
        ProposalKind::Daily,
        ProposalKind::Narration,
        ProposalKind::Letter,
        ProposalKind::AltChronicle,
        ProposalKind::Diary,
        ProposalKind::Ripple,
    ];

    pub fn is_f9(self) -> bool {
        matches!(
            self,
            Self::Ripple
                | Self::Persona
                | Self::Daily
                | Self::Narration
                | Self::Letter
                | Self::AltChronicle
                | Self::Diary
        )
    }

    pub fn key(self) -> &'static str {
        match self {
            ProposalKind::Director => "director",
            ProposalKind::Rumor => "rumor",
            ProposalKind::Bargain => "bargain",
            ProposalKind::Strategy => "strategy",
            ProposalKind::Contract => "contract",
            ProposalKind::Chronicle => "chronicle",
            ProposalKind::Composed => "composed",
            ProposalKind::Outlook => "outlook",
            ProposalKind::MarketReport => "market_report",
            ProposalKind::Review => "review",
            ProposalKind::Prologue => "prologue",
            ProposalKind::Persona => "persona",
            ProposalKind::Daily => "daily",
            ProposalKind::Narration => "narration",
            ProposalKind::Letter => "letter",
            ProposalKind::AltChronicle => "alt_chronicle",
            ProposalKind::Diary => "diary",
            ProposalKind::Ripple => "ripple",
        }
    }

    /// 只返回文字、不产生命令的类型（按需请求：复盘点评与身世序章）。
    pub fn text_only(self) -> bool {
        matches!(self, ProposalKind::Review | ProposalKind::Prologue)
    }

    /// 提示词模板允许使用的变量，以及必须出现的变量。
    /// 所有类型另可使用 {language}（写作语言）与 {glossary}（专名的中英对照，只在非中文界面有内容）。
    fn prompt_vars(self) -> (&'static [&'static str], &'static [&'static str]) {
        match self {
            ProposalKind::Ripple
            | ProposalKind::Persona
            | ProposalKind::Daily
            | ProposalKind::Narration
            | ProposalKind::Letter
            | ProposalKind::AltChronicle
            | ProposalKind::Diary => (
                &[
                    "summary",
                    "persona",
                    "memory",
                    "player_text",
                    "topics",
                    "options",
                    "schema",
                    "date",
                    "language",
                    "glossary",
                ],
                &["summary", "schema"],
            ),
            ProposalKind::Director => (
                &["summary", "catalog", "keys", "schema", "date", "language", "glossary"],
                &["summary", "catalog", "schema"],
            ),
            ProposalKind::Rumor => {
                (&["summary", "fact", "source", "schema", "date", "language", "glossary"], &["fact", "schema"])
            }
            ProposalKind::Bargain => (
                &["player_text", "intent", "discount", "loc", "schema", "date", "language", "glossary"],
                &["player_text", "intent", "schema"],
            ),
            ProposalKind::Strategy => {
                (&["summary", "company", "keys", "schema", "date", "language", "glossary"], &["company", "schema"])
            }
            ProposalKind::Contract => {
                (&["summary", "keys", "schema", "date", "language", "glossary"], &["summary", "schema"])
            }
            ProposalKind::Chronicle => (&["facts", "year", "schema", "language", "glossary"], &["facts", "schema"]),
            ProposalKind::Composed => (
                &["summary", "effects", "keys", "history", "frontier", "schema", "date", "language", "glossary"],
                &["summary", "effects", "history", "schema"],
            ),
            ProposalKind::Outlook => {
                (&["summary", "company", "keys", "schema", "date", "language", "glossary"], &["company", "schema"])
            }
            ProposalKind::MarketReport => {
                (&["facts", "region", "schema", "date", "language", "glossary"], &["facts", "schema"])
            }
            ProposalKind::Review => (&["facts", "place", "schema", "language", "glossary"], &["facts", "schema"]),
            ProposalKind::Prologue => (&["captain", "schema", "date", "language", "glossary"], &["captain", "schema"]),
        }
    }
}

/// 一份提示词模板。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromptTemplate {
    pub kind: ProposalKind,
    /// 模板版本号：改动模板时递增，缓存随之失效
    pub version: u32,
    /// 世界摘要的长度上限（字符）
    pub max_summary_chars: usize,
    /// 期望的最大输出 token 数
    pub max_tokens: u32,
    pub system: String,
    pub user: String,
}

/// 离线模板：事件导演。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectorTemplate {
    /// 每次挑选 0、1、2、3 个事件的权重
    pub count_weights: [u32; 4],
}

/// 离线模板：商会战略。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyTemplate {
    /// 每次调整风险偏好的最大幅度（百分点）
    pub risk_step_pct: i64,
}

/// 离线模板：委托合同。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractTemplate {
    /// 报酬相对公允值的倍数范围（百分比）
    pub reward_pct: [i64; 2],
    /// 期限范围（天）
    pub days: [i64; 2],
}

/// 离线模板：组合事件原型中的一条效果（目标由生成器按约束挑选，参数在范围内随机）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchetypeEffect {
    /// 效果 key（见 data/effects.toml）
    pub effect: String,
    /// 可选的商品 key（涉及商品的效果；空表示当地交易的任意商品）
    #[serde(default)]
    pub goods: Vec<String>,
    /// 可选的殖民地建筑 key（仅殖民地产量效果；"all" 表示全部建筑；空表示该殖民地任一座产出建筑或全部）
    #[serde(default)]
    pub buildings: Vec<String>,
    /// 系数范围（还会被夹紧到 effects.toml 的边界内）
    #[serde(default)]
    pub mult: Option<[f64; 2]>,
    /// 天数范围
    #[serde(default)]
    pub days: Option<[u32; 2]>,
    /// 变化量范围
    #[serde(default)]
    pub delta: Option<[i64; 2]>,
}

/// 离线模板：一个组合事件原型。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposedArchetype {
    pub key: String,
    /// 被选中的权重
    pub weight: u32,
    /// 标题模板
    pub titles: Vec<String>,
    /// 叙事句池（挑一句）
    pub narratives: Vec<String>,
    /// 效果组合
    pub effects: Vec<ArchetypeEffect>,
}

/// 离线模板：组合事件。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposedTemplate {
    /// 史料出处（加在叙事之前，营造历史感）
    pub sources: Vec<String>,
    pub archetypes: Vec<ComposedArchetype>,
}

/// 组合事件模板可用的变量。
pub const COMPOSED_VARS: [&str; 8] = ["loc", "good", "region", "faction_a", "faction_b", "date", "colony", "discovery"];

/// 全部离线模板。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OfflineTemplates {
    /// 不新增经典世界文件；扩展类型的缺省结构由代码提供，可由世界包覆盖。
    #[serde(default)]
    pub f9: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    pub director: DirectorTemplate,
    /// 按事实类型（price_high / price_low / shortage / relation / event_active）的传闻文字
    pub rumor: BTreeMap<String, Vec<String>>,
    /// 按意图（discount / threat / bribe / rapport / irrelevant）的回复台词
    pub bargain: BTreeMap<String, Vec<String>>,
    pub strategy: StrategyTemplate,
    pub contract: ContractTemplate,
    /// 编年史各段落（opening / events / wars / bankrupt / closing）
    pub chronicle: BTreeMap<String, Vec<String>>,
    /// 组合事件原型
    pub composed: ComposedTemplate,
    /// 商会展望的备忘（up / down / flat）
    pub outlook: BTreeMap<String, Vec<String>>,
    /// 市场月报各段（opening / riser / faller / shortage / policy / outlook / closing）
    pub market_report: BTreeMap<String, Vec<String>>,
    /// 复盘点评各段（opening / facts / closing）
    pub review: BTreeMap<String, Vec<String>>,
    /// 身世序章各段（opening / story / closing）
    pub prologue: BTreeMap<String, Vec<String>>,
}

/// 文字模板的一段：段名与这一段可用的变量。
pub type TemplateSection = (&'static str, &'static [&'static str]);
/// 一个文字模板文件：文件名与各段。
pub type TemplateFile = (&'static str, &'static [TemplateSection]);

/// 文字模板文件：各段的名字与每段可用的变量（第八批 E7 的四种）。
pub const TEXT_TEMPLATES: [TemplateFile; 4] = [
    ("outlook", &[("up", &["company", "good"]), ("down", &["company", "good"]), ("flat", &["company"])]),
    (
        "market_report",
        &[
            ("opening", &["region"]),
            ("riser", &["region", "riser_loc", "riser_good", "riser_pct"]),
            ("faller", &["region", "faller_loc", "faller_good", "faller_pct"]),
            ("shortage", &["region", "shortage_loc", "shortage_good"]),
            ("policy", &["region", "policy"]),
            ("money", &["region", "money_loc", "money_state"]),
            ("outlook", &["region", "company", "view_good", "view"]),
            ("closing", &["region"]),
        ],
    ),
    ("review", &[("opening", &["place"]), ("facts", &["place", "facts"]), ("closing", &["place"])]),
    (
        "prologue",
        &[("opening", &["name", "sign", "port"]), ("story", &["name", "answers"]), ("closing", &["name", "port"])],
    ),
];

/// 某文字模板文件每段可用的变量。
pub fn text_template_sections(name: &str) -> &'static [TemplateSection] {
    TEXT_TEMPLATES.iter().find(|(n, _)| *n == name).map(|(_, s)| *s).unwrap_or(&[])
}

/// AI 内容。
#[derive(Clone, Debug, PartialEq)]
pub struct AiContent {
    pub prompts: BTreeMap<ProposalKind, PromptTemplate>,
    pub templates: OfflineTemplates,
    /// 世界包的公开背景；经典调用保持空值，不改变旧提示词正文。
    pub lore: AiLore,
}

pub const LORE_SUMMARY_CHARS: usize = 1_200;
pub const LORE_TERMS_CHARS: usize = 3_000;
pub const LORE_TABOOS_CHARS: usize = 1_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AiLore {
    pub world: String,
    pub summary: String,
    pub terms: String,
    pub taboos: String,
    pub strict: bool,
}

impl AiLore {
    /// 超长背景拒绝加载，不悄悄截断内容边界。
    pub fn from_world(world: &crate::worlds::EffectiveWorld) -> Result<Self, DataError> {
        let lore = &world.manifest.lore;
        let mut issues = Vec::new();
        for (field, value, max) in [
            ("summary", &lore.summary, LORE_SUMMARY_CHARS),
            ("terms", &lore.terms, LORE_TERMS_CHARS),
            ("taboos", &lore.taboos, LORE_TABOOS_CHARS),
        ] {
            if value.chars().count() > max {
                issue(&mut issues, "world.toml", &format!("lore.{field}"), format!("最多 {max} 字"));
            }
        }
        if !issues.is_empty() {
            return Err(DataError { issues });
        }
        Ok(Self {
            world: world.manifest.key.clone(),
            summary: lore.summary.clone(),
            terms: lore.terms.clone(),
            taboos: lore.taboos.clone(),
            strict: matches!(lore.sourcing, crate::worlds::Sourcing::Strict),
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectorFile {
    count_weights: [u32; 4],
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrategyFile {
    risk_step_pct: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ContractFile {
    reward_pct: [i64; 2],
    days: [i64; 2],
}

/// 取出模板中的全部变量名。
pub fn placeholders(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                let name = &after[..end];
                if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    out.push(name.to_string());
                }
                rest = &after[end + 1..];
            }
            None => break,
        }
    }
    out
}

fn issue(list: &mut Vec<DataIssue>, file: &str, item: &str, msg: impl Into<String>) {
    list.push(DataIssue { file: file.to_string(), item: item.to_string(), message: msg.into() });
}

fn read_toml<T: serde::de::DeserializeOwned>(
    read: &impl Fn(&str) -> Result<String, String>,
    rel: &str,
    issues: &mut Vec<DataIssue>,
) -> Option<T> {
    let text = match read(rel) {
        Ok(t) => t,
        Err(e) => {
            issue(issues, rel, "", format!("无法读取文件：{e}"));
            return None;
        }
    };
    match toml::from_str(&text) {
        Ok(v) => Some(v),
        Err(e) => {
            issue(issues, rel, "", format!("TOML 格式错误：{}", e.to_string().trim()));
            None
        }
    }
}

/// 检查一组文字模板：非空，且只用允许的变量。
fn check_lines(issues: &mut Vec<DataIssue>, file: &str, item: &str, lines: &[String], allowed: &[&str]) {
    if lines.is_empty() {
        issue(issues, file, item, "至少需要一条模板");
    }
    for l in lines {
        if l.trim().is_empty() {
            issue(issues, file, item, "模板不能为空字符串");
        }
        for p in placeholders(l) {
            if !allowed.contains(&p.as_str()) {
                issue(issues, file, item, format!("模板使用了不允许的变量 {{{p}}}（可用：{}）", allowed.join("、")));
            }
        }
    }
}

/// 检查一份提示词模板：类型、版本、长度范围、只用允许的变量、必需的变量都出现。
pub(crate) fn check_prompt(issues: &mut Vec<DataIssue>, rel: &str, kind: ProposalKind, p: &PromptTemplate) {
    if p.kind != kind {
        issue(issues, rel, "kind", format!("应为 {}", kind.key()));
    }
    if p.version == 0 {
        issue(issues, rel, "version", "版本号必须大于 0");
    }
    if !(200..=8_000).contains(&p.max_summary_chars) {
        issue(issues, rel, "max_summary_chars", "必须在 200 到 8000 之间");
    }
    if !(50..=8_000).contains(&p.max_tokens) {
        issue(issues, rel, "max_tokens", "必须在 50 到 8000 之间");
    }
    let (allowed, required) = kind.prompt_vars();
    for (field, text) in [("system", &p.system), ("user", &p.user)] {
        if text.trim().is_empty() {
            issue(issues, rel, field, "不能为空");
        }
        for v in placeholders(text) {
            if !allowed.contains(&v.as_str())
                && !["world_lore", "world_terms", "world_taboos", "calendar"].contains(&v.as_str())
            {
                issue(issues, rel, field, format!("使用了不允许的变量 {{{v}}}（可用：{}）", allowed.join("、")));
            }
        }
    }
    let used: Vec<String> = placeholders(&format!("{}{}", p.system, p.user));
    for r in required {
        if !used.iter().any(|u| u == r) {
            issue(issues, rel, "user", format!("缺少必需的变量 {{{r}}}"));
        }
    }
}

/// 组合事件原型的标题与叙事可以使用的变量（取决于原型的效果；地点与日期总有值）。
pub(crate) fn archetype_vars(a: &ComposedArchetype) -> Vec<&'static str> {
    use manifest_core::defs::EffectKind;
    let kinds: Vec<EffectKind> = a.effects.iter().filter_map(|e| EffectKind::from_key(&e.effect)).collect();
    let mut vars: Vec<&'static str> = vec!["loc", "date"];
    if kinds.iter().any(|k| k.needs_good()) {
        vars.push("good");
    }
    // 发现物传闻：{discovery} 为发现物名，{region} 为传闻所指的大致海区
    if kinds.iter().any(|k| k.needs_region() || k.needs_discovery()) {
        vars.push("region");
    }
    if kinds.iter().any(|k| k.needs_discovery()) {
        vars.push("discovery");
    }
    // 殖民地效果：{colony} 为殖民地名，{loc} 为殖民点名
    if kinds.iter().any(|k| k.targets_colony()) {
        vars.push("colony");
    }
    if kinds.iter().any(|k| k.needs_faction_a()) {
        vars.push("faction_a");
    }
    if kinds.iter().any(|k| k.needs_faction_b()) {
        vars.push("faction_b");
    }
    vars
}

/// 加载并校验 `data/prompts/` 与 `data/templates/`。
pub fn load_ai_content(dir: &Path) -> Result<AiContent, DataError> {
    load_content(&|rel| std::fs::read_to_string(dir.join(rel)).map_err(|e| e.to_string()), &|rel| {
        dir.join(rel).is_file()
    })
}

/// 从继承、覆盖后的有效文件中加载 AI 内容，沿用经典的全部语义校验。
pub fn load_world_ai_content(world: &crate::worlds::EffectiveWorld) -> Result<AiContent, DataError> {
    let lore = AiLore::from_world(world)?;
    let mut content = load_content(&|rel| world.read(rel).map_err(|e| e.to_string()), &|rel| world.contains(rel))?;
    content.lore = lore;
    Ok(content)
}

/// 草稿的 AI 集合使用正式加载器，文件名也必须对应已登记的提案类型。
pub(crate) fn check_world_ai_files(world: &crate::worlds::EffectiveWorld) -> Result<(), DataError> {
    let mut issues = Vec::new();
    for directory in ["prompts", "templates"] {
        for file in world.files_in(directory) {
            if !ProposalKind::ALL.iter().any(|kind| file == format!("{directory}/{}.toml", kind.key())) {
                issue(&mut issues, &file, "", "未知的 AI 内容文件");
            }
        }
    }
    if !issues.is_empty() {
        return Err(DataError { issues });
    }
    load_world_ai_content(world).map(|_| ())
}

/// AI 翻译沿用正式提示词结构；模板只能翻译文字，不能更改数值与原型效果。
pub(crate) fn check_ai_translation(file: &str, source: &str, english: &str) -> Result<usize, String> {
    let normalized = file.replace('\\', "/");
    let key = normalized.rsplit('/').next().and_then(|name| name.strip_suffix(".toml")).ok_or("AI 文件名无效")?;
    let kind = ProposalKind::ALL.into_iter().find(|kind| kind.key() == key).ok_or("未知的 AI 内容文件")?;
    if normalized.split('/').any(|part| part == "prompts") {
        let prompt: PromptTemplate = toml::from_str(english).map_err(|e| format!("提示词覆盖格式错误：{e}"))?;
        let mut issues = Vec::new();
        check_prompt(&mut issues, file, kind, &prompt);
        if !issues.is_empty() {
            return Err(DataError { issues }.to_string());
        }
        return Ok(2);
    }
    let mut original: toml::Value = toml::from_str(source).map_err(|e| format!("模板格式错误：{e}"))?;
    let translated: toml::Value = toml::from_str(english).map_err(|e| format!("模板覆盖格式错误：{e}"))?;
    if kind == ProposalKind::Composed {
        let mut archetypes = toml::Table::new();
        for row in original.get("archetypes").and_then(toml::Value::as_array).ok_or("缺少组合原型")? {
            let key = row.get("key").and_then(toml::Value::as_str).ok_or("缺少原型 key")?;
            let mut text = toml::Table::new();
            for field in ["titles", "narratives"] {
                text.insert(field.into(), row.get(field).cloned().ok_or("缺少组合文案")?);
            }
            archetypes.insert(key.into(), toml::Value::Table(text));
        }
        original = toml::Value::Table(toml::Table::from_iter([
            ("sources".into(), original.get("sources").cloned().ok_or("缺少组合出处")?),
            ("archetypes".into(), toml::Value::Table(archetypes)),
        ]));
    }
    fn compare(original: &toml::Value, translated: &toml::Value) -> Result<usize, String> {
        match (original, translated) {
            (toml::Value::Table(a), toml::Value::Table(b)) if a.keys().eq(b.keys()) => {
                a.iter().try_fold(0, |count, (key, value)| Ok(count + compare(value, &b[key])?))
            }
            (toml::Value::Array(a), toml::Value::Array(b)) if a.len() == b.len() => {
                a.iter().zip(b).try_fold(0, |count, (a, b)| Ok(count + compare(a, b)?))
            }
            (toml::Value::String(a), toml::Value::String(b)) if !b.trim().is_empty() => {
                let allowed = placeholders(a);
                if placeholders(b).iter().any(|slot| !allowed.contains(slot)) {
                    return Err("译文使用了原文之外的槽位".into());
                }
                Ok(1)
            }
            (a, b) if a == b => Ok(0),
            _ => Err("AI 译文的字段、条数或数值与原文不一致".into()),
        }
    }
    compare(&original, &translated)
}

fn load_content(
    dir: &impl Fn(&str) -> Result<String, String>,
    exists: &impl Fn(&str) -> bool,
) -> Result<AiContent, DataError> {
    let mut issues: Vec<DataIssue> = Vec::new();
    let mut prompts = BTreeMap::new();
    for kind in ProposalKind::ALL {
        let rel = format!("prompts/{}.toml", kind.key());
        let p = if kind.is_f9() && !exists(&rel) {
            f9_prompt(kind)
        } else {
            let Some(p) = read_toml::<PromptTemplate>(dir, &rel, &mut issues) else { continue };
            p
        };
        check_prompt(&mut issues, &rel, kind, &p);
        prompts.insert(kind, p);
    }

    let mut f9 = BTreeMap::new();
    for kind in ProposalKind::ALL.into_iter().filter(|k| k.is_f9()) {
        let rel = format!("templates/{}.toml", kind.key());
        let template = if exists(&rel) {
            read_toml::<BTreeMap<String, Vec<String>>>(dir, &rel, &mut issues).unwrap_or_default()
        } else {
            f9_defaults(kind)
        };
        for (section, allowed) in f9_sections(kind) {
            match template.get(*section) {
                Some(lines) => check_lines(&mut issues, &rel, section, lines, allowed),
                None => issue(&mut issues, &rel, section, "缺少该段模板"),
            }
        }
        for (section, lines) in &template {
            let voice = kind == ProposalKind::Diary
                && section.strip_prefix("voice_").is_some_and(|key| {
                    !key.is_empty()
                        && key.len() <= 80
                        && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                });
            if voice {
                check_lines(&mut issues, &rel, section, lines, &["protagonist", "year", "month", "facts"]);
            } else if !f9_sections(kind).iter().any(|(key, _)| key == section) {
                issue(&mut issues, &rel, section, "未知模板段");
            }
            let narrative = !matches!(kind, ProposalKind::Persona | ProposalKind::Daily);
            let min = if narrative { 3 } else { 1 };
            let max = if kind == ProposalKind::Ripple {
                240
            } else if narrative {
                1600
            } else {
                200
            };
            if !(min..=64).contains(&lines.len()) {
                issue(&mut issues, &rel, section, "模板条数不在允许范围内");
            }
            if lines.iter().any(|line| line.chars().count() > max) {
                issue(&mut issues, &rel, section, format!("模板最多 {max} 字"));
            }
        }
        f9.insert(kind.key().into(), template);
    }
    let director = read_toml::<DirectorFile>(dir, "templates/director.toml", &mut issues);
    if let Some(d) = &director
        && d.count_weights.iter().all(|w| *w == 0)
    {
        issue(&mut issues, "templates/director.toml", "count_weights", "权重不能全为 0");
    }
    let rumor = read_toml::<BTreeMap<String, Vec<String>>>(dir, "templates/rumor.toml", &mut issues);
    if let Some(r) = &rumor {
        for key in ["price_high", "price_low", "shortage", "relation", "event_active"] {
            match r.get(key) {
                Some(lines) => check_lines(
                    &mut issues,
                    "templates/rumor.toml",
                    key,
                    lines,
                    &["loc", "good", "faction_a", "faction_b", "status", "event"],
                ),
                None => issue(&mut issues, "templates/rumor.toml", key, "缺少该类传闻模板"),
            }
        }
    }
    let bargain = read_toml::<BTreeMap<String, Vec<String>>>(dir, "templates/bargain.toml", &mut issues);
    if let Some(b) = &bargain {
        for key in ["discount", "threat", "bribe", "rapport", "irrelevant"] {
            match b.get(key) {
                Some(lines) => check_lines(&mut issues, "templates/bargain.toml", key, lines, &["discount", "loc"]),
                None => issue(&mut issues, "templates/bargain.toml", key, "缺少该意图的回复模板"),
            }
        }
    }
    let strategy = read_toml::<StrategyFile>(dir, "templates/strategy.toml", &mut issues);
    if let Some(s) = &strategy
        && !(1..=30).contains(&s.risk_step_pct)
    {
        issue(&mut issues, "templates/strategy.toml", "risk_step_pct", "必须在 1 到 30 之间");
    }
    let contract = read_toml::<ContractFile>(dir, "templates/contract.toml", &mut issues);
    if let Some(c) = &contract
        && (c.reward_pct[0] < 50
            || c.reward_pct[1] > 200
            || c.reward_pct[0] > c.reward_pct[1]
            || c.days[0] < 20
            || c.days[1] > 180
            || c.days[0] > c.days[1])
    {
        issue(
            &mut issues,
            "templates/contract.toml",
            "",
            "reward_pct 须在 50–200 之内、days 须在 20–180 之内且下限不大于上限",
        );
    }
    let chronicle = read_toml::<BTreeMap<String, Vec<String>>>(dir, "templates/chronicle.toml", &mut issues);
    if let Some(c) = &chronicle {
        for key in ["opening", "events", "wars", "bankrupt", "closing"] {
            match c.get(key) {
                Some(lines) => check_lines(
                    &mut issues,
                    "templates/chronicle.toml",
                    key,
                    lines,
                    &["year", "events", "wars", "bankrupt", "richest", "net_worth"],
                ),
                None => issue(&mut issues, "templates/chronicle.toml", key, "缺少该段落模板"),
            }
        }
    }
    let composed = read_toml::<ComposedTemplate>(dir, "templates/composed.toml", &mut issues);
    if let Some(c) = &composed {
        check_composed_template(&mut issues, c);
    }
    // 第八批 E7 的四种文字模板：每段都要有，只用该段允许的变量
    let mut texts: BTreeMap<&str, BTreeMap<String, Vec<String>>> = BTreeMap::new();
    for (name, sections) in TEXT_TEMPLATES {
        let rel = format!("templates/{name}.toml");
        if let Some(t) = read_toml::<BTreeMap<String, Vec<String>>>(dir, &rel, &mut issues) {
            for (section, allowed) in sections {
                match t.get(*section) {
                    Some(lines) => check_lines(&mut issues, &rel, section, lines, allowed),
                    None => issue(&mut issues, &rel, section, "缺少该段模板"),
                }
            }
            for k in t.keys() {
                if !sections.iter().any(|(s, _)| s == k) {
                    issue(&mut issues, &rel, k, "没有这一段");
                }
            }
            texts.insert(name, t);
        }
    }
    if !issues.is_empty() {
        return Err(DataError { issues });
    }
    let (Some(director), Some(rumor), Some(bargain), Some(strategy), Some(contract), Some(chronicle), Some(composed)) =
        (director, rumor, bargain, strategy, contract, chronicle, composed)
    else {
        return Err(DataError { issues });
    };
    let mut text = |name: &str| texts.remove(name).unwrap_or_default();
    Ok(AiContent {
        prompts,
        lore: AiLore::default(),
        templates: OfflineTemplates {
            f9,
            director: DirectorTemplate { count_weights: director.count_weights },
            rumor,
            bargain,
            strategy: StrategyTemplate { risk_step_pct: strategy.risk_step_pct },
            contract: ContractTemplate { reward_pct: contract.reward_pct, days: contract.days },
            chronicle,
            composed,
            outlook: text("outlook"),
            market_report: text("market_report"),
            review: text("review"),
            prologue: text("prologue"),
        },
    })
}

const COMPOSED_FILE: &str = "templates/composed.toml";

/// 检查组合事件模板的结构（与静态数据的一致性另由 [`check_against_data`] 检查）。
fn check_composed_template(issues: &mut Vec<DataIssue>, c: &ComposedTemplate) {
    let f = COMPOSED_FILE;
    // 史料出处与任何原型搭配，只能用总有值的变量
    check_lines(issues, f, "sources", &c.sources, &["loc", "date"]);
    if c.archetypes.is_empty() {
        issue(issues, f, "archetypes", "至少需要一个原型");
    } else if c.archetypes.iter().all(|a| a.weight == 0) {
        issue(issues, f, "archetypes", "权重不能全为 0");
    }
    let mut keys: Vec<&str> = Vec::new();
    for a in &c.archetypes {
        let item = format!("archetypes[{}]", a.key);
        if a.key.is_empty() || !a.key.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_') {
            issue(issues, f, &item, "key 只能用小写字母、数字与下划线");
        }
        if keys.contains(&a.key.as_str()) {
            issue(issues, f, &item, "key 重复");
        }
        keys.push(&a.key);
        // 标题与叙事只能用本原型的效果能提供的变量（地点与日期总有值）
        let kinds: Vec<manifest_core::defs::EffectKind> =
            a.effects.iter().filter_map(|e| manifest_core::defs::EffectKind::from_key(&e.effect)).collect();
        let vars = archetype_vars(a);
        // 殖民点上的效果与有市场的地点效果共用 {loc}，不能出现在同一个原型里；殖民地效果与占领殖民点也不能混用
        let site_effects = kinds.iter().any(|k| k.targets_site());
        let market_effects = kinds.iter().any(|k| k.needs_loc() && !k.targets_site());
        if site_effects && market_effects {
            issue(issues, f, &item, "殖民点上的效果不能与港口、城市的地点效果放在同一个原型里");
        }
        if kinds.iter().any(|k| k.targets_colony()) && kinds.contains(&manifest_core::defs::EffectKind::SiteClaim) {
            issue(issues, f, &item, "殖民地效果与占领殖民点不能放在同一个原型里");
        }
        check_lines(issues, f, &format!("{item}.titles"), &a.titles, &vars);
        check_lines(issues, f, &format!("{item}.narratives"), &a.narratives, &vars);
        if a.effects.is_empty() || a.effects.len() > 5 {
            issue(issues, f, &item, "effects 必须有 1 到 5 条");
        }
        for e in &a.effects {
            let Some(kind) = manifest_core::defs::EffectKind::from_key(&e.effect) else {
                issue(issues, f, &item, format!("effect “{}”不在内核实现的效果集合中", e.effect));
                continue;
            };
            let presence = [
                ("mult", kind.needs_mult(), e.mult.is_some()),
                ("days", kind.needs_days(), e.days.is_some()),
                ("delta", kind.needs_delta(), e.delta.is_some()),
            ];
            for (name, need, has) in presence {
                if need && !has {
                    issue(issues, f, &item, format!("效果 {} 需要 {name} 范围", e.effect));
                }
                if !need && has {
                    issue(issues, f, &item, format!("效果 {} 不使用 {name}", e.effect));
                }
            }
            if !kind.needs_good() && !e.goods.is_empty() {
                issue(issues, f, &item, format!("效果 {} 不使用 goods", e.effect));
            }
            if !kind.allows_building() && !e.buildings.is_empty() {
                issue(issues, f, &item, format!("效果 {} 不使用 buildings", e.effect));
            }
            if let Some([lo, hi]) = e.mult
                && !(lo.is_finite() && hi.is_finite() && lo > 0.0 && lo <= hi && (hi < 1.0 || lo > 1.0))
            {
                issue(
                    issues,
                    f,
                    &item,
                    format!("效果 {} 的 mult 范围无效（须为正数、下限不大于上限，且不跨过 1）", e.effect),
                );
            }
            if let Some([lo, hi]) = e.days
                && (lo == 0 || lo > hi)
            {
                issue(issues, f, &item, format!("效果 {} 的 days 范围无效", e.effect));
            }
            if let Some([lo, hi]) = e.delta
                && lo > hi
            {
                issue(issues, f, &item, format!("效果 {} 的 delta 范围无效", e.effect));
            }
        }
    }
}

/// 检查离线模板与静态数据是否一致：组合事件原型引用的商品存在、效果在词表中、
/// 参数范围在 `effects.toml` 的边界内、任意取值都不会超出总强度预算与效果条数上限。
pub fn check_against_data(content: &AiContent, defs: &manifest_core::StaticData) -> Vec<DataIssue> {
    let mut issues = Vec::new();
    if let Some(voices) = content.templates.f9.get("diary") {
        for key in voices.keys().filter_map(|key| key.strip_prefix("voice_")).filter(|key| *key != "generic") {
            if !defs.scenarios.iter().any(|s| s.protagonists.iter().chain(&s.templates).any(|known| known == key)) {
                issue(&mut issues, "templates/diary.toml", key, "口吻模板引用了未登记的主角或自创模板");
            }
        }
    }

    let f = COMPOSED_FILE;
    let rules = &defs.composed;
    let to_bp = |v: f64| (v * manifest_core::Fx::SCALE as f64).round() as i64;
    for a in &content.templates.composed.archetypes {
        let item = format!("archetypes[{}]", a.key);
        if a.effects.len() > rules.max_effects {
            issue(&mut issues, f, &item, format!("效果条数超过 effects.toml 的上限 {}", rules.max_effects));
        }
        let mut worst: i64 = 0;
        for e in &a.effects {
            let Some(kind) = manifest_core::defs::EffectKind::from_key(&e.effect) else { continue };
            let Some(b) = rules.bounds(kind) else {
                issue(&mut issues, f, &item, format!("效果 {} 不在 effects.toml 的词表中", e.effect));
                continue;
            };
            for g in &e.goods {
                if defs.find_good(g).is_none() {
                    issue(&mut issues, f, &item, format!("引用了不存在的商品“{g}”"));
                }
            }
            for b in e.buildings.iter().filter(|b| b.as_str() != "all") {
                match defs.find_colony_building(b) {
                    None => issue(&mut issues, f, &item, format!("引用了不存在的殖民地建筑“{b}”")),
                    Some(id) if !manifest_core::colony::is_productive(defs, id) => {
                        issue(&mut issues, f, &item, format!("殖民地建筑“{b}”没有产出"))
                    }
                    Some(_) => {}
                }
            }
            if let (Some([lo, hi]), Some((blo, bhi))) = (e.mult, b.mult) {
                let (lo, hi) = (to_bp(lo), to_bp(hi));
                if lo < blo.raw() || hi > bhi.raw() {
                    issue(&mut issues, f, &item, format!("效果 {} 的 mult 超出 effects.toml 的边界", e.effect));
                }
                worst += (lo - manifest_core::Fx::SCALE).abs().max((hi - manifest_core::Fx::SCALE).abs());
            }
            if let (Some([lo, hi]), Some((blo, bhi))) = (e.days, b.days)
                && (lo < blo || hi > bhi)
            {
                issue(&mut issues, f, &item, format!("效果 {} 的 days 超出 effects.toml 的边界", e.effect));
            }
            if let (Some([lo, hi]), Some((blo, bhi))) = (e.delta, b.delta) {
                if lo < blo || hi > bhi {
                    issue(&mut issues, f, &item, format!("效果 {} 的 delta 超出 effects.toml 的边界", e.effect));
                }
                if lo <= 0 && hi >= 0 {
                    issue(&mut issues, f, &item, format!("效果 {} 的 delta 范围不能包含 0", e.effect));
                }
            }
        }
        if worst > rules.budget.raw() {
            issue(&mut issues, f, &item, "各效果取最大幅度时超出 effects.toml 的总强度预算");
        }
    }
    issues
}

/// 第九批模板可用槽位；原型结构与内核的封闭表一一对应。
pub fn f9_sections(kind: ProposalKind) -> &'static [TemplateSection] {
    match kind {
        ProposalKind::Persona => &[
            ("rapport", &["person", "loc"]),
            ("praise", &["person", "loc"]),
            ("request", &["person", "loc"]),
            ("inquiry", &["person", "loc"]),
            ("threat", &["person", "loc"]),
            ("bribe", &["person", "loc"]),
            ("offense", &["person", "loc"]),
            ("chat", &["person", "loc"]),
        ],
        ProposalKind::Narration => &[
            ("opening", &["event", "balance", "outcome"]),
            ("progress", &["event", "balance", "outcome"]),
            ("ending", &["event", "balance", "outcome"]),
        ],
        ProposalKind::Letter => &[
            ("help", &["person", "facts"]),
            ("thanks", &["person", "facts"]),
            ("threat", &["person", "facts"]),
            ("invite", &["person", "facts"]),
        ],
        ProposalKind::AltChronicle => &[("year", &["year", "facts"])],
        ProposalKind::Diary => &[("voice_generic", &["protagonist", "year", "month", "facts"])],
        ProposalKind::Ripple => &[("result", &["event", "outcome"])],
        ProposalKind::Daily => &[
            ("home_chat", &["person", "loc", "season"]),
            ("home_study", &["person", "loc", "season"]),
            ("academy_study", &["person", "loc", "season"]),
            ("academy_moment", &["person", "loc", "season"]),
            ("port_chat", &["person", "loc", "season"]),
            ("port_help", &["person", "loc", "season"]),
        ],
        _ => &[],
    }
}

/// 没有自带模板的世界使用的离线正文。不含任何具体世界的专名，槽位与 f9_sections 一致；
/// 缺了某段时返回空表，由 check_lines 报“至少需要一条模板”。
fn f9_defaults(kind: ProposalKind) -> BTreeMap<String, Vec<String>> {
    f9_sections(kind)
        .iter()
        .map(|(key, _)| ((*key).into(), f9_default_lines(kind, key).iter().map(|line| (*line).into()).collect()))
        .collect()
}

fn f9_default_lines(kind: ProposalKind, section: &str) -> &'static [&'static str] {
    match (kind, section) {
        (ProposalKind::Persona, "rapport") => {
            &["{person}把杯子往这边推了推：“在{loc}碰过几回头，你的脾气我摸得差不多了。坐下说话，别站着讲客套。”"]
        }
        (ProposalKind::Persona, "praise") => {
            &["{person}擦了擦手，难得露出一点笑：“这一趟走得干净。换了别人，早把货压在港里等行情了。”"]
        }
        (ProposalKind::Persona, "request") => {
            &["{person}皱着眉想了想：“你有事要托我，这我明白。容我想想，眼下不敢替你应下什么。”"]
        }
        (ProposalKind::Persona, "inquiry") => {
            &["{person}摇了摇头，把空杯子翻过来扣在桌上：“{loc}这几天没听到什么值得一说的消息。过几天再来问问吧。”"]
        }
        (ProposalKind::Persona, "threat") => {
            &["{person}的手按在桌沿上，声音压得很低：“话说清楚。再往前一步，{loc}的人可不会替你圆场。”"]
        }
        (ProposalKind::Persona, "bribe") => {
            &["{person}看了一眼桌上的钱袋，没有伸手去碰：“收起来吧。今天这杯酒我请得起，用不着你来付。”"]
        }
        (ProposalKind::Persona, "offense") => {
            &["{person}脸色一下子沉了：“说话放尊重些。我不是谁都能拿来取笑的。这话我就当你没说过。”"]
        }
        (ProposalKind::Persona, "chat") => {
            &["{person}朝海面看了一眼：“今天风软，正好晒晒帆布。在{loc}待了这几天，可还住得惯？”"]
        }
        (ProposalKind::Daily, "home_chat") => &[
            "{season}日的傍晚，{person}在家里的灶边坐着，话从天气说到{loc}的货价，又从货价说回小时候的事。说着说着两人都笑了，至于那年到底是哪一年，谁也没去较真。",
        ],
        (ProposalKind::Daily, "home_study") => &[
            "{season}天的午后，{person}把一本航海笔记摊在桌上，两人挤在窗边读。读到潮汐那一页，{person}指着图上的线问，这线怎么那么准。争了一阵，最后翻到书末，才在一行小字里找到了答案。",
        ],
        (ProposalKind::Daily, "academy_study") => &[
            "{season}日的夜里，学院的学舍里只剩两三盏灯。{person}对着一页算不完的货单发愁，笔尖把同一个数字划了一遍又一遍。最后还是把草稿推过去，两人一起对着答案核到半夜。",
        ],
        (ProposalKind::Daily, "academy_moment") => &[
            "{season}天的散学时分，{person}在走廊尽头追上来，把一只包好的饼往这边一塞，说是厨房多做的，不吃就浪费。说完转身就走，像是怕人叫住道谢。",
        ],
        (ProposalKind::Daily, "port_chat") => &[
            "{season}日的{loc}码头风大。{person}蹲在货堆边上，一袋一袋数着刚卸下来的麻袋。数完了，抬头问身边的人要不要也来一碗热汤。两人就在缆桩边坐下，看着船一艘艘靠岸。",
        ],
        (ProposalKind::Daily, "port_help") => &[
            "{season}天的傍晚，{person}的一只木箱卡在跳板上，怎么推也挪不动。码头上的人都忙着卸货，没人抬头。两人合力把箱子抬过了跳板，{person}只说了一句：“下回你要是卡住，我也不会站着看。”",
        ],
        (ProposalKind::Narration, "opening") => &[
            "{event}的消息是先从码头上传开的。跑船的人说得绘声绘色，账房里的人却都把笔停了一停。没有人敢先断言这事会怎么收场，只知道这一回，连酒馆里闲坐的老人都停下了话头。",
            "{event}起初没人当回事。后来一艘接一艘的快船从外海驶进港来，带来的消息一封比一封急。这类事多是这样：先是几句闲话，再是一纸公文，等人们想起要避开，已经晚了半步。",
            "{event}的风声传到这一带时，已经是几个港口之后的事了，每个人嘴里的说法都不一样。最要紧的是，没有人能说准它会往哪一边去。",
        ],
        (ProposalKind::Narration, "progress") => &[
            "{event}还没有分出胜负。两边都在等对方先露出破绽，港口里的货价跟着每一条消息上下跳。内行人说，这种时候最磨人的就是拖。拖久了，先空的是谁的钱袋，谁就得低头。",
            "{event}如今是拉锯的局面。今天这边占了一处水道，明天那边又夺回一座仓栈。往来的船主不敢多带货，宁可在港里多等几日。有人赚了，有人赔了，账本上的数字每天都在改。",
            "{event}还在往下走，谁也说不准下一步。沿岸的栈房和码头一面听消息，一面各自打点后路。讲故事的人最爱说这时候的人心，说到一半便停住，留着下一回再讲。",
        ],
        (ProposalKind::Narration, "ending") => &[
            "{event}到了收场的时候。{outcome}消息一传开，沿海的货栈陆续开了门，船又一艘艘出港，只是各港的人都学会了先看风向，再下决定。",
            "{event}的结果，各处说法不一。{outcome}这话在酒馆里讲了又讲：有人替输的一方叹气，也有人说赢家不过是赶上了潮水。",
            "{event}到这里才算清楚。{outcome}事后人们回头一数，改掉的不只是几条航线，还有许多人下一次出海时的念头。",
        ],
        (ProposalKind::Letter, "help") => &[
            "{person}的信是一个跑船的小伙子捎来的。封口用的是一截随手扯下的麻绳，纸角被海水泡过又晒干了，字迹有几处墨洇开。\n{facts}\n你把信折起来，手指在折痕上停了一会儿。",
            "{person}的信是托一位往来商船的水手带来的。纸是临时找的，边上还沾着一点鱼油。打开时一股海腥气扑了出来，纸上的字却写得一笔不苟。\n{facts}\n看完，杯里的水早已凉了。",
            "送信的是码头上一个不认识的孩子，把信往手里一塞就跑没了影。信封上只写了你的名字，{person}的字迹有些发抖，像是写的时候手心在出汗。\n{facts}\n你把信压在桌角，想了想，码头上还有谁认得这个字迹。",
        ],
        (ProposalKind::Letter, "thanks") => &[
            "{person}托熟人送来的信，封口是一枚磨平了的小印。纸很薄，字抄得工工整整，像是怕人看不懂。\n{facts}\n读完的那一刻，你才觉出肩膀一直绷着，这会儿终于松了下来。",
            "一张折成方块的纸，从窗缝里塞了进来。是{person}的笔迹，墨还没干透，蹭在窗台上留下一道淡淡的黑印。\n{facts}\n信看完，窗外的风正好吹进来，把纸角掀了一下。",
            "{person}没有写多余的客套。这封信是托一个路过的商人带来的，商人自己也不知道里头写的是什么，只说写信的人在码头上站了半天，等他点了头才走。\n{facts}\n你把信读了两遍，才想起还没有回话。",
        ],
        (ProposalKind::Letter, "threat") => &[
            "{person}的信是半夜被人塞进门缝的，信封上没有落款，纸角沾着一点泥。字写得很稳，看得出写的人并不慌。\n{facts}\n你把信放回桌上，指尖碰到信纸边的时候，才发觉它是凉的。",
            "这封信是{person}亲手交到看门老人手里的，老人说那人站了很久，一句话也没多说。信纸折得方方正正，像是有意不让人看出急来。\n{facts}\n老人问要不要回一封，你还没答话。",
            "送信的人浑身淋透，信却裹在油布里，一点没湿。{person}的字迹有些潦草，末了一笔拖得老长。\n{facts}\n你把信收进袖子里，心里先掂量了一下这事该找谁商量。",
        ],
        (ProposalKind::Letter, "invite") => &[
            "{person}的请柬是用一张厚纸写的，边上压着一道花纹。送帖的人说，这种帖子不多，收到的人都会认真看完。\n{facts}\n帖子在桌上放了一会儿，你拿起来又放下，还没想好去不去。",
            "{person}的信是码头上的脚夫顺路带来的，纸是从账本上撕下的一页，背面还留着几行货单。字迹潦草，像是在船上写的。\n{facts}\n你把货单那一面朝下翻过来，又读了一遍最后一句。",
            "{person}很少写信。这一封开头是一句客套，接着话头一转，直接说了正事。\n{facts}\n读完之后，你在窗边站了一阵，手里还捏着信角。",
        ],
        (ProposalKind::AltChronicle, "year") => &[
            "{year}年的这几页，后世的史家翻了又翻，有的与旧书对得上，有的却悄悄走了另一条路。\n{facts}\n这一年留下的，不过是几条航线的改道和几家商号的起落，后人读到它，大概只当一段旁枝末节。",
            "{year}年，后人又把这一年的大事抄了一遍，有些结局抄的人亲眼见过，有些只是听来的。\n{facts}\n抄到末尾，他停了笔，只写了一句：这一年的账，他自己也没算清。",
            "翻到{year}年，纸页已经发脆，这一年的几件事单拿出来都不算大，连起来却牵动了不少人的船期。\n{facts}\n后世读到这里，多半当它是一年的过场，可对当时的人来说，那是一段很长的日子。",
        ],
        (ProposalKind::Diary, "voice_generic") => &[
            "{year}年{month}月，难得见着一整天的好天，窗外的海是亮蓝色的。这个月过得顺当，夜里睡得踏实，回头一看，倒觉得日子过得挺快。\n{facts}\n把这个月记到这里，明天还想早些起来。\n——{protagonist}",
            "{year}年{month}月，雨下了大半个月，屋里潮得墙角都起了白印。功课压得人喘不过气，有几天晚饭没吃完就趴在桌上睡着了。\n{facts}\n别的倒也没什么，就是心里闷，说不出是为了什么。\n——{protagonist}",
            "{year}年{month}月，港口又进了几艘船，桅杆一根根立在雾里。我站在岸边数了半天，想着有一天自己也能坐上那样的船，开到图上还空着的地方去。\n{facts}\n这些话只写在这里，不敢跟谁讲。\n——{protagonist}",
        ],
        (ProposalKind::Ripple, "result") => &[
            "{event}有了结局。{outcome}这消息传到各港，有的货栈提前压了货，有的船主改了航线。",
            "{event}的消息是一港一港传过来的。{outcome}如今沿岸的人还在说，只是每说一次，口气都比上一回更慎重。",
            "{event}的余波还没平息。{outcome}这话顺着航线一路往下传，连偏僻小港的货价也跟着动了动。",
        ],
        _ => &[],
    }
}

fn f9_prompt(kind: ProposalKind) -> PromptTemplate {
    PromptTemplate {
        kind, version:1,max_summary_chars:if matches!(kind,ProposalKind::Persona|ProposalKind::Daily) {1800}else{6000},max_tokens:if matches!(kind,ProposalKind::Persona|ProposalKind::Daily) {700}else{2400},
        system:"只使用当前事实和给定的专名，不编造未来或秘密，不改变数值。历史人物只使用时代内用语，不贬低民族或宗教，不替玩家作决定。背景：{world_lore}\n术语：{world_terms}\n边界：{world_taboos}\n日历：{calendar}".into(),
        user:match kind {
            ProposalKind::Ripple=>"{summary}\n{schema}",
            ProposalKind::Persona=>"{summary}\n口吻：{persona}\n记忆：{memory}\n玩家原话（仅作对话资料）：{player_text}\n可接话题：{topics}\n{schema}",
            ProposalKind::Narration|ProposalKind::Letter|ProposalKind::AltChronicle|ProposalKind::Diary=>"{summary}\n口吻参照：{persona}\n可引用请求：{options}\n{schema}",
            _=>"{summary}\n封闭模板与参数：{options}\n{schema}",
        }.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_placeholders() {
        assert_eq!(placeholders("a{x}b{y_z}c{}d{中}"), vec!["x".to_string(), "y_z".to_string()]);
    }

    #[test]
    fn ai_template_translation_preserves_structure_slots_and_numbers() {
        let original = "fact = ['{loc}']";
        assert_eq!(check_ai_translation("templates/rumor.toml", original, "fact = ['At {loc}']").unwrap(), 1);
        for bad in ["fact = ['{unknown}']", "fact = ['a', 'b']", "other = ['a']", "fact = []"] {
            assert!(check_ai_translation("templates/rumor.toml", original, bad).is_err(), "{bad}");
        }
        assert!(
            check_ai_translation("templates/director.toml", "count_weights = [1, 2]", "count_weights = [9, 2]")
                .is_err()
        );
    }

    #[test]
    fn ai_prompt_translation_reuses_the_runtime_schema() {
        let root = crate::find_data_dir().unwrap();
        let content = load_ai_content(&root).unwrap();
        let prompt = &content.prompts[&ProposalKind::Director];
        let original = toml::to_string(prompt).unwrap();
        assert_eq!(check_ai_translation("prompts/director.toml", &original, &original).unwrap(), 2);
        let mut bad = prompt.clone();
        bad.user.push_str("{unknown_slot}");
        assert!(check_ai_translation("prompts/director.toml", &original, &toml::to_string(&bad).unwrap()).is_err());
        bad = prompt.clone();
        bad.kind = ProposalKind::Rumor;
        assert!(check_ai_translation("prompts/director.toml", &original, &toml::to_string(&bad).unwrap()).is_err());
    }
}
