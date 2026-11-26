//! 分片翻译的缺省策略：允许整份覆盖缺失；中文世界的故事可缺整章，已有章节继续严格校验。

use super::{WorldError, WorldManifest, files, validate_story_translation_for_world};

/// 正式世界的合并表同样逐物理分片校验，不要求经典继承文件登记为草稿。
pub(super) fn validate_merged(
    world: &super::EffectiveWorld,
    wanted: &[String],
) -> std::collections::BTreeMap<String, Result<(), String>> {
    let mut result = std::collections::BTreeMap::new();
    for name in wanted {
        let Some(overlay) = world.files.get(&format!("locales/en/{name}")) else { continue };
        let matching: Vec<_> = world
            .files
            .values()
            .filter(|file| file.mode == super::FileMode::Fragments)
            .flat_map(|file| &file.sources)
            .filter_map(|source| world.english_path(source).map(|english| (source, english)))
            .filter(|(_, english)| overlay.sources.contains(english))
            .collect();
        if !matching.is_empty() {
            let checked = matching.into_iter().try_for_each(|(source, english)| {
                let source = files::read_text(source)?;
                let english = files::read_text(&english)?;
                validate_story_translation_for_world(&world.manifest, name, &source, &english).map(|_| ())
            });
            result.insert(name.clone(), checked.map_err(|e| e.to_string()));
        }
    }
    result
}

impl files::DraftFragment {
    pub(super) fn translated_strings(
        &self,
        manifest: &WorldManifest,
        source: &str,
    ) -> Result<Option<usize>, WorldError> {
        let exists =
            self.english.try_exists().map_err(|source| WorldError::Io { path: self.english.clone(), source })?;
        if !manifest.requires_english() && !exists {
            return Ok(None);
        }
        let english = files::read_text(&self.english)?;
        validate_story_translation_for_world(manifest, &self.file, source, &english).map(Some)
    }
}
