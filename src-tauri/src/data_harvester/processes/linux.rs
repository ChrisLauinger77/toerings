//! Process data collection for Linux.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::time::Instant;
use crate::data_harvester::rates::bytes_per_second;

use fxhash::{FxHashMap, FxHashSet};
use procfs::process::{Process, Stat};
use procfs::WithCurrentSystemInfo;
use sysinfo::ProcessStatus;

use super::{ProcessHarvest, UserTable};
use crate::data_harvester::cpu::Point;
use crate::utils::error::{self, ToeError};
use crate::Pid;

/// Maximum character length of a /proc/<PID>/stat process name.
/// If it's equal or greater, then we instead refer to the command for the name.
const MAX_STAT_NAME_LEN: usize = 15;

#[derive(Debug, Clone, Default)]
pub struct PrevProcDetails {
    start_time: Option<u64>,
    cpu_time: u64,
    io: Option<(u64, u64, Instant)>,
}

impl PrevProcDetails {
    fn for_start_time(&self, start_time: u64) -> Option<&Self> {
        (self.start_time == Some(start_time)).then_some(self)
    }
}

fn calculate_idle_values(line: &str) -> error::Result<Point> {
    let mut values = line.split_whitespace();
    if values.next() != Some("cpu") {
        return Err(ToeError::QueryError("Missing aggregate CPU label".into()));
    }
    let counters = values.take(8).map(str::parse::<u64>).collect::<Result<Vec<_>, _>>()?;
    if counters.len() < 4 {
        return Err(ToeError::QueryError("Incomplete CPU counters".into()));
    }
    let get = |index| counters.get(index).copied().unwrap_or(0) as f64;
    // Guest time is already included in user/nice; steal must remain in the total.
    Ok((get(3) + get(4), get(0) + get(1) + get(2) + get(5) + get(6) + get(7)))
}

struct CpuUsage {
    /// Difference between the total delta and the idle delta.
    cpu_usage: f64,

    /// Overall CPU usage as a fraction.
    cpu_fraction: f64,
}

fn cpu_usage_calculation(prev_idle: &mut f64, prev_non_idle: &mut f64) -> error::Result<CpuUsage> {
    let (idle, non_idle) = {
        // From SO answer: https://stackoverflow.com/a/23376195
        let mut reader = BufReader::new(File::open("/proc/stat")?);
        let mut first_line = String::new();
        reader.read_line(&mut first_line)?;

        calculate_idle_values(&first_line)?
    };

    let total = idle + non_idle;
    let prev_total = *prev_idle + *prev_non_idle;

    let total_delta = total - prev_total;
    let idle_delta = idle - *prev_idle;

    *prev_idle = idle;
    *prev_non_idle = non_idle;

    // TODO: Should these return errors instead?
    let cpu_usage = if total_delta - idle_delta != 0.0 {
        total_delta - idle_delta
    } else {
        1.0
    };

    let cpu_fraction = if total_delta != 0.0 {
        cpu_usage / total_delta
    } else {
        0.0
    };

    Ok(CpuUsage {
        cpu_usage,
        cpu_fraction,
    })
}

/// Returns the usage and a new set of process times.
///
/// NB: cpu_fraction should be represented WITHOUT the x100 factor!
fn get_linux_cpu_usage(
    stat: &Stat,
    cpu_usage: f64,
    cpu_fraction: f64,
    prev_proc_times: Option<u64>,
    use_current_cpu_total: bool,
) -> (f64, u64) {
    // Based heavily on https://stackoverflow.com/a/23376195 and https://stackoverflow.com/a/1424556
    let new_proc_times = stat.utime.saturating_add(stat.stime);
    let diff = counter_delta(new_proc_times, prev_proc_times) as f64;

    if cpu_usage <= 0.0 || !cpu_usage.is_finite() || !cpu_fraction.is_finite() {
        (0.0, new_proc_times)
    } else if use_current_cpu_total {
        ((diff / cpu_usage) * 100.0, new_proc_times)
    } else {
        ((diff / cpu_usage) * 100.0 * cpu_fraction, new_proc_times)
    }
}

