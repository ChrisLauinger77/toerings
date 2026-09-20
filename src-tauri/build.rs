use std::{env, fs, path::PathBuf, process::Command};

const UNKNOWN_COMMIT: &str = "unknown";

fn git_output(args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(env::var_os("CARGO_MANIFEST_DIR")?)
        .output()
        .ok()?;

    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn short_commit(value: &str) -> Option<&str> {
    let value = value.trim();
    (value.len() >= 7 && value.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| &value[..7])
}

fn git_commit() -> String {
    env::var("TOERINGS_GIT_COMMIT")
        .ok()
        .and_then(|value| short_commit(&value).map(str::to_string))
        .or_else(|| {
            git_output(&["rev-parse", "HEAD"])
                .and_then(|value| short_commit(&value).map(str::to_string))
        })
        .or_else(|| {
            env::var("GITHUB_SHA")
                .ok()
                .and_then(|value| short_commit(&value).map(str::to_string))
        })
        .unwrap_or_else(|| UNKNOWN_COMMIT.to_string())
}

fn watch_git_head() {
    let Some(head_path) = git_output(&["rev-parse", "--git-path", "HEAD"]).map(PathBuf::from)
    else {
        return;
    };

    println!("cargo:rerun-if-changed={}", head_path.display());
    if let Some(packed_refs) = git_output(&["rev-parse", "--git-path", "packed-refs"]) {
        println!("cargo:rerun-if-changed={packed_refs}");
    }

    let Ok(head) = fs::read_to_string(&head_path) else {
        return;
    };
    let Some(reference) = head.trim().strip_prefix("ref: ") else {
        return;
    };
    if let Some(reference_path) = git_output(&["rev-parse", "--git-path", reference]) {
        println!("cargo:rerun-if-changed={reference_path}");
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=TOERINGS_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    watch_git_head();
    println!("cargo:rustc-env=TOERINGS_GIT_COMMIT={}", git_commit());
    tauri_build::build()
}
