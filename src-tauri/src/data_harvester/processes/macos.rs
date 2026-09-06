//! Process data collection for macOS.  Uses sysinfo and custom bindings.

use sysinfo::System;

use super::ProcessHarvest;
use crate::{data_harvester::processes::UserTable, Pid};
mod sysctl_bindings;

pub fn get_process_data(
    sys: &System,
    use_current_cpu_total: bool,
    unnormalized_cpu: bool,
    mem_total_kb: u64,
    elapsed: std::time::Duration,
    user_table: &mut UserTable,
) -> crate::utils::error::Result<Vec<ProcessHarvest>> {
    super::macos_freebsd::get_process_data(
        sys,
        use_current_cpu_total,
        unnormalized_cpu,
        mem_total_kb,
        elapsed,
        user_table,
        get_macos_process_cpu_usage,
    )
}

pub(crate) fn fallback_macos_ppid(pid: Pid) -> Option<Pid> {
    sysctl_bindings::kinfo_process(pid)
        .map(|kinfo| kinfo.kp_eproc.e_ppid)
        .ok()
}

fn get_macos_process_cpu_usage(
    pids: &[Pid],
) -> std::io::Result<std::collections::HashMap<i32, f64>> {
    if pids.is_empty() { return Ok(std::collections::HashMap::new()); }
    let pid_list = pids.iter().map(i32::to_string).collect::<Vec<_>>().join(",");
    let output = crate::utils::process::capture_stdout(
        std::process::Command::new("/bin/ps")
            .env("LC_ALL", "C")
            .args(["-o", "pid=,pcpu=", "-p", &pid_list]),
        std::time::Duration::from_secs(2),
        1024 * 1024,
    )?;
    Ok(super::ps::parse_cpu_usage(&String::from_utf8_lossy(&output)))
}
