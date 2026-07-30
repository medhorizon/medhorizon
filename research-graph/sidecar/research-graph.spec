# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Research Graph sidecar.
# Built from research-graph/sidecar with: pyinstaller research-graph.spec
# SPECPATH is the directory containing this .spec file (= research-graph/sidecar).

from pathlib import Path

root = Path(SPECPATH).resolve().parent
ui = root / "ui"
backend = root / "backend"

datas = []
if ui.is_dir():
    datas.append((str(ui), "ui"))
datas.append((str(backend), "backend"))

hidden = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "backend.main",
    "backend.config",
    "backend.db.sqlite",
    "backend.routers",
    "backend.services",
    "pydantic",
    "pydantic_settings",
]

a = Analysis(
    [str(root / "sidecar" / "entry.py")],
    pathex=[str(root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pandas"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="research-graph",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
