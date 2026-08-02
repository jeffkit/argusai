---
"argusai-core": patch
"argusai-mcp": patch
---

fix(isolation): complete concurrent-run isolation — namespace container names, add labels, support random host ports (issue #9)

- Container names are now prefixed with the isolation namespace (`<namespace>-<name>`, `deriveNamespace` enabled), keeping the original name as a `--network-alias` so in-network DNS (e.g. `http://aimock:4010`) is unchanged. Applies to service containers and image-based mocks.
- All resources created by `argus_setup` (network + containers) now carry `argusai.managed` / `argusai.project` / `argusai.run-id` / `argusai.created-at` labels, so `OrphanCleaner`, `argus_resources` and `argus_clean` work on the MCP path.
- `ports: ["0:8080"]` is now supported: Docker assigns a random host port and `argus_setup` reads it back (`getHostPort`) into the session; `argus_run` base URL and `argus_status` report the effective host port, so tests no longer hit silently-reassigned ports.
