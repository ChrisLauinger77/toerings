//! Data collection for memory via heim.

use crate::data_harvester::memory::{MemCollect, MemHarvest};

#[cfg(any(target_os = "linux", test))]
mod linux;

pub async fn get_mem_data() -> MemCollect {
    MemCollect {
        ram: get_ram_data().await,
        swap: get_swap_data().await,
        #[cfg(feature = "zfs")]
        arc: get_arc_data().await,
        #[cfg(feature = "gpu")]
        gpus: get_gpu_data().await,
    }
}

pub async fn get_ram_data() -> crate::utils::error::Result<Option<MemHarvest>> {
    let (mem_total_in_kib, mem_used_in_kib) = {
        #[cfg(target_os = "linux")]
        {
            linux::read_meminfo(std::path::Path::new("/proc/meminfo")).await?
        }
        #[cfg(target_os = "macos")]
        {
            let memory = heim::memory::memory().await?;

            use heim::memory::os::macos::MemoryExt;
            use heim::units::information::kibibyte;
            (
                memory.total().get::<kibibyte>(),
                memory.active().get::<kibibyte>() + memory.wire().get::<kibibyte>(),
            )
        }
        #[cfg(target_os = "windows")]
        {
            let memory = heim::memory::memory().await?;

            use heim::units::information::kibibyte;
            let mem_total_in_kib = memory.total().get::<kibibyte>();
            (
                mem_total_in_kib,
                mem_total_in_kib - memory.available().get::<kibibyte>(),
            )
        }
        #[cfg(target_os = "freebsd")]
        {
            let mut s = System::new();
            s.refresh_memory();
            (s.total_memory(), s.used_memory())
        }
    };

    Ok(Some(MemHarvest {
        mem_total_in_kib,
        mem_used_in_kib,
        use_percent: if mem_total_in_kib == 0 {
            None
        } else {
            Some(mem_used_in_kib as f64 / mem_total_in_kib as f64 * 100.0)
        },
    }))
}

pub async fn get_swap_data() -> crate::utils::error::Result<Option<MemHarvest>> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let memory = heim::memory::swap().await?;
    #[cfg(target_os = "freebsd")]
    let mut memory = System::new();

    let (mem_total_in_kib, mem_used_in_kib) = {
        #[cfg(target_os = "linux")]
        {
            // Similar story to above - heim parses this information incorrectly as far as I can tell, so kilobytes = kibibytes here.
            use heim::units::information::kilobyte;
            (
                memory.total().get::<kilobyte>(),
                memory.used().get::<kilobyte>(),
            )
        }
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            use heim::units::information::kibibyte;
            (
                memory.total().get::<kibibyte>(),
                memory.used().get::<kibibyte>(),
            )
        }
        #[cfg(target_os = "freebsd")]
        {
            memory.refresh_memory();
            (memory.total_swap(), memory.used_swap())
        }
    };

    Ok(Some(MemHarvest {
        mem_total_in_kib,
        mem_used_in_kib,
        use_percent: if mem_total_in_kib == 0 {
            None
        } else {
            Some(mem_used_in_kib as f64 / mem_total_in_kib as f64 * 100.0)
        },
    }))
}

#[cfg(feature = "zfs")]
pub async fn get_arc_data() -> crate::utils::error::Result<Option<MemHarvest>> {
    let (mem_total_in_kib, mem_used_in_kib) = {
        #[cfg(target_os = "linux")]
        {
            let mut mem_arc = 0;
            let mut mem_total = 0;
            let mut zfs_keys_read: u8 = 0;
            const ZFS_KEYS_NEEDED: u8 = 2;
            use smol::fs::read_to_string;
            let arcinfo = read_to_string("/proc/spl/kstat/zfs/arcstats").await?;
            for line in arcinfo.lines() {
                if let Some((label, value)) = line.split_once(' ') {
                    let to_write = match label {
                        "size" => &mut mem_arc,
                        "memory_all_bytes" => &mut mem_total,
                        _ => {
                            continue;
                        }
                    };

                    if let Some((_type, number)) = value.trim_start().rsplit_once(' ') {
                        // Parse the value, remember it's in bytes!
                        if let Ok(number) = number.parse::<u64>() {
                            *to_write = number;
                            // We only need a few keys, so we can bail early.
                            zfs_keys_read += 1;
                            if zfs_keys_read == ZFS_KEYS_NEEDED {
                                break;
                            }
                        }
                    }
                }
            }
            (mem_total / 1024, mem_arc / 1024)
        }

        #[cfg(target_os = "freebsd")]
        {
            use sysctl::Sysctl;
            if let (Ok(mem_arc_value), Ok(mem_sys_value)) = (
                sysctl::Ctl::new("kstat.zfs.misc.arcstats.size"),
                sysctl::Ctl::new("hw.physmem"),
            ) {
                if let (Ok(sysctl::CtlValue::U64(arc)), Ok(sysctl::CtlValue::Ulong(mem))) =
                    (mem_arc_value.value(), mem_sys_value.value())
                {
                    (mem / 1024, arc / 1024)
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            }
        }
        #[cfg(target_os = "macos")]
        {
            (0, 0)
        }
        #[cfg(target_os = "windows")]
        {
            (0, 0)
        }
    };

    Ok(Some(MemHarvest {
        mem_total_in_kib,
        mem_used_in_kib,
        use_percent: if mem_total_in_kib == 0 {
            None
        } else {
            Some(mem_used_in_kib as f64 / mem_total_in_kib as f64 * 100.0)
        },
    }))
}

#[cfg(feature = "nvidia")]
pub async fn get_gpu_data() -> crate::utils::error::Result<Option<Vec<(String, MemHarvest)>>> {
    use crate::data_harvester::nvidia::NVML_DATA;
    if let Ok(nvml) = &*NVML_DATA {
        if let Ok(ngpu) = nvml.device_count() {
            let mut results = Vec::with_capacity(ngpu as usize);
            for i in 0..ngpu {
                if let Ok(device) = nvml.device_by_index(i) {
                    if let (Ok(name), Ok(mem)) = (device.name(), device.memory_info()) {
                        // add device memory in bytes
                        let mem_total_in_kib = mem.total / 1024;
                        let mem_used_in_kib = mem.used / 1024;
                        results.push((
                            name,
                            MemHarvest {
                                mem_total_in_kib,
                                mem_used_in_kib,
                                use_percent: if mem_total_in_kib == 0 {
                                    None
                                } else {
                                    Some(mem_used_in_kib as f64 / mem_total_in_kib as f64 * 100.0)
                                },
                            },
                        ));
                    }
                }
            }
            Ok(Some(results))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}
