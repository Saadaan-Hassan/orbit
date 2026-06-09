"""
Orbit backend sidecar entry point.

When built with PyInstaller (--onefile), this file becomes the self-contained
orbit-backend binary that Tauri spawns in production. uvicorn.run() is called
directly so no external Python interpreter or uv installation is required on
the user's Mac.

In development, this file is never used — Tauri spawns `uv run uvicorn` instead.
"""
import sys
import os

# PyInstaller unpacks bundled modules to sys._MEIPASS at runtime.
# Insert it at the front of sys.path so backend modules (main.py, routes/,
# services/, etc.) resolve correctly when running as a frozen binary.
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    sys.path.insert(0, sys._MEIPASS)

import uvicorn  # noqa: E402 — must come after sys.path fix

if __name__ == "__main__":
    # host is bound to loopback only — the sidecar is never reachable from
    # the network, only from the Tauri app on the same machine.
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=47821,
        log_level="warning",
        access_log=False,
    )
