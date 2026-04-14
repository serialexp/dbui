// ABOUTME: Establishes SSH tunnels for forwarding database connections via russh.
// ABOUTME: Supports ssh-agent (SSH_AUTH_SOCK), private-key, and password authentication.

use crate::storage::{SshAuthMethod, SshTunnelConfig};
use russh::ChannelMsg;
use russh::Preferred;
use russh::client::{self, Config, Handle};
use russh::compression;
use russh::keys::PrivateKeyWithHashAlg;
use russh::keys::agent::client::AgentClient;
use std::borrow::Cow;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: verify against ~/.ssh/known_hosts and prompt on first-use.
        Ok(true)
    }
}

/// Holds a live SSH tunnel. Dropping it aborts the forwarding task and
/// disconnects the underlying SSH session.
pub struct TunnelHandle {
    pub local_port: u16,
    listener_task: JoinHandle<()>,
    _session: Arc<Handle<Client>>,
}

impl Drop for TunnelHandle {
    fn drop(&mut self) {
        self.listener_task.abort();
    }
}

pub async fn establish_tunnel(
    cfg: &SshTunnelConfig,
    remote_host: String,
    remote_port: u16,
) -> Result<TunnelHandle, String> {
    // Prefer zlib compression over no-compression. The default order lists
    // NONE first, so negotiation picks NONE whenever both sides support it —
    // which is basically always. Putting zlib first means we actually get
    // compression with any reasonably modern OpenSSH server, which for
    // text-heavy payloads (JSON, HTML, long VARCHARs) can cut wire bytes by
    // 2–10x. Falls back to NONE if the server doesn't offer zlib.
    let preferred = Preferred {
        compression: Cow::Borrowed(&[
            compression::ZLIB,
            compression::ZLIB_LEGACY,
            compression::NONE,
        ]),
        ..Preferred::DEFAULT
    };

    let client_config = Arc::new(Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        // Larger channel flow-control window so fat result sets don't stall
        // waiting for WindowAdjust round-trips across high-latency links.
        window_size: 8 * 1024 * 1024,
        // Disable Nagle on the SSH socket — with Nagle on, small packets
        // (like per-row MySQL/Postgres frames) coalesce with delayed-ACKs and
        // add RTT-sized latency spikes per row.
        nodelay: true,
        preferred,
        ..Default::default()
    });

    let ssh_addr = (cfg.host.as_str(), cfg.port);
    let connect_fut = client::connect(client_config, ssh_addr, Client);
    let mut session = tokio::time::timeout(SSH_CONNECT_TIMEOUT, connect_fut)
        .await
        .map_err(|_| format!("SSH connect to {}:{} timed out", cfg.host, cfg.port))?
        .map_err(|e| format!("SSH connect to {}:{} failed: {}", cfg.host, cfg.port, e))?;

    authenticate(&mut session, cfg).await?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local forwarding port: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local forwarding addr: {}", e))?
        .port();

    let session = Arc::new(session);
    let session_for_task = session.clone();
    let listener_task = tokio::spawn(async move {
        loop {
            let (socket, peer) = match listener.accept().await {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("SSH tunnel accept error: {}", e);
                    continue;
                }
            };
            // Same reasoning as on the SSH side: avoid Nagle/delayed-ACK
            // pairing when forwarding per-row database protocol frames.
            let _ = socket.set_nodelay(true);
            let session = session_for_task.clone();
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                if let Err(e) = forward(
                    session,
                    socket,
                    peer.ip().to_string(),
                    peer.port(),
                    remote_host,
                    remote_port,
                )
                .await
                {
                    eprintln!("SSH tunnel forward error: {}", e);
                }
            });
        }
    });

    Ok(TunnelHandle {
        local_port,
        listener_task,
        _session: session,
    })
}

async fn authenticate(
    session: &mut Handle<Client>,
    cfg: &SshTunnelConfig,
) -> Result<(), String> {
    match &cfg.auth {
        SshAuthMethod::Password { password } => {
            let res = session
                .authenticate_password(&cfg.username, password)
                .await
                .map_err(|e| format!("SSH password auth error: {}", e))?;
            if !res.success() {
                return Err("SSH password authentication was rejected".into());
            }
        }
        SshAuthMethod::PrivateKey { path, passphrase } => {
            let key = russh::keys::load_secret_key(path, passphrase.as_deref())
                .map_err(|e| format!("Failed to load SSH key '{}': {}", path, e))?;
            let hash_alg = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("SSH negotiation failed: {}", e))?
                .flatten();
            let res = session
                .authenticate_publickey(
                    &cfg.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|e| format!("SSH key auth error: {}", e))?;
            if !res.success() {
                return Err("SSH key authentication was rejected".into());
            }
        }
        SshAuthMethod::Agent => {
            let mut agent = AgentClient::connect_env()
                .await
                .map_err(|e| format!("Could not connect to SSH agent: {}", e))?;
            let identities = agent
                .request_identities()
                .await
                .map_err(|e| format!("Failed to list SSH agent identities: {}", e))?;
            if identities.is_empty() {
                return Err(
                    "SSH agent is reachable but has no identities loaded (try `ssh-add`)".into(),
                );
            }
            let hash_alg = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("SSH negotiation failed: {}", e))?
                .flatten();
            for ident in identities {
                let pub_key = ident.public_key().into_owned();
                let res = session
                    .authenticate_publickey_with(
                        &cfg.username,
                        pub_key,
                        hash_alg,
                        &mut agent,
                    )
                    .await
                    .map_err(|e| format!("SSH agent auth error: {}", e))?;
                if res.success() {
                    return Ok(());
                }
            }
            return Err(
                "SSH agent authentication failed — server rejected every identity in the agent"
                    .into(),
            );
        }
    }
    Ok(())
}

async fn forward(
    session: Arc<Handle<Client>>,
    mut socket: TcpStream,
    originator_addr: String,
    originator_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), String> {
    let mut channel = session
        .channel_open_direct_tcpip(
            remote_host,
            remote_port as u32,
            originator_addr,
            originator_port as u32,
        )
        .await
        .map_err(|e| format!("Failed to open direct-tcpip channel: {}", e))?;

    let mut stream_closed = false;
    let mut buf = vec![0u8; 65536];
    loop {
        tokio::select! {
            r = socket.read(&mut buf), if !stream_closed => {
                match r {
                    Ok(0) => {
                        stream_closed = true;
                        channel.eof().await.ok();
                    }
                    Ok(n) => {
                        channel
                            .data(&buf[..n])
                            .await
                            .map_err(|e| format!("channel.data: {}", e))?;
                    }
                    Err(e) => return Err(format!("local socket read: {}", e)),
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        socket
                            .write_all(&data)
                            .await
                            .map_err(|e| format!("local socket write: {}", e))?;
                    }
                    Some(ChannelMsg::Eof) => {
                        if !stream_closed {
                            channel.eof().await.ok();
                        }
                        break;
                    }
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
