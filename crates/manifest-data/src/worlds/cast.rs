//! 人物集合既接受旧目录，也接受分片聚合表；保留原始文件名以关联译文与诊断。
use super::{EffectiveWorld, WorldError, files};

impl EffectiveWorld {
    pub(crate) fn cast_sources(&self) -> Result<Vec<(String, String)>, WorldError> {
        let mut result = Vec::new();
        for file in self.files_in("cast").into_iter().chain(["cast.toml".into()]).filter(|f| self.contains(f)) {
            result.push((file.clone(), self.read(&file)?));
        }
        for logical in ["persons.toml", "past.toml", "ties.toml", "figures.toml"] {
            if let Some(file) = self.files.get(logical) {
                for path in &file.sources {
                    let name = path
                        .strip_prefix(self.data_root().join("worlds"))
                        .ok()
                        .map(|p| {
                            p.components()
                                .skip(1)
                                .map(|c| c.as_os_str().to_string_lossy())
                                .collect::<Vec<_>>()
                                .join("/")
                        })
                        .unwrap_or_else(|| logical.into());
                    result.push((name, files::read_text(path)?));
                }
            }
        }
        Ok(result)
    }
}
