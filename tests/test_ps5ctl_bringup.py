"""`ps5ctl.py bringup` against a stub P5 Manager: no console and no Remote Play.

The tool's whole job is to turn one command into "console awake, loader up, FTP up,
ProsperoAI's own services back". Everything it does on the way is an HTTP call to
P5 Manager and a TCP connect, so both are stubbed here: the stub answers the
Autoload API, and the ports the tool waits for are real listening sockets bound to
ephemeral numbers the environment points it at.
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ps5_config", ROOT / "tools/ps5_config.py")
CONFIG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONFIG)

TEMPLATE_ID = "wake-userguide-jailbreak-autoload"
TEMPLATE = {
    "name": "PS5: Wake → Guide loader → kstuff → ShadowMount → zftpd",
    "console_type": "ps5",
    "store": {"id": TEMPLATE_ID, "author": "P5 Manager", "version": 1},
    "steps": [
        {"type": "wol", "name": "Wake the console over Remote Play"},
        {"type": "input_script", "scriptId": "builtin:open-user-guide", "builtin": True},
        {"type": "check_port", "port": 9021, "waitSeconds": 90},
        {"type": "payload", "payloadName": "kstuff.elf"},
    ],
}


class ManagerStub:
    """The slice of the P5 Manager API that `bringup` uses."""

    def __init__(self, profiles=None, templates=None, outcome="completed", error=None):
        self.profiles = profiles if profiles is not None else [
            {"id": 7, "name": "PS5", "ip_address": "127.0.0.1", "console_type": "ps5"},
            {"id": 8, "name": "Other", "ip_address": "10.0.0.9", "console_type": "ps5"},
        ]
        self.templates = TEMPLATE if templates is None else templates
        self.outcome = outcome
        self.error = error
        self.sequences = []
        self.calls = []
        self.runs = {}
        self.cancelled = []
        handler = self._handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def created(self):
        return [call for call in self.calls if call == ("POST", "/api/sequences")]

    def _handler(stub):
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def _send(self, status, payload):
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                stub.calls.append(("GET", self.path))
                if self.path == "/api/profiles":
                    return self._send(200, stub.profiles)
                if self.path == "/api/sequences":
                    return self._send(200, stub.sequences)
                if self.path == "/api/sequences/templates/list":
                    return self._send(200, [stub.templates] if stub.templates else [])
                if self.path.startswith("/api/sequences/runs/"):
                    run = stub.runs.get(self.path.rsplit("/", 1)[1])
                    if run is None:
                        return self._send(404, {"error": "Run not found"})
                    return self._send(200, run)
                return self._send(404, {"error": f"no stub route {self.path}"})

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                stub.calls.append(("POST", self.path))
                if self.path == "/api/sequences":
                    sequence = {
                        "id": 42,
                        "name": body["name"],
                        "profile_id": body.get("profileId"),
                        "steps": json.dumps(body["steps"]),
                        "auto_trigger": body.get("autoTrigger"),
                    }
                    stub.sequences.append(sequence)
                    return self._send(200, {"success": True, "id": sequence["id"]})
                if self.path.endswith("/cancel"):
                    stub.cancelled.append(self.path.split("/")[-2])
                    return self._send(200, {"success": True})
                if self.path.endswith("/run"):
                    stub.runs["r1"] = {
                        "id": "r1",
                        "status": stub.outcome,
                        "total": len(TEMPLATE["steps"]),
                        "current_step": 0,
                        "current_step_name": "Wake the console over Remote Play",
                        "error": stub.error,
                        "log": "[00:00:00.000] Sequence starting\n"
                               "[00:00:01.000] Step 1/4: Wake the console over Remote Play\n",
                    }
                    return self._send(200, {"success": True, "run_id": "r1"})
                return self._send(404, {"error": f"no stub route {self.path}"})

        return Handler


class BringUpTests(unittest.TestCase):
    def setUp(self):
        directory = ROOT / "build/tests"
        directory.mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(prefix="ps5ctl-bringup-", dir=directory)
        self.config = Path(self.scratch.name) / "local.env"
        self.listeners = contextlib.ExitStack()
        self.addCleanup(self.listeners.close)
        self.addCleanup(self.scratch.cleanup)

    def listen(self):
        """One listening socket, as a port the tool can find open."""
        sock = self.listeners.enter_context(socket.socket())
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(8)
        return sock.getsockname()[1]

    def run_bringup(self, manager=None, *arguments, ports=True, **lines):
        env = dict(os.environ)
        for key in CONFIG.KEYS:
            env.pop(key, None)
        env["PS5_ENV_FILE"] = str(self.config)
        settings = {"PS5_HOST": "127.0.0.1"}
        if manager is not None:
            settings["P5_MANAGER"] = manager.url
        # Every port the tool waits for is bound here, or left closed on purpose.
        for key in ("PS5_PAYLOAD_PORT", "PS5_FTP_PORT", "PS5_AGENT_PORT",
                    "PS5_KLOG_PORT", "PS5_SHSRV_PORT"):
            settings[key] = str(self.listen() if ports else self.closed_port())
        settings.update(lines)
        self.config.write_text("".join(f"{k}={v}\n" for k, v in settings.items()))
        return subprocess.run(
            ["python3", str(ROOT / "tools/ps5ctl.py"), "bringup", *arguments],
            env=env, text=True, capture_output=True, timeout=120)

    def closed_port(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def test_optional_manager_must_be_configured_before_anything_is_woken(self):
        run = self.run_bringup(None)
        self.assertEqual(run.returncode, 2)
        self.assertIn("P5_MANAGER", run.stderr)

    def test_an_unpaired_address_is_named_rather_than_guessed(self):
        stub = ManagerStub(profiles=[{"id": 8, "name": "Other", "ip_address": "10.0.0.9"}])
        self.addCleanup(stub.close)
        run = self.run_bringup(stub)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("127.0.0.1", run.stderr)
        self.assertIn("Remote Play", run.stderr)
        self.assertEqual(stub.created(), [])

    def test_the_sequence_is_built_from_the_template_once_and_then_reused(self):
        stub = ManagerStub()
        self.addCleanup(stub.close)
        first = self.run_bringup(stub, "--skip-services")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(len(stub.created()), 1)
        self.assertEqual(stub.sequences[0]["profile_id"], 7)
        # A watcher that steers the console on its own is not what a command asked for.
        self.assertIsNone(stub.sequences[0]["auto_trigger"])
        self.assertEqual(json.loads(stub.sequences[0]["steps"])[0]["type"], "wol")
        second = self.run_bringup(stub, "--skip-services")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(len(stub.created()), 1)

    def test_a_console_without_the_wake_template_says_which_one_is_missing(self):
        stub = ManagerStub(templates={})
        self.addCleanup(stub.close)
        run = self.run_bringup(stub)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn(TEMPLATE_ID, run.stderr)
        self.assertEqual(stub.created(), [])

    def test_the_run_log_is_printed_and_the_ports_are_proved_open(self):
        stub = ManagerStub()
        self.addCleanup(stub.close)
        run = self.run_bringup(stub, "--skip-services")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("Step 1/4: Wake the console over Remote Play", run.stdout)
        self.assertIn("payload loader", run.stdout)
        self.assertIn("ftp", run.stdout)

    def test_a_failed_run_is_not_reported_as_a_ready_console(self):
        stub = ManagerStub(outcome="failed", error="guide did not open")
        self.addCleanup(stub.close)
        run = self.run_bringup(stub, "--skip-services")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("failed", run.stderr)
        self.assertIn("guide did not open", run.stderr)

    def test_a_cancelled_run_is_a_failure_too(self):
        stub = ManagerStub(outcome="cancelled")
        self.addCleanup(stub.close)
        run = self.run_bringup(stub, "--skip-services")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("cancelled", run.stderr)

    def test_a_closed_port_after_a_completed_run_fails_instead_of_claiming_success(self):
        stub = ManagerStub()
        self.addCleanup(stub.close)
        run = self.run_bringup(stub, "--skip-services", "--port-timeout", "1", ports=False)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("did not become available", run.stderr)

    def test_the_services_prosperoai_needs_are_restored_after_the_chain(self):
        stub = ManagerStub()
        self.addCleanup(stub.close)
        run = self.run_bringup(stub)
        self.assertEqual(run.returncode, 0, run.stderr)
        # service restore skips a service whose port already answers, so the bound
        # sockets above are enough to show that it ran without sending a payload.
        for name in ("ftp", "agent", "klog", "shell"):
            self.assertIn(f"{name}: port", run.stdout)
        self.assertNotIn("restoring from", run.stdout)

    def test_a_run_that_never_ends_is_cancelled_rather_than_waited_on_forever(self):
        stub = ManagerStub(outcome="running")
        self.addCleanup(stub.close)
        run = self.run_bringup(stub, "--skip-services", "--timeout", "2")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("did not finish", run.stderr)
        self.assertEqual(stub.cancelled, ["r1"])


if __name__ == "__main__":
    unittest.main()
