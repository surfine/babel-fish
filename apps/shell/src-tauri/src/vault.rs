//! 所有機密（Slack 登入、AI 金鑰）放在鑰匙圈的同一個項目裡，每次啟動只解鎖一次。
//!
//! - 正式版：新式鑰匙圈（data protection keychain）。只有帶著同一團隊權限簽章的 Babel Fish 讀得到，
//!   Mac 解鎖後就能讀，不跳任何視窗（不加 Touch ID：使用者要的是不被打斷）。需要描述檔授權的
//!   `keychain-access-groups` 權限：Entitlements.plist 與 embedded.provisionprofile，由 scripts/release.sh 打包時加進 App。
//! - 開發版（以及缺權限的建置）：舊式鑰匙圈的單一項目。開發版是裸執行檔，放不了描述檔。
//! - 第一次讀不到新項目時，從舊的分開項目（Slack 登入、rosetta-<供應商>）搬過來，搬完刪掉舊的。
//!
//! 讀到的內容記在記憶體；讀取時持有鎖，同時進來的呼叫等第一個讀完，不會各自跳 Touch ID。
use crate::auth::store::{SessionStore, StoredSession};
use crate::error::SlackError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

pub const VAULT_SERVICE: &str = "app.rosetta.vault";
pub const VAULT_ACCOUNT: &str = "default";
/// 新式鑰匙圈的項目。2026-11-19 曾用 "default" 存過一版要 Touch ID 的項目，改成不需驗證後換新帳號名，舊的搬過來再刪
pub const PROTECTED_ACCOUNT: &str = "app";
pub const LLM_PROVIDERS: [&str; 2] = ["anthropic", "deepseek"];

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Vault {
    #[serde(default)]
    pub slack: Option<StoredSession>,
    /// 供應商 → 金鑰
    #[serde(default)]
    pub llm: BTreeMap<String, String>,
}

impl Vault {
    pub fn is_empty(&self) -> bool {
        self.slack.is_none() && self.llm.is_empty()
    }
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault").field("slack", &self.slack).field("llm", &self.llm.keys().collect::<Vec<_>>()).finish()
    }
}

/// 存放整個 Vault 的地方。
pub trait VaultBackend: Send + Sync {
    fn load(&self) -> Result<Option<Vault>, SlackError>;
    fn save(&self, vault: &Vault) -> Result<(), SlackError>;
}

/// 改版前的分開項目：只在搬移時讀一次、搬完刪掉。
pub trait LegacySource: Send + Sync {
    fn read(&self) -> Result<Vault, SlackError>;
    fn delete(&self);
}

pub struct VaultStore {
    backend: Box<dyn VaultBackend>,
    legacy: Option<Box<dyn LegacySource>>,
    cache: Mutex<Option<Vault>>,
}

impl VaultStore {
    pub fn new(backend: Box<dyn VaultBackend>, legacy: Option<Box<dyn LegacySource>>) -> Self {
        Self { backend, legacy, cache: Mutex::new(None) }
    }

    fn load_locked(&self, cache: &mut Option<Vault>) -> Result<Vault, SlackError> {
        if let Some(v) = cache.as_ref() {
            return Ok(v.clone());
        }
        let v = match self.backend.load()? {
            Some(v) => v,
            None => self.migrate()?,
        };
        *cache = Some(v.clone());
        Ok(v)
    }

    fn migrate(&self) -> Result<Vault, SlackError> {
        let Some(legacy) = &self.legacy else { return Ok(Vault::default()) };
        let v = legacy.read()?;
        if !v.is_empty() {
            self.backend.save(&v)?;
            legacy.delete();
        }
        Ok(v)
    }

    pub fn get(&self) -> Result<Vault, SlackError> {
        let mut cache = self.cache.lock().unwrap();
        self.load_locked(&mut cache)
    }

    pub fn update(&self, f: impl FnOnce(&mut Vault)) -> Result<(), SlackError> {
        let mut cache = self.cache.lock().unwrap();
        let mut v = self.load_locked(&mut cache)?;
        f(&mut v);
        self.backend.save(&v)?;
        *cache = Some(v);
        Ok(())
    }

    pub fn llm_key(&self, provider: &str) -> Result<Option<String>, SlackError> {
        Ok(self.get()?.llm.get(provider).cloned().filter(|k| !k.is_empty()))
    }

