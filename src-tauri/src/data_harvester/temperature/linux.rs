//! Linux temperature collection. A device disappearing must not invalidate its peers.
use std::{fs, path::Path};
use anyhow::Result;
use super::TempHarvest;

fn read_temperature(path: &Path) -> Option<f32> {
    let value = fs::read_to_string(path).ok()?.trim().parse::<f32>().ok()? / 1000.0;
    value.is_finite().then_some(value)
}

fn get_from_hwmon(root: &Path) -> Result<Vec<TempHarvest>> {
    let mut temperatures = Vec::new();
    for entry in root.read_dir()?.filter_map(Result::ok) {
        let mut path = entry.path();
        if !path.join("temp1_input").exists() {
            if path.join("device/temp1_input").exists() {
                path.push("device");
            } else {
                continue;
            }
        }
        let device = path.join("device");
        let hardware_name = fs::read_to_string(path.join("name")).ok()
            .map(|name| name.trim().to_string()).unwrap_or_default();
        let power_state = device.join("power_state");
        // Preserve the existing policy: never wake a sleeping device to read a sensor.
        // An unreadable power-state file is treated conservatively as sleeping.
        let read_sensor = !power_state.exists() || fs::read_to_string(power_state)
            .map(|state| matches!(state.trim(), "D0" | "unknown")).unwrap_or(false);
        let device_name = fs::read_dir(device.join("drm")).ok().and_then(|entries| {
            entries.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().into_owned())
                .find(|name| name.starts_with("card"))
        }).or_else(|| {
            fs::read_link(&device).ok().and_then(|link| link.file_name().map(|name| name.to_string_lossy().into_owned()))
                .filter(|name| name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic))
        });
        let name = match device_name {
            Some(device) if !hardware_name.is_empty() => format!("{device} ({hardware_name})"),
            Some(device) => device,
            None => hardware_name,
        };
        let Ok(entries) = path.read_dir() else { continue };
        for entry in entries.filter_map(Result::ok) {
            let filename = entry.file_name().to_string_lossy().into_owned();
            if !(filename.starts_with("temp") && filename.ends_with("_input")) { continue; }
            let temperature = if read_sensor {
                let Some(value) = read_temperature(&entry.path()) else { continue };
                value
            } else {
                // Retain existing aggregation semantics for sleeping devices.
                0.0
            };
            let label = fs::read_to_string(path.join(filename.replace("_input", "_label"))).ok();
            let sensor_name = match label {
                Some(label) if !name.is_empty() => format!("{}: {}", name, label.trim()),
                Some(label) => label.trim().to_string(),
                None => name.clone(),
            };
            temperatures.push(TempHarvest { name: sensor_name, temperature });
        }
    }
    Ok(temperatures)
}

fn get_from_thermal_zone(root: &Path) -> Result<Vec<TempHarvest>> {
    let mut temperatures = Vec::new();
    for entry in root.read_dir()?.filter_map(Result::ok) {
        if !entry.file_name().to_string_lossy().starts_with("thermal_zone") { continue; }
        let path = entry.path();
        let Some(temperature) = read_temperature(&path.join("temp")) else { continue };
        let name = fs::read_to_string(path.join("type")).unwrap_or_default().trim().to_string();
        temperatures.push(TempHarvest { name, temperature });
    }
    Ok(temperatures)
}

fn collect_temperatures(hwmon: &Path, thermal: &Path) -> Result<Vec<TempHarvest>> {
    match get_from_hwmon(hwmon) {
        Ok(temperatures) if !temperatures.is_empty() => Ok(temperatures),
        _ => get_from_thermal_zone(thermal),
    }
}

pub fn get_temperature_data() -> Result<Option<Vec<TempHarvest>>> {
    let temperature_vec = collect_temperatures(Path::new("/sys/class/hwmon"), Path::new("/sys/class/thermal"))?;
    #[cfg(feature = "nvidia")]
    let temperature_vec = {
        let mut temperatures = temperature_vec;
        super::nvidia::add_nvidia_data(&mut temperatures)?;
        temperatures
    };
    Ok(Some(temperature_vec))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("toerings-hwmon-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn write(&self, file: &str, value: &str) {
            let path = self.0.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, value).unwrap();
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn malformed_and_disappearing_sensors_do_not_hide_valid_peers() {
        let fixture = Fixture::new();
        fixture.write("hwmon0/name", "cpu");
        fixture.write("hwmon0/temp1_input", "42000\n");
        fixture.write("hwmon0/temp2_input", "");
        fixture.write("hwmon0/temp3_input", "NaN");
        fixture.write("hwmon1/temp1_input", "invalid");
        // Missing device symlinks and optional names are valid fixtures too.
        let temperatures = get_from_hwmon(&fixture.0).unwrap();
        assert_eq!(temperatures.len(), 1);
        assert_eq!(temperatures[0].temperature, 42.0);
    }
    #[test]
    fn missing_hwmon_uses_thermal_fallback_and_skips_invalid_zones() {
        let fixture = Fixture::new();
        fixture.write("thermal/thermal_zone0/temp", "51000");
        fixture.write("thermal/thermal_zone1/temp", "");
        let temperatures = collect_temperatures(&fixture.0.join("missing"), &fixture.0.join("thermal")).unwrap();
        assert_eq!(temperatures.len(), 1);
        assert_eq!(temperatures[0].temperature, 51.0);
    }
    #[test]
    fn sleeping_devices_keep_existing_zero_temperature_semantics() {
        let fixture = Fixture::new();
        fixture.write("hwmon0/temp1_input", "invalid");
        fixture.write("hwmon0/device/power_state", "D3cold");
        assert_eq!(get_from_hwmon(&fixture.0).unwrap()[0].temperature, 0.0);
    }
}
