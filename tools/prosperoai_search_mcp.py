#!/usr/bin/env python3
"""OpenCode MCP bridge to ProsperoAI's PS5 LibreY search endpoint."""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def ps5_url():
    base = os.environ.get("PROSPEROAI_BASE_URL", "").rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("Set PROSPEROAI_BASE_URL to the trusted PS5 app origin.")
    if parsed.path or parsed.query or parsed.fragment:
        raise ValueError("PROSPEROAI_BASE_URL must be only the scheme and host, with optional port.")
    return base + "/api/search"


def call_search(arguments):
    query = arguments.get("query") if isinstance(arguments, dict) else None
    limit = arguments.get("limit", 5) if isinstance(arguments, dict) else 5
    if not isinstance(query, str) or not 2 <= len(query) <= 256 or any(ord(c) < 32 for c in query):
        raise ValueError("query must contain 2–256 printable characters")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 3 <= limit <= 5:
        raise ValueError("limit must be 3, 4 or 5")
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("PROSPEROAI_API_KEY")
    if key:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(ps5_url(), data=json.dumps({"query": query, "limit": limit}).encode(),
                                     headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=35) as response:
        payload = json.loads(response.read(128 * 1024 + 1))
    if len(json.dumps(payload).encode()) > 128 * 1024:
        raise ValueError("PS5 search response exceeded 128 KiB")
    return payload


def handle(message):
    method = message.get("method")
    request_id = message.get("id")
    if method == "notifications/initialized":
        return
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": request_id,
              "result": {"protocolVersion": message.get("params", {}).get("protocolVersion", "2024-11-05"),
                         "capabilities": {"tools": {}},
                         "serverInfo": {"name": "prosperoai-librey-search", "version": "1.0.0"}}})
    elif method == "ping":
        send({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": [{
            "name": "web_search",
            "description": "Search through ProsperoAI's built-in LibreY-compatible engine on the PS5. Returns titles, snippets and source URLs.",
            "inputSchema": {"type": "object", "properties": {
                "query": {"type": "string", "minLength": 2, "maxLength": 256},
                "limit": {"type": "integer", "minimum": 3, "maximum": 5, "default": 5}},
                "required": ["query"], "additionalProperties": False}}]}})
    elif method == "tools/call":
        try:
            params = message.get("params", {})
            if params.get("name") != "web_search":
                raise ValueError("Unknown tool")
            result = call_search(params.get("arguments", {}))
            send({"jsonrpc": "2.0", "id": request_id,
                  "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                             "structuredContent": result, "isError": False}})
        except (ValueError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            send({"jsonrpc": "2.0", "id": request_id,
                  "result": {"content": [{"type": "text", "text": str(error)}], "isError": True}})
    elif request_id is not None:
        send({"jsonrpc": "2.0", "id": request_id,
              "error": {"code": -32601, "message": "Method not found"}})


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if isinstance(message, dict):
                handle(message)
        except json.JSONDecodeError:
            send({"jsonrpc": "2.0", "id": None,
                  "error": {"code": -32700, "message": "Parse error"}})


if __name__ == "__main__":
    main()