    pub fn set_llm_key(&self, provider: &str, key: Option<String>) -> Result<(), SlackError> {
        self.update(|v| match key {
            Some(k) => {
                v.llm.insert(provider.to_string(), k);
            }
            None => {
                v.llm.remove(provider);
            }
        })
    }
}

/// 給 AppState 用的 Slack 登入存取：讀寫都經過同一個 Vault。
pub struct VaultSessionStore(pub Arc<VaultStore>);

impl SessionStore for VaultSessionStore {
    fn load(&self) -> Result<Option<StoredSession>, SlackError> {
        Ok(self.0.get()?.slack)
    }
    fn save(&self, session: &StoredSession) -> Result<(), SlackError> {
        let s = session.clone();
        self.0.update(|v| v.slack = Some(s))
    }
    fn delete(&self) -> Result<(), SlackError> {
        self.0.update(|v| v.slack = None)
    }
}

#[derive(Default)]
pub struct MemoryBackend(pub Mutex<Option<Vault>>);

impl VaultBackend for MemoryBackend {
    fn load(&self) -> Result<Option<Vault>, SlackError> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, vault: &Vault) -> Result<(), SlackError> {
        *self.0.lock().unwrap() = Some(vault.clone());
        Ok(())
    }
}

fn to_json(v: &Vault) -> Result<Vec<u8>, SlackError> {
    serde_json::to_vec(v).map_err(|e| SlackError::Internal(e.to_string()))
}

