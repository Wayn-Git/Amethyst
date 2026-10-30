import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from backend.api.main import app, BIND_HOST_ENV
from backend.config import amethyst_home
from backend.db.connection import get_connection
from backend.sync import devices
from scripts.publish_android_update import publish


@pytest.fixture
def phone(monkeypatch):
    monkeypatch.setenv(BIND_HOST_ENV, '0.0.0.0')
    devices._failures.clear()
    _, token = devices.register(get_connection(), name='Phone', role='control')
    return TestClient(app, client=('192.0.2.8', 1234), headers={'Authorization': f'Bearer {token}'})


def build(tmp_path, package='app.amethyst.companion'):
    folder = tmp_path / 'build'
    folder.mkdir()
    (folder / 'test.apk').write_bytes(b'Labelled APK test fixture')
    (folder / 'output-metadata.json').write_text(json.dumps(dict(applicationId=package, elements=[
        dict(versionCode=2, versionName='1.0.1', outputFile='test.apk')
    ])))
    return folder


def test_update_absent_is_honest(phone):
    assert phone.get('/api/mobile/update').status_code == 404


def test_published_update_and_download_require_paired_device(phone, tmp_path):
    folder = build(tmp_path)
    release = publish(folder, amethyst_home() / 'mobile-updates')
    assert phone.get('/api/mobile/update').json() == release
    download = phone.get('/api/mobile/update/apk')
    assert download.status_code == 200
    assert hashlib.sha256(download.content).hexdigest() == release['sha256']
    unpaired = TestClient(app, client=('192.0.2.9', 1234))
    assert unpaired.get('/api/mobile/update/apk').status_code == 403


def test_publisher_rejects_another_package(tmp_path):
    with pytest.raises(ValueError, match='Not an Amethyst'):
        publish(build(tmp_path, 'other.package'), tmp_path / 'updates')


def test_malformed_manifest_cannot_read_arbitrary_file(phone):
    folder = amethyst_home() / 'mobile-updates'
    folder.mkdir()
    (folder / 'latest.json').write_text(json.dumps(dict(sha256='../secrets', version_code=2, size=1)))
    assert phone.get('/api/mobile/update/apk').status_code == 503


def test_incomplete_apk_is_not_published(phone, tmp_path):
    release = publish(build(tmp_path), amethyst_home() / 'mobile-updates')
    (amethyst_home() / 'mobile-updates' / f'{release["sha256"]}.apk').write_bytes(b'broken')
    assert phone.get('/api/mobile/update').status_code == 503
