//! Offline-only runtime policy checks (issue #2).
//!
//! These tests read shipped config and assets so the webview cannot depend on
//! remote CDNs, updaters, or outbound HTTP(S) at runtime.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri parent is repo root")
        .to_path_buf()
}

fn read_to_string(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()))
}

fn parse_json(path: &Path) -> Value {
    serde_json::from_str(&read_to_string(path))
        .unwrap_or_else(|err| panic!("invalid JSON {}: {err}", path.display()))
}

fn csp_string(conf: &Value) -> &str {
    conf.pointer("/app/security/csp")
        .and_then(|v| v.as_str())
        .expect("app.security.csp must be a non-null string")
}

/// Remote http(s) hosts are forbidden; Tauri local asset/ipc hosts are allowed.
fn assert_csp_blocks_remote(csp: &str) {
    assert!(
        csp.contains("default-src 'self'"),
        "CSP must default to 'self': {csp}"
    );
    assert!(
        csp.contains("font-src") && csp.contains("'self'"),
        "CSP must restrict fonts to 'self': {csp}"
    );
    assert!(
        csp.contains("connect-src") && (csp.contains("ipc:") || csp.contains("ipc.localhost")),
        "CSP must allow Tauri IPC without opening general network: {csp}"
    );

    assert!(
        !csp.contains("https:"),
        "CSP must not allow remote https: {csp}"
    );
    assert!(
        !csp.contains('*'),
        "CSP must not use wildcard sources: {csp}"
    );

    for token in csp.split(|c: char| c.is_whitespace() || c == ';') {
        let token = token.trim();
        if token.starts_with("http://") {
            assert!(
                token == "http://ipc.localhost" || token == "http://asset.localhost",
                "unexpected remote http source in CSP: {token}"
            );
        }
    }
}

#[test]
fn tauri_csp_blocks_remote_http_and_https() {
    let conf = parse_json(&repo_root().join("src-tauri/tauri.conf.json"));
    let csp = csp_string(&conf);
    assert_csp_blocks_remote(csp);
}

#[test]
fn asset_protocol_scope_is_not_filesystem_wildcard() {
    let conf = parse_json(&repo_root().join("src-tauri/tauri.conf.json"));
    let enabled = conf
        .pointer("/app/security/assetProtocol/enable")
        .and_then(|v| v.as_bool())
        .expect("assetProtocol.enable must be set");
    assert!(enabled, "asset protocol must stay enabled for offline preview");

    let scope = conf
        .pointer("/app/security/assetProtocol/scope")
        .expect("assetProtocol.scope must be present");
    let patterns: Vec<&str> = if let Some(arr) = scope.as_array() {
        arr.iter().filter_map(|v| v.as_str()).collect()
    } else if let Some(obj) = scope.as_object() {
        obj.get("allow")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str())
            .collect()
    } else {
        panic!("assetProtocol.scope must be an array or scope object");
    };
    assert!(
        patterns.iter().all(|p| *p != "**" && !p.ends_with("/**")),
        "assetProtocol.scope must not grant whole-filesystem access: {patterns:?}"
    );
}

#[test]
fn auto_updater_is_not_configured() {
    let conf = parse_json(&repo_root().join("src-tauri/tauri.conf.json"));
    if let Some(plugins) = conf.get("plugins") {
        assert!(
            plugins.get("updater").is_none(),
            "tauri.conf.json must not configure plugins.updater"
        );
    }

    let cargo = read_to_string(&repo_root().join("src-tauri/Cargo.toml"));
    assert!(
        !cargo.contains("tauri-plugin-updater"),
        "Cargo.toml must not depend on tauri-plugin-updater"
    );

    let package = parse_json(&repo_root().join("package.json"));
    let deps = package
        .get("dependencies")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let dev_deps = package
        .get("devDependencies")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    assert!(
        !deps.contains_key("@tauri-apps/plugin-updater")
            && !dev_deps.contains_key("@tauri-apps/plugin-updater"),
        "package.json must not depend on @tauri-apps/plugin-updater"
    );
}

