"""Hermes middleware for Sabi's native OpenAI-compatible routing path.

Hermes sends the selected ``sabi-code`` alias to the local Sabi proxy. Sabi owns
per-request model, effort and provider scheduling; this middleware supplies only
safe session/turn attribution. Hermes still owns execution, retries, streaming,
cancellation and permissions.
"""

import os
import re
from collections.abc import Mapping
from urllib.parse import urlsplit


_ALIAS = "sabi-code"
_DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1"
_OWNED_HEADERS = frozenset({"x-sabi-client", "x-sabi-session", "x-sabi-turn"})
_OPAQUE_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")


def _local_base_url(value):
    """Accept only an explicit loopback Chat API base, without URL credentials."""
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if (
            url.scheme != "http"
            or url.hostname not in {"127.0.0.1", "::1"}
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
            or url.path.rstrip("/") != "/v1"
            or url.port is None
        ):
            return None
    except ValueError:
        return None
    return value.rstrip("/")


def _opaque_id(value):
    return value if isinstance(value, str) and _OPAQUE_ID.fullmatch(value) else None


def on_llm_request(**event):
    """Return full provider kwargs, changing only Sabi-owned attribution headers.

    Omit absent/unsafe event IDs. Never derive identity from prompt content or
    retain an old Sabi header. Headers are attribution, not an authorization gate.
    """
    request = event.get("request")
    if (
        event.get("middleware_schema_version") != "hermes.middleware.v1"
        or event.get("api_mode") != "chat_completions"
        or not isinstance(request, dict)
        or request.get("model") != _ALIAS
    ):
        return None

    expected = _local_base_url(os.environ.get("SABI_HERMES_BASE_URL", _DEFAULT_BASE_URL))
    if expected is None or _local_base_url(event.get("base_url")) != expected:
        return None

    existing = request.get("extra_headers")
    if existing is not None and not isinstance(existing, Mapping):
        return None
    if existing is not None and any(not isinstance(key, str) for key in existing):
        return None

    # Hermes expects replacement, not a patch. Shallow-copy only containers we
    # modify: unknown kwargs, tool arguments, SDK objects, and callbacks survive.
    updated = dict(request)
    headers = {
        key: value for key, value in (existing or {}).items()
        if key.lower() not in _OWNED_HEADERS
    }
    headers["X-Sabi-Client"] = "hermes"
    for field, header in (("session_id", "X-Sabi-Session"), ("turn_id", "X-Sabi-Turn")):
        value = _opaque_id(event.get(field))
        if value is not None:
            headers[header] = value
    updated["extra_headers"] = headers
    return {"request": updated, "source": "sabi-metadata", "reason": "opaque host attribution"}


def register(ctx):
    ctx.register_middleware("llm_request", on_llm_request)
