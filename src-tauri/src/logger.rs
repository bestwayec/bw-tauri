//! Minimal rotating file logger (no new dependencies).
//!
//! - Logs to `<app_data>/logs/app-YYYY-MM-DD.log`, pruned to the newest 7
//!   files / 5 MB total on every init.
//! - Installs a panic hook that records the payload before the process dies.
//! - Console (`eprintln!`) stays as the dev-visible channel; this file is the
//!   on-PC diagnostic channel support asks for after an incident.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

const KEEP_FILES: usize = 7;
const MAX_TOTAL_BYTES: u64 = 5 * 1024 * 1024;

pub fn file_name_for(date: &str) -> String {
    format!("app-{date}.log")
}

fn today_ymd() -> String {
    // Cheap calendar date without chrono: days since unix epoch -> y/m/d.
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    let (mut y, mut m, mut d) = (1970i64, 1i64, 1i64);
    let mut rest = days;
    while rest >= 365 {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if rest < len {
            break;
        }
        rest -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let lens = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for len in lens {
        if rest < len {
            break;
        }
        rest -= len;
        m += 1;
    }
    d += rest;
    format!("{y:04}-{m:02}-{d:02}")
}

/// Delete oldest `app-*.log` files until count and total size fit the budget.
/// Returns the number of files removed (pure enough to unit-test via temp dirs).
pub fn prune(dir: &Path) -> usize {
    let mut entries: Vec<(PathBuf, u64, String)> = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("app-") && name.ends_with(".log")) {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        entries.push((entry.path(), size, name));
    }
    entries.sort_by(|a, b| a.2.cmp(&b.2));
    let mut removed = 0;
    while entries.len() > KEEP_FILES
        || entries.iter().map(|(_, s, _)| s).sum::<u64>() > MAX_TOTAL_BYTES
    {
        if entries.is_empty() {
            break;
        }
        let (path, _, _) = entries.remove(0);
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// Best-effort append. Never panics, never blocks the caller long.
pub fn log_line(level: &str, msg: &str) {
    let path = LOG_FILE.lock().ok().and_then(|g| g.clone());
    let line = format!("[{}] {level}: {msg}\n", timestamp());
    if let Some(path) = path {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

/// Initialize from setup(): set today's file, prune, install panic hook.
pub fn init(app_dir: &Path) {
    let dir = app_dir.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    prune(&dir);
    let path = dir.join(file_name_for(&today_ymd()));
    if let Ok(mut g) = LOG_FILE.lock() {
        *g = Some(path);
    }
    std::panic::set_hook(Box::new(|info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        let loc = info.location().map(|l| l.to_string()).unwrap_or_default();
        log_line("FATAL", &format!("panic: {payload} at {loc}"));
        eprintln!("[fatal] panic: {payload} at {loc}");
    }));
    log_line("INFO", "logger initialized");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_newest_seven_within_budget() {
        let dir = std::env::temp_dir().join(format!("bw-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..10 {
            std::fs::write(dir.join(format!("app-2026-09-{i:02}.log")), vec![b'x'; 100]).unwrap();
        }
        std::fs::write(dir.join("notes.txt"), b"keep me").unwrap();
        let removed = prune(&dir);
        assert_eq!(removed, 3);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert!(left.contains(&"notes.txt".to_string()));
        assert_eq!(left.iter().filter(|n| n.starts_with("app-")).count(), 7);
        assert!(left.contains(&"app-2026-09-09.log".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_caps_total_bytes() {
        let dir = std::env::temp_dir().join(format!("bw-log-test-b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 3 files x 2MB = 6MB > 5MB budget -> oldest goes.
        for name in [
            "app-2026-01-01.log",
            "app-2026-01-02.log",
            "app-2026-01-03.log",
        ] {
            std::fs::write(dir.join(name), vec![0u8; 2 * 1024 * 1024]).unwrap();
        }
        assert_eq!(prune(&dir), 1);
        assert!(!dir.join("app-2026-01-01.log").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
