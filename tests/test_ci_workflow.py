def test_desktop_release_workflow():
    from pathlib import Path
    import yaml

    wf_path = Path(".github/workflows/desktop-release.yml")
    assert wf_path.exists()
    wf = yaml.safe_load(wf_path.read_text())
    on_trigger = wf.get("on") or wf.get(True)
    assert "push" in on_trigger
    assert "master" in on_trigger["push"]["branches"]
    assert "matrix" in wf["jobs"]["release"]["strategy"]
    os_list = wf["jobs"]["release"]["strategy"]["matrix"]["os"]
    assert any("macos" in o for o in os_list)
    assert any("windows" in o for o in os_list)
    assert any("ubuntu" in o for o in os_list)
    assert "electron-builder --publish always" in str(wf)
