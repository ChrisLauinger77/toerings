//! Process data collection for Windows.  Uses sysinfo.

use sysinfo::System;

use super::ProcessHarvest;

pub fn get_process_data(
    sys: &System,
    use_current_cpu_total: bool,
    unnormalized_cpu: bool,
    elapsed: std::time::Duration,
) -> crate::utils::error::Result<Vec<ProcessHarvest>> {
    let mut process_vector: Vec<ProcessHarvest> = Vec::new();
    let process_hashmap = sys.processes();
    let cpu_usage = sys.global_cpu_usage() as f64 / 100.0;
    let num_processors = sys.cpus().len();

    for process_val in process_hashmap.values() {
        let name = if process_val.name().is_empty() {
            let process_cmd = process_val.cmd();
            if process_cmd.len() > 1 {
                process_cmd[0].to_string_lossy().into_owned()
            } else {
                let process_exe = process_val.exe().and_then(|exe| exe.file_stem());
                if let Some(exe) = process_exe {
                    let process_exe_opt = exe.to_str();
                    if let Some(exe_name) = process_exe_opt {
                        exe_name.to_string()
                    } else {
                        "".to_string()
                    }
                } else {
                    "".to_string()
                }
            }
        } else {
            process_val.name().to_string_lossy().into_owned()
        };
        let command = {
            let command = process_val
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            if command.is_empty() {
                name.to_string()
            } else {
                command
            }
        };

        let pcu = {
            let usage = process_val.cpu_usage() as f64;
            if unnormalized_cpu || num_processors == 0 {
                usage
            } else {
                usage / (num_processors as f64)
            }
        };
        let process_cpu_usage = if use_current_cpu_total && cpu_usage > 0.0 {
            pcu / cpu_usage
        } else {
            pcu
        };

        let disk_usage = process_val.disk_usage();
        let process_state = (process_val.status().to_string(), 'R');
        process_vector.push(ProcessHarvest {
            pid: process_val.pid().as_u32() as _,
            name,
            command,
            mem_usage_bytes: process_val.memory(),
            cpu_usage_percent: process_cpu_usage,
            read_bytes_per_sec: super::super::rates::bytes_per_second(disk_usage.read_bytes, elapsed),
            write_bytes_per_sec: super::super::rates::bytes_per_second(disk_usage.written_bytes, elapsed),
            process_state,
        });
    }

    Ok(process_vector)
}