fn from_json(bytes: &[u8]) -> Result<Vault, SlackError> {
    // 內容壞掉就回錯，不把內容放進錯誤訊息
    serde_json::from_slice(bytes).map_err(|_| SlackError::Internal("keychain: 已存的資料格式不正確".into()))
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options, PasswordOptions,
    };

    const ERR_NOT_FOUND: i32 = -25300;
    const ERR_USER_CANCELED: i32 = -128;
    const ERR_AUTH_FAILED: i32 = -25293;
    pub const ERR_MISSING_ENTITLEMENT: i32 = -34018;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecUseOperationPrompt: CFStringRef;
    }

    fn keychain_err(e: security_framework::base::Error) -> SlackError {
        match e.code() {
            ERR_USER_CANCELED | ERR_AUTH_FAILED => SlackError::Internal("沒有解鎖鑰匙圈，讀不到 Slack 登入與 AI 金鑰".into()),
            c => SlackError::Internal(format!("keychain: {c}")),
        }
    }

    /// 新式鑰匙圈。account 是 PROTECTED_ACCOUNT；舊的 Touch ID 項目用 VAULT_ACCOUNT
    pub struct ProtectedBackend {
        pub account: &'static str,
    }

    impl ProtectedBackend {
        fn options_for(account: &str) -> PasswordOptions {
            let mut o = PasswordOptions::new_generic_password(VAULT_SERVICE, account);
            o.use_protected_keychain();
            o
        }
        fn options(&self) -> PasswordOptions {
            Self::options_for(self.account)
        }
        pub fn delete(&self) {
            let _ = delete_generic_password_options(self.options());
        }

        /// 試讀一次，看這個建置有沒有新式鑰匙圈的權限（不會跳 Touch ID：查不到資料時不需要驗證）
        pub fn available() -> bool {
            let mut o = Self::options_for(PROTECTED_ACCOUNT);
            #[allow(deprecated)]
            o.query.push((
                unsafe { CFString::wrap_under_get_rule(security_framework_sys::item::kSecUseAuthenticationUI) },
                unsafe { CFString::wrap_under_get_rule(security_framework_sys::item::kSecUseAuthenticationUISkip) }.into_CFType(),
            ));
            match generic_password(o) {
                Err(e) if e.code() == ERR_MISSING_ENTITLEMENT => false,
                _ => true,
            }
        }
    }

    impl VaultBackend for ProtectedBackend {
        fn load(&self) -> Result<Option<Vault>, SlackError> {
            let mut o = self.options();
            // 只有舊的 Touch ID 項目會用到這段提示
            #[allow(deprecated)]
            o.query.push((
                unsafe { CFString::wrap_under_get_rule(kSecUseOperationPrompt) },
                CFString::new("把 Slack 登入與 AI 金鑰搬到新的位置").into_CFType(),
            ));
            match generic_password(o) {
                Ok(bytes) => from_json(&bytes).map(Some),
                Err(e) if e.code() == ERR_NOT_FOUND => Ok(None),
                Err(e) => Err(keychain_err(e)),
            }
        }

        fn save(&self, vault: &Vault) -> Result<(), SlackError> {
            match delete_generic_password_options(self.options()) {
                Ok(()) => {}
                Err(e) if e.code() == ERR_NOT_FOUND => {}
                Err(e) => return Err(keychain_err(e)),
            }
            let mut o = self.options();
            // Mac 解鎖後可讀、只存在這台 Mac，不加 Touch ID 之類的額外驗證
            let ac = SecAccessControl::create_with_protection(Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly), 0)
                .map_err(keychain_err)?;
            o.set_access_control(ac);
            o.set_label("Babel Fish");
            set_generic_password_options(&to_json(vault)?, o).map_err(keychain_err)
        }
    }

    /// 舊式鑰匙圈的單一項目（開發版）
    pub struct FileBackend;

    impl VaultBackend for FileBackend {
        fn load(&self) -> Result<Option<Vault>, SlackError> {
            match keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT).and_then(|e| e.get_secret()) {
                Ok(bytes) => from_json(&bytes).map(Some),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(SlackError::Internal(format!("keychain: {e}"))),
            }
        }
        fn save(&self, vault: &Vault) -> Result<(), SlackError> {
            let bytes = to_json(vault)?;
            keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT)
                .and_then(|e| e.set_secret(&bytes))
                .map_err(|e| SlackError::Internal(format!("keychain: {e}")))
        }
    }

    /// 改版前的項目：Slack 登入（app.rosetta.shell / slack-web-session）、各家 AI 金鑰（rosetta-<供應商> / $USER），
    /// 以及開發版用過的舊式單一項目
    pub struct LegacyItems {
        pub include_file_vault: bool,
        /// 也看舊的 Touch ID 項目（只有正式版）
        pub include_touch_id_vault: bool,
    }

    impl LegacySource for LegacyItems {
        fn read(&self) -> Result<Vault, SlackError> {
            if self.include_touch_id_vault {
                if let Some(v) = (ProtectedBackend { account: VAULT_ACCOUNT }).load()? {
                    return Ok(v);
                }
            }
            if self.include_file_vault {
                if let Some(v) = FileBackend.load()? {
                    return Ok(v);
                }
            }
            let mut v = Vault::default();
            v.slack = crate::auth::store::KeychainStore.load()?;
            let user = std::env::var("USER").unwrap_or_default();
            for p in LLM_PROVIDERS {
                if let Ok(k) = keyring::Entry::new(&format!("rosetta-{p}"), &user).and_then(|e| e.get_password()) {
                    if !k.is_empty() {
                        v.llm.insert(p.to_string(), k);
                    }
                }
            }
            Ok(v)
        }

        fn delete(&self) {
            if self.include_touch_id_vault {
                (ProtectedBackend { account: VAULT_ACCOUNT }).delete();
            }
            let _ = crate::auth::store::KeychainStore.delete();
            let user = std::env::var("USER").unwrap_or_default();
            for p in LLM_PROVIDERS {
                if let Ok(e) = keyring::Entry::new(&format!("rosetta-{p}"), &user) {
                    let _ = e.delete_credential();
                }
            }
            if self.include_file_vault {
                if let Ok(e) = keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT) {
                    let _ = e.delete_credential();
                }
            }
        }
    }
}

static VAULT: OnceLock<Arc<VaultStore>> = OnceLock::new();

/// App 用的 Vault。正式版有權限就用新式鑰匙圈，否則用舊式單一項目。
pub fn global() -> Arc<VaultStore> {
    VAULT
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            {
                let protected = !cfg!(debug_assertions) && mac::ProtectedBackend::available();
                let store = if protected {
                    VaultStore::new(
                        Box::new(mac::ProtectedBackend { account: PROTECTED_ACCOUNT }),
                        Some(Box::new(mac::LegacyItems { include_file_vault: true, include_touch_id_vault: true })),
                    )
                } else {
                    VaultStore::new(
                        Box::new(mac::FileBackend),
                        Some(Box::new(mac::LegacyItems { include_file_vault: false, include_touch_id_vault: false })),
                    )
                };
                Arc::new(store)
            }
            #[cfg(not(target_os = "macos"))]
            {
                Arc::new(VaultStore::new(Box::new(MemoryBackend::default()), None))
            }
        })
        .clone()
}
