//! `baud-cli` - the headless doors, with no window and no GTK.
//!
//! The same crate and the same reader as the desktop `baud`: this file hands
//! the arguments to [`baud_lib::run_headless`] and exits with its code, so the
//! six verbs answer here exactly as they do there. Built without the `gui`
//! feature (`cargo build --release --locked --no-default-features --bin
//! baud-cli`) it links no tauri, webkit or GTK, which is what lets a server or
//! a container with no desktop answer the host API's fleet, census, roster and
//! room lanes.
//!
//! It never opens a window. With no verb, or none of the six, it prints them to
//! stderr and exits 2 - the usage-error code, stdout empty.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = baud_lib::run_headless(&args).unwrap_or_else(|| {
        let program = baud_lib::program_name();
        if args.is_empty() {
            eprintln!("{program}: no verb given - it answers these six and opens no window");
        } else {
            eprintln!("{program}: none of the six verbs in '{}'", args.join(" "));
        }
        eprintln!("{}", baud_lib::usage(&program));
        2
    });
    std::process::exit(code);
}
