"""Regression tests for the universal loopback API guard."""

import secrets
import unittest
import importlib
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.routing import APIRoute

from local_api_security import (
    LocalApiSecurityConfig,
    LocalApiSecurityMiddleware,
    PairingCodeRegistry,
    DEVELOPMENT_WEBVIEW_ORIGIN,
    SESSION_TOKEN_ENV,
    TAURI_WEBVIEW_ORIGIN,
)


def _client() -> tuple[TestClient, str]:
    token = secrets.token_urlsafe(32)
    app = FastAPI()
    app.add_middleware(
        LocalApiSecurityMiddleware,
        config=LocalApiSecurityConfig(session_token=token),
    )

    @app.get("/sensitive")
    async def sensitive_route() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app, base_url="http://127.0.0.1:47821"), token


class LocalApiSecurityTests(unittest.TestCase):
    def test_pairing_codes_are_one_use_and_fail_closed_after_bad_attempts(self) -> None:
        registry = PairingCodeRegistry()
        code = registry.issue()
        self.assertTrue(registry.consume(code))
        self.assertFalse(registry.consume(code))

        code = registry.issue()
        for _ in range(5):
            self.assertFalse(registry.consume("incorrect-pairing-code"))
        self.assertFalse(registry.consume(code))
    def test_production_requires_a_valid_session_token(self) -> None:
        with patch.dict("os.environ", {"APP_ENVIRONMENT": "production"}, clear=True):
            with self.assertRaises(RuntimeError):
                LocalApiSecurityConfig.from_environment()

        with patch.dict(
            "os.environ",
            {"APP_ENVIRONMENT": "production", SESSION_TOKEN_ENV: secrets.token_urlsafe(32)},
            clear=True,
        ):
            config = LocalApiSecurityConfig.from_environment()
            self.assertIsNotNone(config.session_token)
            self.assertNotIn(DEVELOPMENT_WEBVIEW_ORIGIN, config.allowed_origins)

        with patch.dict("os.environ", {SESSION_TOKEN_ENV: secrets.token_urlsafe(32)}, clear=True):
            self.assertIn(
                DEVELOPMENT_WEBVIEW_ORIGIN,
                LocalApiSecurityConfig.from_environment().allowed_origins,
            )

    def test_sensitive_route_requires_a_valid_bearer_token(self) -> None:
        client, token = _client()

        self.assertEqual(client.get("/sensitive").status_code, 401)
        self.assertEqual(
            client.get("/sensitive", headers={"Authorization": "Bearer incorrect"}).status_code,
            401,
        )
        self.assertEqual(
            client.get("/sensitive", headers={"Authorization": f"Bearer {token}"}).status_code,
            200,
        )
        tauri_response = client.get(
            "/sensitive",
            headers={"Authorization": f"Bearer {token}", "Origin": TAURI_WEBVIEW_ORIGIN},
        )
        self.assertEqual(tauri_response.status_code, 200)
        self.assertEqual(tauri_response.headers["access-control-allow-origin"], TAURI_WEBVIEW_ORIGIN)

    def test_unknown_origin_and_host_are_rejected(self) -> None:
        client, token = _client()
        headers = {"Authorization": f"Bearer {token}"}

        self.assertEqual(
            client.get("/sensitive", headers={**headers, "Origin": "https://attacker.example"}).status_code,
            403,
        )
        self.assertEqual(
            client.get("/sensitive", headers={**headers, "Host": "attacker.example"}).status_code,
            400,
        )

    def test_tauri_origin_preflight_is_restrictive(self) -> None:
        client, _ = _client()
        response = client.options(
            "/sensitive",
            headers={
                "Origin": TAURI_WEBVIEW_ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["access-control-allow-origin"], TAURI_WEBVIEW_ORIGIN)
        self.assertEqual(response.headers["vary"], "Origin")
        self.assertEqual(
            client.options(
                "/sensitive",
                headers={
                    "Origin": TAURI_WEBVIEW_ORIGIN,
                    "Access-Control-Request-Method": "PATCH",
                },
            ).status_code,
            405,
        )

    def test_token_query_parameters_and_oversized_requests_are_rejected(self) -> None:
        client, token = _client()
        headers = {"Authorization": f"Bearer {token}"}

        self.assertEqual(client.get("/sensitive?token=not-accepted", headers=headers).status_code, 400)
        self.assertEqual(
            client.post(
                "/sensitive",
                content=b"x" * 16,
                headers={**headers, "Content-Length": str(1_048_577)},
            ).status_code,
            413,
        )

    def test_main_app_requires_authentication_on_every_registered_route(self) -> None:
        # Importing/reloading does not run the app lifespan, so no database or
        # sidecar service starts. Every route must be rejected before its handler
        # can read data, mutate settings, call an AI provider, or delete data.
        token = secrets.token_urlsafe(32)
        with patch.dict("os.environ", {SESSION_TOKEN_ENV: token}, clear=True):
            import main

            app = importlib.reload(main).app

        middleware_types = {middleware.cls for middleware in app.user_middleware}
        self.assertIn(LocalApiSecurityMiddleware, middleware_types)

        client = TestClient(app, base_url="http://127.0.0.1:47821")
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            method = next(method for method in route.methods if method not in {"HEAD", "OPTIONS"})
            with self.subTest(method=method, path=route.path):
                self.assertEqual(client.request(method, route.path).status_code, 401)

        health_response = client.get("/health", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(health_response.status_code, 204)
        self.assertEqual(health_response.content, b"")
