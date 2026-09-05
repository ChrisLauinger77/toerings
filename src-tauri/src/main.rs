#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod data_harvester;
mod utils;
mod sampling;

use std::{net::Ipv4Addr, time::Duration};

use crate::utils::error;
use sampling::{Sampler, Snapshot};
#[cfg(not(target_os = "windows"))]
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[cfg(target_family = "windows")]
pub type Pid = usize;

#[cfg(target_family = "unix")]
pub type Pid = libc::pid_t;

#[tauri::command]
fn collect_data(sampler: tauri::State<Sampler>) -> Snapshot {
    sampler.snapshot()
}

fn parse_external_ipv4(response: &str) -> Option<String> {
    response
        .trim()
        .parse::<Ipv4Addr>()
        .ok()
        .map(|address| address.to_string())
}

#[tauri::command]
async fn get_external_ip() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let response = client
        .get("https://api.ipify.org")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let body = response.text().await.ok()?;

    parse_external_ipv4(&body)
}

#[cfg(not(target_os = "windows"))]
struct MenuLabels {
    open_preferences: &'static str,
    select_all: &'static str,
    copy: &'static str,
    quit: &'static str,
    about: &'static str,
    menu: &'static str,
    forked_from: &'static str,
    repository: &'static str,
    upstream: &'static str,
}

#[cfg(not(target_os = "windows"))]
fn menu_labels(locale: &str) -> MenuLabels {
    match locale {
        "de" => MenuLabels {
            open_preferences: "Einstellungen öffnen",
            select_all: "Alles auswählen",
            copy: "Kopieren",
            quit: "ToeRings beenden",
            about: "Über ToeRings",
            menu: "Menü",
            forked_from: "Abgespalten von:",
            repository: "Repository",
            upstream: "Ursprungsprojekt",
        },
        "fr" => MenuLabels {
            open_preferences: "Ouvrir les préférences",
            select_all: "Tout sélectionner",
            copy: "Copier",
            quit: "Quitter ToeRings",
            about: "À propos de ToeRings",
            menu: "Menu",
            forked_from: "Dérivé du projet :",
            repository: "Dépôt",
            upstream: "Projet d’origine",
        },
        "es" => MenuLabels {
            open_preferences: "Abrir preferencias",
            select_all: "Seleccionar todo",
            copy: "Copiar",
            quit: "Salir de ToeRings",
            about: "Acerca de ToeRings",
            menu: "Menú",
            forked_from: "Derivado del proyecto:",
            repository: "Repositorio",
            upstream: "Proyecto original",
        },
        _ => MenuLabels {
            open_preferences: "Open Preferences",
            select_all: "Select All",
            copy: "Copy",
            quit: "Quit ToeRings",
            about: "About ToeRings",
            menu: "Menu",
            forked_from: "Forked from upstream:",
            repository: "Repository",
            upstream: "Upstream (fork source)",
        },
    }
}

#[cfg(not(target_os = "windows"))]
fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    locale: &str,
) -> tauri::Result<Menu<R>> {
    let labels = menu_labels(locale);
    let preferences = MenuItemBuilder::with_id("preferences", labels.open_preferences)
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    let select_all = PredefinedMenuItem::select_all(handle, Some(labels.select_all))?;
    let copy = PredefinedMenuItem::copy(handle, Some(labels.copy))?;
    let quit = MenuItemBuilder::with_id("quit", labels.quit)
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;
    let about = PredefinedMenuItem::about(
        handle,
        Some(labels.about),
        Some(AboutMetadata {
            name: Some("ToeRings".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            authors: Some(vec!["ChrisLauinger77".to_string()]),
            comments: Some(format!(
                "{}\nhttps://github.com/acarl005/toerings",
                labels.forked_from
            )),
            license: Some("MIT".to_string()),
            website: Some("https://github.com/ChrisLauinger77/toerings".to_string()),
            website_label: Some("github.com/ChrisLauinger77/toerings".to_string()),
            credits: Some(format!(
                "{}\nhttps://github.com/ChrisLauinger77/toerings\n\n{}\nhttps://github.com/acarl005/toerings",
                labels.repository, labels.upstream
            )),
            icon: handle.default_window_icon().cloned(),
            ..Default::default()
        }),
    )?;
    let submenu = Submenu::with_items(
        handle,
        labels.menu,
        true,
        &[&preferences, &select_all, &copy, &quit, &about],
    )?;

    Menu::with_items(handle, &[&submenu])
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn set_menu_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    let menu = build_menu(&app, &locale).map_err(|error| error.to_string())?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn set_menu_locale(_app: tauri::AppHandle, _locale: String) -> Result<(), String> {
    Ok(())
}

fn main() {
    let sampler = Sampler::start().expect("failed to start telemetry worker");
    let builder = tauri::Builder::default().manage(sampler);

    #[cfg(not(target_os = "windows"))]
    let builder = builder.menu(|handle| build_menu(handle, "en"));

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
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
        })
        .invoke_handler(tauri::generate_handler![
            collect_data,
            get_external_ip,
            set_menu_locale
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::parse_external_ipv4;

    #[test]
    fn parses_external_ipv4() {
        assert_eq!(
            parse_external_ipv4("203.0.113.42"),
            Some("203.0.113.42".to_string())
        );
    }

    #[test]
    fn trims_external_ipv4_response() {
        assert_eq!(
            parse_external_ipv4("  198.51.100.8\n"),
            Some("198.51.100.8".to_string())
        );
    }

    #[test]
    fn rejects_non_ipv4_responses() {
        assert_eq!(parse_external_ipv4("2001:db8::1"), None);
        assert_eq!(parse_external_ipv4("not an IP address"), None);
    }
}
