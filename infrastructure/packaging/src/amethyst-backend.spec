# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
root_dir = os.path.abspath(os.path.join(SPECPATH, '..'))

datas = [
    (os.path.join(root_dir, 'backend'), 'backend'),
]

frontend_dist = os.path.join(root_dir, 'frontend', 'dist')
if os.path.exists(frontend_dist):
    datas.append((frontend_dist, os.path.join('frontend', 'dist')))

hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'starlette',
    'anyio',
    'pydantic',
    'sqlite_vec',
    'dotenv',
    'httpx',
    'aiosqlite',
    'yt_dlp',
    'yt_dlp.extractor',
    'yt_dlp.extractor.instagram',
]
hiddenimports += collect_submodules('backend')
try:
    hiddenimports += collect_submodules('yt_dlp')
except Exception:
    pass

a = Analysis(
    ['freeze_entry.py'],
    pathex=[root_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'scipy'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='amethyst-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
