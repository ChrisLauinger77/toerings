#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod data_harvester;
mod utils;
mod sampling;
#[cfg(any(not(target_os = "windows"), test))]
mod menu_sync;

use std::{net::Ipv4Addr, time::Duration};

use crate::utils::error;
use sampling::{Sampler, Snapshot};
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
use tauri::menu::AboutMetadata;
#[cfg(not(target_os = "windows"))]
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use objc2::{rc::Retained, runtime::AnyObject};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAboutPanelOptionApplicationName, NSAboutPanelOptionApplicationVersion,
    NSAboutPanelOptionCredits, NSAboutPanelOptionVersion, NSApplication, NSLinkAttributeName,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    MainThreadMarker, NSDictionary, NSMutableAttributedString, NSRange, NSString,
};

#[cfg(not(target_os = "windows"))]
const REPOSITORY_URL: &str = "https://github.com/ChrisLauinger77/toerings";
#[cfg(not(target_os = "windows"))]
const UPSTREAM_URL: &str = "https://github.com/acarl005/toerings";

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
    #[cfg(not(target_os = "macos"))]
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
            #[cfg(not(target_os = "macos"))]
            forked_from: "Abgespalten von:",
            repository: "GitHub Repository",
            upstream: "Ursprungsprojekt",
        },
        "fr" => MenuLabels {
            open_preferences: "Ouvrir les préférences",
            select_all: "Tout sélectionner",
            copy: "Copier",
            quit: "Quitter ToeRings",
            about: "À propos de ToeRings",
            menu: "Menu",
            #[cfg(not(target_os = "macos"))]
            forked_from: "Dérivé du projet :",
            repository: "GitHub Repository",
            upstream: "Projet d’origine",
        },
        "es" => MenuLabels {
            open_preferences: "Abrir preferencias",
            select_all: "Seleccionar todo",
            copy: "Copiar",
            quit: "Salir de ToeRings",
            about: "Acerca de ToeRings",
            menu: "Menú",
            #[cfg(not(target_os = "macos"))]
            forked_from: "Derivado del proyecto:",
            repository: "GitHub Repository",
            upstream: "Proyecto original",
        },
        _ => MenuLabels {
            open_preferences: "Open Preferences",
            select_all: "Select All",
            copy: "Copy",
            quit: "Quit ToeRings",
            about: "About ToeRings",
            menu: "Menu",
            #[cfg(not(target_os = "macos"))]
            forked_from: "Forked from upstream:",
            repository: "GitHub Repository",
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
    #[cfg(not(target_os = "macos"))]
    let about = PredefinedMenuItem::about(
        handle,
        Some(labels.about),
        Some(AboutMetadata {
            name: Some("ToeRings".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            short_version: Some(env!("TOERINGS_GIT_COMMIT").to_string()),
            authors: Some(vec!["ChrisLauinger77".to_string()]),
            comments: Some(format!("{}\n{UPSTREAM_URL}", labels.forked_from)),
            license: Some("MIT".to_string()),
            website: Some(REPOSITORY_URL.to_string()),
            website_label: Some(labels.repository.to_string()),
            credits: Some(format!(
                "{}\n{REPOSITORY_URL}\n\n{}\n{UPSTREAM_URL}",
                labels.repository, labels.upstream
            )),
            icon: handle.default_window_icon().cloned(),
            ..Default::default()
        }),
    )?;
    #[cfg(target_os = "macos")]
    let about = MenuItemBuilder::with_id(format!("about-{locale}"), labels.about).build(handle)?;
    let submenu = Submenu::with_items(
        handle,
        labels.menu,
        true,
        &[&preferences, &select_all, &copy, &quit, &about],
    )?;

    Menu::with_items(handle, &[&submenu])
}

#[cfg(target_os = "macos")]
fn show_macos_about(locale: &str) {
    let labels = menu_labels(locale);
    let credits_text = format!(
        "{}\n\n{}\n{UPSTREAM_URL}",
        labels.repository, labels.upstream
    );
    let credits = NSMutableAttributedString::from_nsstring(&NSString::from_str(&credits_text));
    let repository_url = NSString::from_str(REPOSITORY_URL);

    // SAFETY: NSLinkAttributeName accepts an NSString URL, and the range covers the UTF-16
    // representation of the repository label at the beginning of the credits string.
    unsafe {
        credits.addAttribute_value_range(
            NSLinkAttributeName,
            &repository_url,
            NSRange::new(0, labels.repository.encode_utf16().count()),
        );
    }

    let keys = vec![
        unsafe { NSAboutPanelOptionApplicationName },
        unsafe { NSAboutPanelOptionApplicationVersion },
        unsafe { NSAboutPanelOptionVersion },
        unsafe { NSAboutPanelOptionCredits },
    ];
    let objects: Vec<Retained<AnyObject>> = vec![
        Retained::into_super(Retained::into_super(NSString::from_str("ToeRings"))),
        Retained::into_super(Retained::into_super(NSString::from_str(env!(
            "CARGO_PKG_VERSION"
        )))),
        Retained::into_super(Retained::into_super(NSString::from_str(env!(
            "TOERINGS_GIT_COMMIT"
        )))),
        Retained::into_super(Retained::into_super(Retained::into_super(credits))),
    ];
    let options = NSDictionary::from_retained_objects(&keys, &objects);
    let main_thread = MainThreadMarker::new().expect("menu events must run on the main thread");

    // SAFETY: The dictionary values match the Cocoa types required by each About panel key.
    unsafe {
        NSApplication::sharedApplication(main_thread)
            .orderFrontStandardAboutPanelWithOptions(&options);
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
async fn set_menu_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    let handle = app.clone();
    menu_sync::apply_on_main_thread(
        move |update| app.run_on_main_thread(update).map_err(|error| error.to_string()),
        move || {
            // Tauri may enqueue set_menu work when called off the main thread.
            // On the main thread its nested menu operations complete inline.
            let menu = build_menu(&handle, &locale).map_err(|error| error.to_string())?;
            handle.set_menu(menu).map(|_| ()).map_err(|error| error.to_string())
        },
    )
    .await
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn set_menu_locale(_app: tauri::AppHandle, _locale: String) -> Result<(), String> {
    Ok(())
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: Xlib requires this before any other Xlib call. Run it on the
        // main thread before Tauri/GTK initialization or starting any workers.
        // This initializes locking only; it does not open or select a display.
        assert_ne!(unsafe { x11::xlib::XInitThreads() }, 0, "failed to initialize Xlib threading");
    }
    let sampler = Sampler::start().expect("failed to start telemetry worker");
    let builder = tauri::Builder::default().manage(sampler);

    #[cfg(not(target_os = "windows"))]
    let builder = builder.menu(|handle| build_menu(handle, "en"));

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            #[cfg(target_os = "macos")]
            id if id.starts_with("about-") => {
                show_macos_about(id.strip_prefix("about-").unwrap_or("en"));
            }
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
