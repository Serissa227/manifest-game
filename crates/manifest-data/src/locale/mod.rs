//! 多语言（EXPANSION.md §12）：语言、覆盖文件、后端显示文字与按语言格式化。
//!
//! - 中文（`zh-CN`）就是 `data/` 下的原数据；其他语言用覆盖文件 `data/locales/<语言>/` 提供显示文字：
//!   与原数据文件同名同路径，只写要覆盖的显示字段（格式见 `overrides` 模块与 README“语言与翻译”）。
//! - 覆盖只改显示：[`LocaleBundle::defs`] 是一份显示字段换成该语言的静态数据副本（下标、数值、key 与原数据完全相同）；
//!   世界始终用原数据运行，切换语言不改变世界状态、世界哈希、存档与重放。
//! - 覆盖文件缺某条时回退到中文，[`LocaleBundle::missing`] 列出缺失的条目（`validate-data` 输出条数，测试要求英文齐全）。
//! - 后端生成的文字（离线模板的传闻、议价回复、编年史，事件效果说明，命令被拒绝的原因，应用层提示）
//!   按语言格式化，见 `render` 模块。

mod fragments;
mod overrides;
pub(crate) use overrides::{native_history_display, native_ideas_display, native_upbringing_display};
mod render;
mod source;
mod texts;

pub use overrides::variant;
pub use overrides::{FILES_WITHOUT_DISPLAY_TEXT, Missing, data_files};
pub use render::{ComposedText, fill, glossary, localize_composed};
pub use texts::Texts;

use crate::ai_content::{AiContent, ComposedTemplate, PromptTemplate, ProposalKind};
use crate::{DataError, DataIssue};
use manifest_core::StaticData;
use manifest_core::defs::EffectKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// 界面与内容的语言；中文变体的对外代码为 `zh-CN-x-gemini`。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum Locale {
    /// 简体中文（默认；就是 data/ 下的原数据）
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn,
    /// 英语（data/locales/en/）
    #[serde(rename = "en")]
    En,
    /// 第二套中文；按字段稀疏覆盖，来源变化时回退。
    #[serde(rename = "zh-CN-x-gemini")]
    ZhCnGemini,
}

impl Locale {
    pub const ALL: [Locale; 3] = [Locale::ZhCn, Locale::En, Locale::ZhCnGemini];

    pub fn is_chinese(self) -> bool {
        self != Locale::En
    }

    /// 对外语言代码；系统语言不会自动选择中文变体。
    pub fn code(self) -> &'static str {
        match self {
            Locale::ZhCn => "zh-CN",
            Locale::En => "en",
            Locale::ZhCnGemini => "zh-CN-x-gemini",
        }
    }

    /// 覆盖文件目录名（`data/locales/<dir>/`）；中文没有覆盖目录。
    pub fn dir(self) -> Option<&'static str> {
        match self {
            Locale::ZhCn => None,
            Locale::En => Some("en"),
            Locale::ZhCnGemini => Some("zh-gemini"),
        }
    }

    /// 语言的英文名（写进提示词，要求模型用该语言写作）。
    pub fn english_name(self) -> &'static str {
        match self {
            Locale::ZhCn | Locale::ZhCnGemini => "Simplified Chinese",
            Locale::En => "English",
        }
    }

    pub fn parse(code: &str) -> Option<Locale> {
        Locale::ALL.into_iter().find(|l| l.code().eq_ignore_ascii_case(code))
    }

    /// 按系统语言标签选择：`zh` 开头取中文，否则英语（EXPANSION.md §12.1）。
    pub fn from_system(tag: &str) -> Locale {
        if tag.trim().to_ascii_lowercase().starts_with("zh") { Locale::ZhCn } else { Locale::En }
    }
}

impl<'de> Deserialize<'de> for Locale {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let code = String::deserialize(deserializer)?;
        Ok(Self::parse(&code).unwrap_or_default())
    }
}

/// 组合事件原型的文字（某语言）与效果组合（用于找回模板位置）。
#[derive(Clone, Debug, PartialEq)]
pub struct ArchetypeText {
    pub titles: Vec<String>,
    pub narratives: Vec<String>,
    /// 原型的效果种类（按顺序；来自中文原型）
    pub kinds: Vec<EffectKind>,
}

/// 离线模板中的文字（某语言）：与 `data/templates/` 中文模板逐条对应（同一小节、同一序号）。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TemplateText {
    pub rumor: BTreeMap<String, Vec<String>>,
    pub bargain: BTreeMap<String, Vec<String>>,
    pub chronicle: BTreeMap<String, Vec<String>>,
    pub composed_sources: Vec<String>,
    pub composed: BTreeMap<String, ArchetypeText>,
    /// 第八批 E7 的文字模板（商会展望、市场月报、复盘点评、身世序章），按文件名
    pub texts: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}

