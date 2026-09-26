# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Orbit backend sidecar.

Build from the backend/ directory:
    uv run pyinstaller orbit-backend.spec --noconfirm

The output binary is backend/dist/orbit-backend.
CI renames it to orbit-backend-{target-triple} for Tauri's externalBin lookup.

Using a .spec file (rather than bare CLI flags) gives reproducible,
version-controlled builds — the recommended production approach.
"""

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all uvicorn submodules — uvicorn uses string-based dynamic imports
# for its loop and protocol backends that PyInstaller won't detect statically.
uvicorn_hidden = collect_submodules("uvicorn")

# qdrant_client uses dynamic imports for its REST and gRPC backends.
qdrant_hidden = collect_submodules("qdrant_client")

# Collect data files that packages need at runtime (e.g. JSON schemas, certs).
qdrant_datas = collect_data_files("qdrant_client")
httpx_datas = collect_data_files("httpx")
certifi_datas = collect_data_files("certifi")

a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=[],
    datas=[
        *qdrant_datas,
        *httpx_datas,
        *certifi_datas,
    ],
    hiddenimports=[
        *uvicorn_hidden,
        *qdrant_hidden,
        # anyio: asyncio backend is selected dynamically at runtime
        "anyio._backends._asyncio",
        "anyio._backends._trio",
        # SQLAlchemy registers dialects via entry points — list explicitly
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.sqlite.aiosqlite",
        # aiosqlite registers itself as a SQLAlchemy dialect at import time
        "aiosqlite",
        # standard-library modules used transitively by httpx / email clients
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Strip out heavy dev-only packages to keep the binary lean
        "pytest",
        "black",
        "ruff",
        "mypy",
        "IPython",
        "jupyter",
        "matplotlib",
        "numpy",
        "pandas",
        "torch",
        "tensorflow",
    ],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="orbit-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX compression can trigger macOS Gatekeeper false-positives — skip it.
    upx=False,
    # console=True keeps stderr/stdout available for Tauri to capture via the
    # shell plugin's event stream (useful for crash diagnosis).
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    # target_arch=None inherits the build machine's architecture.
    # On the CI runner (macos-latest / Apple Silicon) this produces aarch64.
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
