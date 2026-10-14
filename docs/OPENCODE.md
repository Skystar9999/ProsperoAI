# Use the PS5 Vulkan model in OpenCode

For the planned coding-agent workflow and shared PS5/web UI search through
LibreY, with an optional OpenCode websearch route, see the
[coding-agent integration plan](OPENCODE_CODING_AGENT_PLAN.md).

The Vulkan build exposes `GET /v1/models` and `POST /v1/chat/completions` at
`http://<PS5-IP>:11434/v1`. It supports non-streaming completions and SSE chat
chunks, finish reasons, usage, and `[DONE]`. The existing console layout is unchanged.

## Configure the console

Install the latest app-folder ZIP from the release, or build with `make app-release`.
Launch the app and keep it running while using OpenCode. Use Models to download a
Text preset, or copy a raw GGUF to the shared model directory. Vulkan GGUF and AGC
prepared models are stored in `/data/prosperoai/models`; the runtime
registers them immediately and returns their IDs from `/v1/models`. Use the exact model ID
returned by `/v1/models`.

By default the local API requires no authentication: without an `api_key.txt` file,
every HTTP route (including the older Ollama routes) accepts unauthenticated requests.
The API uses plain HTTP, so only expose it on a network you trust.

To require a bearer key instead, create a file named `api_key.txt` in the deployed
app's root (`/data/homebrew/PPSA99004/api_key.txt` for the release), containing your
key on one line, at most 256 bytes including a trailing newline, and restart the
title to load it. The server then requires `Authorization: Bearer <key>` on all HTTP
routes; the built-in web page does not supply this header, so adding a key breaks it.
Keep keys out of Git and PR descriptions.

The Vulkan context is selected in ProsperoAI's Generation settings and defaults to Auto.
For older builds, `context_size.txt` beside `api_key.txt` remains a 512–16384 compatibility
override. Current API requests may select 512–262144 with `context_tokens`, capped by the
model's trained context and available memory. Larger contexts consume more GPU memory.
The benchmark report used 4096; its buffer figures do not describe larger contexts.

## Configure OpenCode

Add this to `opencode.json` (adjust the address and model ID). No API key is needed
by default, matching the server's unauthenticated default above:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "prosperoai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "PS5 ProsperoAI",
      "options": {
        "baseURL": "http://<PS5-IP>:11434/v1"
      },
      "models": {
        "Mistral-7B-Instruct-v0.3.Q4_0.gguf": {
          "name": "Mistral PS5",
          "limit": {"context": 16384, "output": 8192},
          "tool_call": true
        }
      }
    }
  },
  "model": "prosperoai/Mistral-7B-Instruct-v0.3.Q4_0.gguf"
}
```

If you set up `api_key.txt` above, also set `PROSPEROAI_API_KEY` in your local
environment to the same key and add `"apiKey": "{env:PROSPEROAI_API_KEY}"` under
`options`.

This uses OpenCode's [custom OpenAI-compatible provider](https://opencode.ai/docs/providers/#custom-provider).
A direct OpenCode 1.1.36 streaming connection returned `API_OK` on the PS5 test build. A PS5 function-call test called `lookup` with `{"query":"Vulkan"}`, accepted the tool result and produced a final answer.

### Use LibreY search

In the web UI Settings, set the HTTPS address of your LibreY instance, enable
LibreY, and use **Test LibreY**. The PS5 app can then search from its built-in
conversation with `/search your query`; the same command works in the web UI.
The app sends the search from the console and passes up to five titles, snippets
and source URLs to the model. Search results are treated as untrusted input.
LibreY runs as a separate self-hosted service and is not bundled into the PS5 app.
The client caps each response at 128 KiB; its shared HTTPS transport reserves a
4 MiB receive buffer only during a request and frees it when the request closes.

OpenCode can call the same PS5 search endpoint through the included MCP bridge.
Configure the bridge in `opencode.json` and set the console origin in the local
environment:

```json
{
  "mcp": {
    "prosperoai-search": {
      "type": "local",
      "command": ["python3", "<PATH-TO-PROSPEROAI>/tools/prosperoai_search_mcp.py"],
      "environment": {
        "PROSPEROAI_BASE_URL": "http://<PS5-IP>:11434",
        "PROSPEROAI_API_KEY": "<OPTIONAL-API-KEY>"
      },
      "enabled": true
    }
  }
}
```

Use the MCP `web_search` tool when you want OpenCode to search through the
LibreY instance configured in ProsperoAI. OpenCode also has its own optional
`websearch`/`webfetch` tools. Their provider selection lives in OpenCode; those
hosted search providers are separate from the open-source LibreY route. Disable
OpenCode's built-in `websearch` if you want only the LibreY MCP tool. OpenCode
documents the built-in provider selection and permission settings in its
[websearch guide](https://opencode.ai/docs/websearch/).

## Tool calls and limits

Tools use a portable prompt/GBNF fallback: function schemas are included in the
system prompt; grammar constrains the JSON envelope and declared function names.
The server maps this to OpenAI `tool_calls`, including call IDs, and maps tool-result
messages back into the conversation. `tool_choice` supports `auto`, `none`,
`required`, and a named function; `parallel_tool_calls: false` restricts output to
one call. Tools execute in the client, not on the PS5. This is not llama-server's
native per-model Jinja tool implementation. Parameter schemas guide the model;
full JSON Schema argument validation is not implemented.

Ordinary text streams as it is generated. Tool-enabled responses are buffered
until the entire JSON envelope has been validated, then sent as SSE deltas.
Invalid or incomplete tool output returns an error rather than executing a
fabricated call. Model ability to choose useful tools still needs workload testing. In an OpenCode read test with automatic tool choice, Mistral 7B answered with invented file contents instead of calling the tool. A diagnostic proxy forcing `tool_choice=required` on the first OpenCode request did complete the `read` tool and returned the real `PROSPERO_TOOL_OK` file contents. That verifies the protocol roundtrip, not automatic tool selection. API compatibility does not establish coding-agent reliability for this model.

Requests accept up to 128 text messages and 256 KiB including headers. Content
may be a string, null, or an array of text parts. Output is capped at 131072 tokens;
omitting `max_tokens`/`max_completion_tokens` fills the remaining context instead of
stopping early, so it is always bounded by the space remaining after the prompt and
stops sooner on its own end-of-generation token. Pass a smaller or larger explicit
value to override. The optional
`context_tokens` extension selects 512-262144 tokens for a request; omitting it
uses the shared Generation setting. Temperature defaults to
zero (greedy); values above zero use top-k 40 / top-p 0.95 sampling. Only `n=1`
and text responses are supported; custom stop sequences are rejected. Requests
must use Content-Length; chunked request bodies are rejected. Unknown model IDs
return 404. Concurrent API generations return 503. Connection workers are bounded
and completed threads are joined rather than leaked.

The hybrid release serves text through Vulkan and Image, Audio and Voice through
AGC in the same app. OpenCode's coding workflow uses a text model. Voice generation
and switching back to Vulkan text are verified; Image/Audio generation in the
combined release remains unverified on console.

Native/browser limit controls and API examples are in
[Context and response limits](CONTEXT_AND_OUTPUT.md).
