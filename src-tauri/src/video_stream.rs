use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};

use crate::encryption::{self, BwayHeader};

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

    let path_str = file_path.to_string_lossy().to_lowercase();
    let is_bway = path_str.ends_with(".bway");

    // Handle Encrypted .bway Containers (AES-256-CTR)
    let (total_size, content_type, bway_context) = if is_bway {
        let mut header_buf = [0u8; encryption::HEADER_SIZE];
        if file.read_exact(&mut header_buf).is_err() {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(b"Invalid .bway container: header truncated".to_vec())
                .unwrap();
        }

        let header = match BwayHeader::parse(&header_buf) {
            Ok(h) => h,
            Err(e) => {
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(format!("Header parse error: {e}").into_bytes())
                    .unwrap();
            }
        };

        let key = match encryption::get_or_derive_machine_key() {
            Ok(k) => k,
            Err(e) => {
                return Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(format!("Machine key resolution failed: {e}").into_bytes())
                    .unwrap();
            }
        };

        (header.original_len, "video/mp4", Some((header, key)))
    } else {
        let size = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => 0,
        };
        let ctype = if path_str.ends_with(".mp4") {
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
        (size, ctype, None)
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

            if let Some((bway_hdr, key)) = &bway_context {
                // On-the-fly AES-256-CTR partial content decryption
                match encryption::read_and_decrypt_range(
                    &mut file,
                    bway_hdr,
                    key,
                    start,
                    length as usize,
                ) {
                    Ok(decrypted_buffer) => {
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
                            .body(decrypted_buffer)
                            .unwrap();
                    }
                    Err(e) => {
                        return Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                            .body(format!("Decryption streaming error: {e}").into_bytes())
                            .unwrap();
                    }
                }
            } else if file.seek(SeekFrom::Start(start)).is_ok() {
                // Standard non-encrypted range reading
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

    // Fallback: Non-range requests (read initial slice or full file)
    if let Some((bway_hdr, key)) = &bway_context {
        let read_len = CHUNK_SIZE.min(total_size) as usize;
        let decrypted = encryption::read_and_decrypt_range(
            &mut file,
            bway_hdr,
            key,
            0,
            read_len,
        )
        .unwrap_or_default();

        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, decrypted.len().to_string())
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(decrypted)
            .unwrap();
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tauri::http::Request;

    #[test]
    fn test_bway_protocol_range_decryption() {
        let key = encryption::get_or_derive_machine_key().expect("derive machine key");
        let original = b"Sample video plaintext data for HTTP 206 protocol streaming test".to_vec();

        let temp_dir = std::env::temp_dir();
        let bway_path = temp_dir.join("protocol_test_video.bway");

        let reader = Cursor::new(&original);
        encryption::encrypt_stream_to_file(reader, original.len() as u64, &bway_path, &key)
            .expect("encrypt to bway");

        let path_str = bway_path.to_string_lossy().replace('\\', "/");
        let uri = format!("bway://localhost/{}", path_str);

        // Build simulated Range request: bytes=7-20
        let req = Request::builder()
            .uri(&uri)
            .header("Range", "bytes=7-20")
            .body(Vec::new())
            .unwrap();

        let resp = handle_bway_protocol(&req);
        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp.headers().get("content-range").unwrap().to_str().unwrap(),
            format!("bytes 7-20/{}", original.len())
        );

        let body = resp.body();
        assert_eq!(body.len(), 14);
        assert_eq!(body.as_slice(), &original[7..=20]);

        let _ = std::fs::remove_file(bway_path);
    }
}
