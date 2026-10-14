# OpenCode coding-agent integration plan

## Goal

Use a text model served by ProsperoAI on the PS5 as the inference provider in
OpenCode, while OpenCode runs project tools on the development computer. The
workflow should support repository reading and editing, tests and shell
commands, plus web search through a LibreY-derived engine embedded in the app.
The PS5 does not receive repository files or execute project commands.

## Current state

ProsperoAI already exposes `/v1/models` and `/v1/chat/completions`, supports
streaming, and can encode OpenAI-style tool calls using a portable prompt and
GBNF grammar. OpenCode can connect through its custom OpenAI-compatible
provider. OpenCode executes tools on the client, so its file and shell tools
can work without adding filesystem access to the console app.

The current tool-call implementation is a compatibility fallback, not a
reliable agent interface yet. It does not enforce each tool's JSON Schema,
depends on the model selecting tools correctly, and an earlier Mistral 7B test
invented file contents in automatic mode. The existing protocol round-trip
proves only that a forced tool call can be passed back and forth.

## Proposed architecture

```text
PS5 native UI ─┐
ProsperoAI web UI ├─> shared chat/search orchestration ─> local GGUF model
OpenCode ───────┘             │                           │
                               └─ web_search
                                      │
                                      ▼
                         embedded native LibreY adapter
                                      │
                                      ▼
                      DuckDuckGo HTML results over HTTPS

OpenCode project tools (read/edit/bash) stay on the development computer.
OpenCode can use its own websearch tool instead, or reach the PS5 search tool
through an OpenCode MCP bridge.
```

The upstream LibreY project is a PHP web app, so it cannot be run as-is inside
the PS5 title. ProsperoAI embeds a native C++ implementation of its text search
flow, starting with LibreY's DuckDuckGo HTML engine: native chat, web UI, and
OpenCode MCP share the same handler. When enabled, `/search <query>` fetches
and parses up to five results within the app. Search results are untrusted
input. Additional engine adapters and automatic model-selected search are
later improvements.
OpenCode continues to execute project tools and permission prompts on the
development computer. Its own `websearch` tool is a separate optional route;
the documented provider choices are hosted services, so that route is not an
open-source search stack. To use ProsperoAI/LibreY in OpenCode, provide a small
MCP bridge which forwards a search request to the PS5 app's embedded engine.
Search queries go directly from the PS5 to DuckDuckGo over HTTPS; its privacy
and availability depend on that provider. OpenCode's built-in websearch remains
a separate provider-based option.

## Work plan

### 1. Make the local provider reliable

- Keep the documented OpenAI-compatible provider configuration and model IDs
  returned by `/v1/models`.
- Validate incoming tool definitions, names, call IDs, tool-result messages,
  and argument JSON against the declared parameter schema before returning a
  tool call. Reject malformed or undeclared calls.
- Preserve tool-call round trips in both streaming and non-streaming modes,
  including multiple calls only when requested.
- Prefer llama.cpp's native tool-aware chat template when the selected model
  provides one; retain the portable grammar fallback for models without it.
- Return clear API errors for unsupported features and ensure cancellation or
  disconnects do not leave inference workers stuck.

### 2. Qualify coding models and prompt behavior

- Test OpenCode's actual request format against installed models, not only
  hand-written API calls.
- Use a small set of deterministic tasks: find a symbol, read a file, make a
  one-line edit, run a test, and search the web then cite a source URL.
- Confirm the model calls tools when needed, incorporates tool output, stops
  when work is complete, and does not claim unperformed edits or tests.
- Record model, context size, tool-call success, latency, and failures. Publish
  a short tested-model recommendation in `docs/OPENCODE.md`; keep model quality
  separate from API protocol compatibility.
- Start with sequential tool calls. Enable parallel tool calls only after
  testing models that reliably produce them.

### 3. Embed LibreY-compatible text search in app chats

