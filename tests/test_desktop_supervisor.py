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


def test_supervisor_fail_fast_and_tray_handling():
    from pathlib import Path

    main_cjs = Path("electron/main.cjs").read_text()
    assert "backendProcess.on('exit'" in main_cjs
    assert "backend.log" in main_cjs
    assert "tray.enabled" in main_cjs or "trayEnabled" in main_cjs
    assert "desktop:set-tray-enabled" in main_cjs
    assert "desktop:open-logs" in main_cjs

    splash_html = Path("electron/splash.html").read_text()
    assert "splash-log-snippet" in splash_html
    assert "splash-open-logs" in splash_html

    preload_cjs = Path("electron/preload.cjs").read_text()
    assert "setTrayEnabled" in preload_cjs
    assert "openLogs" in preload_cjs

