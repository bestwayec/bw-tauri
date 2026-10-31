use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};

const CHUNK_SIZE: u64 = 2 * 1024 * 1024; // 2 MB slice buffer

pub fn handle_bway_protocol(
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let raw_path = uri.path();

    // Decode percent-encoded characters using url::form_urlencoded
    let decoded_path: String = url::form_urlencoded::parse(raw_path.as_bytes())
        .map(|(k, _)| k.into_owned())
        .collect::<Vec<String>>()
        .join("");
    let path_to_use = if decoded_path.is_empty() {
        raw_path.to_string()
    } else {
        decoded_path
    };

    // Normalize Windows / POSIX path prefix
    let normalized = path_to_use.trim_start_matches('/');
    #[cfg(target_os = "windows")]
    let file_path = if normalized.len() > 2 && normalized.chars().nth(1) == Some(':') {
        PathBuf::from(normalized)
    } else {
        PathBuf::from(format!("/{}", normalized))
    };

    #[cfg(not(target_os = "windows"))]
    let file_path = PathBuf::from(format!("/{}", normalized));

    if !file_path.exists() || !file_path.is_file() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(b"File not found".to_vec())
            .unwrap();
    }

    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(b"Could not open media file".to_vec())
                .unwrap();
        }
    };

    let total_size = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => 0,
    };

    let path_str = file_path.to_string_lossy().to_lowercase();
    let content_type = if path_str.ends_with(".mp4") {
        "video/mp4"
    } else if path_str.ends_with(".webm") {
        "video/webm"
    } else if path_str.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if path_str.ends_with(".ts") {
        "video/mp2t"
    } else if path_str.ends_with(".mp3") {
        "audio/mpeg"
    } else {
        "application/octet-stream"
    };

    // Evaluate HTTP Range Request Header
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());

    if let Some(range_val) = range_header {
        if let Some(bytes_range) = range_val.strip_prefix("bytes=") {
            let parts: Vec<&str> = bytes_range.split('-').collect();
            let start = parts
                .first()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            let end = parts
                .get(1)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or_else(|| (start + CHUNK_SIZE - 1).min(total_size.saturating_sub(1)));

            let end = end.min(total_size.saturating_sub(1));
            let length = if end >= start { end - start + 1 } else { 0 };

            if file.seek(SeekFrom::Start(start)).is_ok() {
                let mut buffer = vec![0u8; length as usize];
                if file.read_exact(&mut buffer).is_ok() {
                    return Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, content_type)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {}-{}/{}", start, end, total_size),
                        )
                        .header(header::CONTENT_LENGTH, length.to_string())
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .header(
                            header::ACCESS_CONTROL_EXPOSE_HEADERS,
                            "Content-Range, Content-Length, Accept-Ranges",
                        )
                        .body(buffer)
                        .unwrap();
                }
            }
        }
    }

    // Fallback: Read full file or initial buffer
    let mut buffer = Vec::new();
    let _ = file.read_to_end(&mut buffer);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total_size.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(buffer)
        .unwrap()
}
