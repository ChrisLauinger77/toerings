//! CPU stats through sysinfo.
//! Supports FreeBSD.

use std::collections::VecDeque;

use sysinfo::{LoadAvg, System};

use super::{CpuData, CpuDataType, CpuHarvest, PastCpuTotal, PastCpuWork};
use crate::data_harvester::cpu::LoadAvgHarvest;

pub async fn get_cpu_data_list(
    sys: &sysinfo::System,
    show_average_cpu: bool,
    _previous_cpu_times: &mut [(PastCpuWork, PastCpuTotal)],
    _previous_average_cpu_time: &mut Option<(PastCpuWork, PastCpuTotal)>,
) -> crate::error::Result<CpuHarvest> {
    let mut cpu_deque: VecDeque<_> = sys
        .cpus()
        .iter()
        .enumerate()
        .map(|(i, cpu)| CpuData {
            data_type: CpuDataType::Cpu(i),
            cpu_usage: cpu.cpu_usage() as f64,
        })
        .collect();

    if show_average_cpu {
        cpu_deque.push_front(CpuData {
            data_type: CpuDataType::Avg,
            cpu_usage: sys.global_cpu_usage() as f64,
        })
    }

    Ok(Vec::from(cpu_deque))
}

pub async fn get_load_avg() -> crate::error::Result<LoadAvgHarvest> {
    let LoadAvg { one, five, fifteen } = System::load_average();

    Ok([one as f32, five as f32, fifteen as f32])
}
