#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Ensure WebView2 media-stream capture (microphone/audio) is enabled without blocking
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let media_flags = "--enable-media-stream --enable-features=msWebAudioCapture,msWebAudioCaptureMute,PreloadMediaEngagementData --autoplay-policy=no-user-gesture-required";
        let combined = if existing.is_empty() {
            media_flags.to_string()
        } else {
            format!("{} {}", existing, media_flags)
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
    }

    #[cfg(target_os = "linux")]
    {
        // Ensure WebKitGTK allows WebRTC audio stream capture
        std::env::set_var("WEBKIT_WEBRTC_AUDIO_CAPTURE", "1");
        std::env::set_var("WEBKIT_MEDIA_STREAM", "1");
    }

    bestway_app_lib::run();
}
