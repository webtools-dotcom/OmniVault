//! In-place update of the Windows build from a GitHub release.
//!
//! The release zip is downloaded with the `curl.exe` that ships with Windows 10
//! and 11, so the app needs no TLS stack of its own. The archive is checked
//! against the release's `SHA256SUMS.txt` before anything on disk is touched.
//! A running executable cannot be overwritten on Windows but can be renamed,
//! so the current one is moved aside, the new one put in its place, and the
//! app relaunched; the old copy is removed on the next start.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const STAGING_DIR: &str = ".omnivault-update";
const OLD_EXE: &str = "omnivault.old.exe";
const OLD_DIST: &str = "dist.old";

/// Downloads, verifies and installs `version`, then schedules a relaunch.
/// The caller exits the app once this returns.
pub fn install(repo: &str, version: &str) -> Result<(), String> {
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Err(format!("'{version}' is not a release version."));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or("The app's folder could not be found.")?
        .to_path_buf();
    let staging = dir.join(STAGING_DIR);
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Could not prepare the update: {e}"))?;

    let base = format!("https://github.com/{repo}/releases/download/v{version}");
    let zip_name = format!("omnivault-v{version}-windows-x64.zip");
    let zip_path = staging.join(&zip_name);
    let sums_path = staging.join("SHA256SUMS.txt");
    download(&format!("{base}/{zip_name}"), &zip_path)?;
    download(&format!("{base}/SHA256SUMS.txt"), &sums_path)?;

    let zip = fs::read(&zip_path).map_err(|e| e.to_string())?;
    let sums = fs::read_to_string(&sums_path).map_err(|e| e.to_string())?;
    let expected = expected_hash(&sums, &zip_name)
        .ok_or("The release does not list a checksum for the Windows build.")?;
    if crate::db::media::compute_sha256(&zip) != expected {
        return Err("The download did not match the published checksum.".into());
    }

    // The release zips are made with PowerShell's Compress-Archive, which
    // writes `\` as the path separator; accept either.
    let replace_dist = dir.join("dist").is_dir();
    let entries: Vec<(String, Vec<u8>)> = crate::db::import::zip_entries(&zip, |name| {
        let name = name.replace('\\', "/");
        name == "omnivault.exe" || (replace_dist && name.starts_with("dist/"))
    })
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|(name, bytes)| (name.replace('\\', "/"), bytes))
    .collect();
    if !entries.iter().any(|(name, _)| name == "omnivault.exe") {
        return Err("The downloaded archive has no omnivault.exe.".into());
    }
    for (name, bytes) in &entries {
        if name.split('/').any(|part| part == ".." || part.is_empty()) {
            continue;
        }
        let dest = staging.join(name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    }

    swap(&exe, &staging.join("omnivault.exe"), &dir.join(OLD_EXE))?;
    if replace_dist {
        let _ = swap(
            &dir.join("dist"),
            &staging.join("dist"),
            &dir.join(OLD_DIST),
        );
    }
    relaunch(&exe)
}

/// Removes what a previous update left behind. Called at start-up.
pub fn clean_up_previous() {
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return;
    };
    let _ = fs::remove_file(dir.join(OLD_EXE));
    let _ = fs::remove_dir_all(dir.join(OLD_DIST));
    let _ = fs::remove_dir_all(dir.join(STAGING_DIR));
}

/// The hash `SHA256SUMS.txt` lists for `file_name`.
fn expected_hash(sums: &str, file_name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, name) = line.split_once(char::is_whitespace)?;
        (name.trim().trim_start_matches('*') == file_name).then(|| hash.to_ascii_lowercase())
    })
}

/// Moves `current` aside to `backup` and `replacement` into its place, putting
/// `current` back if the second step fails.
fn swap(current: &Path, replacement: &Path, backup: &Path) -> Result<(), String> {
    if backup.is_dir() {
        let _ = fs::remove_dir_all(backup);
    } else {
        let _ = fs::remove_file(backup);
    }
    fs::rename(current, backup).map_err(|e| format!("Could not replace the app: {e}"))?;
    if let Err(e) = fs::rename(replacement, current) {
        let _ = fs::rename(backup, current);
        return Err(format!("Could not replace the app: {e}"));
    }
    Ok(())
}

fn download(url: &str, dest: &PathBuf) -> Result<(), String> {
    let status = hidden(Command::new("curl.exe"))
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "2",
        ])
        .args(["--max-time", "300", "--output"])
        .arg(dest)
        .arg(url)
        .status()
        .map_err(|e| format!("Could not start the download: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("The download failed. Check the internet connection and try again.".into())
    }
}

/// Starts the new executable after this process has exited and released the
/// server port.
fn relaunch(exe: &Path) -> Result<(), String> {
    let quoted = exe.display().to_string().replace('\'', "''");
    hidden(Command::new("powershell.exe"))
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
        ])
        .arg(format!(
            "Start-Sleep -Seconds 2; Start-Process -FilePath '{quoted}'"
        ))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Updated, but could not restart the app: {e}"))
}

#[cfg(windows)]
fn hidden(mut command: Command) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn hidden(command: Command) -> Command {
    command
}

#[cfg(test)]
mod tests {
    use super::expected_hash;

    #[test]
    fn finds_the_checksum_for_a_file() {
        let sums = "ABC123  omnivault.exe\nfff000  omnivault-v0.2.2-windows-x64.zip\n";
        assert_eq!(
            expected_hash(sums, "omnivault-v0.2.2-windows-x64.zip").as_deref(),
            Some("fff000")
        );
        assert_eq!(
            expected_hash(sums, "omnivault.exe").as_deref(),
            Some("abc123")
        );
        assert_eq!(expected_hash(sums, "missing.zip"), None);
    }
}