fn permission_identifier(perm: &Value) -> Option<&str> {
    perm.as_str()
        .or_else(|| perm.get("identifier").and_then(|v| v.as_str()))
}

#[test]
fn capabilities_do_not_grant_http_client() {
    let caps = parse_json(&repo_root().join("src-tauri/capabilities/default.json"));
    let permissions = caps
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("capabilities.default.permissions must be an array");
    for perm in permissions {
        let name = permission_identifier(perm).unwrap_or("");
        assert!(
            !name.starts_with("http:") && !name.contains("http-"),
            "default capability must not grant HTTP client access: {name}"
        );
    }
}

/// `openPath` denies when the allow list is empty — OPEN _COMPRESSED needs a path scope.
#[test]
fn opener_allow_open_path_has_path_allow_scope() {
    let caps = parse_json(&repo_root().join("src-tauri/capabilities/default.json"));
    let permissions = caps
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("capabilities.default.permissions must be an array");

    let open_path = permissions
        .iter()
        .find(|perm| permission_identifier(perm) == Some("opener:allow-open-path"))
        .expect("capabilities must grant opener:allow-open-path");

    let allow = open_path
        .get("allow")
        .and_then(|v| v.as_array())
        .expect("opener:allow-open-path must use object form with an allow scope");
    assert!(
        allow.iter().any(|entry| {
            entry
                .get("path")
                .and_then(|p| p.as_str())
                .is_some_and(|p| !p.is_empty())
        }),
        "opener:allow-open-path allow scope must include at least one path entry"
    );
}

#[test]
fn ice_hud_fonts_are_vendored_locally() {
    let fonts_dir = repo_root().join("src/assets/fonts");
    let required = [
        "exo-2-latin-400-normal.woff2",
        "exo-2-latin-500-normal.woff2",
        "exo-2-latin-600-normal.woff2",
        "jetbrains-mono-latin-400-normal.woff2",
        "jetbrains-mono-latin-500-normal.woff2",
        "fonts.css",
    ];
    for name in required {
        let path = fonts_dir.join(name);
        assert!(path.is_file(), "missing local font asset: {}", path.display());
        assert!(
            fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false),
            "font asset is empty: {}",
            path.display()
        );
    }

    let css = read_to_string(&fonts_dir.join("fonts.css"));
    assert!(
        css.contains("@font-face")
            && css.contains("Exo 2")
            && css.contains("JetBrains Mono"),
        "fonts.css must declare Exo 2 and JetBrains Mono @font-face rules"
    );
    assert!(
        !css.contains("http://") && !css.contains("https://"),
        "fonts.css must not reference remote URLs"
    );
    assert!(
        css.contains("./exo-2-") && css.contains("./jetbrains-mono-"),
        "fonts.css must load relative local woff2 files"
    );
}

#[test]
fn frontend_entry_loads_local_fonts_only() {
    let main = read_to_string(&repo_root().join("src/main.tsx"));
    assert!(
        main.contains("assets/fonts/fonts.css") || main.contains("./assets/fonts/fonts.css"),
        "main.tsx must import local fonts.css"
    );

    let index = read_to_string(&repo_root().join("index.html"));
    assert!(
        !index.contains("fonts.googleapis.com")
            && !index.contains("fonts.gstatic.com")
            && !index.contains("cdn."),
        "index.html must not load CDN fonts or scripts"
    );
}

#[test]
fn readme_states_offline_only_constraint() {
    let readme = read_to_string(&repo_root().join("README.md"));
    let lower = readme.to_lowercase();
    assert!(
        lower.contains("offline")
            && (lower.contains("no network")
                || lower.contains("without network")
                || lower.contains("no internet")
                || lower.contains("offline-only")
                || lower.contains("does not require")),
        "README must document the offline-only product constraint"
    );
}
