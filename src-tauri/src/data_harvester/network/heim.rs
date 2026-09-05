//! Gets network byte counters via heim.
use super::{NetworkHarvest, NetworkHistory};

pub async fn get_network_data(
    history: &mut NetworkHistory,
) -> crate::utils::error::Result<Option<NetworkHarvest>> {
    use futures::StreamExt;
    let io_data = heim::net::io_counters().await?;
    futures::pin_mut!(io_data);
    let mut counters = Vec::new();
    while let Some(io) = io_data.next().await {
        if let Ok(io) = io {
            counters.push((io.interface().to_string(),
                io.bytes_recv().get::<heim::units::information::byte>(),
                io.bytes_sent().get::<heim::units::information::byte>()));
        }
    }
    Ok(Some(history.sample(counters, std::time::Instant::now())))
}
