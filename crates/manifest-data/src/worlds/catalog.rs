//! 世界目录文案：英文只覆盖显示字段；缺省值与作者设定、模拟定义分离。

use super::{EffectiveWorld, WorldError, parse};
use crate::Locale;
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldText {
    pub name: String,
    pub tagline: String,
    pub blurb: String,
}

impl WorldText {
    pub fn fallback(key: &str, name: &str, locale: Locale) -> Self {
        match locale {
            Locale::ZhCn | Locale::ZhCnGemini => Self {
                name: name.into(),
                tagline: "启航探索这个世界".into(),
                blurb: "在此世界中选择剧本，开始航行与经营。".into(),
            },
            Locale::En => Self {
                name: key
                    .split(['_', '-'])
                    .filter(|part| !part.is_empty())
                    .map(|part| {
                        let mut letters = part.chars();
                        let first = letters.next().map(|c| c.to_ascii_uppercase()).unwrap_or_default();
                        format!("{first}{}", letters.as_str())
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                tagline: "Set sail and explore this world".into(),
                blurb: "Choose a scenario to begin sailing and trading in this world.".into(),
            },
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct English {
    name: Option<String>,
    tagline: Option<String>,
    blurb: Option<String>,
}

impl EffectiveWorld {
    /// world.toml 的 tagline/blurb 与 locales/en/world.toml 顶层显示覆盖都可省略。
    pub fn catalog_text(&self, locale: Locale) -> Result<WorldText, WorldError> {
        if locale == Locale::ZhCnGemini {
            return crate::locale::variant::catalog_overlay(self, self.catalog_text(Locale::ZhCn)?)
                .map_err(WorldError::from);
        }
        let mut text = if locale == Locale::En && !self.manifest.requires_english() {
            self.catalog_text(Locale::ZhCn)?
        } else {
            WorldText::fallback(&self.manifest.key, &self.manifest.name, locale)
        };
        let fields = match locale {
            Locale::ZhCn | Locale::ZhCnGemini => {
                English { name: None, tagline: self.manifest.tagline.clone(), blurb: self.manifest.blurb.clone() }
            }
            Locale::En if self.contains("locales/en/world.toml") => {
                parse("locales/en/world.toml", &self.read("locales/en/world.toml")?)?
            }
            Locale::En => English::default(),
        };
        for (target, value) in
            [(&mut text.name, fields.name), (&mut text.tagline, fields.tagline), (&mut text.blurb, fields.blurb)]
        {
            if let Some(value) = value.filter(|s| !s.trim().is_empty()) {
                *target = value;
            }
        }
        Ok(text)
    }
}
