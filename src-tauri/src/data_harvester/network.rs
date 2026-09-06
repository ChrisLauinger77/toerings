//! Data collection for network usage/IO.
//!
//! For Linux and macOS, this is handled by Heim.
//! For Windows, this is handled by sysinfo.

use serde::Serialize;

cfg_if::cfg_if! {
    if #[cfg(any(target_os = "linux", target_os = "macos"))] {
        pub mod heim;
        pub use self::heim::*;
    } else if #[cfg(any(target_os = "freebsd", target_os = "windows"))] {
        pub mod sysinfo;
        pub use self::sysinfo::*;
    }
}

#[derive(Default, Clone, Debug, Serialize)]
/// Rates are bytes per second.
pub struct NetworkHarvest {
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Default)]
pub struct NetworkHistory {
    interfaces: std::collections::HashMap<String, (u64, u64, std::time::Instant)>,
}

impl NetworkHistory {
    pub fn sample(
        &mut self,
        counters: impl IntoIterator<Item = (String, u64, u64)>,
        now: std::time::Instant,
    ) -> NetworkHarvest {
        use super::rates::bytes_per_second;
        let mut next = std::collections::HashMap::new();
        let mut data = NetworkHarvest::default();
        for (name, rx, tx) in counters {
            if let Some(&(previous_rx, previous_tx, previous_time)) = self.interfaces.get(&name) {
                let elapsed = now.saturating_duration_since(previous_time);
                data.rx = data.rx.saturating_add(bytes_per_second(rx.saturating_sub(previous_rx), elapsed));
                data.tx = data.tx.saturating_add(bytes_per_second(tx.saturating_sub(previous_tx), elapsed));
            }
            next.insert(name, (rx, tx, now));
        }
        self.interfaces = next;
        data
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    fn counter(name: &str, bytes: u64) -> (String, u64, u64) { (name.into(), bytes, bytes) }

    #[test]
    fn samples_bytes_with_per_interface_baselines() {
        let mut history = NetworkHistory::default();
        let now = Instant::now();
        assert_eq!(history.sample([counter("a", 100)], now).rx, 0);
        let sample = history.sample([counter("a", 1_048_676)], now + Duration::from_secs(1));
        assert_eq!((sample.rx, sample.tx), (1_048_576, 1_048_576));
        assert_eq!(serde_json::to_value(&sample).unwrap(), serde_json::json!({
            "rx": 1_048_576, "tx": 1_048_576,
        }));
        // Raw counters and sample times must survive removal of exported totals.
        let sample = history.sample([counter("a", 2_097_252)], now + Duration::from_millis(1500));
        assert_eq!((sample.rx, sample.tx), (2_097_152, 2_097_152));
    }

    #[test]
    fn changes_and_failed_intervals_do_not_create_spikes_or_hide_other_traffic() {
        let mut history = NetworkHistory::default();
        let now = Instant::now();
        history.sample([counter("a", 100)], now);
        // No sample is committed during a failed enumeration.
        let sample = history.sample([counter("a", 400), counter("b", 90000)], now + Duration::from_secs(3));
        assert_eq!(sample.rx, 100);
        let sample = history.sample([counter("a", 500)], now + Duration::from_secs(4));
        assert_eq!(sample.rx, 100);
        let sample = history.sample([counter("a", 10)], now + Duration::from_secs(5));
        assert_eq!(sample.rx, 0);
        let sample = history.sample([counter("a", 110)], now + Duration::from_secs(6));
        assert_eq!(sample.rx, 100);
    }
}
