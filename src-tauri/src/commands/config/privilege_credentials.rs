// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

use super::ConfigState;
use crate::config::types::{
    LOCAL_SHELL_PRIVILEGE_CONNECTION_ID, PrivilegeCredentialKind, SavedPrivilegeCredential,
};
use crate::config::{ConfigFile, SavedConnection};
use chrono::Utc;
use serde::Deserialize;
use std::fmt;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use zeroize::Zeroizing;

pub(super) fn collect_privilege_keychain_ids(connection: &SavedConnection) -> Vec<String> {
    connection
        .privilege_credentials
        .iter()
        .filter_map(|credential| credential.keychain_id.clone())
        .collect()
}

fn privilege_keychain_id(connection_id: &str, credential_id: &str) -> String {
    format!("privilege:v1:{connection_id}:{credential_id}")
}

fn privilege_credentials_for_scope<'a>(
    config: &'a ConfigFile,
    connection_id: &str,
) -> Result<&'a Vec<SavedPrivilegeCredential>, String> {
    if connection_id == LOCAL_SHELL_PRIVILEGE_CONNECTION_ID {
        // Local shell credentials are app-scoped because there is no
        // SavedConnection row for a local PTY. Secret values still live only in
        // the dedicated privilege keychain service.
        return Ok(&config.local_privilege_credentials);
    }
    config
        .get_connection(connection_id)
        .map(|connection| &connection.privilege_credentials)
        .ok_or("Connection not found".to_string())
}

fn privilege_credentials_for_scope_mut<'a>(
    config: &'a mut ConfigFile,
    connection_id: &str,
) -> Result<&'a mut Vec<SavedPrivilegeCredential>, String> {
    if connection_id == LOCAL_SHELL_PRIVILEGE_CONNECTION_ID {
        // Keep local shell sudo/su metadata separate from SSH saved connection
        // metadata so no SSH password can be selected by accident.
        return Ok(&mut config.local_privilege_credentials);
    }
    config
        .connections
        .iter_mut()
        .find(|conn| conn.id == connection_id)
        .map(|connection| &mut connection.privilege_credentials)
        .ok_or("Connection not found".to_string())
}

pub(super) fn default_privilege_prompt_patterns(kind: PrivilegeCredentialKind) -> Vec<String> {
    match kind {
        PrivilegeCredentialKind::SudoPassword => vec![
            "[sudo]".to_string(),
            "password for".to_string(),
            "的密码".to_string(),
            "sudo password".to_string(),
        ],
        PrivilegeCredentialKind::SuPassword => vec![
            "su: password".to_string(),
            "password:".to_string(),
            "密码：".to_string(),
        ],
        PrivilegeCredentialKind::CustomPrompt => Vec::new(),
    }
}

fn legacy_privilege_prompt_patterns(kind: PrivilegeCredentialKind) -> Vec<String> {
    match kind {
        PrivilegeCredentialKind::SudoPassword => {
            vec![
                "[sudo] password for".to_string(),
                "sudo password".to_string(),
            ]
        }
        PrivilegeCredentialKind::SuPassword => {
            vec!["Password:".to_string(), "su: Password:".to_string()]
        }
        PrivilegeCredentialKind::CustomPrompt => Vec::new(),
    }
}

fn normalize_privilege_prompt_patterns(
    kind: PrivilegeCredentialKind,
    patterns: Vec<String>,
) -> Vec<String> {
    let patterns = patterns
        .into_iter()
        .map(|pattern| pattern.trim().to_string())
        .filter(|pattern| !pattern.is_empty())
        .collect::<Vec<_>>();
    if patterns.is_empty() {
        return default_privilege_prompt_patterns(kind);
    }
    // Only the generated legacy defaults are upgraded automatically. Real
    // custom fragments must stay exactly under user control.
    if kind != PrivilegeCredentialKind::CustomPrompt
        && patterns == legacy_privilege_prompt_patterns(kind)
    {
        return default_privilege_prompt_patterns(kind);
    }
    patterns
}

pub(super) fn normalize_saved_privilege_credential_for_display(
    mut credential: SavedPrivilegeCredential,
) -> SavedPrivilegeCredential {
    credential.prompt_patterns =
        normalize_privilege_prompt_patterns(credential.kind, credential.prompt_patterns);
    credential
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePrivilegeCredentialRequest {
    pub connection_id: String,
    pub credential_id: Option<String>,
    pub label: String,
    pub kind: PrivilegeCredentialKind,
    #[serde(default)]
    pub username_hint: Option<String>,
    #[serde(default)]
    pub prompt_patterns: Vec<String>,
    #[serde(default)]
    pub secret: Option<Zeroizing<String>>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub require_click_to_send: bool,
}

impl fmt::Debug for SavePrivilegeCredentialRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SavePrivilegeCredentialRequest")
            .field("connection_id", &self.connection_id)
            .field("credential_id", &self.credential_id)
            .field("label", &self.label)
            .field("kind", &self.kind)
            .field("username_hint", &self.username_hint)
            .field("prompt_patterns", &self.prompt_patterns)
            .field("secret", &self.secret.as_ref().map(|_| "[redacted secret]"))
            .field("enabled", &self.enabled)
            .field("require_click_to_send", &self.require_click_to_send)
            .finish()
    }
}

