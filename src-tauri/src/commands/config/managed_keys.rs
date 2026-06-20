// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

use super::{ConfigEncryptionKeyLookup, ConfigState};
use crate::config::types::{ManagedSshKey, ManagedSshKeyOrigin};
use crate::config::{CONFIG_ENCRYPTION_KEY_LEN, ConfigFile, SavedAuth};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce, aead::Aead};
use rand::RngCore;
use russh::keys::{PrivateKey, PublicKeyBase64};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use zeroize::Zeroizing;

pub(super) const MANAGED_SSH_KEYCHAIN_SERVICE: &str = "com.oxideterm.managed-ssh-keys";
const MANAGED_SSH_KEY_SECRET_DIR: &str = "managed-ssh-key-secrets";
const MANAGED_SSH_KEY_SECRET_FILE_FORMAT: &str = "oxideterm.managed-ssh-key-secret.encrypted";
const MANAGED_SSH_KEY_SECRET_FILE_VERSION: u32 = 1;
const MANAGED_SSH_KEY_SECRET_FILE_ALGORITHM: &str = "chacha20poly1305";
const MANAGED_SSH_KEY_SECRET_NONCE_LEN: usize = 12;

#[derive(Debug, Serialize, Deserialize)]
struct ManagedSshKeySecretEnvelope {
    format: String,
    version: u32,
    algorithm: String,
    nonce: String,
    ciphertext: String,
}

struct ManagedSshKeySecretWrite {
    created_config_key: bool,
}

fn validate_managed_ssh_key_secret_id(secret_id: &str) -> Result<(), String> {
    let valid = !secret_id.is_empty()
        && secret_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

    if valid {
        Ok(())
    } else {
        Err("Invalid managed SSH key secret ID".to_string())
    }
}

fn managed_ssh_key_secret_file_path(data_dir: &Path, secret_id: &str) -> Result<PathBuf, String> {
    validate_managed_ssh_key_secret_id(secret_id)?;
    Ok(data_dir
        .join(MANAGED_SSH_KEY_SECRET_DIR)
        .join(format!("{}.json", secret_id)))
}

fn encrypt_managed_ssh_key_secret(
    private_key: &str,
    config_key: &[u8; CONFIG_ENCRYPTION_KEY_LEN],
) -> Result<ManagedSshKeySecretEnvelope, String> {
    let mut nonce = [0u8; MANAGED_SSH_KEY_SECRET_NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    let cipher = ChaCha20Poly1305::new_from_slice(config_key)
        .map_err(|_| "Invalid local config encryption key".to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), private_key.as_bytes())
        .map_err(|_| "Failed to encrypt managed SSH key secret".to_string())?;

    Ok(ManagedSshKeySecretEnvelope {
        format: MANAGED_SSH_KEY_SECRET_FILE_FORMAT.to_string(),
        version: MANAGED_SSH_KEY_SECRET_FILE_VERSION,
        algorithm: MANAGED_SSH_KEY_SECRET_FILE_ALGORITHM.to_string(),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_managed_ssh_key_secret(
    envelope: ManagedSshKeySecretEnvelope,
    config_key: &[u8; CONFIG_ENCRYPTION_KEY_LEN],
) -> Result<Zeroizing<String>, String> {
    if envelope.format != MANAGED_SSH_KEY_SECRET_FILE_FORMAT
        || envelope.version != MANAGED_SSH_KEY_SECRET_FILE_VERSION
        || envelope.algorithm != MANAGED_SSH_KEY_SECRET_FILE_ALGORITHM
    {
        return Err("Invalid managed SSH key secret file".to_string());
    }

    let nonce = BASE64
        .decode(envelope.nonce)
        .map_err(|_| "Invalid managed SSH key secret nonce".to_string())?;
    let nonce: [u8; MANAGED_SSH_KEY_SECRET_NONCE_LEN] = nonce
        .try_into()
        .map_err(|_| "Invalid managed SSH key secret nonce".to_string())?;
    let ciphertext = BASE64
        .decode(envelope.ciphertext)
        .map_err(|_| "Invalid managed SSH key secret ciphertext".to_string())?;

    let cipher = ChaCha20Poly1305::new_from_slice(config_key)
        .map_err(|_| "Invalid local config encryption key".to_string())?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
            .map_err(|_| "Failed to decrypt managed SSH key secret".to_string())?,
    );

    String::from_utf8(plaintext.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| "Managed SSH key secret is not valid UTF-8".to_string())
}

fn write_managed_ssh_key_secret_file(
    data_dir: &Path,
    secret_id: &str,
    private_key: &str,
    config_key: &[u8; CONFIG_ENCRYPTION_KEY_LEN],
) -> Result<(), String> {
    let path = managed_ssh_key_secret_file_path(data_dir, secret_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid managed SSH key secret path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create managed SSH key secret directory: {}",
            error
        )
    })?;

    // Large private keys cannot reliably fit in every OS keychain backend.
    // The fallback file stores only encrypted ciphertext under the app data directory.
    let envelope = encrypt_managed_ssh_key_secret(private_key, config_key)?;
    let json = serde_json::to_vec_pretty(&envelope)
        .map_err(|error| format!("Failed to serialize managed SSH key secret: {}", error))?;
    let temp_path = path.with_extension("json.tmp");
    std::fs::write(&temp_path, json)
        .map_err(|error| format!("Failed to write managed SSH key secret: {}", error))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Failed to finalize managed SSH key secret: {}", error))?;
    Ok(())
}

