use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use tauri::http::{header, Request, Response, StatusCode};

use crate::encryption::{self, BwayHeader};

const CHUNK_SIZE: u64 = 2 * 1024 * 1024; // 2 MB slice buffer

pub fn handle_bway_protocol(request: &Request<Vec<u8>>, root: &Path) -> Response<Vec<u8>> {
    handle_bway_protocol_with_key(request, root, encryption::get_or_derive_machine_key)
}

fn handle_bway_protocol_with_key(
    request: &Request<Vec<u8>>,
    root: &Path,
    resolve_key: impl FnOnce() -> Result<[u8; 32], String>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let raw_path = uri.path();

    let file_path = match crate::offline_media::media_path(root, raw_path) {
        Ok(path) => path,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(b"Media path unavailable".to_vec())
                .unwrap()
        }
    };

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

        let key = match resolve_key() {
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
        if let Some((start, end)) =
            crate::offline_media::byte_range(range_val, total_size, CHUNK_SIZE)
        {
            let length = end - start + 1;

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
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total_size}"))
            .body(Vec::new())
            .unwrap();
    }

    // Keep every response within the same memory budget. Browser media
    // clients use byte ranges; a whole-file request cannot allocate gigabytes.
    if total_size > CHUNK_SIZE {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes */{total_size}"))
            .body(b"Use a byte-range request for large media".to_vec())
            .unwrap();
    }

    // Small non-range requests return the complete file.
    if let Some((bway_hdr, key)) = &bway_context {
        let read_len = CHUNK_SIZE.min(total_size) as usize;
        let decrypted = encryption::read_and_decrypt_range(&mut file, bway_hdr, key, 0, read_len)
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
        let key = [73u8; 32];
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

        let resp = handle_bway_protocol_with_key(&req, &temp_dir, || Ok(key));
        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp.headers()
                .get("content-range")
                .unwrap()
                .to_str()
                .unwrap(),
            format!("bytes 7-20/{}", original.len())
        );

        let body = resp.body();
        assert_eq!(body.len(), 14);
        assert_eq!(body.as_slice(), &original[7..=20]);

        let _ = std::fs::remove_file(bway_path);
    }
}
