// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

//! Tauri commands for local serial terminal sessions.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::serial::{
    OpenSerialSessionRequest, OpenSerialSessionResponse, SerialError, SerialPortInfo,
    SerialSessionRegistry, WriteSerialSessionRequest, decode_serial_bytes, list_ports,
};

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<SerialPortInfo>, SerialError> {
    list_ports()
}

#[tauri::command]
pub async fn serial_open_session(
    request: OpenSerialSessionRequest,
    state: State<'_, Arc<SerialSessionRegistry>>,
    app: AppHandle,
) -> Result<OpenSerialSessionResponse, SerialError> {
    state.open_session(app, request).await
}

#[tauri::command]
pub async fn serial_write_session(
    request: WriteSerialSessionRequest,
    state: State<'_, Arc<SerialSessionRegistry>>,
) -> Result<(), SerialError> {
    let data = decode_serial_bytes(&request.data_base64)?;
    state.write_session(&request.session_id, data).await
}

#[tauri::command]
pub async fn serial_close_session(
    session_id: String,
    state: State<'_, Arc<SerialSessionRegistry>>,
) -> Result<(), SerialError> {
    state.close_session(&session_id).await
}