impl TemplateText {
    /// 中文离线模板中的文字。
    pub fn from_ai(ai: &AiContent) -> TemplateText {
        let t = &ai.templates;
        TemplateText {
            rumor: t.rumor.clone(),
            bargain: t.bargain.clone(),
            chronicle: t.chronicle.clone(),
            composed_sources: t.composed.sources.clone(),
            composed: composed_text(&t.composed),
            texts: [
                ("outlook", &t.outlook),
                ("market_report", &t.market_report),
                ("review", &t.review),
                ("prologue", &t.prologue),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .chain(t.f9.iter().map(|(k, v)| (k.clone(), v.clone())))
            .collect(),
        }
    }

    /// 模板位置（`file`, `section`, `index`）上的文字。
    pub fn line(&self, file: &str, section: &str, index: usize) -> Option<&str> {
        let list = match file {
            "rumor" => self.rumor.get(section)?,
            "bargain" => self.bargain.get(section)?,
            "chronicle" => self.chronicle.get(section)?,
            "outlook" | "market_report" | "review" | "prologue" | "ripple" | "persona" | "daily" | "narration"
            | "letter" | "alt_chronicle" | "diary" => self.texts.get(file)?.get(section)?,
            "composed" if section == "sources" => &self.composed_sources,
            "composed" => {
                let (arch, field) = section.split_once('.')?;
                let a = self.composed.get(arch)?;
                match field {
                    "titles" => &a.titles,
                    "narratives" => &a.narratives,
                    _ => return None,
                }
            }
            _ => return None,
        };
        list.get(index).map(String::as_str)
    }
}

fn composed_text(c: &ComposedTemplate) -> BTreeMap<String, ArchetypeText> {
    c.archetypes
        .iter()
        .map(|a| {
            let kinds = a.effects.iter().filter_map(|e| EffectKind::from_key(&e.effect)).collect();
            (a.key.clone(), ArchetypeText { titles: a.titles.clone(), narratives: a.narratives.clone(), kinds })
        })
        .collect()
}

/// 某语言的全部显示内容。
#[derive(Clone, Debug)]
pub struct LocaleBundle {
    pub locale: Locale,
    /// 显示用静态数据：显示字段（名称、介绍、简史、小传、货币与纪年……）换成该语言，
    /// 其余（下标、数值、key、数据哈希）与原数据完全相同。只用于显示，不能用来运行世界。
    pub defs: Arc<StaticData>,
    /// 后端显示文字（缺失的键回退到中文）
    pub texts: Texts,
    /// 离线模板中的文字（缺失的小节回退到中文）
    pub templates: TemplateText,
    /// 提示词模板（该语言有整文件覆盖的换成覆盖，其余为中文）
    pub prompts: BTreeMap<ProposalKind, PromptTemplate>,
    /// 商品类别的显示名（中文类别 → 该语言；类别本身是内部键，不改）
    pub categories: BTreeMap<String, String>,
    /// 缺失、回退到中文的条目
    pub missing: Vec<Missing>,
    /// 中文变体的实际生效覆盖与过期字段数；不进入世界定义或存档。
    pub variant_coverage: variant::Coverage,
}

impl LocaleBundle {
    /// 中文（原数据）。
    pub fn chinese(defs: Arc<StaticData>, ai: &AiContent, texts: Texts) -> LocaleBundle {
        let categories = defs.goods.iter().map(|g| (g.category.clone(), g.category.clone())).collect();
        LocaleBundle {
            locale: Locale::ZhCn,
            defs,
            texts,
            templates: TemplateText::from_ai(ai),
            prompts: ai.prompts.clone(),
            categories,
            missing: Vec::new(),
            variant_coverage: Default::default(),
        }
    }

