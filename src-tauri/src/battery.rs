use serde::Serialize;

/// Battery snapshot sent to the frontend.
/// `percent` is 0-100, or `None` (null in JSON) when unknown / no battery.
#[derive(Debug, Clone, Serialize)]
pub struct BatteryInfo {
    pub percent: Option<u8>,
    pub charging: bool,
    pub state: String,
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
pub fn get_battery() -> BatteryInfo {
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
