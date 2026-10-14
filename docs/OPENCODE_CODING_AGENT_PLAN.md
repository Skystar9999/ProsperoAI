# OpenCode coding-agent integration status

## Goal

Use a text model served by ProsperoAI on the PS5 in OpenCode, while OpenCode runs
repository tools on the development computer. The console performs inference and
optional embedded search; it does not receive project files or execute project
commands.

## Implemented

- Vulkan builds expose `/v1/models` and `/v1/chat/completions`, including SSE
  responses and OpenAI-style function calls. OpenCode connects through its
  custom OpenAI-compatible provider using a model ID returned by `/v1/models`.
- Tool declarations, names, call IDs, result pairing, and generated arguments
  are validated. The supported JSON Schema subset covers common types, required
  properties, additional properties, arrays, enums/constants, alternatives,
  string lengths, and numeric bounds. Unsupported keywords fail closed.
- ProsperoAI embeds a native C++ text-search adapter based on LibreY's
  DuckDuckGo HTML engine. Native chat and web UI share the `/search` flow, with
  a settings toggle, bounded request, up to five results, and source URLs.
- The `tools/prosperoai_search_mcp.py` bridge exposes the app search route to
  OpenCode as `web_search`. OpenCode's own `websearch`/`webfetch` remains a
  separate selectable provider route.
- `docs/examples/opencode.prosperoai.json` is a copyable profile. Repository
  reading is allowed; edits, shell commands, web access, and MCP search ask for
  permission. It reads an optional bearer key from the local environment.
- API tests cover tool argument schemas, malformed declarations and history,
  tool-choice modes, round trips, parallel-call limits, and streaming.

## Still needs qualification

- The protocol round trip is verified on-console and with OpenCode 1.1.36, but
  that does not prove autonomous coding quality. Mistral 7B failed an automatic
  read-tool selection test by inventing file contents; a forced tool-call
  diagnostic did complete the round trip. The example model is therefore a
  connection example, not a coding recommendation.
- No model has yet passed the full deterministic OpenCode sequence: find a
  symbol, read a file, make a one-line edit, run a test, and search then cite a
  source. A tested-model recommendation must wait for those results.
- Native and web `/search` plus the MCP bridge need a fresh end-to-end check
  against the current test build. Earlier console deployment succeeded, but a
  live search request could not be reached from the restricted host session.
- OpenCode streaming, tool calls and the supported schema subset are covered;
  cancellation/disconnect behavior and broad model/template compatibility still
  need targeted verification.

## Verification sequence

1. Build and deploy to a designated test title, then confirm the title is
   running before calling port 11434.
2. Verify `/v1/models`, streaming completion, forced and automatic tool use,
   argument rejection, and search results with source URLs.
3. Run OpenCode against at least one candidate coding model and one weaker
   control in a disposable checkout. Record model ID, context, task outcome,
   latency, and tool-selection failures.
4. Run the deterministic read-edit-test task with the example permission
   profile, keeping changes confined to the disposable checkout.
5. Update `docs/OPENCODE.md` with only verified model recommendations and
   console results. Keep this file as the status record until qualification is
   complete.

## Architecture

```text
OpenCode ── OpenAI-compatible API ──> ProsperoAI on PS5 ──> local GGUF model
    │                                        │
    ├── repository tools run locally         └── embedded LibreY-compatible search
    └── optional hosted websearch or MCP web_search bridge
```

The upstream LibreY project is a PHP web app and does not run inside the PS5
title. ProsperoAI embeds a native C++ adapter for its DuckDuckGo HTML text-search
flow. Search requests go from the console to DuckDuckGo over HTTPS; results are
untrusted model input. The MCP bridge forwards OpenCode searches to the app.

## References

- [ProsperoAI OpenCode setup](OPENCODE.md)
- [Example OpenCode profile](examples/opencode.prosperoai.json)
- [OpenCode providers](https://opencode.ai/docs/providers/)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode websearch settings and providers](https://opencode.ai/docs/websearch/)
- [LibreY source and license](https://github.com/Ahwxorg/LibreY)
- [LibreY DuckDuckGo adapter](https://github.com/Ahwxorg/LibreY/blob/main/engines/text/duckduckgo.php)
