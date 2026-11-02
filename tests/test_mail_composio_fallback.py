import pytest
from unittest.mock import patch, AsyncMock
from backend.mail import accounts, threads, thread, reply, unread_count, MailAccount

def test_mail_accounts_falls_back_to_composio():
    with patch("backend.mail.gmail.CREDENTIALS_DIR") as mock_dir, \
         patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.get_connections", return_value={"gmail": {"id": "ca_test", "status": "ACTIVE", "word_id": "test@gmail.com"}}):
        mock_dir.is_dir.return_value = False
        accs = accounts()
        assert len(accs) == 1
        assert isinstance(accs[0], MailAccount)
        assert accs[0].address == "test@gmail.com"
        assert accs[0].can_send is True


@pytest.mark.asyncio
async def test_mail_threads_falls_back_to_composio():
    fake_emails = {
        "messages": [
            {
                "id": "msg_123",
                "thread_id": "th_123",
                "subject": "Hello from Composio",
                "from": "alice@example.com",
                "to": "test@gmail.com",
                "date": "2026-11-02",
                "snippet": "Test body snippet",
                "label_ids": ["UNREAD", "INBOX"],
            }
        ]
    }
    with patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mail.gmail._composio_call", new_callable=AsyncMock, return_value=fake_emails):
        items = await threads(query="in:inbox", limit=5)
        assert len(items) == 1
        assert items[0]["id"] == "msg_123"
        assert items[0]["thread_id"] == "th_123"
        assert items[0]["subject"] == "Hello from Composio"
        assert items[0]["unread"] is True


@pytest.mark.asyncio
async def test_mail_unread_count_falls_back_to_composio():
    fake_emails = {
        "messages": [
            {"id": "msg_1", "label_ids": ["UNREAD"]},
            {"id": "msg_2", "label_ids": ["UNREAD"]},
        ]
    }
    with patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mail.gmail._composio_call", new_callable=AsyncMock, return_value=fake_emails):
        counts = await unread_count()
        assert counts["messages"] == 2
        assert counts["threads"] == 2


@pytest.mark.asyncio
async def test_mail_thread_detail_falls_back_to_composio():
    fake_email = {
        "id": "th_123",
        "thread_id": "th_123",
        "subject": "Thread Subject",
        "from": "bob@example.com",
        "body": "Full message body here",
    }
    with patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mail.gmail._composio_call", new_callable=AsyncMock, return_value=fake_email):
        detail = await thread("th_123")
        assert detail["id"] == "th_123"
        assert len(detail["messages"]) == 1
        assert detail["messages"][0]["body"] == "Full message body here"


@pytest.mark.asyncio
async def test_mail_reply_falls_back_to_composio():
    with patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mail.gmail._composio_call", new_callable=AsyncMock, return_value={"id": "reply_456"}):
        res = await reply("th_123", "Sounds good!")
        assert res["id"] == "reply_456"
        assert res["thread_id"] == "th_123"
