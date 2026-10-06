// This file is intentionally empty.
// The P2P backend previously used start_as_p2p_backend (TCP on :7420) but now
// dispatches requests in-process via axum Router::call() in p2p/router_handle.rs.
