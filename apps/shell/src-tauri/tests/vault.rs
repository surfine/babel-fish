use rosetta_shell_lib::auth::store::{SessionStore, StoredSession};
use rosetta_shell_lib::error::SlackError;
use rosetta_shell_lib::vault::{LegacySource, MemoryBackend, Vault, VaultBackend, VaultSessionStore, VaultStore};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

fn session() -> StoredSession {
    StoredSession { team_id: "T1".into(), team_name: "t".into(), team_url: None, user_id: "U1".into(), token: "xoxc-1".into(), cookie: None }
}

/// 記錄讀取次數的後端：每次讀取在正式版都是一次 Touch ID
#[derive(Clone, Default)]
struct Counting {
    inner: Arc<MemoryBackend>,
    loads: Arc<AtomicUsize>,
}
impl VaultBackend for Counting {
    fn load(&self) -> Result<Option<Vault>, SlackError> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        self.inner.load()
    }
    fn save(&self, v: &Vault) -> Result<(), SlackError> {
        self.inner.save(v)
    }
}

struct FakeLegacy {
    vault: Mutex<Option<Vault>>,
    reads: Arc<AtomicUsize>,
}
impl LegacySource for FakeLegacy {
    fn read(&self) -> Result<Vault, SlackError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.vault.lock().unwrap().clone().unwrap_or_default())
    }
    fn delete(&self) {
        *self.vault.lock().unwrap() = None;
    }
}

#[test]
fn one_unlock_per_launch_for_session_and_keys() {
    let backend = Counting::default();
    let mut v = Vault::default();
    v.slack = Some(session());
    v.llm.insert("deepseek".into(), "sk-1".into());
    backend.inner.save(&v).unwrap();
    let store = Arc::new(VaultStore::new(Box::new(backend.clone()), None));
    let sessions = VaultSessionStore(store.clone());
    for _ in 0..3 {
        assert_eq!(sessions.load().unwrap().unwrap().team_id, "T1");
        assert_eq!(store.llm_key("deepseek").unwrap().as_deref(), Some("sk-1"));
        assert_eq!(store.llm_key("anthropic").unwrap(), None);
    }
    assert_eq!(backend.loads.load(Ordering::SeqCst), 1, "Slack 登入和金鑰共用一次解鎖");
}

#[test]
fn migrates_old_items_once_then_deletes_them() {
    let reads = Arc::new(AtomicUsize::new(0));
    let mut old = Vault::default();
    old.slack = Some(session());
    old.llm.insert("deepseek".into(), "sk-old".into());
    let legacy = FakeLegacy { vault: Mutex::new(Some(old)), reads: reads.clone() };
    let backend = Counting::default();
    let store = VaultStore::new(Box::new(backend.clone()), Some(Box::new(legacy)));
    assert_eq!(store.llm_key("deepseek").unwrap().as_deref(), Some("sk-old"));
    let saved = backend.inner.load().unwrap().expect("搬到新項目");
    assert_eq!(saved.slack.unwrap().token, "xoxc-1");
    assert_eq!(reads.load(Ordering::SeqCst), 1);
}

#[test]
fn updates_persist_and_empty_legacy_is_not_saved() {
    let reads = Arc::new(AtomicUsize::new(0));
    let backend = Counting::default();
    let store = Arc::new(VaultStore::new(Box::new(backend.clone()), Some(Box::new(FakeLegacy { vault: Mutex::new(None), reads }))));
    assert!(store.get().unwrap().is_empty());
    assert!(backend.inner.load().unwrap().is_none(), "沒有舊資料就不建立空項目");
    store.set_llm_key("anthropic", Some("sk-a".into())).unwrap();
    VaultSessionStore(store.clone()).save(&session()).unwrap();
    let saved = backend.inner.load().unwrap().unwrap();
    assert_eq!(saved.llm.get("anthropic").map(String::as_str), Some("sk-a"));
    assert!(saved.slack.is_some());
    VaultSessionStore(store.clone()).delete().unwrap();
    store.set_llm_key("anthropic", None).unwrap();
    assert!(backend.inner.load().unwrap().unwrap().is_empty());
}

#[test]
fn debug_output_hides_keys_and_tokens() {
    let mut v = Vault::default();
    v.slack = Some(session());
    v.llm.insert("deepseek".into(), "sk-secret".into());
    let s = format!("{v:?}");
    assert!(!s.contains("sk-secret") && !s.contains("xoxc-1"), "{s}");
}
