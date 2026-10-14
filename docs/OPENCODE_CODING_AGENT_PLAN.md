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
  read-tool selection test by inventing file contents; Qwen passed a small,
  controlled task but has not completed broader coding qualification.
- Qwen 3.8 9B Distill Q4_K_M passed a controlled read-edit-test task in
  OpenCode 1.1.36 at 16K context; the same test was not reliable at 4K because
  OpenCode's system/tool prompt exceeded the context. This is a useful candidate
  for guided tasks, not a broad coding-quality benchmark.
- The same model called the ProsperoAI MCP search tool and returned a real result
  with its URL when explicitly instructed to call it. A vague search prompt
  produced a fabricated answer, so automatic search selection remains unreliable.
- Native `/search` in the PS5 app and the MCP bridge both returned three live
  results with source URLs. The web UI `/search` flow still needs a fresh visual
  interaction check; its backend shares the verified handler.
- OpenCode streaming, tool calls and the supported schema subset are covered;
  cancellation/disconnect behavior and broad model/template compatibility still
  need targeted verification.

## Verification sequence

1. Done: on PPSA99023, confirm the title is running, check `/v1/models`, and
   verify `/api/search` and the MCP `web_search` call return live URLs.
2. Done: API tests cover schema validation, tool history, tool-choice modes,
   streaming, round trips, and rejected malformed calls.
3. Done: Qwen 3.8 9B Distill Q4_K_M completed a controlled OpenCode read-edit-test
   task at 16K context; Mistral 7B remains a weaker control that failed automatic
   read-tool selection.
4. Remaining: test a broader sequence (symbol lookup, one-line code change,
   project test, and cited web research) in a disposable checkout and visually
   confirm the web UI search flow.
5. Done: update `docs/OPENCODE.md` with the tested profile and the model/search
   limits above; keep this file as the status record for remaining qualification.

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
