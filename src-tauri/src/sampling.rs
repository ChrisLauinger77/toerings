//! One worker owns all mutable collector state. IPC only reads published snapshots.
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::data_harvester::{Data, DataCollector};

#[derive(Serialize)]
pub struct Snapshot {
    #[serde(flatten)]
    pub data: Data,
    pub sequence: u64,
    pub age_ms: Option<u64>,
    pub failed: bool,
}

struct Published {
    data: Data,
    sequence: u64,
    published_at: Option<Instant>,
    failed: bool,
}

pub struct Sampler {
    published: Arc<Mutex<Published>>,
    stop: mpsc::Sender<()>,
    worker: Option<JoinHandle<()>>,
}

impl Sampler {
    pub fn start() -> std::io::Result<Self> {
        Self::spawn(Duration::from_secs(1), || {
            // Construction and the initial baseline can perform blocking OS calls too.
            let mut collector = DataCollector::new();
            collector.init();
            move || {
                futures::executor::block_on(collector.update_data());
                collector.data.clone()
            }
        })
    }

    fn spawn<F, S>(interval: Duration, factory: F) -> std::io::Result<Self>
    where
        F: Fn() -> S + Send + 'static,
        S: FnMut() -> Data,
    {
        let published = Arc::new(Mutex::new(Published {
            data: Data::default(),
            sequence: 0,
            published_at: None,
            failed: false,
        }));
        let shared = Arc::clone(&published);
        let (stop, stopped) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("toerings-sampler".into())
            .spawn(move || {
                let mut sample = None;
                loop {
                    if stopped.try_recv().is_ok() {
                        break;
                    }
                    let started = Instant::now();
                    let result = catch_unwind(AssertUnwindSafe(|| {
                        sample.get_or_insert_with(&factory)()
                    }));
                    if result.is_err() {
                        // Drop collector resources outside the snapshot lock.
                        sample = None;
                    }
                    {
                        let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
                        match result {
                            Ok(data) => {
                                state.data = data;
                                state.sequence += 1;
                                state.published_at = Some(Instant::now());
                                state.failed = false;
                            }
                            Err(_) => {
                                // The next tick recreates the collector and its baselines.
                                state.failed = true;
                            }
                        }
                    }
                    let delay = interval.saturating_sub(started.elapsed());
                    if !matches!(stopped.recv_timeout(delay), Err(mpsc::RecvTimeoutError::Timeout)) {
                        break;
                    }
                }
            })?;
        Ok(Self { published, stop, worker: Some(worker) })
    }

    pub fn snapshot(&self) -> Snapshot {
        let state = self.published.lock().unwrap_or_else(|e| e.into_inner());
        Snapshot {
            data: state.data.clone(),
            sequence: state.sequence,
            age_ms: state.published_at.map(|time| time.elapsed().as_millis() as u64),
            failed: state.failed,
        }
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        // An OS read cannot safely be cancelled. Never block application exit on it;
        // the worker owns its resources and exits after the outstanding sample returns.
        if let Some(worker) = self.worker.take() {
            if worker.is_finished() {
                let _ = worker.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_shutdown_do_not_wait_for_a_blocked_collector() {
        let (entered, entry) = mpsc::channel();
        let (release, blocked) = mpsc::channel();
        let blocked = Arc::new(Mutex::new(blocked));
        let sampler = Sampler::spawn(Duration::from_millis(1), move || {
            let entered = entered.clone();
            let blocked = Arc::clone(&blocked);
            move || {
                entered.send(()).unwrap();
                blocked.lock().unwrap().recv().unwrap();
                Data::default()
            }
        }).unwrap();
        entry.recv_timeout(Duration::from_secs(2)).unwrap();
        let (finished, completion) = mpsc::channel();
        thread::spawn(move || {
            let sequence = sampler.snapshot().sequence;
            drop(sampler);
            let _ = finished.send(sequence);
        });
        let result = completion.recv_timeout(Duration::from_secs(2));
        // Release even on a regression, so the test cannot leave a blocked worker.
        release.send(()).unwrap();
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn panic_recreates_collector_and_publishes_again() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let attempts = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&attempts);
        let sampler = Sampler::spawn(Duration::from_millis(2), move || {
            let attempt = counter.fetch_add(1, Ordering::SeqCst);
            move || {
                assert_ne!(attempt, 0, "simulated collector failure");
                Data::default()
            }
        }).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while sampler.snapshot().sequence == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(2));
        }
        assert!(sampler.snapshot().sequence > 0);
        assert!(!sampler.snapshot().failed);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }
}
