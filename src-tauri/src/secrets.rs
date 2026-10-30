//! User-registered API keys (BYOK), kept in the OS secret store.
//! There is deliberately NO function here that is exposed to the frontend for reading a key back:
//! the UI can only set, remove, and ask whether a slot is filled.

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

const SERVICE: &str = "vn.livestudio.app";

/// Slots the user may fill. `connector` is the key of an approved comment-source provider.
pub const SLOTS: &[&str] = &["claude", "openai", "gemini", "connector"];

pub fn valid_slot(slot: &str) -> bool {
    SLOTS.contains(&slot)
}

pub trait SecretStore: Send + Sync {
    fn set(&self, slot: &str, value: &str) -> Result<(), String>;
    fn get(&self, slot: &str) -> Result<Option<String>, String>;
    fn remove(&self, slot: &str) -> Result<(), String>;
}

pub struct KeyringStore;

impl KeyringStore {
    fn entry(slot: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, slot).map_err(|e| e.to_string())
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, slot: &str, value: &str) -> Result<(), String> {
        Self::entry(slot)?
            .set_password(value)
            .map_err(|e| e.to_string())
    }
    fn get(&self, slot: &str) -> Result<Option<String>, String> {
        match Self::entry(slot)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn remove(&self, slot: &str) -> Result<(), String> {
        match Self::entry(slot)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// In-memory store used by tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn set(&self, slot: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(slot.into(), value.into());
        Ok(())
    }
    fn get(&self, slot: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(slot).cloned())
    }
    fn remove(&self, slot: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(slot);
        Ok(())
    }
}

pub fn set_secret(store: &dyn SecretStore, slot: &str, value: &str) -> Result<(), String> {
    if !valid_slot(slot) {
        return Err("unknown slot".into());
    }
    let value = value.trim();
    if value.is_empty() {
        return Err("empty key".into());
    }
    store.set(slot, value)
}

pub fn secret_exists(store: &dyn SecretStore, slot: &str) -> Result<bool, String> {
    if !valid_slot(slot) {
        return Err("unknown slot".into());
    }
    Ok(store.get(slot)?.is_some())
}

pub fn remove_secret(store: &dyn SecretStore, slot: &str) -> Result<(), String> {
    if !valid_slot(slot) {
        return Err("unknown slot".into());
    }
    store.remove(slot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_exists_remove() {
        let s = MemoryStore::default();
        assert!(!secret_exists(&s, "claude").unwrap());
        set_secret(&s, "claude", "  sk-test  ").unwrap();
        assert!(secret_exists(&s, "claude").unwrap());
        assert_eq!(s.get("claude").unwrap().as_deref(), Some("sk-test"));
        remove_secret(&s, "claude").unwrap();
        assert!(!secret_exists(&s, "claude").unwrap());
    }

    #[test]
    fn rejects_unknown_slot_and_empty_key() {
        let s = MemoryStore::default();
        assert!(set_secret(&s, "evil", "x").is_err());
        assert!(set_secret(&s, "openai", "   ").is_err());
        assert!(secret_exists(&s, "evil").is_err());
    }
}