fn read_managed_ssh_key_secret_file(
    data_dir: &Path,
    secret_id: &str,
    config_key: &[u8; CONFIG_ENCRYPTION_KEY_LEN],
) -> Result<Zeroizing<String>, String> {
    let path = managed_ssh_key_secret_file_path(data_dir, secret_id)?;
    let json = std::fs::read(&path)
        .map_err(|error| format!("Failed to read managed SSH key secret: {}", error))?;
    let envelope: ManagedSshKeySecretEnvelope = serde_json::from_slice(&json)
        .map_err(|error| format!("Failed to parse managed SSH key secret: {}", error))?;
    decrypt_managed_ssh_key_secret(envelope, config_key)
}

fn delete_managed_ssh_key_secret_file(data_dir: &Path, secret_id: &str) -> Result<(), String> {
    let path = managed_ssh_key_secret_file_path(data_dir, secret_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete managed SSH key secret: {}",
            error
        )),
    }
}

impl ConfigState {
    fn store_managed_ssh_key_secret(
        &self,
        key: &str,
        value: &str,
    ) -> Result<ManagedSshKeySecretWrite, String> {
        self.ensure_ready()?;
        match self.managed_keychain.store(key, value) {
            Ok(()) => Ok(ManagedSshKeySecretWrite {
                created_config_key: false,
            }),
            Err(keychain_error) => {
                tracing::warn!(
                    "Managed SSH keychain store failed for id={}; falling back to encrypted local secret file: {}",
                    key,
                    keychain_error
                );
                let _ = self.managed_keychain.delete(key);
                let (config_key, created_config_key) =
                    self.get_or_create_config_encryption_key_cached()?;
                write_managed_ssh_key_secret_file(
                    &self.config_data_dir()?,
                    key,
                    value,
                    &config_key,
                )?;
                Ok(ManagedSshKeySecretWrite { created_config_key })
            }
        }
    }

    pub(crate) fn set_managed_keychain_value(&self, key: &str, value: &str) -> Result<(), String> {
        self.store_managed_ssh_key_secret(key, value).map(|_| ())
    }

