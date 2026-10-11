def test_main_process_logic_and_preload():
    from pathlib import Path

    main_cjs = Path("electron/main.cjs")
    assert main_cjs.exists()
    content = main_cjs.read_text()
    assert "requestSingleInstanceLock" in content
    assert "/api/ping" in content
    assert "amethyst-backend" in content
    assert "before-quit" in content
    assert "autoUpdater" in content

    preload_cjs = Path("electron/preload.cjs")
    assert preload_cjs.exists()
    preload_content = preload_cjs.read_text()
    assert "contextBridge.exposeInMainWorld('amethystDesktop'" in preload_content
