//! 世界语言声明与封闭取值校验。

use serde::{Deserialize, Deserializer, de::Error};

pub(super) fn default() -> Vec<String> {
    vec!["zh".into(), "en".into()]
}

pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    let languages = Vec::<String>::deserialize(deserializer)?;
    if !languages.iter().any(|language| language == "zh") {
        return Err(D::Error::custom("languages 必须包含 zh"));
    }
    for (index, language) in languages.iter().enumerate() {
        if !matches!(language.as_str(), "zh" | "en") {
            return Err(D::Error::custom(format!("languages 不支持 {language}，只允许 zh、en")));
        }
        if languages[..index].contains(language) {
            return Err(D::Error::custom(format!("languages 重复：{language}")));
        }
    }
    Ok(languages)
}

impl super::WorldManifest {
    pub fn requires_english(&self) -> bool {
        self.languages.iter().any(|language| language == "en")
    }
}

#[cfg(test)]
mod tests {
    use super::super::WorldManifest;

    #[test]
    fn language_schema_defaults_and_rejects_invalid_declarations() {
        let parse =
            |extra: &str| toml::from_str::<WorldManifest>(&format!("key='test'\nname='测试'\nmap='classic'\n{extra}"));
        assert_eq!(parse("").expect("缺省双语").languages, ["zh", "en"]);
        assert!(!parse("languages=['zh']").expect("中文").requires_english());
        assert_eq!(parse("languages=['en','zh']").expect("保留声明顺序").languages, ["en", "zh"]);
        for declaration in ["[]", "['en']", "['zh','fr']", "['zh-CN','en']", "['zh','zh']", "'zh'", "[1]"] {
            assert!(parse(&format!("languages={declaration}")).is_err(), "{declaration}");
        }
    }

    #[test]
    fn omitted_child_languages_default_to_bilingual() {
        let tmp = tempfile::tempdir().expect("临时目录");
        for (key, extra) in [("parent", "languages=['zh']\nmap='missing'"), ("child", "inherit='parent'")] {
            let dir = tmp.path().join("worlds").join(key);
            std::fs::create_dir_all(&dir).expect("目录");
            std::fs::write(dir.join("world.toml"), format!("key='{key}'\nname='测试'\ndraft=true\n{extra}\n"))
                .expect("清单");
        }
        let world = crate::resolve_world(tmp.path(), "child").expect("解析子包");
        assert_eq!(world.manifest.languages, ["zh", "en"]);
    }
}
