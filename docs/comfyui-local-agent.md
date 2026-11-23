# ComfyUI Local Agent / remote worker contract

Biren Social Studio intentionally does not open a public port, create a tunnel, or execute arbitrary commands on a user's computer. Cloud mode detects that `127.0.0.1` belongs to the cloud host and returns a clear unavailable status.

A future Local Agent should use this boundary:

1. The user starts the agent locally; it binds only to `127.0.0.1` and makes outbound HTTPS requests to an explicitly configured Biren endpoint.
2. Pairing uses a short-lived one-time code, then a rotated token stored in the OS credential store. Never put the token in a workflow or browser localStorage.
3. The cloud sends an allowlisted job envelope: input asset reference, workflow identifier/version, and timeout. The agent accepts only signed envelopes, validates the workflow locally, and forwards only `/system_stats`, `/object_info`, `/upload/image`, `/prompt`, `/queue`, `/history/{id}`, and `/view` to the local ComfyUI URL.
4. The agent returns progress and output metadata over the outbound connection. It never exposes ComfyUI's port to the LAN/Internet and never accepts shell commands, arbitrary URLs, or arbitrary filesystem paths.
5. Both sides enforce size limits, TLS, request IDs, expiry, cancellation, and output MIME validation. Cloud storage should be persistent; local SQLite/uploads remain a Local-mode concern.

This document is a design contract, not a claim that a remote worker is already deployed.
