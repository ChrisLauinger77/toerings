//! Bounded capture for trusted platform utilities such as /bin/ps.
use std::{
    io::{self, Read},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

struct RunningChild(Child);
impl Drop for RunningChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn capture_stdout(command: &mut Command, timeout: Duration, limit: usize) -> io::Result<Vec<u8>> {
    let mut child = RunningChild(command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?);
    let stdout = child.0.stdout.take().ok_or_else(|| io::Error::other("missing child stdout"))?;
    // Drain concurrently so a full pipe cannot prevent the child from exiting.
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout.take(limit as u64 + 1).read_to_end(&mut output)?;
        Ok::<_, io::Error>(output)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.0.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "platform utility timed out")),
            Err(error) => break Err(error),
        }
    };
    drop(child); // Terminate/reap before joining the stdout reader on failure.
    let output = reader.join().map_err(|_| io::Error::other("stdout reader failed"))??;
    if !status?.success() { return Err(io::Error::other("platform utility failed")); }
    if output.len() > limit { return Err(io::Error::other("platform utility output exceeded limit")); }
    Ok(output)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn captures_output_and_rejects_failure_and_excessive_output() {
        assert_eq!(capture_stdout(Command::new("/bin/echo").arg("hello"), Duration::from_secs(2), 100).unwrap(), b"hello\n");
        assert!(capture_stdout(&mut Command::new("/bin/false"), Duration::from_secs(2), 100).is_err());
        assert!(capture_stdout(Command::new("/bin/echo").arg("too long"), Duration::from_secs(2), 2).is_err());
    }
    #[test]
    fn terminates_and_reaps_a_timed_out_child() {
        let started = Instant::now();
        let error = capture_stdout(Command::new("/bin/sleep").arg("10"), Duration::from_millis(30), 100).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