fn default_true() -> bool {
    true
}

/// List saved sudo/su helper metadata for one connection without reading secrets.
#[tauri::command]
pub async fn list_privilege_credentials(
    state: State<'_, Arc<ConfigState>>,
    connection_id: String,
) -> Result<Vec<SavedPrivilegeCredential>, String> {
    let config = state.config.read();
    Ok(privilege_credentials_for_scope(&config, &connection_id)?
        .iter()
        .cloned()
        .map(normalize_saved_privilege_credential_for_display)
        .collect())
}

/// Save sudo/su helper metadata and optionally replace its keychain secret.
#[tauri::command]
pub async fn save_privilege_credential(
    state: State<'_, Arc<ConfigState>>,
    request: SavePrivilegeCredentialRequest,
) -> Result<SavedPrivilegeCredential, String> {
    state.ensure_ready()?;
    let connection_id = request.connection_id.trim();
    if connection_id.is_empty() {
        return Err("Connection id is required".to_string());
    }
    let label = request.label.trim();
    if label.is_empty() {
        return Err("Credential label is required".to_string());
    }

    let now = Utc::now();
    let credential_id = request
        .credential_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let keychain_id = privilege_keychain_id(connection_id, &credential_id);

    if let Some(secret) = request.secret.as_ref() {
        // The privilege secret is intentionally stored in a dedicated service
        // and never in SavedConnection metadata, so SSH passwords cannot be
        // reused for sudo/su by accident.
        state
            .privilege_keychain
            .store(&keychain_id, secret.as_str())
            .map_err(|e| e.to_string())?;
    }

    let credential = {
        let mut config = state.config.write();
        let credentials = privilege_credentials_for_scope_mut(&mut config, connection_id)?;
        let existing = credentials
            .iter()
            .find(|credential| credential.id == credential_id)
            .cloned();
        let prompt_patterns =
            normalize_privilege_prompt_patterns(request.kind, request.prompt_patterns);
        let keychain_id = if request.secret.is_some() {
            Some(keychain_id.clone())
        } else {
            existing
                .as_ref()
                .and_then(|credential| credential.keychain_id.clone())
        };
        let credential = SavedPrivilegeCredential {
            id: credential_id.clone(),
            connection_id: connection_id.to_string(),
            label: label.to_string(),
            kind: request.kind,
            username_hint: request
                .username_hint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            prompt_patterns,
            keychain_id,
            enabled: request.enabled,
            require_click_to_send: request.require_click_to_send,
            created_at: existing
                .as_ref()
                .map(|credential| credential.created_at)
                .unwrap_or(now),
            updated_at: now,
        };
        if let Some(index) = credentials
            .iter()
            .position(|candidate| candidate.id == credential_id)
        {
            credentials[index] = credential.clone();
        } else {
            credentials.push(credential.clone());
        }
        credential
    };

    state.save().await?;
    Ok(credential)
}

#[tauri::command]
pub async fn delete_privilege_credential(
    state: State<'_, Arc<ConfigState>>,
    connection_id: String,
    credential_id: String,
) -> Result<bool, String> {
    state.ensure_ready()?;
    let removed = {
        let mut config = state.config.write();
        let credentials = privilege_credentials_for_scope_mut(&mut config, &connection_id)?;
        let before = credentials.len();
        credentials.retain(|credential| credential.id != credential_id);
        before != credentials.len()
    };
    if removed {
        let keychain_id = privilege_keychain_id(&connection_id, &credential_id);
        let _ = state.privilege_keychain.delete(&keychain_id);
        state.save().await?;
    }
    Ok(removed)
}

/// Read one privilege secret only for an explicit user-confirmed fill action.
#[tauri::command]
pub async fn get_privilege_credential_secret(
    state: State<'_, Arc<ConfigState>>,
    connection_id: String,
    credential_id: String,
) -> Result<String, String> {
    let keychain_id = {
        let config = state.config.read();
        let credential = privilege_credentials_for_scope(&config, &connection_id)?
            .iter()
            .find(|credential| credential.id == credential_id)
            .ok_or("Privilege credential not found")?;
        if !credential.enabled {
            return Err("Privilege credential is disabled".to_string());
        }
        credential
            .keychain_id
            .clone()
            .ok_or("Privilege credential secret is not saved")?
    };

    state
        .privilege_keychain
        .get(&keychain_id)
        .map_err(|e| e.to_string())
}