    pub(crate) fn delete_managed_keychain_value(&self, key: &str) -> Result<(), String> {
        self.ensure_ready()?;
        let keychain_result = self.managed_keychain.delete(key).map_err(|e| e.to_string());
        let file_result = delete_managed_ssh_key_secret_file(&self.config_data_dir()?, key);

        match (keychain_result, file_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(keychain_error), Ok(())) => {
                tracing::debug!(
                    "Managed SSH keychain delete skipped for id={}: {}",
                    key,
                    keychain_error
                );
                Ok(())
            }
            (Ok(()), Err(file_error)) => Err(file_error),
            (Err(keychain_error), Err(file_error)) => Err(format!(
                "Failed to delete managed SSH key secret from keychain ({}) and encrypted file ({})",
                keychain_error, file_error
            )),
        }
    }

    pub(crate) fn get_managed_ssh_key_metadata(
        &self,
        key_id: &str,
    ) -> Result<ManagedSshKey, String> {
        self.ensure_ready()?;
        self.config
            .read()
            .managed_ssh_keys
            .iter()
            .find(|key| key.id == key_id)
            .cloned()
            .ok_or_else(|| "Managed SSH key not found".to_string())
    }

    pub(crate) fn resolve_managed_ssh_key_private_key(
        &self,
        key_id: &str,
    ) -> Result<Zeroizing<String>, String> {
        self.ensure_ready()?;
        let secret_id = self.get_managed_ssh_key_metadata(key_id)?.secret_id;

        // Secret material leaves the managed backend only at the SSH auth boundary.
        // Callers must decode/use it immediately and must not persist this value.
        match self.managed_keychain.get(&secret_id) {
            Ok(secret) => Ok(Zeroizing::new(secret)),
            Err(keychain_error) => {
                let config_key = match self.load_config_encryption_key_cached()? {
                    ConfigEncryptionKeyLookup::Found(key) => key,
                    ConfigEncryptionKeyLookup::Locked => {
                        return Err(
                            "Portable mode is locked. Unlock the portable keystore first"
                                .to_string(),
                        );
                    }
                    ConfigEncryptionKeyLookup::Missing => {
                        return Err(format!(
                            "Managed SSH key secret unavailable from keychain ({}) and local config key is missing",
                            keychain_error
                        ));
                    }
                };
                read_managed_ssh_key_secret_file(
                    &self.config_data_dir()?,
                    &secret_id,
                    &config_key,
                )
                .map_err(|file_error| {
                    format!(
                        "Managed SSH key secret unavailable from keychain ({}) or encrypted file ({})",
                        keychain_error, file_error
                    )
                })
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedSshKeyInfo {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub public_key: String,
    pub requires_passphrase: bool,
    pub origin: ManagedSshKeyOrigin,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedSshKeyUsageItem {
    pub connection_id: String,
    pub connection_name: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedSshKeyUsage {
    pub key_id: String,
    pub count: usize,
    pub items: Vec<ManagedSshKeyUsageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedSshKeyDeleteResult {
    pub deleted: bool,
    pub key_id: String,
    pub usage: ManagedSshKeyUsage,
}

impl From<&ManagedSshKey> for ManagedSshKeyInfo {
    fn from(key: &ManagedSshKey) -> Self {
        Self {
            id: key.id.clone(),
            name: key.name.clone(),
            fingerprint: key.fingerprint.clone(),
            public_key: key.public_key.clone(),
            requires_passphrase: key.requires_passphrase,
            origin: key.origin.clone(),
            created_at: key.created_at.to_rfc3339(),
            updated_at: key.updated_at.to_rfc3339(),
        }
    }
}

fn managed_key_display_name(name: Option<String>, fallback: &str) -> String {
    name.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn decode_managed_private_key(
    private_key: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, String> {
    russh::keys::decode_secret_key(private_key, passphrase).map_err(|error| {
        let normalized = error.to_string().to_ascii_lowercase();
        if normalized.contains("encrypted")
            || normalized.contains("decrypt")
            || normalized.contains("password")
            || normalized.contains("passphrase")
            || normalized.contains("bcrypt")
            || normalized.contains("kdf")
        {
            if passphrase.is_some() {
                "Invalid SSH key passphrase".to_string()
            } else {
                "SSH key requires a passphrase".to_string()
            }
        } else {
            "Invalid SSH private key".to_string()
        }
    })
}

fn public_key_line_from_private_key(private_key: &PrivateKey) -> String {
    let public_key = private_key.public_key();
    format!(
        "{} {}",
        public_key.algorithm(),
        BASE64.encode(public_key.public_key_bytes())
    )
}

fn managed_key_requires_passphrase(
    private_key: &str,
    passphrase: Option<&Zeroizing<String>>,
) -> bool {
    passphrase.is_some()
        || private_key.contains("ENCRYPTED")
        || private_key.contains("Proc-Type: 4,ENCRYPTED")
}

fn create_managed_key_metadata(
    config: &mut ConfigFile,
    private_key: Zeroizing<String>,
    name: Option<String>,
    passphrase: Option<Zeroizing<String>>,
    origin: ManagedSshKeyOrigin,
    fallback_name: &str,
    store_secret: impl FnOnce(&str, &str) -> Result<(), String>,
) -> Result<ManagedSshKeyInfo, String> {
    let passphrase_ref = passphrase.as_ref().map(|value| value.as_str());
    let decoded_key = decode_managed_private_key(&private_key, passphrase_ref)?;
    let fingerprint = crate::ssh::KnownHostsStore::fingerprint(decoded_key.public_key());
    let public_key = public_key_line_from_private_key(&decoded_key);

    if let Some(existing) = config
        .managed_ssh_keys
        .iter()
        .find(|key| key.fingerprint == fingerprint)
    {
        return Err(format!("Managed SSH key already exists: {}", existing.name));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let secret_id = format!("managed-key-{}", id);
    // Secret material crosses into the managed backend here; ConfigFile stores only metadata.
    store_secret(&secret_id, private_key.as_str())?;

    let now = chrono::Utc::now();
    let key = ManagedSshKey {
        id,
        secret_id,
        name: managed_key_display_name(name, fallback_name),
        fingerprint,
        public_key,
        requires_passphrase: managed_key_requires_passphrase(&private_key, passphrase.as_ref()),
        origin,
        created_at: now,
        updated_at: now,
    };
    let info = ManagedSshKeyInfo::from(&key);
    config.managed_ssh_keys.push(key);
    Ok(info)
}

fn managed_key_usage_from_config(config: &ConfigFile, key_id: &str) -> ManagedSshKeyUsage {
    let mut items = Vec::new();
    for connection in &config.connections {
        if matches!(&connection.auth, SavedAuth::ManagedKey { key_id: id, .. } if id == key_id) {
            items.push(ManagedSshKeyUsageItem {
                connection_id: connection.id.clone(),
                connection_name: connection.name.clone(),
                location: "connection".to_string(),
            });
        }

        for (index, hop) in connection.proxy_chain.iter().enumerate() {
            if matches!(&hop.auth, SavedAuth::ManagedKey { key_id: id, .. } if id == key_id) {
                items.push(ManagedSshKeyUsageItem {
                    connection_id: connection.id.clone(),
                    connection_name: connection.name.clone(),
                    location: format!("proxy_chain[{}]", index),
                });
            }
        }
    }

    ManagedSshKeyUsage {
        key_id: key_id.to_string(),
        count: items.len(),
        items,
    }
}

fn fallback_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Managed SSH Key")
        .to_string()
}

#[tauri::command]
pub async fn create_managed_ssh_key_from_text(
    state: State<'_, Arc<ConfigState>>,
    private_key: Zeroizing<String>,
    name: Option<String>,
    passphrase: Option<Zeroizing<String>>,
) -> Result<ManagedSshKeyInfo, String> {
    state.ensure_ready()?;
    let mut created_managed_secret_config_key = false;
    let (info, secret_id) = {
        let mut config = state.config.write();
        let info = create_managed_key_metadata(
            &mut config,
            private_key,
            name,
            passphrase,
            ManagedSshKeyOrigin::PastedText,
            "Managed SSH Key",
            |secret_id, secret| {
                let result = state.store_managed_ssh_key_secret(secret_id, secret)?;
                created_managed_secret_config_key |= result.created_config_key;
                Ok(())
            },
        )?;
        let secret_id = config
            .managed_ssh_keys
            .iter()
            .find(|key| key.id == info.id)
            .map(|key| key.secret_id.clone())
            .ok_or_else(|| "Managed SSH key metadata was not stored".to_string())?;
        (info, secret_id)
    };

    if let Err(error) = state.save().await {
        let _ = state.managed_keychain.delete(&secret_id);
        let _ = delete_managed_ssh_key_secret_file(&state.config_data_dir()?, &secret_id);
        if created_managed_secret_config_key {
            state.rollback_new_config_key();
        }
        state
            .config
            .write()
            .managed_ssh_keys
            .retain(|key| key.id != info.id);
        return Err(error);
    }

    Ok(info)
}

#[tauri::command]
pub async fn create_managed_ssh_key_from_file(
    state: State<'_, Arc<ConfigState>>,
    path: String,
    name: Option<String>,
    passphrase: Option<Zeroizing<String>>,
) -> Result<ManagedSshKeyInfo, String> {
    state.ensure_ready()?;
    let expanded_path = crate::path_utils::expand_tilde_path(PathBuf::from(path).as_path());
    let fallback_name = fallback_name_from_path(&expanded_path);
    let private_key = Zeroizing::new(
        std::fs::read_to_string(&expanded_path)
            .map_err(|error| format!("Failed to read SSH private key file: {}", error))?,
    );

    let mut created_managed_secret_config_key = false;
    let (info, secret_id) = {
        let mut config = state.config.write();
        let info = create_managed_key_metadata(
            &mut config,
            private_key,
            name,
            passphrase,
            ManagedSshKeyOrigin::ImportedFile,
            &fallback_name,
            |secret_id, secret| {
                let result = state.store_managed_ssh_key_secret(secret_id, secret)?;
                created_managed_secret_config_key |= result.created_config_key;
                Ok(())
            },
        )?;
        let secret_id = config
            .managed_ssh_keys
            .iter()
            .find(|key| key.id == info.id)
            .map(|key| key.secret_id.clone())
            .ok_or_else(|| "Managed SSH key metadata was not stored".to_string())?;
        (info, secret_id)
    };

    if let Err(error) = state.save().await {
        let _ = state.managed_keychain.delete(&secret_id);
        let _ = delete_managed_ssh_key_secret_file(&state.config_data_dir()?, &secret_id);
        if created_managed_secret_config_key {
            state.rollback_new_config_key();
        }
        state
            .config
            .write()
            .managed_ssh_keys
            .retain(|key| key.id != info.id);
        return Err(error);
    }

    Ok(info)
}

#[tauri::command]
pub async fn list_managed_ssh_keys(
    state: State<'_, Arc<ConfigState>>,
) -> Result<Vec<ManagedSshKeyInfo>, String> {
    state.ensure_ready()?;
    let config = state.config.read();
    Ok(config
        .managed_ssh_keys
        .iter()
        .map(ManagedSshKeyInfo::from)
        .collect())
}

#[tauri::command]
pub async fn rename_managed_ssh_key(
    state: State<'_, Arc<ConfigState>>,
    id: String,
    name: String,
) -> Result<ManagedSshKeyInfo, String> {
    state.ensure_ready()?;
    let info = {
        let mut config = state.config.write();
        let key = config
            .managed_ssh_keys
            .iter_mut()
            .find(|key| key.id == id)
            .ok_or_else(|| "Managed SSH key not found".to_string())?;
        key.name = managed_key_display_name(Some(name), "Managed SSH Key");
        key.updated_at = chrono::Utc::now();
        ManagedSshKeyInfo::from(&*key)
    };
    state.save().await?;
    Ok(info)
}

#[tauri::command]
pub async fn get_managed_ssh_key_usage(
    state: State<'_, Arc<ConfigState>>,
    id: String,
) -> Result<ManagedSshKeyUsage, String> {
    state.ensure_ready()?;
    let config = state.config.read();
    if !config.managed_ssh_keys.iter().any(|key| key.id == id) {
        return Err("Managed SSH key not found".to_string());
    }
    Ok(managed_key_usage_from_config(&config, &id))
}

#[tauri::command]
pub async fn delete_managed_ssh_key(
    state: State<'_, Arc<ConfigState>>,
    id: String,
    force: Option<bool>,
) -> Result<ManagedSshKeyDeleteResult, String> {
    state.ensure_ready()?;
    let force = force.unwrap_or(false);
    let (removed, usage) = {
        let mut config = state.config.write();
        let usage = managed_key_usage_from_config(&config, &id);
        if usage.count > 0 && !force {
            return Err(format!(
                "Managed SSH key is used by {} saved connection entries",
                usage.count
            ));
        }
        let index = config
            .managed_ssh_keys
            .iter()
            .position(|key| key.id == id)
            .ok_or_else(|| "Managed SSH key not found".to_string())?;
        (config.managed_ssh_keys.remove(index), usage)
    };

    if let Err(error) = state.save().await {
        state.config.write().managed_ssh_keys.push(removed);
        return Err(error);
    }

    state.delete_managed_keychain_value(&removed.secret_id)?;

    Ok(ManagedSshKeyDeleteResult {
        deleted: true,
        key_id: id,
        usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        CONFIG_VERSION, Keychain, ProxyHopConfig, SavedConnection, SavedUpstreamProxyPolicy,
    };
    use rand10::{rand_core::UnwrapErr, rngs::SysRng};
    use russh::keys::ssh_key::LineEnding;
    use russh::keys::{Algorithm, PrivateKey};
    use tempfile::tempdir;

    fn generated_private_key_text(passphrase: Option<&str>) -> String {
        let temp_dir = tempdir().unwrap();
        let key_path = temp_dir.path().join("id_ed25519");
        let mut rng = UnwrapErr(SysRng);
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let key = match passphrase {
            Some(passphrase) => key.encrypt(&mut rng, passphrase).unwrap(),
            None => key,
        };
        key.write_openssh_file(&key_path, LineEnding::LF).unwrap();
        std::fs::read_to_string(key_path).unwrap()
    }

    #[test]
    fn create_managed_key_metadata_stores_secret_and_returns_metadata_only() {
        let keychain = Keychain::in_memory_for_tests("com.oxideterm.managed-test");
        let mut config = ConfigFile::default();
        let private_key = generated_private_key_text(None);

        let info = create_managed_key_metadata(
            &mut config,
            Zeroizing::new(private_key.clone()),
            Some("Deploy Key".to_string()),
            None,
            ManagedSshKeyOrigin::PastedText,
            "Managed SSH Key",
            |secret_id, secret| {
                keychain
                    .store(secret_id, secret)
                    .map_err(|error| error.to_string())
            },
        )
        .unwrap();

        assert_eq!(info.name, "Deploy Key");
        assert_eq!(info.origin, ManagedSshKeyOrigin::PastedText);
        assert!(!info.requires_passphrase);
        assert!(info.public_key.starts_with("ssh-ed25519 "));
        assert_eq!(config.managed_ssh_keys.len(), 1);
        assert_eq!(
            keychain.get(&config.managed_ssh_keys[0].secret_id).unwrap(),
            private_key
        );
    }

    #[test]
    fn managed_key_secret_file_round_trips_large_private_key_material() {
        let temp_dir = tempdir().unwrap();
        let config_key = [42u8; CONFIG_ENCRYPTION_KEY_LEN];
        let secret_id = "managed-key-large-rsa";
        let private_key = Zeroizing::new(format!(
            "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n",
            "A".repeat(4096)
        ));

        write_managed_ssh_key_secret_file(
            temp_dir.path(),
            secret_id,
            private_key.as_str(),
            &config_key,
        )
        .unwrap();

        let secret_path = managed_ssh_key_secret_file_path(temp_dir.path(), secret_id).unwrap();
        let secret_file = std::fs::read_to_string(secret_path).unwrap();
        assert!(!secret_file.contains(private_key.as_str()));

        let restored =
            read_managed_ssh_key_secret_file(temp_dir.path(), secret_id, &config_key).unwrap();
        assert_eq!(restored.as_str(), private_key.as_str());
    }

    #[test]
    fn create_managed_key_metadata_rejects_invalid_key_without_echoing_secret() {
        let keychain = Keychain::in_memory_for_tests("com.oxideterm.managed-test");
        let mut config = ConfigFile::default();
        let marker = "not-a-private-key-secret-marker";

        let error = create_managed_key_metadata(
            &mut config,
            Zeroizing::new(marker.to_string()),
            None,
            None,
            ManagedSshKeyOrigin::PastedText,
            "Managed SSH Key",
            |secret_id, secret| {
                keychain
                    .store(secret_id, secret)
                    .map_err(|error| error.to_string())
            },
        )
        .unwrap_err();

        assert_eq!(error, "Invalid SSH private key");
        assert!(!error.contains(marker));
        assert!(config.managed_ssh_keys.is_empty());
    }

    #[test]
    fn create_managed_key_metadata_detects_passphrase_protected_key() {
        let keychain = Keychain::in_memory_for_tests("com.oxideterm.managed-test");
        let mut config = ConfigFile::default();
        let private_key = generated_private_key_text(Some("secret-passphrase"));

        let info = create_managed_key_metadata(
            &mut config,
            Zeroizing::new(private_key),
            None,
            Some(Zeroizing::new("secret-passphrase".to_string())),
            ManagedSshKeyOrigin::ImportedFile,
            "id_ed25519",
            |secret_id, secret| {
                keychain
                    .store(secret_id, secret)
                    .map_err(|error| error.to_string())
            },
        )
        .unwrap();

        assert!(info.requires_passphrase);
        assert_eq!(info.name, "id_ed25519");
    }

    #[test]
    fn managed_key_usage_counts_direct_and_proxy_references() {
        let mut config = ConfigFile::default();
        config.add_connection(SavedConnection {
            id: "conn-1".to_string(),
            version: CONFIG_VERSION,
            name: "Prod".to_string(),
            group: None,
            host: "prod.example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            auth: SavedAuth::ManagedKey {
                key_id: "managed-key-1".to_string(),
                passphrase_keychain_id: None,
            },
            options: Default::default(),
            created_at: chrono::Utc::now(),
            last_used_at: None,
            updated_at: Some(chrono::Utc::now()),
            color: None,
            tags: Vec::new(),
            proxy_chain: vec![ProxyHopConfig {
                host: "jump.example.com".to_string(),
                port: 22,
                username: "jump".to_string(),
                auth: SavedAuth::ManagedKey {
                    key_id: "managed-key-1".to_string(),
                    passphrase_keychain_id: None,
                },
                agent_forwarding: false,
            }],
            upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
            privilege_credentials: Vec::new(),
        });

        let usage = managed_key_usage_from_config(&config, "managed-key-1");

        assert_eq!(usage.count, 2);
        assert_eq!(usage.items[0].location, "connection");
        assert_eq!(usage.items[1].location, "proxy_chain[0]");
    }
}
