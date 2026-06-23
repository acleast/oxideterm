// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

use super::{
    ConfigState, ConnectionInfo, ProxyHopInfo, build_saved_auth, build_saved_auth_for_update,
    collect_connection_keychain_ids, materialize_upstream_proxy_policy,
};
use crate::commands::forwarding::ForwardingRegistry;
use crate::config::{ConfigFile, Keychain, ProxyHopConfig, SavedConnection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionSyncRecord {
    pub id: String,
    pub revision: String,
    pub updated_at: String,
    pub deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<ConnectionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionsSyncSnapshot {
    pub revision: String,
    pub exported_at: String,
    pub records: Vec<SavedConnectionSyncRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySavedConnectionsSyncSnapshotResult {
    pub applied: usize,
    pub skipped: usize,
    pub conflicts: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncMetadata {
    pub saved_connections_revision: String,
    pub saved_connections_updated_at: String,
}

fn sha256_hex<T: Serialize>(value: &T) -> Result<String, String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| format!("Failed to serialize sync payload: {}", e))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn parse_sync_timestamp(
    value: &str,
    field_name: &str,
) -> Result<chrono::DateTime<chrono::Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&chrono::Utc))
        .map_err(|e| format!("Invalid {} '{}': {}", field_name, value, e))
}

fn connection_sync_updated_at(conn: &SavedConnection) -> String {
    conn.updated_at
        .or(conn.last_used_at)
        .unwrap_or(conn.created_at)
        .to_rfc3339()
}

fn build_saved_connection_tombstone_record(
    tombstone: &crate::config::types::DeletedConnectionTombstone,
) -> Result<SavedConnectionSyncRecord, String> {
    let revision = sha256_hex(&(
        tombstone.id.as_str(),
        tombstone.deleted_at.to_rfc3339(),
        true,
    ))?;

    Ok(SavedConnectionSyncRecord {
        id: tombstone.id.clone(),
        revision,
        updated_at: tombstone.deleted_at.to_rfc3339(),
        deleted: true,
        payload: None,
    })
}

fn build_saved_connection_sync_record(
    conn: &SavedConnection,
) -> Result<SavedConnectionSyncRecord, String> {
    let payload = ConnectionInfo::from(conn);
    let revision = sha256_hex(&payload)?;

    Ok(SavedConnectionSyncRecord {
        id: conn.id.clone(),
        revision,
        updated_at: connection_sync_updated_at(conn),
        deleted: false,
        payload: Some(payload),
    })
}

