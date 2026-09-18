"""Synthetic request contracts. Run with a project interpreter, not a live client."""

import copy
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "sabi_metadata", Path(__file__).resolve().parents[1] / "plugin" / "__init__.py"
)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.request = {
            "model": "sabi-code",
            "messages": [
                {"role": "user", "content": "synthetic request"},
                {"role": "assistant", "tool_calls": [{
                    "id": "call-opaque", "type": "function",
                    "function": {"name": "read_file", "arguments": '{"path":"a b.txt"}'},
                }]},
                {"role": "tool", "tool_call_id": "call-opaque", "content": "synthetic result"},
            ],
            "tools": [{"type": "function", "function": {
                "name": "read_file", "parameters": {"type": "object", "properties": {}}
            }}],
            "stream": True,
            "stream_options": {"include_usage": True},
            "parallel_tool_calls": True,
            "reasoning_effort": "low",
            "extra_body": {"vendor_specific": {"keep": True}},
            "extra_headers": {"Vendor-Flag": "keep", "x-sabi-session": "stale"},
        }
        self.event = {
            "middleware_schema_version": "hermes.middleware.v1",
            "api_mode": "chat_completions",
            "base_url": "http://127.0.0.1:8787/v1",
            "session_id": "session-opaque",
            "turn_id": "session-opaque:task-1:turn-1",
            "api_request_id": "session-opaque:task-1:turn-1:api:2",
            "request": self.request,
        }

    def test_complete_replacement_preserves_all_other_kwargs_and_inputs(self):
        before = copy.deepcopy(self.request)
        result = bridge.on_llm_request(**self.event)["request"]
        self.assertIsNot(result, self.request)
        self.assertEqual(self.request, before)
        self.assertEqual(set(result), set(self.request))
        for key, value in self.request.items():
            if key != "extra_headers":
                self.assertIs(result[key], value)
        self.assertEqual(result["extra_headers"], {
            "Vendor-Flag": "keep", "X-Sabi-Client": "hermes",
            "X-Sabi-Session": "session-opaque", "X-Sabi-Turn": "session-opaque:task-1:turn-1",
        })

    def test_preserves_noncopyable_provider_objects(self):
        class ProviderObject:
            def __deepcopy__(self, memo):
                raise AssertionError("Do not clone an SDK object")
        self.request["unknown_provider_kwarg"] = ProviderObject()
        result = bridge.on_llm_request(**self.event)["request"]
        self.assertIs(result["unknown_provider_kwarg"], self.request["unknown_provider_kwarg"])

    def test_only_registers_request_middleware(self):
        calls = []
        class Context:
            def register_middleware(self, kind, callback):
                calls.append((kind, callback))
        bridge.register(Context())
        self.assertEqual(calls, [("llm_request", bridge.on_llm_request)])

    def test_ignores_other_models_protocols_and_schemas(self):
        for field, value in (("api_mode", "codex_responses"), ("api_mode", "anthropic_messages"),
                             ("middleware_schema_version", "future"),
                             ("middleware_schema_version", None), ("request", None)):
            with self.subTest(field=field, value=value):
                self.assertIsNone(bridge.on_llm_request(**{**self.event, field: value}))
        self.request["model"] = "operator-pinned-model"
        self.assertIsNone(bridge.on_llm_request(**self.event))

    def test_requires_exact_loopback_endpoint_even_if_alias_matches(self):
        for url in (None, "https://upstream.example/v1", "http://127.0.0.1:8788/v1",
                    "http://localhost:8787/v1", "http://127.0.0.1:8787/v1?token=x",
                    "http://user:secret@127.0.0.1:8787/v1", "http://127.0.0.1:bad/v1",
                    "http://127.0.0.1:8787/v1#fragment", "http://127.0.0.1/v1"):
            with self.subTest(url=url):
                self.assertIsNone(bridge.on_llm_request(**{**self.event, "base_url": url}))
        self.assertIsNotNone(bridge.on_llm_request(**{**self.event, "base_url": self.event["base_url"] + "/"}))

    def test_explicit_loopback_port_override(self):
        os.environ["SABI_HERMES_BASE_URL"] = "http://127.0.0.1:9876/v1"
        self.event["base_url"] = os.environ["SABI_HERMES_BASE_URL"]
        self.assertIsNotNone(bridge.on_llm_request(**self.event))
        for url in ("https://upstream.example/v1", "http://0.0.0.0:9876/v1", ""):
            os.environ["SABI_HERMES_BASE_URL"] = url
            self.event["base_url"] = url
            self.assertIsNone(bridge.on_llm_request(**self.event))

    def test_missing_or_unsafe_ids_are_omitted_not_synthesized(self):
        for value in (None, "", 12, "contains spaces", "line\r\nInjected: header", "é", "a" * 129):
            with self.subTest(value=value):
                event = {**self.event, "session_id": value, "turn_id": value}
                result = bridge.on_llm_request(**event)["request"]
                self.assertEqual(result["extra_headers"], {"Vendor-Flag": "keep", "X-Sabi-Client": "hermes"})

    def test_id_length_boundaries(self):
        result = bridge.on_llm_request(**{**self.event, "session_id": "s", "turn_id": "t" * 128})["request"]
        self.assertEqual(result["extra_headers"]["X-Sabi-Session"], "s")
        self.assertEqual(result["extra_headers"]["X-Sabi-Turn"], "t" * 128)

    def test_all_case_variants_of_owned_headers_are_replaced(self):
        self.request["extra_headers"].update({"X-SABI-CLIENT": "other", "x-Sabi-turn": "stale"})
        result = bridge.on_llm_request(**self.event)["request"]
        for name in ("client", "session", "turn"):
            self.assertEqual(sum(key.lower() == "x-sabi-" + name for key in result["extra_headers"]), 1)

    def test_none_or_missing_headers_and_nonstream_requests(self):
        self.request.pop("extra_headers")
        self.request["stream"] = False
        self.assertFalse(bridge.on_llm_request(**self.event)["request"]["stream"])
        self.request["extra_headers"] = None
        self.assertIsNotNone(bridge.on_llm_request(**self.event))

    def test_malformed_headers_leave_request_untouched(self):
        for headers in ("invalid", [("a", "b")], {12: "not-a-header-name"}):
            self.request["extra_headers"] = headers
            self.assertIsNone(bridge.on_llm_request(**self.event))

    def test_repeated_calls_are_stateless(self):
        first = bridge.on_llm_request(**self.event)["request"]
        second = bridge.on_llm_request(**{**self.event, "session_id": "other-session", "turn_id": "other-turn"})["request"]
        self.assertEqual(first["extra_headers"]["X-Sabi-Session"], "session-opaque")
        self.assertEqual(second["extra_headers"]["X-Sabi-Session"], "other-session")
        self.assertEqual(second["extra_headers"]["X-Sabi-Turn"], "other-turn")
        self.assertEqual(bridge.on_llm_request(**{**self.event, "request": first})["request"], first)


if __name__ == "__main__":
    unittest.main()