fn read_proc(
    prev_proc: &PrevProcDetails,
    process: &Process,
    cpu_usage: f64,
    cpu_fraction: f64,
    use_current_cpu_total: bool,
    now: Instant,
    mem_total_kb: u64,
    user_table: &mut UserTable,
) -> error::Result<(ProcessHarvest, PrevProcDetails)> {
    let stat = process.stat()?;
    let (command, name) = {
        let truncated_name = stat.comm.as_str();
        if let Ok(cmdline) = process.cmdline() {
            if cmdline.is_empty() {
                (format!("[{}]", truncated_name), truncated_name.to_string())
            } else {
                (
                    cmdline.join(" "),
                    if truncated_name.len() >= MAX_STAT_NAME_LEN {
                        if let Some(first_part) = cmdline.first() {
                            // We're only interested in the executable part... not the file path.
                            // That's for command.
                            first_part
                                .rsplit_once('/')
                                .map(|(_prefix, suffix)| suffix)
                                .unwrap_or(truncated_name)
                                .to_string()
                        } else {
                            truncated_name.to_string()
                        }
                    } else {
                        truncated_name.to_string()
                    },
                )
            }
        } else {
            (truncated_name.to_string(), truncated_name.to_string())
        }
    };

    let process_state_char = stat.state;
    let process_state = (
        ProcessStatus::from(process_state_char).to_string(),
        process_state_char,
    );
    let (cpu_usage_percent, new_process_times) = get_linux_cpu_usage(
        &stat,
        cpu_usage,
        cpu_fraction,
        prev_proc.for_start_time(stat.starttime).map(|previous| previous.cpu_time),
        use_current_cpu_total,
    );
    let parent_pid = Some(stat.ppid);
    let mem_usage_bytes = stat.rss_bytes().get();
    let mem_usage_kb = mem_usage_bytes / 1024;
    let mem_usage_percent = mem_usage_kb as f64 / mem_total_kb as f64 * 100.0;

    // A missing I/O reading invalidates only that baseline. Reappearing counters
    // must not attribute the process's lifetime traffic to one sampling interval.
    let io = process.io().ok().map(|io| (io.read_bytes, io.write_bytes, now));
    let previous_io = prev_proc.for_start_time(stat.starttime).and_then(|previous| previous.io);
    let (read_bytes_per_sec, write_bytes_per_sec) = io_rates(io, previous_io);
    let (total_read_bytes, total_write_bytes) = io.map(|(read, write, _)| (read, write)).unwrap_or((0, 0));

    let uid = process.uid()?;

    Ok((
        ProcessHarvest {
            pid: process.pid,
            parent_pid,
            cpu_usage_percent,
            mem_usage_percent,
            mem_usage_bytes,
            name,
            command,
            read_bytes_per_sec,
            write_bytes_per_sec,
            total_read_bytes,
            total_write_bytes,
            process_state,
            uid: Some(uid),
            user: user_table
                .get_uid_to_username_mapping(uid)
                .map(Into::into)
                .unwrap_or_else(|_| "N/A".into()),
        },
        PrevProcDetails { start_time: Some(stat.starttime), cpu_time: new_process_times, io },
    ))
}

/// How to calculate CPU usage.
pub enum CpuUsageStrategy {
    /// Normalized means the displayed usage percentage is divided over the number of CPU cores.
    ///
    /// For example, if the "overall" usage over the entire system is 105%, and there are 5 cores, then
    /// the displayed percentage is 21%.
    Normalized,

    /// Non-normalized means that the overall usage over the entire system is shown, without dividing
    /// over the number of cores.
    NonNormalized(f64),
}

