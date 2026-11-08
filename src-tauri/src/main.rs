use std::{
    error::Error,
    io::{self, BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};
use tauri::{path::BaseDirectory, Manager, WebviewUrl, WebviewWindowBuilder};

struct Backend(Child);

impl Drop for Backend {
    fn drop(&mut self) {
        // EOF stops the listener while allowing a burn already in progress to finish.
        drop(self.0.stdin.take());
    }
}

fn start_backend(runtime: &Path) -> Result<(Backend, tauri::Url, String), Box<dyn Error>> {
    let executable = std::env::current_exe()?.with_file_name("burna-node");
    let mut child = Command::new(executable)
        .arg(runtime.join("desktop.mjs"))
        .current_dir(runtime)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let output = BufReader::new(child.stdout.take().expect("piped backend stdout"));
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        for line in output.lines().map_while(Result::ok) {
            if let Some(ready) = line.strip_prefix("BURNA_READY ") {
                let _ = ready_tx.try_send(ready.to_owned());
            } else {
                eprintln!("[burna backend] {line}");
            }
        }
    });

    let ready = ready_rx.recv_timeout(Duration::from_secs(15)).ok();
    if let Some((port, token)) = ready.as_deref().and_then(|line| line.split_once(' ')) {
        if let Ok(port) = port.parse::<u16>() {
            if port != 0 && token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                let url = format!("http://127.0.0.1:{port}/").parse()?;
                return Ok((Backend(child), url, token.into()));
            }
        }
    }
    let status = child.try_wait()?;
    let _ = child.kill();
    let _ = child.wait();
    Err(io::Error::other(format!("Burna's backend did not start ({status:?})")).into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let runtime = app.path().resolve("runtime", BaseDirectory::Resource)?;
            let window = |url| {
                WebviewWindowBuilder::new(app, "main", url)
                    .title("Burna")
                    .inner_size(720.0, 840.0)
                    .min_inner_size(380.0, 500.0)
            };

            match start_backend(&runtime) {
                Ok((backend, url, token)) => {
                    let origin = url.origin();
                    let script = format!(
                        r#"if (location.origin === "{origin}") {{
                            Object.defineProperty(window, "__BURNA_DESKTOP_TOKEN__", {{value: "{token}"}});
                        }}"#,
                        origin = origin.ascii_serialization()
                    );
                    window(WebviewUrl::External(url))
                        .initialization_script(script)
                        .on_navigation(move |destination| destination.origin() == origin)
                        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                        .build()?;
                    app.manage(backend);
                }
                Err(error) => {
                    eprintln!("{error}");
                    window(WebviewUrl::App("index.html".into())).build()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("could not run Burna");
}
