---
"argusai-core": patch
"argusai-mcp": patch
"argusai-core-storage": patch
"argusai-dashboard": patch
---

HostRuntime: run exec commands with cwd = workspaceDir (mirror Docker WORKDIR)

HostRuntime.execInContainer now sets `cwd: workspaceDir` when a workspace
dir is configured. Without this, host-mode processes inherited the
daemon's cwd, so commands relying on relative paths — or binaries that
default their workspace to cwd (e.g. `recursive http` with no
`--workspace`) — resolved files outside the mapped workspace, diverging
from Docker mode (where `docker exec` uses the image WORKDIR=/workspace).

Fixes recursive's host-mode e2e suites where the agent wrote files to
the daemon cwd instead of the workspace (e.g. 08-http-api's
"POST /run wrote http-run.txt" assertion).