- Add a Web Search setting in ProsperoAI with `Off` and `LibreY` choices, shared
  by native PS5 conversations and the web UI. Include a timeout; cap results at
  five.
- Port LibreY's text search engine interface into the native app and start with
  its DuckDuckGo HTML adapter. Add other engine adapters only after parser
  fixtures and live PS5 tests.
- Keep bounded connect/read timeouts, response size limits, TLS verification,
  and clear errors for HTTP failure, timeout, malformed HTML or no results.
- Add a user-triggered `/search <query>` command to both chat flows when enabled.
  Run the request through the common app-side search handler, return only title,
  short snippet and URL, then resume generation with those results in context.
  Consider model-selected tool calls after tool-call validation and reliability
  work in sections 1 and 2.
- Validate response fields; treat result text as untrusted, preserve
  source URLs, and never follow instructions embedded in search results.
- Do not require a separate LibreY URL or server process. Document that the
  selected upstream search provider receives each query.

### 4. Connect OpenCode to the model and selectable search

- Keep OpenCode's project tools (read, grep, glob, edit, write and bash) on the
  development computer. The PS5 only performs inference and embedded web search;
  it never receives project filesystem or shell access.
- Provide a small MCP bridge exposing a narrow `web_search` tool which forwards
  queries to ProsperoAI's embedded search endpoint.
- Document OpenCode's built-in `websearch`/`webfetch` as a separate route. Let
  users enable or disable it and select its provider in OpenCode settings/config;
  do not call those hosted providers open-source. Users can disable built-in
  websearch and enable the LibreY MCP bridge for the open-source option.
- Keep LibreY attribution and license notices for any adapted code; document
  separate terms and privacy behavior of the selected search provider.

### 5. Provide a safe OpenCode project profile

- Add a copyable example `opencode.json` that selects ProsperoAI and enables
  OpenCode's repository tools plus either the LibreY MCP bridge or its own
  selected websearch provider.
- Keep `bash`, `edit`, and `write` under OpenCode's normal permission controls;
  default the example agent to ask before shell commands that modify files or
  access the network.
- Explain that the PS5 endpoint is plain HTTP today and should be used only on a
  trusted LAN. Use the existing bearer-key option when configured. Never expose
  the unauthenticated API directly to the public internet.
- Add setup and troubleshooting steps for model IDs, context limits, model
  tool-call reliability, LibreY API errors, and OpenCode MCP startup.

### 6. Validate and release

- Run existing host tests and API tests for invalid schemas, tool-choice modes,
  tool-call/result round trips, and streaming.
- On a test title, run the deterministic OpenCode tasks with at least one
  recommended coding model and one weaker control model.
- Confirm local file tools only touch the selected test repository and search
  returns usable, attributable links in native PS5 chat, web UI, and OpenCode.
- Update `docs/OPENCODE.md` with the verified configuration and tested models;
  keep this plan as the implementation checklist until those checks pass.

## Acceptance criteria

- OpenCode can select a live model from ProsperoAI and complete a real
  read-edit-test task in a local checkout using its own tools.
- Tool arguments are validated against their declared schema and malformed
  calls fail closed.
- Native PS5 chat and the web UI search through the embedded LibreY adapter and
  return cited source URLs.
- OpenCode can use either its selected websearch provider or the same embedded
  PS5 search endpoint through MCP.
- The console app remains isolated from project files and shell execution.
- Documentation clearly distinguishes API compatibility from tested coding
  performance and model reliability.

## References

- [ProsperoAI OpenCode setup](OPENCODE.md)
- [OpenCode providers](https://opencode.ai/docs/providers/)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/)
- [LibreY source and license](https://github.com/Ahwxorg/LibreY)
- [LibreY DuckDuckGo adapter](https://github.com/Ahwxorg/LibreY/blob/main/engines/text/duckduckgo.php)
- [OpenCode websearch settings and providers](https://opencode.ai/docs/websearch/)
