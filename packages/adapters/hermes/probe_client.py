"""Bounded native Hermes CLI probe against synthetic loopback SSE, never inference.

Run via the network-isolated command in README.md, with the pinned upstream venv.
Only selected synthetic wire facts are saved. No provider credentials are needed.
"""

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sys
from threading import Thread


PIN = "01382698fc32ec7740b6a204d9b7a6abeac74d33"
ADAPTER = Path(__file__).resolve().parent
RUNTIME = ADAPTER.parents[2] / ".sabi" / "compat" / "hermes"
OPAQUE_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")


async def command(*argv, cwd, env, timeout=45):
    process = await asyncio.create_subprocess_exec(
        *map(str, argv), cwd=cwd, env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError:
        process.kill()
        await process.communicate()
        raise AssertionError("Native command exceeded its bounded deadline") from None
    output = stdout.decode("utf-8", errors="replace")
    errors = stderr.decode("utf-8", errors="replace")
    if process.returncode:
        # These processes have a synthetic HOME/config/input and no external network.
        # Still keep diagnostics bounded; do not retain raw request bodies or headers.
        diagnostic = "\n".join((output + "\n" + errors).splitlines()[-12:])
        raise AssertionError(f"Native command exit {process.returncode}: {diagnostic}")
    return output, errors


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-netns", required=True)
    parser.add_argument("--via-sabi", action="store_true", help="Use the real Sabi server with a strict synthetic model fixture")
    args = parser.parse_args()
    assert os.readlink("/proc/self/ns/net") != args.host_netns, "Run inside an isolated network namespace"
    assert Path(os.environ["HOME"]).is_relative_to(RUNTIME), "Require isolated HOME"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run = RUNTIME / "runs" / stamp
    home, profile, workspace = (run / name for name in ("home", "profile", "workspace"))
    for directory in (home, profile, workspace):
        directory.mkdir(parents=True)
    fixture = workspace / "synthetic input.txt"
    fixture.write_text("SABI_HERMES_SYNTHETIC_TOOL_RESULT\n", encoding="utf-8")
    (profile / "plugins").mkdir()
    (profile / "plugins" / "sabi-metadata").symlink_to(ADAPTER / "plugin", target_is_directory=True)
    tool_args = json.dumps({"path": str(fixture)}, separators=(",", ":"))
    requests, failures, get_paths = [], [], []

    class Mock(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def do_GET(self):
            get_paths.append(self.path)
            body = b'{"error":{"message":"Unsupported mock endpoint"}}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_POST(self):
            try:
                assert self.path == "/v1/chat/completions", "Wrong protocol endpoint"
                size = int(self.headers["Content-Length"])
                assert 0 < size < 1_000_000, "Unexpected request size"
                body = json.loads(self.rfile.read(size))
                expected_models = {"mock-cheap", "mock-mid", "mock-strong"} if args.via_sabi else {"sabi-code"}
                assert body["model"] in expected_models, "Unexpected selected model"
                assert body.get("stream") is True, "Expected streaming"
                headers = {name: self.headers.get_all(name) for name in (
                    "X-Sabi-Client", "X-Sabi-Session", "X-Sabi-Turn"
                )}
                if args.via_sabi:
                    assert not any(name.lower().startswith("x-sabi-") for name in self.headers), "Sabi metadata leaked upstream"
                    assert self.headers.get("Authorization") is None, "Client credential leaked upstream"
                else:
                    assert headers["X-Sabi-Client"] == ["hermes"], "Missing/duplicate client header"
                    for name in ("X-Sabi-Session", "X-Sabi-Turn"):
                        assert headers[name] and len(headers[name]) == 1 and OPAQUE_ID.fullmatch(headers[name][0]), "Unsafe/missing ID"
                messages = body["messages"]
                request_number = len(requests) + 1
                assert request_number <= 3, "Unexpected retry/auxiliary call"
                record = {
                    "path": self.path, "model": body["model"], "stream": True,
                    "headers": {key: value[0] for key, value in headers.items() if value},
                    "sabi_metadata_stripped": not any(headers.values()),
                    "parameter_names": sorted(body),
                    "message_roles": [message["role"] for message in messages],
                }
                if request_number == 1:
                    assert any(tool["function"]["name"] == "read_file" for tool in body.get("tools", [])), "Missing native read_file"
                else:
                    calls = [call for message in messages for call in message.get("tool_calls", [])]
                    assert len(calls) == 1 and calls[0]["id"] == "call_sabi_opaque", "Tool call identity/count changed"
                    assert calls[0]["function"] == {"name": "read_file", "arguments": tool_args}, "Tool arguments changed"
                    results = [message for message in messages if message["role"] == "tool"]
                    assert len(results) == 1 and results[0]["tool_call_id"] == "call_sabi_opaque", "Tool result identity/count changed"
                    assert "SABI_HERMES_SYNTHETIC_TOOL_RESULT" in str(results[0]["content"]), "Native file read did not complete"
                    record["tool_call_id"] = "call_sabi_opaque"
                    record["tool_arguments_unchanged"] = True
                    record["native_read_result_seen"] = True
                requests.append(record)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()

                def emit(delta, finish_reason=None):
                    chunk = {"id": "chatcmpl-sabi-fixture", "object": "chat.completion.chunk", "created": 1,
                             "model": body["model"], "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                    self.wfile.flush()

                emit({"role": "assistant", "content": ""})
                if request_number == 1:
                    emit({"tool_calls": [{"index": 0, "id": "call_sabi_opaque", "type": "function",
                                           "function": {"name": "read_file", "arguments": tool_args[:17]}}]})
                    emit({"tool_calls": [{"index": 0, "function": {"arguments": tool_args[17:]}}]})
                    emit({}, "tool_calls")
                else:
                    emit({"content": "SABI_HERMES_"})
                    emit({"content": "NATIVE_OK" if request_number == 2 else "RESUME_OK"})
                    emit({}, "stop")
                usage = {"id": "chatcmpl-sabi-fixture", "object": "chat.completion.chunk", "created": 1,
                         "model": body["model"], "choices": [],
                         "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}
                self.wfile.write(("data: " + json.dumps(usage) + "\n\ndata: [DONE]\n\n").encode())
                self.wfile.flush()
                self.close_connection = True
            except Exception as error:
                failures.append(str(error))
                self.send_error(400, "Synthetic contract mismatch")
                self.close_connection = True

    server = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}/v1"
    config = {
        "model": {"provider": "custom:sabi", "default": "sabi-code", "base_url": base_url,
                  "api_mode": "chat_completions", "context_length": 65536},
        "providers": {"sabi": {"api": base_url, "api_key": "sabi-local-placeholder",
                               "transport": "chat_completions", "discover_models": False,
                               "capabilities": {"openai_native_compaction": False},
                               "models": {"sabi-code": {"context_length": 65536, "prompt_caching": False}}}},
        "model_overrides": {"custom:sabi": {"sabi-code": {"context_window": 65536, "supports_tools": True,
                                                       "supports_vision": False, "supports_reasoning": False}}},
        "plugins": {"enabled": ["sabi-metadata"]},
        "fallback_providers": [], "fallback_model": None, "mcp_servers": {},
        "auxiliary": {"title_generation": {"model_upgrade_enabled": False}},
        "telemetry": {"shared_metrics": {"enabled": False, "send": False}},
        "models_dev": {"url": f"http://127.0.0.1:{server.server_port}/registry"},
    }
    (profile / "config.yaml").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    env = {"HOME": str(home), "HERMES_HOME": str(profile), "PATH": "/usr/bin:/bin",
           "XDG_CONFIG_HOME": str(home / "config"), "XDG_CACHE_HOME": str(home / "cache"),
           "SABI_HERMES_BASE_URL": base_url, "PYTHONDONTWRITEBYTECODE": "1",
           "TERM": "dumb", "NO_COLOR": "1"}
    report = {"source_commit": PIN, "network_isolated": True, "production_model_facts": False,
              "via_sabi": args.via_sabi, "requests": requests, "metadata_gets": get_paths, "failures": failures}
    proxy = None
    proxy_report = run / "sabi.json"

    async def finish_proxy():
        if proxy is None:
            return
        if proxy.returncode is None:
            proxy.stdin.close()
            try:
                await asyncio.wait_for(proxy.communicate(), 10)
            except TimeoutError:
                proxy.kill()
                await proxy.communicate()
                raise AssertionError("Sabi helper exceeded shutdown deadline") from None
        assert proxy.returncode == 0, "Sabi helper failed"
        report["sabi"] = json.loads(proxy_report.read_text(encoding="utf-8"))

    try:
        if args.via_sabi:
            proxy = await asyncio.create_subprocess_exec(
                "/usr/bin/node", "--experimental-strip-types", str(ADAPTER / "probe_sabi.mjs"),
                str(server.server_port), str(proxy_report), cwd=workspace, env=env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            ready = await asyncio.wait_for(proxy.stdout.readline(), 10)
            assert ready, "Sabi helper did not start; check Node and workspace module visibility"
            base_url = f"http://127.0.0.1:{json.loads(ready)['port']}/v1"
            config["model"]["base_url"] = config["providers"]["sabi"]["api"] = base_url
            env["SABI_HERMES_BASE_URL"] = base_url
            (profile / "config.yaml").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        head, _ = await command("/usr/bin/git", "-C", RUNTIME / "upstream", "rev-parse", "HEAD", cwd=workspace, env=env)
        assert head.strip() == PIN, "Pinned checkout mismatch"
        cli = RUNTIME / "env" / "bin" / "hermes"
        version, _ = await command(cli, "--version", cwd=workspace, env=env)
        report["version"] = version.strip()
        common = [cli, "chat", "--ignore-rules", "--toolsets", "file", "--max-turns", "3",
                  "--run-budget", "25", "--format", "stream-json"]
        output, _ = await command(*common, "--query", f"Read {fixture.name} once and report the result.", cwd=workspace, env=env)
        assert "SABI_HERMES_NATIVE_OK" in output, "Missing native completion"
        assert len(requests) == 2, "Expected exactly one native tool round"
        first_events = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
        session_id = next(event["session_id"] for event in first_events if event.get("type") == "result")
        assert OPAQUE_ID.fullmatch(session_id), "Unsafe native session ID"
        resumed, _ = await command(*common, "--resume", session_id, "--query", "Reply with the resume check.", cwd=workspace, env=env)
        assert "SABI_HERMES_RESUME_OK" in resumed, "Missing resumed completion"
        assert len(requests) == 3 and not failures, "Unexpected request count/failures"
        await finish_proxy()
        identity_requests = report["sabi"]["inputs"] if args.via_sabi else requests
        assert len(identity_requests) == 3, "Unexpected client-to-proxy request count"
        assert all(item["headers"]["X-Sabi-Client"] == "hermes" for item in identity_requests), "Client attribution changed"
        assert all(item["headers"]["X-Sabi-Session"] == session_id for item in identity_requests), "Session changed on resume"
        assert identity_requests[0]["headers"]["X-Sabi-Turn"] == identity_requests[1]["headers"]["X-Sabi-Turn"], "Tool loop lost turn identity"
        assert identity_requests[2]["headers"]["X-Sabi-Turn"] != identity_requests[1]["headers"]["X-Sabi-Turn"], "Resume reused old turn"
        if args.via_sabi:
            decisions = report["sabi"]["decisions"]
            assert len(decisions) == 3 and len({row["requestId"] for row in decisions}) == 3, "Decision count/identity mismatch"
            assert all(row["alias"] == "sabi-code" and row["client"] == "hermes" and row["sessionKnown"] for row in decisions), "Sabi lost alias or attribution"
            assert all(re.fullmatch(r"[a-f0-9]{64}", row["sessionId"]) and re.fullmatch(r"[a-f0-9]{64}", row["turnId"]) for row in decisions), "Raw identity in decision evidence"
            assert len({row["sessionId"] for row in decisions}) == 1 and len({row["turnId"] for row in decisions}) == 2, "Sabi resume grouping changed"
            assert all(row["outcome"] == "ok" for row in decisions), "Sabi did not complete every request"
            assert [row["upstreamModel"] for row in decisions] == ["mock-mid", "mock-cheap", "mock-mid"], "Shared-core fixture routing changed"
            report["metadata_gets"] = report["sabi"]["metadataPaths"]
        # This Hermes build probes a local LM Studio metadata route despite
        # discover_models=False. It must tolerate the 404; do not serve a fake
        # model catalog or claim that the config disables every metadata probe.
        known_metadata_paths = {"/api/v1/models", "/api/tags", "/v1/props", "/props", "/version", "/v1/models", "/models"}
        metadata_paths = report["metadata_gets"]
        assert all(path in known_metadata_paths for path in metadata_paths), "Unexpected discovery endpoint"
        report["discovery_fully_suppressed"] = not metadata_paths
        events = [json.loads(line) for line in (output + "\n" + resumed).splitlines() if line.startswith("{")]
        counts = Counter(event.get("type", "unknown") for event in events)
        report["cli_event_counts"] = dict(counts)
        assert counts["tool_use"] == counts["tool_result"] == 1, "Unexpected tool execution count"
        report["synthetic_usage"] = [event["tokens"] for event in events if event.get("type") == "result"]
        assert len(report["synthetic_usage"]) == 2 and all(usage["input"] > 0 and usage["output"] > 0 for usage in report["synthetic_usage"]), "Usage not consumed"
        report["result"] = "passed_with_metadata_probe_limit" if metadata_paths else "passed"
    except Exception as error:
        report["result"] = "failed"
        report["error"] = str(error)
    finally:
        try:
            await finish_proxy()
        except Exception as error:
            report["result"] = "failed"
            report["proxy_error"] = str(error)
        server.shutdown()
        server.server_close()
        (run / "summary.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"result": report["result"], "summary": str(run / "summary.json")}))
    return 0 if report["result"] in {"passed", "passed_with_metadata_probe_limit"} else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
