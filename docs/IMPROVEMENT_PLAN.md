# ProsperoAI improvement plan

This plan records five focused improvements for the native PS5 app, hosted web UI,
and HTTP API. It is a roadmap; it does not claim that the work below has been
implemented.

## 1. One model manager for every interface

**Problem.** The native app serializes model work through its `App` worker, while
`/api/models/selection` currently calls the runtime directly. That gives the native
state and API separate paths for selecting and preparing a model. Requests from the
web UI, API clients, and controller can therefore disagree about which model is
selected or whether it is ready, and can race with other runtime work.

**Plan.** Add one model manager that owns model selection, preparation, unload, and
the published state (`selected`, `loading`, `ready`, or `failed`). Make native UI,
web UI, and API submit requests to it. Serialize transitions with inference and
downloads, and return the same status and error details to all callers. Keep
conversation model identity separate from the currently loaded runtime so switching
the runtime does not silently change an existing conversation.

**Acceptance criteria.** Selecting Chatterbox from any interface produces the same
selected and ready state in all interfaces. Concurrent selection during generation
returns a clear busy response or queues safely. A failed preparation leaves the
previous conversation readable and gives every interface the same actionable error.

## 2. Make model selection easier to use

**Problem.** The native Workspace model picker is a long list, and a selection uses
confirmation followed by a potentially slow load. It is easy to mistake the
confirmation or preparation step for a failed selection.

**Plan.** Add search and capability filters to the Workspace picker. Show distinct
selected, loading, ready, and failed states, with progress where the runtime can
report it. Keep the current model usable until the replacement is ready, and explain
whether retrying will reuse an already selected model. Apply the same state labels in
the web UI.

**Acceptance criteria.** A user can find a model by name or capability, confirm it
once, see that it is loading, and tell whether it became ready or failed. The picker
does not imply that a model is ready merely because it is selected.

## 3. Warn about model memory needs before loading

**Problem.** Text, image, audio, and speech workloads share limited console memory.
Model changes and larger settings can fail during preparation or put stability at
risk.

**Plan.** Track measured memory use and preparation outcomes by model and settings.
Combine those measurements with current free-memory information to show a
conservative estimate before loading or downloading. If reliable estimates are not
available, say so rather than presenting a guessed number. On a failed allocation,
release partial resources and preserve the last usable app state.

**Acceptance criteria.** Estimates are based on recorded console measurements and
identify their confidence. Low-memory cases warn before preparation when possible;
failed preparation returns the app to a usable state and records the failure.

## 4. Protect the API without disabling the browser UI

**Problem.** The API has optional bearer-key authentication, but the hosted browser
UI does not send that key. Enabling API authentication therefore also blocks the
first-party web interface. The API is plain HTTP and is documented for trusted local
networks.

**Plan.** Add a browser-specific authorization flow, such as a short-lived,
origin-scoped session established from the console UI, while retaining bearer keys
for external clients. Avoid exposing long-lived API keys to browser storage. Make
the listener's network exposure and authentication state visible in Settings, and
document the trusted-network limitation until transport encryption is available.

**Acceptance criteria.** With API authentication enabled, the first-party browser
UI can connect through a short-lived session and external clients still require the
configured bearer key. Unauthorized API requests remain rejected.

## 5. Improve crash and failure diagnostics

**Problem.** Detailed debug tracing is opt-in. When a title crashes or model
preparation fails, the information needed to distinguish a model error, memory
pressure, or runtime failure may be missing.

**Plan.** Keep a small bounded diagnostic journal for app lifecycle, model
transitions, allocation failures, and API errors. Record timestamps, operation IDs,
model IDs, and error codes, but no prompts, generated content, API keys, or voice
recordings. Preserve the journal across restarts and expose an export action in
Diagnostics. Keep verbose runtime tracing opt-in.

**Acceptance criteria.** A restart after a crash retains the last completed model
transition and relevant error code. The journal is size-bounded, contains no user
content or secrets, and can be exported from the app.

## Suggested order

1. Build the shared model manager and common state transitions.
2. Use that state to improve the native and web model pickers.
3. Add bounded diagnostics for transitions and failures.
4. Collect console memory measurements and add conservative warnings.
5. Design and implement browser authorization alongside the API security review.

Each item should be implemented and verified as a separate change, with console
verification for runtime, memory, and crash-handling behavior.
