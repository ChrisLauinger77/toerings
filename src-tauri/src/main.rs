#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod data_harvester;
mod utils;

use std::sync::Mutex;

use crate::utils::error;
use data_harvester::{Data, DataCollector};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

#[cfg(target_family = "windows")]
pub type Pid = usize;

#[cfg(target_family = "unix")]
pub type Pid = libc::pid_t;

#[tauri::command]
fn collect_data(data_state: tauri::State<Mutex<DataCollector>>) -> Data {
    futures::executor::block_on(data_state.lock().unwrap().update_data());
    data_state.lock().unwrap().data.clone()
}

fn main() {
    let mut data_state = DataCollector::new();
    data_state.init();

    tauri::Builder::default()
        .manage(Mutex::new(data_state))
        .menu(|handle| {
            let preferences = MenuItemBuilder::with_id("preferences", "Open Preferences")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let select_all = PredefinedMenuItem::select_all(handle, None)?;
            let copy = PredefinedMenuItem::copy(handle, None)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit ToeRings")
                .accelerator("CmdOrCtrl+Q")
                .build(handle)?;
            let about = PredefinedMenuItem::about(
                handle,
                Some("About ToeRings"),
                Some(AboutMetadata {
                    name: Some("ToeRings".to_string()),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    authors: Some(vec!["ChrisLauinger77".to_string()]),
                    comments: Some(
                        "Forked from upstream:\nhttps://github.com/acarl005/toerings".to_string(),
                    ),
                    license: Some("MIT".to_string()),
                    website: Some("https://github.com/ChrisLauinger77/toerings".to_string()),
                    website_label: Some(
                        "github.com/ChrisLauinger77/toerings".to_string(),
                    ),
                    credits: Some(
                        "Repository\nhttps://github.com/ChrisLauinger77/toerings\n\n\
                         Upstream (fork source)\nhttps://github.com/acarl005/toerings"
                            .to_string(),
                    ),
                    ..Default::default()
                }),
            )?;
            let submenu = Submenu::with_items(
                handle,
                "Menu",
                true,
                &[&preferences, &select_all, &copy, &quit, &about],
            )?;

            Menu::with_items(handle, &[&submenu])
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "preferences" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("openPreferences", ());
                        #[cfg(target_os = "linux")]
                        {
                            let window = window.clone();
                            let _ = app.run_on_main_thread(move || {
                                let _ = window.set_focus();
                            });
                        }
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![collect_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
