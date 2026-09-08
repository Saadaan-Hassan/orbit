"""Authentication and browser-boundary protections for Orbit's loopback API.

The loopback address is a network boundary, not an identity boundary. This
module is deliberately applied to the whole FastAPI app so a newly registered
route is secure by default.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import os
from dataclasses import dataclass
from typing import Final

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

SESSION_TOKEN_ENV: Final = "ORBIT_LOCAL_API_SESSION_TOKEN"
PRODUCTION_ENVIRONMENTS: Final = frozenset({"production", "prod"})
TAURI_WEBVIEW_ORIGIN: Final = "tauri://localhost"
LOOPBACK_HOSTS: Final = frozenset({"127.0.0.1:47821", "localhost:47821"})
ALLOWED_CORS_METHODS: Final = frozenset({"DELETE", "GET", "POST"})
ALLOWED_CORS_HEADERS: Final = frozenset({"authorization", "content-type"})
MAX_REQUEST_BODY_BYTES: Final = 1_048_576


def _is_valid_session_token(value: str) -> bool:
    """Require the 256-bit base64url token format defined by ADR-001."""
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, binascii.Error):
        return False
    return len(decoded) >= 32


@dataclass(frozen=True)
class LocalApiSecurityConfig:
    """Process-local security configuration, supplied by the Tauri parent."""

    session_token: str | None
    allowed_origins: frozenset[str] = frozenset({TAURI_WEBVIEW_ORIGIN})
    allowed_hosts: frozenset[str] = LOOPBACK_HOSTS

    @classmethod
    def from_environment(cls) -> "LocalApiSecurityConfig":
        token = os.getenv(SESSION_TOKEN_ENV, "")
        environment = os.getenv("APP_ENVIRONMENT", "development").strip().lower()

        if environment in PRODUCTION_ENVIRONMENTS and not _is_valid_session_token(token):
            raise RuntimeError(
                f"{SESSION_TOKEN_ENV} must be a base64url token containing at least 256 bits in production."
            )

        # A development process without a token still starts for diagnostics, but
        # the middleware returns 503 for every request instead of weakening auth.
        return cls(session_token=token if _is_valid_session_token(token) else None)


class LocalApiSecurityMiddleware(BaseHTTPMiddleware):
    """Reject untrusted hosts/origins and require the app-session bearer token."""

    def __init__(self, app: ASGIApp, *, config: LocalApiSecurityConfig) -> None:
        super().__init__(app)
        self._config = config

    async def dispatch(self, request: Request, call_next) -> Response:
        host = request.headers.get("host", "").lower()
        if host not in self._config.allowed_hosts:
            return self._error(400, "Invalid Host header.")

        origin = request.headers.get("origin")
        if origin is not None and origin not in self._config.allowed_origins:
            return self._error(403, "Origin is not allowed.")

        if request.method == "OPTIONS":
            return self._handle_preflight(request, origin)

        if self._contains_credential_query_parameter(request):
            return self._error(400, "Credentials in query parameters are not accepted.")

        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                return self._error(400, "Invalid Content-Length header.")
            if declared_size < 0 or declared_size > MAX_REQUEST_BODY_BYTES:
                return self._error(413, "Request body is too large.")

        if self._config.session_token is None:
            return self._error(503, "Local API authentication is not configured.")

        provided_token = self._bearer_token(request.headers.get("authorization"))
        if provided_token is None or not hmac.compare_digest(provided_token, self._config.session_token):
            return self._error(401, "Authentication is required.")

        response = await call_next(request)
        if origin is not None:
            self._add_cors_headers(response, origin)
        return response

    def _handle_preflight(self, request: Request, origin: str | None) -> Response:
        if origin is None:
            return self._error(400, "CORS preflight requires an Origin header.")

        requested_method = request.headers.get("access-control-request-method", "").upper()
        if requested_method not in ALLOWED_CORS_METHODS:
            return self._error(405, "Requested CORS method is not allowed.")

        requested_headers = {
            header.strip().lower()
            for header in request.headers.get("access-control-request-headers", "").split(",")
            if header.strip()
        }
        if not requested_headers.issubset(ALLOWED_CORS_HEADERS):
            return self._error(400, "Requested CORS headers are not allowed.")

        response = Response(status_code=204)
        self._add_cors_headers(response, origin)
        response.headers["Access-Control-Allow-Methods"] = ", ".join(sorted(ALLOWED_CORS_METHODS))
        response.headers["Access-Control-Allow-Headers"] = ", ".join(sorted(ALLOWED_CORS_HEADERS))
        response.headers["Access-Control-Max-Age"] = "600"
        return response

    @staticmethod
    def _bearer_token(authorization: str | None) -> str | None:
        if authorization is None:
            return None
        scheme, separator, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not separator or not token or " " in token:
            return None
        return token

    @staticmethod
    def _contains_credential_query_parameter(request: Request) -> bool:
        forbidden_names = {"access_token", "api_key", "authorization", "token"}
        return any(name.lower() in forbidden_names for name in request.query_params)

    @staticmethod
    def _add_cors_headers(response: Response, origin: str) -> None:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"

    @staticmethod
    def _error(status_code: int, detail: str) -> JSONResponse:
        # Never include request headers, tokens, or request body in this response.
        return JSONResponse(status_code=status_code, content={"detail": detail})