    /// 商品类别的显示名。
    pub fn category(&self, zh: &str) -> String {
        self.categories.get(zh).cloned().unwrap_or_else(|| zh.to_string())
    }
}

/// 读取 `data/texts.toml`（中文后端显示文字）并与内核的错误码、效果说明核对。
pub fn load_texts(dir: &Path) -> Result<Texts, DataError> {
    let mut issues = Vec::new();
    let t = texts::load_zh(&source::Source::directory(dir), &mut issues);
    match t {
        Some(t) if issues.is_empty() => Ok(t),
        _ => Err(DataError { issues }),
    }
}

/// 加载某语言的显示内容（覆盖文件有问题时报告全部问题）。
///
/// `defs` 与 `ai` 为原数据（中文）。中文直接包装原数据；其他语言读取 `data/locales/<语言>/`，
/// 校验覆盖的条目存在于原数据、字段可以覆盖、模板逐条对应，然后生成显示用的数据副本。
pub fn load_locale(
    dir: &Path,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
) -> Result<LocaleBundle, DataError> {
    let (bundle, issues) = load_locale_lenient(dir, locale, defs, ai);
    if issues.is_empty() { Ok(bundle) } else { Err(DataError { issues }) }
}

/// 宽松加载：有问题的覆盖（条目不存在、字段不能覆盖、模板对不上……）跳过并回退到中文，同时返回全部问题。
///
/// 桌面应用用它：原数据改了、译文还没跟上时游戏照常运行（缺的译文显示中文）；问题由 `validate-data` 与测试报告。
pub fn load_locale_lenient(
    dir: &Path,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
) -> (LocaleBundle, Vec<DataIssue>) {
    let mut issues: Vec<DataIssue> = Vec::new();
    let zh_texts = texts::load_zh(&source::Source::directory(dir), &mut issues).unwrap_or_default();
    let Some(sub) = locale.dir() else {
        return (LocaleBundle::chinese(defs.clone(), ai, zh_texts), issues);
    };
    let root = dir.join("locales").join(sub);
    let mut bundle = overrides::load(
        &source::Source::directory(dir),
        &source::Source::directory(&root),
        &format!("locales/{sub}"),
        locale,
        defs,
        ai,
        zh_texts,
        &mut issues,
    );
    if locale == Locale::En {
        fragments::validate(dir, &mut bundle.missing, &mut issues);
    }
    (bundle, issues)
}

/// 某语言覆盖文件缺失的条目（中文永远齐全）。
pub fn coverage(dir: &Path, locale: Locale) -> Result<Vec<Missing>, DataError> {
    Ok(load_locale_shared(dir, locale)?.missing.clone())
}

type LocaleCache = Mutex<BTreeMap<(PathBuf, Locale), (String, Arc<LocaleBundle>, Vec<DataIssue>)>>;

/// 进程内共享的显示内容：同一目录、同一语言且内容（含覆盖文件）未变时直接返回上次的结果。
/// 覆盖文件有问题时返回全部问题（严格）。
pub fn load_locale_shared(dir: &Path, locale: Locale) -> Result<Arc<LocaleBundle>, DataError> {
    let (bundle, issues) = load_locale_shared_lenient(dir, locale)?;
    if issues.is_empty() { Ok(bundle) } else { Err(DataError { issues }) }
}

/// 同 [`load_locale_shared`]，但宽松（见 [`load_locale_lenient`]）：只有原数据本身加载失败时才返回错误。
pub fn load_locale_shared_lenient(
    dir: &Path,
    locale: Locale,
) -> Result<(Arc<LocaleBundle>, Vec<DataIssue>), DataError> {
    static CACHE: OnceLock<LocaleCache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    let key = (dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf()), locale);
    let hash = format!("{}:{}", crate::convert::hash_all(dir), fragments::fingerprint(dir));
    let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((h, b, is)) = c.get(&key)
        && *h == hash
    {
        return Ok((b.clone(), is.clone()));
    }
    let defs = crate::load_shared(dir)?;
    let ai = crate::load_ai_content(dir)?;
    let (bundle, issues) = load_locale_lenient(dir, locale, &defs, &ai);
    let bundle = Arc::new(bundle);
    c.insert(key, (hash, bundle.clone(), issues.clone()));
    Ok((bundle, issues))
}

/// 按世界有效文件加载显示内容；继承与分片沿用世界解析器，坏覆盖仍回退中文。
pub fn load_world_locale_lenient(
    world: &crate::worlds::EffectiveWorld,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
) -> (LocaleBundle, Vec<DataIssue>) {
    let source = source::Source::world(world);
    load_world_locale_source(source, locale, defs, ai, true)
}

/// 游戏运行时用的 [`load_world_locale_lenient`]（2026-11-03 启动提速）：得到的显示内容完全相同，
/// 只是不做只为报告问题的文件级检查（覆盖文件有没有对应的原数据、分片译文的结构比对）——
/// 运行时本来就丢掉这些问题，它们由 `validate-data` 与测试报告。
pub fn load_world_locale(
    world: &crate::worlds::EffectiveWorld,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
) -> LocaleBundle {
    load_world_locale_source(source::Source::world(world), locale, defs, ai, false).0
}

/// 显式复用公共 UI/AI 文字；游戏条目和分片登记仍由目标世界独立校验。
pub fn load_world_locale_with_common_texts_lenient(
    world: &crate::worlds::EffectiveWorld,
    common: &crate::worlds::EffectiveWorld,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
) -> (LocaleBundle, Vec<DataIssue>) {
    load_world_locale_source(source::Source::world_with_common_texts(world, common), locale, defs, ai, true)
}

/// `file_checks`：是否做只为报告问题的文件级检查（见 [`load_world_locale`]）。
fn load_world_locale_source(
    source: source::Source<'_>,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
    file_checks: bool,
) -> (LocaleBundle, Vec<DataIssue>) {
    let mut issues = Vec::new();
    let texts = texts::load_zh(&source, &mut issues).unwrap_or_default();
    let Some(sub) = locale.dir() else {
        return (LocaleBundle::chinese(defs.clone(), ai, texts), issues);
    };
    let prefix = format!("locales/{sub}");
    let root = source.join(&prefix);
    let bundle = overrides::load_with(&source, &root, &prefix, locale, defs, ai, texts, file_checks, &mut issues);
    (bundle, issues)
}
