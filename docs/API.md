# ProsperoAI HTTP API

ProsperoAI serves its API from the running PS5 title at `http://<PS5-IP>:11434/`.
Replace `<PS5-IP>` with the console's local address. The server uses plain HTTP; use it
only on a trusted network.

## Authentication

By default, requests do not need an API key. To require one, place `api_key.txt` in the
deployed app folder and restart the title. Then send `Authorization: Bearer <key>` with
every request. The web UI does not send this header, so enabling a key also prevents that
browser UI from connecting.

## OpenAI-compatible API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/models` | List installed models and their IDs. |
| `POST` | `/v1/chat/completions` | Generate text, optionally streaming Server-Sent Events; supports function/tool calls. |

Use a model ID returned by `/v1/models`. See [OpenCode setup and API limits](OPENCODE.md)
for request limits, tool-call behavior, and a client configuration example.

## Runtime settings

`GET /api/settings/runtime` returns the shared runtime settings. `POST` accepts a JSON
object containing one or more settings; omitted settings retain their current values.
Both methods return the complete settings object after the request.

```bash
curl -X POST 'http://<PS5-IP>:11434/api/settings/runtime' \
  -H 'Content-Type: application/json' \
  -d '{"audio_duration_sec":30,"audio_seed":123,"sd_seed":456}'
```

If authentication is enabled, add `-H 'Authorization: Bearer <key>'`.

| Property | Type and valid values | Effect |
| --- | --- | --- |
| `context` | String: `auto`, `4k`, `8k`, `16k`, `32k`, `64k`, `128k`, `256k` | Shared text model context setting. |
| `output_limit` | Integer: a supported output token limit, including `0` for automatic | Shared text generation limit. |
| `kv` | String: `auto` | KV cache precision is selected automatically. |
| `thinking` | Boolean | Enables thinking for supported text models. |
| `idle_unload_minutes` | Integer: `1`, `2`, `5`, `10`, `30`, or `60` | Unloads an idle text model after this many minutes. |
| `audio_duration_sec` | Integer: `0` to `300`; `0` means each model's default | Requested clip duration for ACE-Step and Stable Audio. The audio planner may clamp it. |
| `audio_seed` | Unsigned 32-bit integer | Seed used by ACE-Step and Stable Audio. Default is `42`. |
| `sd_seed` | Unsigned 32-bit integer; `0` requests a random seed | Seed used by image generation models, including Stable Diffusion. Default is `42`. |
| `kokoro_voice` | Voice ID string | Default Kokoro voice. |
| `chatterbox_voice` | Voice ID string | Default Chatterbox voice. |
| `chatterbox_language` | Language code string | Default Chatterbox language. |

Audio controls apply to audio-generation models. Image seed applies to image-generation
models. The web workspace shows each model-specific setting when a matching model is
selected. The native Generation menu offers the current seed and common seed choices;
the web UI and API accept any unsigned 32-bit seed.

Invalid settings return `400 Bad Request`; a settings-file write failure returns
`500 Internal Server Error`. Settings persist in `prosperoai.cfg` across app restarts.

## ProsperoAI and Ollama-compatible routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tags` | List installed models in Ollama-style format. |
| `POST` | `/api/generate` | Generate from a prompt in Ollama-style format. |
| `POST` | `/api/chat` | Generate from chat messages in Ollama-style format. |
| `GET` | `/api/models/memory` | Report the currently loaded model. |
| `GET`, `POST` | `/api/models/selection` | Read or change the selected model. |
| `GET`, `POST` | `/api/models/presets` | List curated model presets or start a preset download. |
| `POST` | `/api/models/search` | Search model repositories by query. |
| `POST` | `/api/models/browse` | Browse downloadable files in a model repository. |
| `GET`, `POST`, `DELETE` | `/api/models/download` | Check, start, or cancel a model download. |
| `DELETE` | `/api/models` | Delete an installed model. |
| `GET`, `POST` | `/api/conversations` | List or create/update a saved conversation. |
| `GET`, `DELETE` | `/api/conversations/{id}` | Read or remove one saved conversation. |
| `GET`, `POST` | `/api/voices/chatterbox/custom` | Read or upload the custom Chatterbox voice sample. |
| `GET`, `POST`, `DELETE` | `/api/voices/chatterbox/recording` | Read or manage a Chatterbox recording session. |

The model library and conversation routes use JSON. Model download operations can return
`409 Conflict` when another download is active or the request cannot be started. The web
workspace calls these routes directly.
