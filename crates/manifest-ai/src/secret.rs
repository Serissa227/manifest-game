//! API 密钥：只存系统凭据管理器；在内存中用 [`Secret`] 包装，打印时一律遮蔽，且不可序列化。

use std::collections::BTreeMap;
use std::fmt;
use std::sync::Mutex;

/// 密钥。`Debug` / `Display` 只输出遮蔽后的内容；未实现 `Serialize`，无法写入日志或存档。
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Secret(value.into())
    }

    /// 取出明文，仅用于组装 HTTP 请求头。
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// 密钥存取错误（不含密钥内容）。
#[derive(Debug, thiserror::Error)]
pub enum KeyStoreError {
    #[error("系统凭据管理器不可用：{0}")]
    Unavailable(String),
}

/// 密钥存储。
pub trait KeyStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeyStoreError>;
    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeyStoreError>;
    fn delete(&self, account: &str) -> Result<(), KeyStoreError>;
}

/// 系统凭据管理器（Windows 凭据管理器 / macOS 钥匙串 / Linux 内核密钥环）。
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, KeyStoreError> {
        keyring::Entry::new(&self.service, account).map_err(|e| KeyStoreError::Unavailable(e.to_string()))
    }
}

impl KeyStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeyStoreError> {
        match self.entry(account)?.get_password() {
            Ok(p) => Ok(Some(Secret::new(p))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeyStoreError::Unavailable(e.to_string())),
        }
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeyStoreError> {
        self.entry(account)?.set_password(secret.expose()).map_err(|e| KeyStoreError::Unavailable(e.to_string()))
    }

    fn delete(&self, account: &str) -> Result<(), KeyStoreError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(KeyStoreError::Unavailable(e.to_string())),
        }
    }
}

/// 内存中的密钥存储（测试与无凭据管理器的环境）。
#[derive(Default)]
pub struct MemoryKeyStore {
    map: Mutex<BTreeMap<String, Secret>>,
}

impl KeyStore for MemoryKeyStore {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeyStoreError> {
        let map = self.map.lock().map_err(|_| KeyStoreError::Unavailable("锁已损坏".into()))?;
        Ok(map.get(account).cloned())
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeyStoreError> {
        let mut map = self.map.lock().map_err(|_| KeyStoreError::Unavailable("锁已损坏".into()))?;
        map.insert(account.to_string(), secret.clone());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), KeyStoreError> {
        let mut map = self.map.lock().map_err(|_| KeyStoreError::Unavailable("锁已损坏".into()))?;
        map.remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_masked() {
        let s = Secret::new("sk-very-secret");
        assert_eq!(format!("{s:?}"), "Secret(***)");
        assert_eq!(format!("{s}"), "***");
        let store = MemoryKeyStore::default();
        store.set("anthropic", &s).unwrap();
        assert_eq!(store.get("anthropic").unwrap().unwrap().expose(), "sk-very-secret");
        store.delete("anthropic").unwrap();
        assert!(store.get("anthropic").unwrap().is_none());
    }
}
