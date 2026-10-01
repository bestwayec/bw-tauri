use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Battery snapshot sent to the frontend.
/// `percent` is 0-100, or `None` (null in JSON) when unknown / no battery.
#[derive(Debug, Clone, Serialize)]
pub struct BatteryInfo {
    pub percent: Option<u8>,
    pub charging: bool,
    pub state: String,
}

/// How long a reading is trusted before re-probing the OS.
const CACHE_TTL: Duration = Duration::from_secs(10);

/// Managed cache: probing the OS is the slow part, so concurrent ticks
/// within the TTL share one reading instead of hammering the API.
pub struct BatteryCache {
    last: Mutex<Option<(BatteryInfo, Instant)>>,
}

impl BatteryCache {
    pub fn new() -> Self {
        Self { last: Mutex::new(None) }
    }

    fn fresh(&self) -> Option<BatteryInfo> {
        self.last
            .lock()
            .ok()
            .and_then(|g| g.as_ref().filter(|(_, at)| at.elapsed() < CACHE_TTL).map(|(info, _)| info.clone()))
    }

    fn store(&self, info: &BatteryInfo) {
        if let Ok(mut g) = self.last.lock() {
            *g = Some((info.clone(), Instant::now()));
        }
    }
}

impl Default for BatteryCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Async command: never blocks the UI thread (heavy probe runs on the
/// blocking pool) and serves cached readings to concurrent pollers.
/// (Tauri requires async commands with borrowed inputs to return Result.)
#[tauri::command]
pub async fn get_battery(cache: tauri::State<'_, BatteryCache>) -> Result<BatteryInfo, String> {
    if let Some(hit) = cache.fresh() {
        return Ok(hit);
    }
    let info = tauri::async_runtime::spawn_blocking(get_battery_sync)
        .await
        .unwrap_or_else(|_| unknown());
    cache.store(&info);
    Ok(info)
}

fn unknown() -> BatteryInfo {
    BatteryInfo {
        percent: None,
        charging: false,
        state: "unknown".to_string(),
    }
}

/// Cross-platform battery readout via `starship-battery`.
/// Never panics: every failure path falls back to `unknown()`.
/// Runs on the blocking pool (see the `get_battery` command above).
fn get_battery_sync() -> BatteryInfo {
    let manager = match starship_battery::Manager::new() {
        Ok(m) => m,
        Err(_) => return unknown(),
    };

    let batteries = match manager.batteries() {
        Ok(b) => b,
        Err(_) => return unknown(),
    };

    // Take the first battery that reads successfully; desktops often have none.
    let mut first: Option<starship_battery::Battery> = None;
    for maybe in batteries {
        match maybe {
            Ok(b) => {
                first = Some(b);
                break;
            }
            Err(_) => continue,
        }
    }

    let battery = match first {
        Some(b) => b,
        None => return unknown(),
    };

    let state = battery.state();
    let charging = matches!(
        state,
        starship_battery::State::Charging | starship_battery::State::Full
    );

    let state_str = match state {
        starship_battery::State::Charging => "charging",
        starship_battery::State::Discharging => "discharging",
        starship_battery::State::Full => "full",
        starship_battery::State::Empty => "empty",
        starship_battery::State::Unknown => "unknown",
    }
    .to_string();

    // `state_of_charge` is a uom Ratio; extract percent (0.0-100.0).
    let percent = {
        use starship_battery::units::ratio::percent;
        let v = battery.state_of_charge().get::<percent>();
        if v.is_finite() {
            let rounded = v.round().clamp(0.0, 100.0) as u8;
            Some(rounded)
        } else {
            None
        }
    };

    BatteryInfo {
        percent,
        charging,
        state: state_str,
    }
}
