//! 图鉴由应用层按世界隔离并原子保存，不进入内核状态和重放哈希。
use crate::{AppError, AppState};
use manifest_core::World;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
// 同一进程的不同世界/会话可能共用图鉴文件，写入需共用一把锁。
static COLLECTION_IO: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Collection {
    pub version: u32,
    pub worlds: BTreeMap<String, BTreeSet<String>>,
}
impl Default for Collection {
    fn default() -> Self {
        Self { version: 1, worlds: BTreeMap::new() }
    }
}
fn read(path: &std::path::Path) -> Result<Collection, AppError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Collection::default()),
        Err(e) => return Err(AppError::Io(e.to_string())),
    };
    let value: Collection = serde_json::from_str(&text).map_err(|e| AppError::Io(format!("结局图鉴格式错误：{e}")))?;
    if value.version != 1 {
        return Err(AppError::Io("结局图鉴版本不支持".into()));
    }
    Ok(value)
}
impl AppState {
    pub(crate) fn collect_ending(&self, world: &World) -> Result<(), AppError> {
        let Some(key) =
            world.state.upbringing.as_ref().and_then(|s| s.graduation.as_ref()).and_then(|g| g.ending.as_ref())
        else {
            return Ok(());
        };
        let _guard = COLLECTION_IO.lock().map_err(|_| AppError::Poisoned)?;
        let path = self.paths().settings_file.with_file_name("endings.json");
        let mut collection = read(&path)?;
        if !collection.worlds.entry(world.defs.world_key.clone()).or_default().insert(key.clone()) {
            return Ok(());
        }
        let bytes = serde_json::to_vec_pretty(&collection).map_err(|e| AppError::Io(e.to_string()))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
        }
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes).map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::rename(&temporary, &path).map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }
    pub(crate) fn collected_endings(&self) -> Result<BTreeSet<String>, AppError> {
        let _guard = COLLECTION_IO.lock().map_err(|_| AppError::Poisoned)?;
        Ok(read(&self.paths().settings_file.with_file_name("endings.json"))?
            .worlds
            .remove(&self.defs().world_key)
            .unwrap_or_default())
    }
}
