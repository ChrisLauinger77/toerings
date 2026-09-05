//! Gets network byte counters via sysinfo.
use std::time::Instant;
use super::{NetworkHarvest, NetworkHistory};

pub async fn get_network_data(
    networks: &sysinfo::Networks,
    history: &mut NetworkHistory,
    curr_time: Instant,
) -> crate::utils::error::Result<Option<NetworkHarvest>> {
    let counters = networks.iter().map(|(name, network)| (
        name.to_string(), network.total_received(), network.total_transmitted()
    ));
    Ok(Some(history.sample(counters, curr_time)))
}
