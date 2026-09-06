use std::time::Duration;

pub fn bytes_per_second(bytes: u64, elapsed: Duration) -> u64 {
    if elapsed.is_zero() {
        0
    } else {
        (bytes as f64 / elapsed.as_secs_f64()) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_fractional_and_delayed_intervals() {
        assert_eq!(bytes_per_second(500, Duration::from_millis(500)), 1000);
        assert_eq!(bytes_per_second(1900, Duration::from_millis(1900)), 1000);
        assert_eq!(bytes_per_second(5000, Duration::from_secs(5)), 1000);
        assert_eq!(bytes_per_second(10, Duration::ZERO), 0);
    }
}
