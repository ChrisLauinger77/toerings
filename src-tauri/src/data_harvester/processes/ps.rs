//! Parse individual ps rows defensively; one malformed row cannot shift later columns.
pub fn parse_cpu_usage(output: &str) -> std::collections::HashMap<i32, f64> {
    output.lines().filter_map(|line| {
        let mut columns = line.split_whitespace();
        let pid = columns.next()?.parse::<i32>().ok()?;
        let usage = columns.next()?.parse::<f64>().ok()?;
        if columns.next().is_some() || pid <= 0 || !usage.is_finite() || usage < 0.0 { return None; }
        Some((pid, usage))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn skips_malformed_rows_without_losing_valid_neighbors() {
        let result = parse_cpu_usage("1 3.5\n2\n3 2.0\n4 NaN\n5 -1\n6 2 extra\ntext\n");
        assert_eq!(result.len(), 2);
        assert_eq!(result[&1], 3.5);
        assert_eq!(result[&3], 2.0);
    }
}
