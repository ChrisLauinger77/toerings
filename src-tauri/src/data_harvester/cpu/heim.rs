//! CPU stats through heim.
//! Supports macOS, Linux, and Windows.

cfg_if::cfg_if! {
    if #[cfg(target_os = "linux")] {
        pub mod linux;
        pub use linux::*;
    } else if #[cfg(any(target_os = "macos", target_os = "windows"))] {
        pub mod windows_macos;
        pub use windows_macos::*;
    }
}

use std::collections::VecDeque;

use futures::StreamExt;

use crate::data_harvester::cpu::{
    CpuData, CpuDataType, CpuHarvest, PastCpuTotal, PastCpuWork, Point,
};

pub async fn get_cpu_data_list(
    show_average_cpu: bool,
    previous_cpu_times: &mut Vec<(PastCpuWork, PastCpuTotal)>,
    previous_average_cpu_time: &mut Option<(PastCpuWork, PastCpuTotal)>,
) -> crate::error::Result<CpuHarvest> {
    fn calculate_cpu_usage_percentage(
        (previous_working_time, previous_total_time): Point,
        (current_working_time, current_total_time): Point,
    ) -> f64 {
        ((if current_working_time > previous_working_time {
            current_working_time - previous_working_time
        } else {
            0.0
        }) * 100.0)
            / (if current_total_time > previous_total_time {
                current_total_time - previous_total_time
            } else {
                1.0
            })
    }

    async fn read_cpu_times() -> crate::error::Result<Vec<Option<Point>>> {
        let cpu_times = heim::cpu::times().await?;
        Ok(cpu_times
            .map(|cpu| cpu.ok().map(|cpu| convert_cpu_times(&cpu)))
            .collect()
            .await)
    }

    let mut current = read_cpu_times().await?;
    if previous_cpu_times.is_empty() {
        // Warm up on the worker. Both reads use the same topology-aware path.
        update_cpu_history(&current, previous_cpu_times);
        futures_timer::Delay::new(std::time::Duration::from_millis(100)).await;
        current = read_cpu_times().await?;
    }
    let mut cpu_deque: VecDeque<CpuData> = update_cpu_history(&current, previous_cpu_times)
        .into_iter()
        .enumerate()
        .map(|(index, cpu_usage)| CpuData {
            data_type: CpuDataType::Cpu(index),
            cpu_usage,
        })
        .collect();

    // Get average CPU if needed... and slap it at the top
    if show_average_cpu {
        let cpu_time = heim::cpu::time().await?;

        let (cpu_usage, new_average_cpu_time) = if let Some((past_cpu_work, past_cpu_total)) =
            previous_average_cpu_time
        {
            let present_times = convert_cpu_times(&cpu_time);
            (
                calculate_cpu_usage_percentage((*past_cpu_work, *past_cpu_total), present_times),
                present_times,
            )
        } else {
            // Again, we need to do a quick timeout...
            futures_timer::Delay::new(std::time::Duration::from_millis(100)).await;
            let second_cpu_time = heim::cpu::time().await?;

            let present_times = convert_cpu_times(&second_cpu_time);
            (
                calculate_cpu_usage_percentage(convert_cpu_times(&cpu_time), present_times),
                present_times,
            )
        };

        *previous_average_cpu_time = Some(new_average_cpu_time);
        cpu_deque.push_front(CpuData {
            data_type: CpuDataType::Avg,
            cpu_usage,
        })
    }

    Ok(Vec::from(cpu_deque))
}

// Topology changes invalidate positional baselines. In particular, never zip a
// newly expanded CPU list against a permanently shortened history vector.
fn update_cpu_history(current: &[Option<Point>], previous: &mut Vec<Point>) -> Vec<f64> {
    let topology_changed = current.len() != previous.len();
    let mut next = Vec::with_capacity(current.len());
    let usage = current.iter().enumerate().map(|(index, current)| {
        let past = if topology_changed { None } else { previous.get(index).copied() };
        let Some(now) = current else {
            next.push(past.unwrap_or((f64::NAN, f64::NAN)));
            return 0.0;
        };
        next.push(*now);
        match past {
            Some(past) if past.0.is_finite() && past.1.is_finite() && now.0 >= past.0 && now.1 > past.1 =>
                (((now.0 - past.0) / (now.1 - past.1)) * 100.0).clamp(0.0, 100.0),
            _ => 0.0,
        }
    }).collect();
    *previous = next;
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grows_again_after_cpu_removal_and_rebaselines() {
        let mut previous = vec![(10.0, 100.0); 4];
        assert_eq!(update_cpu_history(&[Some((20.0, 200.0)); 2], &mut previous), vec![0.0; 2]);
        assert_eq!(update_cpu_history(&[Some((30.0, 300.0)); 4], &mut previous), vec![0.0; 4]);
        assert_eq!(update_cpu_history(&[Some((80.0, 400.0)); 4], &mut previous), vec![50.0; 4]);
    }
    #[test]
    fn missing_cpu_reading_keeps_the_last_valid_counter() {
        let mut previous = vec![(10.0, 100.0)];
        assert_eq!(update_cpu_history(&[None], &mut previous), vec![0.0]);
        assert_eq!(update_cpu_history(&[Some((110.0, 300.0))], &mut previous), vec![50.0]);
        assert_eq!(update_cpu_history(&[Some((1.0, 5.0))], &mut previous), vec![0.0]);
    }
}
