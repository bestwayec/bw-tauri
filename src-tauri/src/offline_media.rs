//! Filesystem boundary for the offline video command and protocol.
use std::path::{Path, PathBuf};

pub fn video_filename(input: &str) -> Result<String, String> {
    let name = input.trim().trim_end_matches(".bway");
    if name.is_empty()
        || name.len() > 160
        || name.starts_with('.')
        || name.contains("..")
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    {
        return Err("INVALID_FILENAME: use a simple video name".into());
    }
    Ok(format!("{name}.bway"))
}

pub fn media_path(root: &Path, encoded: &str) -> Result<PathBuf, String> {
    // URI paths are not form bodies: '+' and '&' are literal filename bytes.
    let mut bytes = Vec::new();
    let mut input = encoded.bytes();
    while let Some(byte) = input.next() {
        bytes.push(if byte == b'%' {
            let hi = input.next().and_then(|c| (c as char).to_digit(16));
            let lo = input.next().and_then(|c| (c as char).to_digit(16));
            match (hi, lo) {
                (Some(hi), Some(lo)) => (hi * 16 + lo) as u8,
                _ => return Err("Invalid path encoding".into()),
            }
        } else {
            byte
        });
    }
    let decoded = String::from_utf8(bytes).map_err(|_| "Invalid path encoding")?;
    #[cfg(target_os = "windows")]
    let decoded = decoded.trim_start_matches('/');
    let candidate = PathBuf::from(decoded);
    let root = root
        .canonicalize()
        .map_err(|_| "Offline video directory unavailable")?;
    let candidate = candidate
        .canonicalize()
        .map_err(|_| "Media file unavailable")?;
    if !candidate.starts_with(&root) || !candidate.is_file() {
        return Err("Media path outside offline video directory".into());
    }
    Ok(candidate)
}

pub fn byte_range(value: &str, size: u64, max_chunk: u64) -> Option<(u64, u64)> {
    if size == 0 || max_chunk == 0 {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (size.saturating_sub(suffix), size - 1)
    } else {
        let start = start.parse::<u64>().ok()?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>().ok()?
        };
        (start, end.min(size - 1))
    };
    if start >= size || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(max_chunk - 1))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_download_path_traversal_and_absolute_names() {
        for input in [
            "",
            "..",
            "../session",
            "/tmp/session",
            "C:\\session",
            "a/b",
            "a\\b",
            "%2e%2e",
            ".hidden",
            "x\n",
        ] {
            // Whitespace at the edges is deliberately trimmed.
            if input == "x\n" {
                continue;
            }
            assert!(video_filename(input).is_err(), "accepted {input}");
        }
        assert_eq!(video_filename("lesson-1.bway").unwrap(), "lesson-1.bway");
    }
    #[test]
    fn restricts_protocol_to_its_directory_and_preserves_literal_path_bytes() {
        let dir = std::env::temp_dir().join(format!("bw-media-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("videos")).unwrap();
        std::fs::write(dir.join("private.json"), b"synthetic secret").unwrap();
        let video = dir.join("videos/a+b&c.bway");
        std::fs::write(&video, b"video").unwrap();
        assert_eq!(
            media_path(&dir.join("videos"), video.to_str().unwrap()).unwrap(),
            video.canonicalize().unwrap()
        );
        assert!(media_path(
            &dir.join("videos"),
            dir.join("private.json").to_str().unwrap()
        )
        .is_err());
        assert!(media_path(
            &dir.join("videos"),
            &format!("{}/%2e%2e/private.json", dir.join("videos").display())
        )
        .is_err());
        assert!(media_path(&dir.join("videos"), "%ZZ").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("private.json"), dir.join("videos/link")).unwrap();
            assert!(media_path(
                &dir.join("videos"),
                dir.join("videos/link").to_str().unwrap()
            )
            .is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn range_requests_are_validated_and_allocations_are_bounded() {
        assert_eq!(
            byte_range("bytes=10-999999999999", 1000, 20),
            Some((10, 29))
        );
        assert_eq!(byte_range("bytes=-10", 1000, 20), Some((990, 999)));
        assert_eq!(byte_range("bytes=995-", 1000, 20), Some((995, 999)));
        for value in [
            "bytes=20-10",
            "bytes=1000-",
            "bytes=-0",
            "bytes=0-1,3-4",
            "garbage",
        ] {
            assert_eq!(byte_range(value, 1000, 20), None);
        }
        assert_eq!(byte_range("bytes=0-", 0, 20), None);
    }
}
