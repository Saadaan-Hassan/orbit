"""Canonical exclusion policy shared through SQLite by every capture path."""

from __future__ import annotations

import os
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

# This is the only default-exclusion definition. database.py writes these
# canonical values into SQLite; Rust and FastAPI only consume that shared data.
DEFAULT_EXCLUDED_APPS: tuple[str, ...] = (
    "Orbit",
    "1Password",
    "Bitwarden",
    "Keychain Access",
    "LastPass",
    "Dashlane",
    "System Preferences",
    "System Settings",
)

DEFAULT_EXCLUDED_DOMAINS: tuple[str, ...] = (
    "mail.google.com",
    "accounts.google.com",
)


def normalize_app_name(value: str) -> str:
    """Returns a stable case-insensitive app identity for capture comparisons."""
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.split()).lower()


def normalize_domain(value: str) -> str | None:
    """Canonicalizes a hostname and deliberately treats `www.` as equivalent."""
    candidate = value.strip()
    if not candidate:
        return None

    parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}")
    hostname = parsed.hostname
    if not hostname:
        return None

    hostname = hostname.rstrip(".").casefold()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if not hostname or any(character.isspace() for character in hostname):
        return None

    try:
        return hostname.encode("idna").decode("ascii").lower()
    except UnicodeError:
        return None


def domain_is_excluded(hostname_or_url: str, excluded_domains: set[str]) -> bool:
    """Matches an excluded domain and its DNS subdomains, never string suffixes."""
    hostname = normalize_domain(hostname_or_url)
    if hostname is None:
        return False
    return any(
        hostname == excluded_domain or hostname.endswith(f".{excluded_domain}")
        for excluded_domain in excluded_domains
    )


def normalize_folder_path(value: str) -> str | None:
    """Returns a canonical absolute path without requiring it to exist yet."""
    candidate = value.strip()
    if not candidate:
        return None
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        return None
    # Do not resolve symlinks: a file watch event can be a deletion, and both
    # native and Python capture must compare the same lexical path boundaries.
    return os.path.normpath(str(path))


def path_is_within_watched_folder(file_path: str, watched_folders: tuple[str, ...]) -> bool:
    """Prevents paths outside explicitly watched roots from being captured."""
    normalized_file = normalize_folder_path(file_path)
    if normalized_file is None:
        return False
    file = Path(normalized_file)
    for folder in watched_folders:
        try:
            file.relative_to(Path(folder))
            return True
        except ValueError:
            continue
    return False