fn build_saved_connections_sync_snapshot(
    config: &ConfigFile,
) -> Result<SavedConnectionsSyncSnapshot, String> {
    let mut records: Vec<SavedConnectionSyncRecord> = config
        .connections
        .iter()
        .map(build_saved_connection_sync_record)
        .collect::<Result<_, _>>()?;
    records.extend(
        config
            .active_connection_tombstones()
            .into_iter()
            .map(build_saved_connection_tombstone_record)
            .collect::<Result<Vec<_>, _>>()?,
    );
    records.sort_by(|left, right| left.id.cmp(&right.id));

    let revision = sha256_hex(
        &records
            .iter()
            .map(|record| (&record.id, &record.revision, record.deleted))
            .collect::<Vec<_>>(),
    )?;

    Ok(SavedConnectionsSyncSnapshot {
        revision,
        exported_at: chrono::Utc::now().to_rfc3339(),
        records,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SavedConnectionsConflictStrategy {
    Skip,
    Replace,
    Merge,
}

impl SavedConnectionsConflictStrategy {
    fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("skip") {
            "skip" => Ok(Self::Skip),
            "replace" => Ok(Self::Replace),
            "merge" => Ok(Self::Merge),
            other => Err(format!(
                "Unsupported saved connection conflict strategy: {}",
                other
            )),
        }
    }

    fn preserves_local_auth(self) -> bool {
        matches!(self, Self::Merge)
    }
}

#[derive(Debug, Default)]
struct ApplySavedConnectionsSyncSideEffects {
    deleted_connection_ids: Vec<String>,
    keychain_ids_to_delete: Vec<String>,
}

fn build_synced_proxy_chain(
    proxy_chain: &[ProxyHopInfo],
    existing_proxy_chain: Option<&[ProxyHopConfig]>,
    preserve_auth: bool,
    keychain: &Keychain,
) -> Result<Vec<ProxyHopConfig>, String> {
    proxy_chain
        .iter()
        .map(|hop| {
            let existing_auth = if preserve_auth {
                existing_proxy_chain.and_then(|existing| {
                    existing
                        .iter()
                        .find(|candidate| {
                            candidate.host == hop.host
                                && candidate.port == hop.port
                                && candidate.username == hop.username
                        })
                        .map(|candidate| &candidate.auth)
                })
            } else {
                None
            };

            let auth = if let Some(existing_auth) = existing_auth {
                build_saved_auth_for_update(
                    existing_auth,
                    &hop.auth_type,
                    None,
                    hop.key_path.as_deref(),
                    hop.cert_path.as_deref(),
                    hop.managed_key_id.as_deref(),
                    None,
                    keychain,
                )?
            } else {
                build_saved_auth(
                    &hop.auth_type,
                    None,
                    hop.key_path.as_deref(),
                    hop.cert_path.as_deref(),
                    hop.managed_key_id.as_deref(),
                    None,
                    keychain,
                )?
            };

            Ok(ProxyHopConfig {
                host: hop.host.clone(),
                port: hop.port,
                username: hop.username.clone(),
                auth,
                agent_forwarding: hop.agent_forwarding,
            })
        })
        .collect()
}

fn build_saved_connection_from_sync_payload(
    payload: &ConnectionInfo,
    record_updated_at: chrono::DateTime<chrono::Utc>,
    existing: Option<&SavedConnection>,
    preserve_auth: bool,
    keychain: &Keychain,
) -> Result<SavedConnection, String> {
    let auth = if let Some(existing) = existing.filter(|_| preserve_auth) {
        build_saved_auth_for_update(
            &existing.auth,
            &payload.auth_type,
            None,
            payload.key_path.as_deref(),
            payload.cert_path.as_deref(),
            payload.managed_key_id.as_deref(),
            None,
            keychain,
        )?
    } else {
        build_saved_auth(
            &payload.auth_type,
            None,
            payload.key_path.as_deref(),
            payload.cert_path.as_deref(),
            payload.managed_key_id.as_deref(),
            None,
            keychain,
        )?
    };

    let proxy_chain = build_synced_proxy_chain(
        &payload.proxy_chain,
        existing.map(|value| value.proxy_chain.as_slice()),
        preserve_auth,
        keychain,
    )?;
    let upstream_proxy = materialize_upstream_proxy_policy(
        payload.upstream_proxy.clone(),
        existing
            .filter(|_| preserve_auth)
            .map(|value| &value.upstream_proxy),
        keychain,
    )?;

    Ok(SavedConnection {
        id: payload.id.clone(),
        version: crate::config::CONFIG_VERSION,
        name: payload.name.clone(),
        group: payload.group.clone(),
        host: payload.host.clone(),
        port: payload.port,
        username: payload.username.clone(),
        auth,
        options: crate::config::ConnectionOptions {
            agent_forwarding: payload.agent_forwarding,
            post_connect_command: payload.post_connect_command.clone(),
            ..Default::default()
        },
        created_at: chrono::DateTime::parse_from_rfc3339(&payload.created_at)
            .map_err(|e| {
                format!(
                    "Invalid connection created_at '{}': {}",
                    payload.created_at, e
                )
            })?
            .with_timezone(&chrono::Utc),
        last_used_at: payload
            .last_used_at
            .as_deref()
            .map(|value| {
                chrono::DateTime::parse_from_rfc3339(value)
                    .map(|time| time.with_timezone(&chrono::Utc))
                    .map_err(|e| format!("Invalid connection last_used_at '{}': {}", value, e))
            })
            .transpose()?,
        updated_at: Some(record_updated_at),
        color: payload.color.clone(),
        tags: payload.tags.clone(),
        proxy_chain,
        upstream_proxy,
        privilege_credentials: existing
            .map(|value| value.privilege_credentials.clone())
            .unwrap_or_default(),
    })
}

fn apply_saved_connections_snapshot_to_config(
    config: &mut ConfigFile,
    snapshot: &SavedConnectionsSyncSnapshot,
    strategy: SavedConnectionsConflictStrategy,
    keychain: &Keychain,
) -> Result<
    (
        ApplySavedConnectionsSyncSnapshotResult,
        ApplySavedConnectionsSyncSideEffects,
    ),
    String,
> {
    let mut result = ApplySavedConnectionsSyncSnapshotResult {
        applied: 0,
        skipped: 0,
        conflicts: 0,
    };
    let mut side_effects = ApplySavedConnectionsSyncSideEffects::default();

    for record in &snapshot.records {
        let record_updated_at =
            parse_sync_timestamp(&record.updated_at, "saved connection sync updated_at")?;

        if record.deleted {
            if let Some(existing) = config.get_connection(&record.id) {
                let existing_updated_at = parse_sync_timestamp(
                    &connection_sync_updated_at(existing),
                    "local saved connection updated_at",
                )?;

                if existing_updated_at > record_updated_at {
                    result.skipped += 1;
                    result.conflicts += 1;
                    continue;
                }
            }

            if let Some(removed) =
                config.remove_connection_with_tombstone_at(&record.id, record_updated_at)
            {
                side_effects.deleted_connection_ids.push(removed.id.clone());
                side_effects
                    .keychain_ids_to_delete
                    .extend(collect_connection_keychain_ids(&removed));
                result.applied += 1;
            } else if config.upsert_connection_tombstone(record.id.clone(), record_updated_at) {
                result.applied += 1;
            } else {
                result.skipped += 1;
            }
            continue;
        }

        let Some(payload) = &record.payload else {
            result.skipped += 1;
            result.conflicts += 1;
            continue;
        };

        if let Some(tombstone) = config.get_connection_tombstone(&record.id) {
            if tombstone.deleted_at >= record_updated_at {
                result.skipped += 1;
                result.conflicts += 1;
                continue;
            }
        }

        let existing_by_id = config.get_connection(&record.id).cloned();
        let existing_by_name = if existing_by_id.is_none() {
            config
                .connections
                .iter()
                .find(|candidate| candidate.name == payload.name && candidate.id != record.id)
                .cloned()
        } else {
            None
        };

        if existing_by_id.is_none()
            && existing_by_name.is_some()
            && strategy == SavedConnectionsConflictStrategy::Skip
        {
            result.skipped += 1;
            result.conflicts += 1;
            continue;
        }

        if let Some(existing_same_name) = existing_by_name.as_ref() {
            if let Some(removed) = config.remove_connection(&existing_same_name.id) {
                side_effects.deleted_connection_ids.push(removed.id.clone());
            }
        }

        let baseline = existing_by_id.as_ref().or(existing_by_name.as_ref());
        let connection = build_saved_connection_from_sync_payload(
            payload,
            record_updated_at,
            baseline,
            baseline.is_some() && strategy.preserves_local_auth(),
            keychain,
        )?;

        if let Some(existing) = baseline {
            let existing_keychain_ids: HashSet<String> = collect_connection_keychain_ids(existing)
                .into_iter()
                .collect();
            let next_keychain_ids: HashSet<String> = collect_connection_keychain_ids(&connection)
                .into_iter()
                .collect();

            side_effects.keychain_ids_to_delete.extend(
                existing_keychain_ids
                    .difference(&next_keychain_ids)
                    .cloned(),
            );
        }

        if let Some(group) = connection.group.clone() {
            if !config.groups.contains(&group) {
                config.groups.push(group);
            }
        }

        config.add_connection(connection);
        result.applied += 1;
    }

    Ok((result, side_effects))
}

/// Export a structured snapshot of saved connections for plugin-driven sync.
#[tauri::command]
pub async fn export_saved_connections_snapshot(
    state: State<'_, Arc<ConfigState>>,
) -> Result<SavedConnectionsSyncSnapshot, String> {
    let config = state.config.read();
    build_saved_connections_sync_snapshot(&config)
}

/// Get lightweight local sync metadata for saved connections.
#[tauri::command]
pub async fn get_local_sync_metadata(
    state: State<'_, Arc<ConfigState>>,
) -> Result<LocalSyncMetadata, String> {
    let config = state.config.read();
    let snapshot = build_saved_connections_sync_snapshot(&config)?;
    let saved_connections_updated_at = snapshot
        .records
        .iter()
        .map(|record| record.updated_at.clone())
        .max()
        .unwrap_or_else(|| snapshot.exported_at.clone());

    Ok(LocalSyncMetadata {
        saved_connections_revision: snapshot.revision,
        saved_connections_updated_at,
    })
}

/// Apply a structured snapshot of saved connections produced by a sync plugin.
#[tauri::command]
pub async fn apply_saved_connections_snapshot(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<ConfigState>>,
    forwarding_registry: State<'_, Arc<ForwardingRegistry>>,
    snapshot: SavedConnectionsSyncSnapshot,
    conflict_strategy: Option<String>,
) -> Result<ApplySavedConnectionsSyncSnapshotResult, String> {
    let strategy = SavedConnectionsConflictStrategy::parse(conflict_strategy.as_deref())?;

    let (result, side_effects) = {
        let mut config = state.config.write();
        apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            strategy,
            &state.keychain,
        )?
    };

    for keychain_id in side_effects.keychain_ids_to_delete {
        let _ = state.keychain.delete(&keychain_id);
    }

    let deleted_connection_ids: HashSet<String> =
        side_effects.deleted_connection_ids.into_iter().collect();
    for connection_id in deleted_connection_ids {
        forwarding_registry
            .delete_owned_forwards(&connection_id)
            .await?;
    }

    if result.applied > 0 {
        state.save().await?;
        app_handle
            .emit("connection:update", "saved")
            .map_err(|e| format!("Failed to emit connection:update: {}", e))?;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ProxyHopConfig, SavedAuth, SavedUpstreamProxyPolicy};

    #[test]
    fn build_saved_connections_sync_snapshot_includes_agent_forwarding() {
        let mut config = ConfigFile::default();
        let mut connection =
            SavedConnection::new_key("Prod", "prod.example.com", 22, "root", "/tmp/id_ed25519");
        connection.options.agent_forwarding = true;
        connection.options.post_connect_command = Some("cd /srv/prod".to_string());
        connection.proxy_chain.push(ProxyHopConfig {
            host: "jump.example.com".to_string(),
            port: 22,
            username: "jump".to_string(),
            auth: SavedAuth::Agent,
            agent_forwarding: true,
        });
        config.add_connection(connection);

        let snapshot = build_saved_connections_sync_snapshot(&config).unwrap();
        let payload = snapshot.records[0].payload.as_ref().unwrap();

        assert!(!snapshot.revision.is_empty());
        assert!(payload.agent_forwarding);
        assert_eq!(
            payload.post_connect_command.as_deref(),
            Some("cd /srv/prod")
        );
        assert!(payload.proxy_chain[0].agent_forwarding);
    }

    #[test]
    fn apply_saved_connections_snapshot_merge_preserves_password_keychain() {
        let mut config = ConfigFile::default();
        config.add_connection(SavedConnection {
            id: "conn-1".to_string(),
            version: crate::config::CONFIG_VERSION,
            name: "Prod".to_string(),
            group: Some("Ops".to_string()),
            host: "old.example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            auth: SavedAuth::Password {
                keychain_id: Some("kc-pass".to_string()),
            },
            options: crate::config::ConnectionOptions {
                agent_forwarding: false,
                ..Default::default()
            },
            created_at: chrono::Utc::now(),
            last_used_at: None,
            updated_at: Some(chrono::Utc::now()),
            color: None,
            tags: Vec::new(),
            proxy_chain: Vec::new(),
            upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
            privilege_credentials: Vec::new(),
        });

        let snapshot = SavedConnectionsSyncSnapshot {
            revision: "rev-1".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            records: vec![SavedConnectionSyncRecord {
                id: "conn-1".to_string(),
                revision: "rec-1".to_string(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                deleted: false,
                payload: Some(ConnectionInfo {
                    id: "conn-1".to_string(),
                    name: "Prod".to_string(),
                    group: Some("Ops".to_string()),
                    host: "new.example.com".to_string(),
                    port: 2222,
                    username: "deploy".to_string(),
                    auth_type: "password".to_string(),
                    key_path: None,
                    cert_path: None,
                    managed_key_id: None,
                    managed_key_name: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    last_used_at: None,
                    color: Some("#ff0000".to_string()),
                    tags: vec!["prod".to_string()],
                    agent_forwarding: true,
                    post_connect_command: Some("cd /srv/prod".to_string()),
                    proxy_chain: Vec::new(),
                    upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
                }),
            }],
        };

        let (result, _side_effects) = apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            SavedConnectionsConflictStrategy::Merge,
            &Keychain::with_service("com.oxideterm.test"),
        )
        .unwrap();

        let updated = config.get_connection("conn-1").unwrap();
        assert_eq!(result.applied, 1);
        assert_eq!(updated.host, "new.example.com");
        assert_eq!(updated.port, 2222);
        assert_eq!(updated.username, "deploy");
        assert!(updated.options.agent_forwarding);
        assert_eq!(
            updated.options.post_connect_command.as_deref(),
            Some("cd /srv/prod")
        );
        assert_eq!(
            updated.auth,
            SavedAuth::Password {
                keychain_id: Some("kc-pass".to_string()),
            }
        );
    }

    #[test]
    fn apply_saved_connections_snapshot_merge_collects_obsolete_proxy_keychain_ids() {
        let mut config = ConfigFile::default();
        config.add_connection(SavedConnection {
            id: "conn-1".to_string(),
            version: crate::config::CONFIG_VERSION,
            name: "Prod".to_string(),
            group: None,
            host: "prod.example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            auth: SavedAuth::Agent,
            options: Default::default(),
            created_at: chrono::Utc::now(),
            last_used_at: None,
            updated_at: Some(chrono::Utc::now()),
            color: None,
            tags: Vec::new(),
            proxy_chain: vec![
                ProxyHopConfig {
                    host: "jump-a.example.com".to_string(),
                    port: 22,
                    username: "jump-a".to_string(),
                    auth: SavedAuth::Password {
                        keychain_id: Some("kc-hop-a".to_string()),
                    },
                    agent_forwarding: false,
                },
                ProxyHopConfig {
                    host: "jump-b.example.com".to_string(),
                    port: 22,
                    username: "jump-b".to_string(),
                    auth: SavedAuth::Password {
                        keychain_id: Some("kc-hop-b".to_string()),
                    },
                    agent_forwarding: false,
                },
            ],
            upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
            privilege_credentials: Vec::new(),
        });

        let snapshot = SavedConnectionsSyncSnapshot {
            revision: "rev-2".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            records: vec![SavedConnectionSyncRecord {
                id: "conn-1".to_string(),
                revision: "rec-2".to_string(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                deleted: false,
                payload: Some(ConnectionInfo {
                    id: "conn-1".to_string(),
                    name: "Prod".to_string(),
                    group: None,
                    host: "prod.example.com".to_string(),
                    port: 22,
                    username: "root".to_string(),
                    auth_type: "agent".to_string(),
                    key_path: None,
                    cert_path: None,
                    managed_key_id: None,
                    managed_key_name: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    last_used_at: None,
                    color: None,
                    tags: Vec::new(),
                    agent_forwarding: false,
                    post_connect_command: None,
                    proxy_chain: vec![ProxyHopInfo {
                        host: "jump-a.example.com".to_string(),
                        port: 22,
                        username: "jump-a".to_string(),
                        auth_type: "password".to_string(),
                        key_path: None,
                        cert_path: None,
                        managed_key_id: None,
                        managed_key_name: None,
                        agent_forwarding: false,
                    }],
                    upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
                }),
            }],
        };

        let (_result, mut side_effects) = apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            SavedConnectionsConflictStrategy::Merge,
            &Keychain::with_service("com.oxideterm.test"),
        )
        .unwrap();

        side_effects.keychain_ids_to_delete.sort();
        assert_eq!(
            side_effects.keychain_ids_to_delete,
            vec!["kc-hop-b".to_string()]
        );
    }

    #[test]
    fn apply_saved_connections_snapshot_merge_rebuilds_certificate_proxy_hops() {
        let mut config = ConfigFile::default();

        let snapshot = SavedConnectionsSyncSnapshot {
            revision: "rev-cert-hop".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            records: vec![SavedConnectionSyncRecord {
                id: "conn-cert-hop".to_string(),
                revision: "rec-cert-hop".to_string(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                deleted: false,
                payload: Some(ConnectionInfo {
                    id: "conn-cert-hop".to_string(),
                    name: "Cert Hop".to_string(),
                    group: None,
                    host: "target.example.com".to_string(),
                    port: 22,
                    username: "root".to_string(),
                    auth_type: "agent".to_string(),
                    key_path: None,
                    cert_path: None,
                    managed_key_id: None,
                    managed_key_name: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    last_used_at: None,
                    color: None,
                    tags: Vec::new(),
                    agent_forwarding: false,
                    post_connect_command: None,
                    proxy_chain: vec![ProxyHopInfo {
                        host: "jump.example.com".to_string(),
                        port: 22,
                        username: "jump".to_string(),
                        auth_type: "certificate".to_string(),
                        key_path: Some("/tmp/id_jump".to_string()),
                        cert_path: Some("/tmp/id_jump-cert.pub".to_string()),
                        managed_key_id: None,
                        managed_key_name: None,
                        agent_forwarding: true,
                    }],
                    upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
                }),
            }],
        };

        let (result, _side_effects) = apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            SavedConnectionsConflictStrategy::Merge,
            &Keychain::with_service("com.oxideterm.test"),
        )
        .unwrap();

        let connection = config.get_connection("conn-cert-hop").unwrap();
        assert_eq!(result.applied, 1);
        assert_eq!(connection.proxy_chain.len(), 1);
        assert_eq!(
            connection.proxy_chain[0].auth,
            SavedAuth::Certificate {
                key_path: "/tmp/id_jump".to_string(),
                cert_path: "/tmp/id_jump-cert.pub".to_string(),
                has_passphrase: false,
                passphrase_keychain_id: None,
            }
        );
        assert!(connection.proxy_chain[0].agent_forwarding);
    }

    #[test]
    fn build_saved_connections_sync_snapshot_includes_tombstones() {
        let mut config = ConfigFile::default();
        let deleted_at = chrono::Utc::now();
        config.upsert_connection_tombstone("conn-deleted", deleted_at);

        let snapshot = build_saved_connections_sync_snapshot(&config).unwrap();
        let record = snapshot
            .records
            .iter()
            .find(|candidate| candidate.id == "conn-deleted")
            .unwrap();

        assert!(record.deleted);
        assert!(record.payload.is_none());
        assert_eq!(record.updated_at, deleted_at.to_rfc3339());
    }

    #[test]
    fn apply_saved_connections_snapshot_skips_payload_older_than_local_tombstone() {
        let mut config = ConfigFile::default();
        let deleted_at = chrono::Utc::now();
        config.upsert_connection_tombstone("conn-1", deleted_at);

        let snapshot = SavedConnectionsSyncSnapshot {
            revision: "rev-3".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            records: vec![SavedConnectionSyncRecord {
                id: "conn-1".to_string(),
                revision: "rec-3".to_string(),
                updated_at: (deleted_at - chrono::Duration::minutes(1)).to_rfc3339(),
                deleted: false,
                payload: Some(ConnectionInfo {
                    id: "conn-1".to_string(),
                    name: "Prod".to_string(),
                    group: None,
                    host: "prod.example.com".to_string(),
                    port: 22,
                    username: "root".to_string(),
                    auth_type: "agent".to_string(),
                    key_path: None,
                    cert_path: None,
                    managed_key_id: None,
                    managed_key_name: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    last_used_at: None,
                    color: None,
                    tags: Vec::new(),
                    agent_forwarding: false,
                    post_connect_command: None,
                    proxy_chain: Vec::new(),
                    upstream_proxy: SavedUpstreamProxyPolicy::UseGlobal,
                }),
            }],
        };

        let (result, _side_effects) = apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            SavedConnectionsConflictStrategy::Merge,
            &Keychain::with_service("com.oxideterm.test"),
        )
        .unwrap();

        assert_eq!(result.applied, 0);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.conflicts, 1);
        assert!(config.get_connection("conn-1").is_none());
        assert_eq!(
            config
                .get_connection_tombstone("conn-1")
                .unwrap()
                .deleted_at,
            deleted_at
        );
    }

    #[test]
    fn apply_saved_connections_snapshot_records_remote_delete_tombstone_when_local_missing() {
        let mut config = ConfigFile::default();
        let deleted_at = chrono::Utc::now();

        let snapshot = SavedConnectionsSyncSnapshot {
            revision: "rev-4".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            records: vec![SavedConnectionSyncRecord {
                id: "conn-1".to_string(),
                revision: "rec-4".to_string(),
                updated_at: deleted_at.to_rfc3339(),
                deleted: true,
                payload: None,
            }],
        };

        let (result, _side_effects) = apply_saved_connections_snapshot_to_config(
            &mut config,
            &snapshot,
            SavedConnectionsConflictStrategy::Merge,
            &Keychain::with_service("com.oxideterm.test"),
        )
        .unwrap();

        assert_eq!(result.applied, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.conflicts, 0);
        assert!(config.get_connection("conn-1").is_none());
        assert_eq!(
            config
                .get_connection_tombstone("conn-1")
                .unwrap()
                .deleted_at,
            deleted_at
        );
    }
}
