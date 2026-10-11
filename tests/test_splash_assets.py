def test_splash_screen_structure():
    from pathlib import Path

    splash_html = Path("electron/splash.html")
    assert splash_html.exists()
    content = splash_html.read_text()
    assert 'class="splash-card"' in content
    assert 'id="splash-status"' in content
    assert 'id="splash-close"' in content
    assert 'id="splash-retry"' in content
    assert "Opening your workspace..." in content

    splash_css = Path("electron/splash.css")
    assert splash_css.exists()
    css_content = splash_css.read_text()
    assert "--gem-glow" in css_content or "box-shadow" in css_content
