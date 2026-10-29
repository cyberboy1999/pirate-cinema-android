//! Deterministic local-only fixture seeder; connect the phone with adb reverse.
use librqbit::{CreateTorrentOptions, ListenerOptions, Session, SessionOptions};
use std::{num::NonZeroU32, path::PathBuf, time::Duration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = std::env::args().collect::<Vec<_>>();
    anyhow::ensure!(
        args.len() == 3 || args.len() == 4,
        "usage: seed_fixture <owned-video> <output.torrent> [listen-address]"
    );
    let path = PathBuf::from(&args[1]).canonicalize()?;
    let listen_addr = args
        .get(3)
        .map(String::as_str)
        .unwrap_or("127.0.0.1:4242")
        .parse()?;
    let session = Session::new_with_opts(
        path.parent().unwrap().into(),
        SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            ipv4_only: true,
            listen: Some(ListenerOptions {
                listen_addr,
                enable_upnp_port_forwarding: false,
                ..Default::default()
            }),
            ratelimits: librqbit::limits::LimitsConfig {
                upload_bps: NonZeroU32::new(64 * 1024),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await?;
    let (torrent, handle) = session
        .create_and_serve_torrent(
            &path,
            CreateTorrentOptions {
                piece_length: Some(64 * 1024),
                ..Default::default()
            },
        )
        .await?;
    handle.wait_until_initialized().await?;
    std::fs::write(&args[2], torrent.as_bytes()?)?;
    println!("READY {}", torrent.info_hash().as_string());
    tokio::time::sleep(Duration::from_secs(1800)).await;
    session.stop().await;
    Ok(())
}