pub fn get_process_data(
    prev_idle: &mut f64,
    prev_non_idle: &mut f64,
    pid_mapping: &mut FxHashMap<Pid, PrevProcDetails>,
    use_current_cpu_total: bool,
    normalization: CpuUsageStrategy,
    now: Instant,
    mem_total_kb: u64,
    user_table: &mut UserTable,
) -> crate::utils::error::Result<Vec<ProcessHarvest>> {
    // Commit aggregate CPU baselines only after a successful process enumeration.
    let mut next_idle = *prev_idle;
    let mut next_non_idle = *prev_non_idle;

    if let Ok(CpuUsage {
        mut cpu_usage,
        cpu_fraction,
    }) = cpu_usage_calculation(&mut next_idle, &mut next_non_idle)
    {
        if let CpuUsageStrategy::NonNormalized(num_cores) = normalization {
            // Note we *divide* here because the later calculation divides `cpu_usage` - in effect,
            // multiplying over the number of cores.
            cpu_usage /= num_cores;
        }

        let mut pids_to_clear: FxHashSet<Pid> = pid_mapping.keys().cloned().collect();

        let process_vector: Vec<ProcessHarvest> = std::fs::read_dir("/proc")?
            .filter_map(|dir| {
                if let Ok(dir) = dir {
                    if let Ok(pid) = dir.file_name().to_string_lossy().trim().parse::<Pid>() {
                        let Ok(process) = Process::new(pid) else {
                            return None;
                        };
                        let prev_proc_details = pid_mapping.entry(pid).or_default();

                        if let Ok((process_harvest, new_details)) = read_proc(
                            prev_proc_details,
                            &process,
                            cpu_usage,
                            cpu_fraction,
                            use_current_cpu_total,
                            now,
                            mem_total_kb,
                            user_table,
                        ) {
                            *prev_proc_details = new_details;

                            pids_to_clear.remove(&pid);
                            return Some(process_harvest);
                        }
                    }
                }

                None
            })
            .collect();

        pids_to_clear.iter().for_each(|pid| {
            pid_mapping.remove(pid);
        });

        *prev_idle = next_idle;
        *prev_non_idle = next_non_idle;
        Ok(process_vector)
    } else {
        Err(ToeError::GenericError(
            "Could not calculate CPU usage.".to_string(),
        ))
    }
}

fn counter_delta(current: u64, previous: Option<u64>) -> u64 {
    previous.and_then(|previous| current.checked_sub(previous)).unwrap_or(0)
}

fn io_rates(current: Option<(u64, u64, Instant)>, previous: Option<(u64, u64, Instant)>) -> (u64, u64) {
    match (current, previous) {
        (Some((read, write, now)), Some((old_read, old_write, then))) => {
            let elapsed = now.saturating_duration_since(then);
            (bytes_per_second(counter_delta(read, Some(old_read)), elapsed),
             bytes_per_second(counter_delta(write, Some(old_write)), elapsed))
        }
        _ => (0, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parses_actual_proc_stat_lines_including_steal() {
        assert_eq!(calculate_idle_values("cpu 100 0 100 100").unwrap(), (100.0, 200.0));
        assert_eq!(calculate_idle_values("cpu 100 0 100 100 20 30 40 50 100 200").unwrap(), (120.0, 320.0));
        assert!(calculate_idle_values("100 0 100 100").is_err());
        assert!(calculate_idle_values("cpu 100 0").is_err());
        assert!(calculate_idle_values("cpu 100 invalid 100 100").is_err());
    }

    #[test]
    fn pid_reuse_and_counter_reset_rebaseline_without_underflow() {
        let previous = PrevProcDetails {
            start_time: Some(100),
            cpu_time: 1000,
            io: Some((1000, 2000, Instant::now())),
        };
        assert!(previous.for_start_time(200).is_none());
        assert_eq!(previous.for_start_time(100).unwrap().cpu_time, 1000);
        assert_eq!(counter_delta(2, Some(1000)), 0);
        assert_eq!(counter_delta(90000, None), 0);
        assert_eq!(counter_delta(1100, Some(1000)), 100);
    }

    #[test]
    fn io_uses_its_own_fractional_interval_and_requires_a_baseline() {
        let now = Instant::now();
        let current = Some((2900, 4800, now + Duration::from_millis(1900)));
        assert_eq!(io_rates(current, Some((1000, 1000, now))), (1000, 2000));
        assert_eq!(io_rates(current, None), (0, 0));
        assert_eq!(io_rates(None, Some((1000, 1000, now))), (0, 0));
        assert_eq!(io_rates(Some((10, 20, now + Duration::from_secs(1))), Some((1000, 1000, now))), (0, 0));
    }
}
