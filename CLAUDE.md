# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OxideTerm is a Tauri 2.0 desktop app (GPL-3.0) with a React 19/TypeScript frontend and Rust backend. It provides SSH terminals, SFTP, port forwarding, a built-in IDE (CodeMirror 6), OxideSens AI, and a runtime plugin system. The SSH stack is pure Rust via russh 0.61 compiled against `ring` — zero C/OpenSSL dependencies.

- **Frontend**: React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 + Zustand (19 stores)
- **Backend**: Rust 2024 edition + Tokio + russh (SSH) + portable-pty (local PTY)
- **Desktop**: Tauri 2.0 (WebView2 on Windows, WebKit2GTK on Linux, WebKit on macOS)
- **Package manager**: pnpm

## Common Commands

```bash
pnpm install                    # Install Node dependencies
pnpm dev                        # Frontend only (Vite on port 1420)
pnpm tauri dev                  # Full desktop app (frontend + Rust backend + HMR)
pnpm build                      # Type-check (tsc) and build frontend
pnpm tauri build                # Production Tauri bundle
pnpm test                       # Run Vitest suite once
pnpm test:watch                 # Watch mode
pnpm test:coverage              # With coverage
pnpm i18n:check                 # Verify locale coverage across all 11 languages
pnpm cli:check                  # Check CLI companion (cli/)
pnpm cli:build                  # Build CLI companion (Rust)
cd src-tauri && cargo check     # Check Rust app code
cd src-tauri && cargo fmt       # Format Rust code
cd agent && cargo check         # Check remote agent crate
```

## Architecture

### Dual-Plane Communication

Terminal data and control commands are separated into two planes:

- **Data plane (WebSocket)**: Each SSH session gets its own WebSocket port. Terminal bytes flow as binary frames with a Type-Length-Payload header — no JSON serialization in the hot path.
- **Control plane (Tauri IPC)**: Connection management, SFTP ops, forwarding, config — structured JSON off the critical path.
- **Node-first addressing**: Frontend addresses everything by `nodeId`, resolved server-side by `NodeRouter`. SSH reconnect changes `connectionId` but leaves SFTP/IDE/forwards unaffected.

Read `docs/reference/ARCHITECTURE.md` and `docs/reference/SYSTEM_INVARIANTS.md` for deep architecture details. **Always read SYSTEM_INVARIANTS.md before touching session, connection, or reconnect code** — it defines strict invariants (Strong Consistency Sync, Key-Driven Reset, lock ordering) that govern Session/Channel/Forward/SFTP/WebShell lifecycle.

### Frontend Structure (`src/`)

- `components/` — React components organized by domain: `terminal/`, `sessions/`, `sftp/`, `editor/`, `ai/`, `settings/`, `topology/`, `plugin/`, `modals/`, `ui/`
- `store/` — 19 Zustand stores (e.g., `sessionTreeStore.ts`, `appStore.ts`, `reconnectOrchestratorStore.ts`, `ideStore.ts`)
- `hooks/` — Shared hooks (terminal keyboard, autosuggest, recording, keybinding dispatch)
- `lib/` — Domain utilities: `api.ts` (Tauri IPC wrappers), `terminal/`, `codemirror/`, `themeManager.ts`, `wireProtocol.ts`, `plugin/`
- `types/` — TypeScript type definitions
- `locales/` — i18n files for 11 languages

### Backend Structure (`src-tauri/src/`)

- `lib.rs` — Entry point, registers all Tauri commands and modules
- `commands/` — Tauri command handlers (~40 files by domain: `ssh.rs`, `sftp.rs`, `forwarding.rs`, `ai_chat.rs`, `plugin.rs`, `rag.rs`, etc.)
- `ssh/` — SSH connection logic
- `session/` — Session management
- `sftp/` — SFTP operations
- `forwarding/` — Port forwarding (lock-free message-passing I/O)
- `bridge/` — WebSocket-to-SSH bridge (WsBridge)
- `router/` — NodeRouter (nodeId resolution, session registry)
- `trzsz/` — In-band terminal file transfer
- `rag/` — RAG knowledge base (BM25 + vector HNSW)
- `cli_server/` — JSON-RPC 2.0 CLI companion server
- `local/` — Local PTY management (feature-gated)
- `graphics/` — WSL graphics/VNC forwarding

### State Management

19 Zustand stores coordinate via events. Key stores:
- `sessionTreeStore.ts` — User intent (expand/collapse, selection)
- `appStore.ts` — Connection state facts (synced via `refreshConnections()`)
- `reconnectOrchestratorStore.ts` — Unified reconnect pipeline
- `nodeStateStore.ts` — Per-node state tracking

After changing `sessionTreeStore`, call `refreshConnections()` to sync per SYSTEM_INVARIANTS.

### Rust Lock Ordering

Respect documented lock ordering in SYSTEM_INVARIANTS: never hold a Session lock while acquiring a SessionRegistry lock. Use `DashMap` for lock-free concurrent access to the SSH connection registry.

## Development Guidelines

- **TypeScript**: Prefer `type` over `interface`. Use function components and hooks. Merge classes with `cn()`.
- **Rust**: Run `cargo fmt`. New Tauri commands go in `src-tauri/src/commands/`, registered in `lib.rs`, wrapped in `src/lib/api.ts`, typed in `src/types/`.
- **i18n**: No hardcoded user-visible strings. Add keys to all 11 locale files. Run `pnpm i18n:check`.
- **Tests**: Vitest with jsdom. Place tests in `src/test/<area>/` as `*.test.ts`/`*.test.tsx`. Run `pnpm test` to verify.
- **Commits**: Conventional Commit style (`feat: ...`, `fix: ...`, `chore(deps): ...`).
- **PRs**: Discuss in an Issue first. Keep PRs small and focused. Link the issue.

## Security

- Passwords and API keys go in the OS keychain, never in config files.
- `.oxide` export uses ChaCha20-Poly1305 + Argon2id (256 MB memory cost).
- Portable mode uses a local encrypted keystore beside the app binary.
- Plugins: `Object.freeze` + Proxy ACL + circuit breaker + IPC whitelist.
- Host keys use TOFU with known_hosts rejection for MITM prevention.

## Other
- 回复和中间过程都使用中文。
- 修改翻译文件的时候，只需要修改简体中文和英语就可以了，其他语言不需要修改。
