//! Linux RAM accounting. Values in /proc/meminfo are KiB despite its "kB" label.

use std::io;

#[cfg(target_os = "linux")]
pub(super) async fn read_meminfo(path: &std::path::Path) -> io::Result<(u64, u64)> {
    parse_meminfo(&smol::fs::read_to_string(path).await?)
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn parse_meminfo(meminfo: &str) -> io::Result<(u64, u64)> {
    const LABELS: [&str; 6] = [
        "MemTotal", "MemFree", "Buffers", "Cached", "Shmem", "SReclaimable",
    ];
    let mut values = [None; 6];
    for line in meminfo.lines() {
        let Some((label, value)) = line.split_once(':') else {
            continue;
        };
        let Some(index) = LABELS.iter().position(|expected| *expected == label) else {
            continue;
        };
        if values[index].is_some() {
            return Err(invalid_data("duplicate RAM counter"));
        }
        let mut fields = value.split_whitespace();
        let number = fields
            .next()
            .and_then(|number| number.parse::<u64>().ok())
            .ok_or_else(|| invalid_data("invalid RAM counter"))?;
        if fields.next() != Some("kB") || fields.next().is_some() {
            return Err(invalid_data("invalid RAM counter unit or trailing data"));
        }
        values[index] = Some(number);
    }

    let [Some(total), Some(free), Some(buffers), Some(cached), Some(shmem), Some(reclaimable)] = values
    else {
        return Err(invalid_data("missing RAM counter"));
    };
    if total == 0 || free > total {
        return Err(invalid_data("invalid total or free RAM"));
    }

    // Preserve the existing accounting formula, including its fallback to
    // total - free when cache accounting exceeds total memory. Reject arithmetic
    // that cannot represent a sample instead of panicking or wrapping.
    let cached_memory = cached
        .checked_add(reclaimable)
        .and_then(|sum| sum.checked_sub(shmem))
        .ok_or_else(|| invalid_data("inconsistent RAM cache counters"))?;
    let unused = free
        .checked_add(cached_memory)
        .and_then(|sum| sum.checked_add(buffers))
        .ok_or_else(|| invalid_data("RAM counters overflow"))?;
    let used = total.checked_sub(unused).unwrap_or(total - free);
    Ok((total, used))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = "MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 20 kB\nCached: 200 kB\nShmem: 10 kB\nSReclaimable: 30 kB\n";

    fn assert_invalid(input: &str) {
        assert_eq!(
            parse_meminfo(input).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn preserves_memory_accounting_and_existing_fallback() {
        assert_eq!(parse_meminfo(VALID).unwrap(), (1000, 660));
        // The existing formula deliberately falls back when unused > total.
        assert_eq!(
            parse_meminfo(&VALID.replace("Cached: 200", "Cached: 1000")).unwrap(),
            (1000, 900)
        );
        assert_eq!(
            parse_meminfo(&VALID.replace("MemTotal: 1000", "MemTotal: 340")).unwrap(),
            (340, 0)
        );
        let all_used = "MemTotal: 1000 kB\nMemFree: 0 kB\nBuffers: 0 kB\nCached: 0 kB\nShmem: 0 kB\nSReclaimable: 0 kB\n";
        assert_eq!(parse_meminfo(all_used).unwrap(), (1000, 1000));
    }

    #[test]
    fn accepts_reordered_counters_whitespace_and_unrelated_fields() {
        let mut lines = VALID.lines().rev().collect::<Vec<_>>();
        lines.push("HugePages_Total: 0");
        lines.push("MemAvailable: 800 kB");
        let input = lines
            .join("\n")
            .replace(": ", ":\t")
            .replace(" kB", "\t kB  ");
        assert_eq!(parse_meminfo(&input).unwrap(), (1000, 660));
    }

    #[test]
    fn rejects_empty_incomplete_and_duplicate_counters() {
        assert_invalid("");
        for missing in VALID.lines() {
            let input = VALID
                .lines()
                .filter(|line| *line != missing)
                .collect::<Vec<_>>()
                .join("\n");
            assert_invalid(&input);
        }
        assert_invalid(&format!("{VALID}MemTotal: 1000 kB\n"));
        assert_invalid(&VALID.replace("Shmem: 10 kB", "MemFree: 100 kB"));
    }

    #[test]
    fn rejects_invalid_values_units_and_truncated_fields() {
        for value in [
            "oops kB",
            "-1 kB",
            "18446744073709551616 kB",
            "100",
            "100 B",
            "100 kB extra",
            "",
        ] {
            assert_invalid(&VALID.replace("MemFree: 100 kB", &format!("MemFree: {value}")));
        }
        assert_invalid(&VALID.replace("MemFree: 100 kB", "MemFree 100 kB"));
    }

    #[test]
    fn rejects_inconsistent_counters_without_overflow_or_underflow() {
        for input in [
            VALID.replace("MemTotal: 1000", "MemTotal: 0"),
            VALID.replace("MemFree: 100", "MemFree: 1001"),
            VALID.replace("Shmem: 10", "Shmem: 231"),
            VALID.replace("Cached: 200", &format!("Cached: {}", u64::MAX)),
            VALID.replace("Buffers: 20", &format!("Buffers: {}", u64::MAX)),
            VALID.replace("Cached: 200", &format!("Cached: {}", u64::MAX - 30)),
        ] {
            assert_invalid(&input);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reading_recovers_after_invalid_and_missing_input() {
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let directory = std::env::temp_dir().join(format!(
            "toerings-meminfo-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // Fail rather than reuse a directory that this test does not own.
        std::fs::create_dir(&directory).unwrap();
        let fixture = Fixture(directory);
        let path = fixture.0.join("meminfo");
        std::fs::write(&path, VALID).unwrap();
        let read = || futures::executor::block_on(read_meminfo(&path));
        assert_eq!(read().unwrap(), (1000, 660));
        std::fs::write(&path, "MemTotal: 1000 kB\n").unwrap();
        assert_eq!(read().unwrap_err().kind(), io::ErrorKind::InvalidData);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(read().unwrap_err().kind(), io::ErrorKind::NotFound);
        std::fs::write(&path, VALID).unwrap();
        assert_eq!(read().unwrap(), (1000, 660));
    }
}
