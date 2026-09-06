//! Complete a menu update on the UI thread before acknowledging its IPC request.

pub async fn apply_on_main_thread(
    dispatch: impl FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), String>,
    apply: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let (sender, receiver) = futures::channel::oneshot::channel();
    dispatch(Box::new(move || {
        let _ = sender.send(apply());
    }))?;
    receiver
        .await
        .map_err(|_| "Native menu update ended without a result".to_string())?
}

#[cfg(test)]
mod tests {
    use super::apply_on_main_thread;
    use std::{cell::RefCell, task::Poll};

    #[test]
    fn acknowledgement_waits_for_the_dispatched_operation() {
        futures::executor::block_on(async {
            let task = RefCell::new(None);
            let mut update = Box::pin(apply_on_main_thread(
                |callback| {
                    task.replace(Some(callback));
                    Ok(())
                },
                || Ok(()),
            ));
            assert!(matches!(futures::poll!(update.as_mut()), Poll::Pending));
            task.take().unwrap()();
            assert_eq!(update.await, Ok(()));
        });
    }

    #[test]
    fn native_failure_is_reported_instead_of_dispatch_success() {
        let result = futures::executor::block_on(apply_on_main_thread(
            |callback| {
                callback();
                Ok(())
            },
            || Err("menu replacement failed".to_string()),
        ));
        assert_eq!(result, Err("menu replacement failed".to_string()));
    }

    #[test]
    fn dispatch_failure_does_not_run_the_operation() {
        let result = futures::executor::block_on(apply_on_main_thread(
            |_| Err("event loop unavailable".to_string()),
            || panic!("a rejected dispatch must not apply the menu"),
        ));
        assert_eq!(result, Err("event loop unavailable".to_string()));
    }

    #[test]
    fn dropped_dispatch_is_not_acknowledged_as_success() {
        let result = futures::executor::block_on(apply_on_main_thread(
            |_| Ok(()),
            || panic!("the dispatcher dropped this operation"),
        ));
        assert!(result.is_err());
    }
}
