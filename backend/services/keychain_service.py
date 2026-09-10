"""macOS Keychain storage for user-owned provider credentials.

The `security` command receives a new password through stdin (`-w` as its
last argument), never through a command-line argument. Errors intentionally
discard stderr/stdout so a key or provider response can never reach logs.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys

KEYCHAIN_SERVICE = "com.heyorbit.orbit"
GROQ_KEYCHAIN_ACCOUNT = "groq-api-key"
_SECURITY_BINARY = "/usr/bin/security"


class KeychainUnavailableError(RuntimeError):
    """The Keychain could not safely store or read a credential."""


class KeychainItemNotFoundError(KeychainUnavailableError):
    """The requested credential does not exist in the selected Keychain."""

def _require_macos() -> None:
    if sys.platform != "darwin":
        raise KeychainUnavailableError("macOS Keychain is unavailable")


def _run_security(arguments: list[str], *, secret_input: str | None = None) -> subprocess.CompletedProcess[str]:
    _require_macos()
    try:
        result = subprocess.run(
            [_SECURITY_BINARY, *arguments],
            input=secret_input,
            text=True,
            capture_output=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise KeychainUnavailableError("Keychain command failed") from error
    if result.returncode == 44:  # errSecItemNotFound
        raise KeychainItemNotFoundError("Keychain credential was not found")
    if result.returncode != 0:
        raise KeychainUnavailableError("Keychain command was rejected")
    return result


def _store_groq_api_key_sync(api_key: str) -> None:
    _run_security(
        [
            "add-generic-password",
            "-a",
            GROQ_KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-U",
            "-w",
        ],
        secret_input=f"{api_key}\n",
    )


def _get_groq_api_key_sync() -> str | None:
    try:
        result = _run_security(
            [
                "find-generic-password",
                "-a",
                GROQ_KEYCHAIN_ACCOUNT,
                "-s",
                KEYCHAIN_SERVICE,
                "-w",
            ]
        )
    except (KeychainItemNotFoundError, KeychainUnavailableError):
        return None
    value = result.stdout.strip()
    return value or None


def _has_groq_api_key_sync() -> bool:
    try:
        # Deliberately omit -w: Keychain returns metadata/status, not the key.
        _run_security(
            [
                "find-generic-password",
                "-a",
                GROQ_KEYCHAIN_ACCOUNT,
                "-s",
                KEYCHAIN_SERVICE,
            ]
        )
        return True
    except KeychainItemNotFoundError:
        return False


def _delete_groq_api_key_sync() -> None:
    try:
        _run_security(
            [
                "delete-generic-password",
                "-a",
                GROQ_KEYCHAIN_ACCOUNT,
                "-s",
                KEYCHAIN_SERVICE,
            ]
        )
    except KeychainItemNotFoundError:
        return


async def store_groq_api_key(api_key: str) -> None:
    await asyncio.to_thread(_store_groq_api_key_sync, api_key)


async def get_groq_api_key() -> str | None:
    return await asyncio.to_thread(_get_groq_api_key_sync)


async def has_groq_api_key() -> bool:
    return await asyncio.to_thread(_has_groq_api_key_sync)


async def delete_groq_api_key() -> None:
    await asyncio.to_thread(_delete_groq_api_key_sync)
