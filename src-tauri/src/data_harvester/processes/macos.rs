//! Process data collection for macOS. Uses sysinfo with a ps CPU fallback.

use sysinfo::System;

use super::ProcessHarvest;
use crate::{data_harvester::processes::UserTable, Pid};

pub fn get_process_data(
    sys: &System,
    use_current_cpu_total: bool,
    unnormalized_cpu: bool,
    elapsed: std::time::Duration,
    user_table: &mut UserTable,
) -> crate::utils::error::Result<Vec<ProcessHarvest>> {
    super::macos_freebsd::get_process_data(
        sys,
        use_current_cpu_total,
        unnormalized_cpu,
        elapsed,
        user_table,
        get_macos_process_cpu_usage,
    )
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

#[cfg(test)]
mod tests {
    use super::get_macos_process_cpu_usage;

    #[test]
    fn ps_cpu_fallback_still_reads_a_running_process() {
        assert!(get_macos_process_cpu_usage(&[]).unwrap().is_empty());
        let pid = std::process::id() as crate::Pid;
        let usage = get_macos_process_cpu_usage(&[pid]).unwrap();
        let cpu = usage.get(&pid).expect("ps must return the running test process");
        assert!(cpu.is_finite() && *cpu >= 0.0);
    }
}
