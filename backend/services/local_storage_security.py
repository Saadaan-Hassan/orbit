"""Best-effort restrictive permissions for Orbit's local, non-encrypted data."""

from __future__ import annotations

from pathlib import Path

DIRECTORY_MODE = 0o700
FILE_MODE = 0o600


def _chmod_if_safe(path: Path, mode: int) -> None:
    """Never follow a symlink while repairing permissions."""
    try:
        if path.is_symlink():
            return
        path.chmod(mode)
    except OSError:
        # Permissions are defence in depth. Capture must not crash merely
        # because an external volume or unusual test filesystem rejects chmod.
        return


def secure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _chmod_if_safe(path, DIRECTORY_MODE)


def secure_file(path: Path) -> None:
    if path.exists() and not path.is_dir():
        _chmod_if_safe(path, FILE_MODE)


def secure_directory_tree(path: Path) -> None:
    """Applies owner-only modes to a local storage directory and its contents."""
    secure_directory(path)
    for child in path.rglob("*"):
        if child.is_symlink():
            continue
        _chmod_if_safe(child, DIRECTORY_MODE if child.is_dir() else FILE_MODE)


def repair_orbit_storage(database_path: str, qdrant_path: str | None = None) -> None:
    """Creates/repairs data roots, SQLite sidecars, and existing Qdrant files."""
    database = Path(database_path).expanduser()
    secure_directory(database.parent)
    secure_file(database)
    secure_file(database.with_name(f"{database.name}-wal"))
    secure_file(database.with_name(f"{database.name}-shm"))

    if qdrant_path:
        secure_directory_tree(Path(qdrant_path).expanduser())
