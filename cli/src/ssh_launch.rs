// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

use std::{
    env,
    io::{self, Read},
};

use serde::Serialize;
use zeroize::Zeroizing;

use crate::CliError;

#[derive(Debug, Serialize)]
pub struct TemporarySshLaunch<'a> {
    pub username: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<&'a str>,
}

impl TemporarySshLaunch<'_> {
    pub fn title(&self) -> String {
        format!("{}@{}", self.username, self.host)
    }
}

pub fn build_launch<'a>(
    target: &str,
    port: u16,
    password: Option<&'a Zeroizing<String>>,
) -> Result<TemporarySshLaunch<'a>, CliError> {
    let default_username = current_username();
    let (username, host) = parse_user_host_target(target, default_username.as_deref())?;
    Ok(TemporarySshLaunch {
        username,
        host,
        port,
        password: password.map(|password| password.as_str()),
    })
}

pub fn read_password_from_stdin() -> Result<Zeroizing<String>, CliError> {
    let mut password = Zeroizing::new(String::new());
    io::stdin().read_to_string(&mut password).map_err(|error| {
        CliError::runtime(format!("Failed to read password from stdin: {error}"))
    })?;
    while password.ends_with(['\n', '\r']) {
        password.pop();
    }
    Ok(password)
}

fn current_username() -> Option<String> {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn parse_user_host_target(
    target: &str,
    default_username: Option<&str>,
) -> Result<(String, String), CliError> {
    let target = target.trim();
    if target.is_empty() {
        return Err(CliError::usage("SSH target is empty"));
    }
    if target.contains("://") {
        return Err(CliError::usage(
            "SSH target must be user@host, not an ssh:// URI",
        ));
    }
    let (username, host) = if let Some((username, host)) = target.rsplit_once('@') {
        (username.trim(), host.trim())
    } else {
        (default_username.unwrap_or("").trim(), target)
    };
    if username.is_empty() {
        return Err(CliError::usage("SSH target is missing a username"));
    }
    if host.is_empty() {
        return Err(CliError::usage("SSH target is missing a host"));
    }
    Ok((username.to_string(), host.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_at_host() {
        let (username, host) = parse_user_host_target("alice@example.com", None).unwrap();
        assert_eq!(username, "alice");
        assert_eq!(host, "example.com");
    }

    #[test]
    fn rejects_uris() {
        assert!(parse_user_host_target("ssh://alice@example.com", None).is_err());
    }
}
