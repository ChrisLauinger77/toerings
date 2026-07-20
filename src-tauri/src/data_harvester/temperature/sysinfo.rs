//! Gets temperature data via sysinfo.

use anyhow::Result;

use super::TempHarvest;

pub fn get_temperature_data(components: &sysinfo::Components) -> Result<Option<Vec<TempHarvest>>> {
    let mut temperature_vec: Vec<TempHarvest> = Vec::new();

    for component in components {
        let name = component.label().to_string();

        if let Some(temperature) = component.temperature() {
            temperature_vec.push(TempHarvest { name, temperature });
        }
    }

    #[cfg(feature = "nvidia")]
    {
        super::nvidia::add_nvidia_data(&mut temperature_vec, temp_type, filter)?;
    }

    Ok(Some(temperature_vec))
}
