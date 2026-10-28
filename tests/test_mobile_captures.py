"""Durable capture acceptance, validation and retry boundaries."""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend import jobs
from backend.api.main import app, BIND_HOST_ENV
from backend.db.connection import get_connection
from backend.remote.captures import run_capture
from backend.sync import devices


@pytest.fixture
def phone(monkeypatch):
    monkeypatch.setenv(BIND_HOST_ENV, '0.0.0.0')
    devices._failures.clear()
    device, token = devices.register(get_connection(), name='Phone', role='control')
    # No lifespan: the job stays queued so duplicate acceptance is deterministic.
    client = TestClient(app, client=('192.0.2.8', 1234))
    client.headers['Authorization'] = f'Bearer {token}'
    return client, device


def test_capture_is_durable_and_idempotent(phone):
    client, _ = phone
    body = dict(id=str(uuid4()), title='Saved note', text='Capture body', approved=True)
    first = client.post('/api/mobile/captures', json=body)
    assert first.status_code == 202
    assert client.post('/api/mobile/captures', json=body).json()['job_id'] == first.json()['job_id']
    assert client.post('/api/mobile/captures', json={**body, 'text': 'changed'}).status_code == 409
    job = jobs.JobStore().get(first.json()['job_id'])
    assert job.payload['text'] == 'Capture body'


@pytest.mark.parametrize('change', [{'approved': False}, {'title': ' '}, {'url': 'file:///etc/passwd'}, {'text': '', 'url': ''}])
def test_capture_requires_review_and_valid_content(phone, change):
    client, _ = phone
    body = dict(id=str(uuid4()), title='Note', text='text', approved=True)
    assert client.post('/api/mobile/captures', json={**body, **change}).status_code == 422


async def test_worker_rechecks_removed_permission(phone):
    client, device = phone
    body = dict(id=str(uuid4()), title='Note', text='text', approved=True)
    response = client.post('/api/mobile/captures', json=body)
    job = jobs.JobStore().get(response.json()['job_id'])
    devices.update_permissions(get_connection(), device.id, {'library': False})
    assert client.post('/api/mobile/captures', json={**body, 'id': str(uuid4())}).status_code == 403
    with pytest.raises(jobs.Unretryable):
        await run_capture(job, jobs.JobStore())


async def test_text_capture_retry_reuses_library_item(monkeypatch):
    from backend.remote import captures
    # Use the same offline service setup as the library suite.
    from tests.test_library import service
    monkeypatch.setattr(captures, 'LibraryService', service)
    job = SimpleNamespace(payload={'device_id': 'local', 'title': 'Note', 'text': 'A durable capture body.', 'url': ''}, idempotency_key='capture-retry')
    first = await run_capture(job, None)
    second = await run_capture(job, None)
    assert first['item_id'] == second['item_id']
