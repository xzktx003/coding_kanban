use std::sync::Arc;
use std::time::{Duration, Instant};
use futures::future::{BoxFuture, Shared};
use futures::FutureExt;
use tokio::sync::Mutex;

type ScanResult<T> = Result<Arc<T>, String>;
type ScanFuture<T> = Shared<BoxFuture<'static, ScanResult<T>>>;

struct ScanState<T> {
    cached: Option<(Instant, Arc<T>)>,
    running: Option<(u64, ScanFuture<T>)>,
    generation: u64,
}

pub(crate) struct CachedScan<T> {
    state: Mutex<ScanState<T>>,
    ttl: Duration,
}

impl<T> Default for CachedScan<T> {
    fn default() -> Self {
        Self { state: Mutex::new(ScanState { cached: None, running: None, generation: 0 }), ttl: Duration::from_secs(60) }
    }
}

impl<T: Send + Sync + 'static> CachedScan<T> {
    pub(crate) async fn get(&self, loader: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<Arc<T>, String> {
        let (generation, scan) = {
            let mut state = self.state.lock().await;
            if let Some((at, records)) = &state.cached
                && at.elapsed() < self.ttl
            { return Ok(Arc::clone(records)); }
            if state.running.is_none() {
                state.generation += 1;
                let task = tokio::task::spawn_blocking(loader);
                let scan = async move {
                    task.await.map_err(|error| format!("Usage scan failed: {error}"))?.map(Arc::new)
                }.boxed().shared();
                state.running = Some((state.generation, scan));
            }
            state.running.as_ref().unwrap().clone()
        };
        // The shared task survives a disconnected HTTP request; another waiter
        // joins the same scan instead of reading large histories again.
        let result = scan.await;
        let mut state = self.state.lock().await;
        if state.running.as_ref().is_some_and(|(current, _)| *current == generation) {
            state.running = None;
            if let Ok(records) = &result { state.cached = Some((Instant::now(), Arc::clone(records))); }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test(flavor = "current_thread")]
    async fn scans_share_results_and_leave_the_request_runtime_responsive() {
        let cache = CachedScan::<usize>::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let scan = || {
            let calls = calls.clone();
            cache.get(move || {
                calls.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(80));
                Ok(42)
            })
        };
        let started = std::time::Instant::now();
        let heartbeat = async {
            tokio::time::sleep(Duration::from_millis(5)).await;
            assert!(started.elapsed() < Duration::from_millis(60), "blocking scan stalled the request runtime");
        };
        let (first, second, _) = tokio::join!(scan(), scan(), heartbeat);
        let (first, second) = (first.unwrap(), second.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(&first, &second));
        let cached = cache.get(|| panic!("fresh cache must not scan again")).await.unwrap();
        assert!(Arc::ptr_eq(&first, &cached));
    }

    #[tokio::test]
    async fn failed_scans_can_be_retried_and_expired_results_are_refreshed() {
        let mut cache = CachedScan::<usize>::default();
        assert!(cache.get(|| Err("scan failed".to_string())).await.is_err());
        assert_eq!(*cache.get(|| Ok(1)).await.unwrap(), 1);
        cache.ttl = Duration::ZERO;
        assert_eq!(*cache.get(|| Ok(2)).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn cancelling_one_waiter_does_not_launch_a_duplicate_scan() {
        let cache = Arc::new(CachedScan::<usize>::default());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let first_cache = cache.clone();
        let first = tokio::spawn(async move {
            first_cache.get(move || {
                let _ = started_tx.send(());
                finish_rx.recv_timeout(Duration::from_secs(2)).map_err(|error| error.to_string())?;
                Ok(7)
            }).await
        });
        started_rx.await.unwrap();
        first.abort();
        finish_tx.send(()).unwrap();
        assert_eq!(*cache.get(|| panic!("cancelled waiter must retain its running scan")).await.unwrap(), 7);
    }
}
