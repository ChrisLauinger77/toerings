//! Data collection for processes.
//!
//! For Linux, this is handled by a custom set of functions.
//! For Windows and macOS, this is handled by sysinfo.

cfg_if::cfg_if! {
    if #[cfg(target_os = "linux")] {
        pub mod linux;
        pub use self::linux::*;
    } else if #[cfg(target_os = "macos")] {
        pub mod macos;
        mod macos_freebsd;
        pub use self::macos::*;
    } else if #[cfg(target_os = "windows")] {
        pub mod windows;
        pub use self::windows::*;
    } else if #[cfg(target_os = "freebsd")] {
        pub mod freebsd;
        mod macos_freebsd;
        pub use self::freebsd::*;
    }
}

use serde::Serialize;

use crate::Pid;

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProcessHarvest {
    /// The pid of the process.
    pub pid: Pid,

    /// CPU usage as a percentage.
    pub cpu_usage_percent: f64,

    /// Memory usage as bytes.
    pub mem_usage_bytes: u64,

    /// The name of the process.
    pub name: String,

    /// The exact command for the process.
    pub command: String,

    /// Bytes read per second.
    pub read_bytes_per_sec: u64,

    /// Bytes written per second.
    pub write_bytes_per_sec: u64,

    /// The current state of the process (e.g. zombie, asleep)
    pub process_state: (String, char),

    // TODO: Additional fields
    // pub rss_kb: u64,
    // pub virt_kb: u64,
}

#[cfg(any(test, target_os = "macos"))]
mod ps;
