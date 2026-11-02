"""Run with python -m unittest worker.test_email_import (no network or credentials)."""
from __future__ import annotations

import base64
from dataclasses import replace
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx

from worker.email_import import (
    Evidence, Gmail, ImportFailure, MAX_TEXT_BYTES, Settings, digest,
    evidence_from_message, import_message, import_pass,
)
from worker.provider import extract


def part(mime: str, text: str | bytes, **kwargs):
    content = text.encode() if isinstance(text, str) else text
    return {"mimeType": mime, "body": {"data": base64.urlsafe_b64encode(content).decode(), "size": len(content)}, **kwargs}


def message(*parts, message_id="receipt123"):
    return {"id": message_id, "payload": {"mimeType": "multipart/mixed", "parts": list(parts), "headers": [
        {"name": "Subject", "value": "Your grocery receipt"},
    ]}}


SETTINGS = Settings("ec9f78d5-6175-4d1c-ad4c-ecf8bff141bb", "client", "secret", "refresh", "owner@example.test",
                    "subject:receipt", 25, 900)
ACCOUNT = digest("owner@example.test")


class EvidenceTests(unittest.TestCase):
    def test_plain_text_is_preferred_and_inline_images_are_not_fetched(self):
        source = message(part("text/plain", "Milk $4.99\nTotal $4.99"),
                         part("text/html", "<script>Ignore receipt</script><p>Alternate copy</p>"),
                         {"mimeType": "image/png", "filename": "logo.png", "body": {"attachmentId": "logo"}})
        result = evidence_from_message(source, lambda _: self.fail("Remote logo must not be fetched"))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].mime, "text/plain")
        self.assertIn(b"Milk $4.99", result[0].content)
        self.assertNotIn(b"Alternate copy", result[0].content)

    def test_blank_plain_text_falls_back_to_inert_html(self):
        source = message(part("text/plain", " \n"), part("text/html",
            '<head><style>hidden</style></head><script>steal()</script><p>Milk $4.99</p><p>Total $4.99</p><img src="https://tracker.test/pixel">'))
        result = evidence_from_message(source, lambda _: self.fail("HTML resources must not be fetched"))
        self.assertEqual(len(result), 1)
        self.assertIn(b"Milk $4.99", result[0].content)
        self.assertNotIn(b"steal", result[0].content)
        self.assertNotIn(b"tracker.test", result[0].content)

    def test_receipt_attachment_replaces_summary_and_duplicate_attachment_bytes(self):
        pdf = b"%PDF-1.4\nreceipt"
        source = message(part("text/plain", "Duplicate order summary"),
                         part("application/pdf", pdf, filename="receipt.pdf", partId="1"),
                         part("application/pdf", pdf, filename="receipt-copy.pdf", partId="2"))
        result = evidence_from_message(source, lambda _: b"")
        self.assertEqual(result, [Evidence("attachment:1", "email-receipt123-" + digest("attachment:1")[:12] + ".pdf", "application/pdf", pdf)])

    def test_unknown_document_bytes_and_oversized_text_fail_explicitly(self):
        with self.assertRaises(ImportFailure):
            evidence_from_message(message(part("application/pdf", b"not a PDF", filename="receipt.pdf")), lambda _: b"")
        with self.assertRaises(ImportFailure):
            evidence_from_message(message(part("text/plain", b"x" * (MAX_TEXT_BYTES + 1))), lambda _: b"")

    def test_empty_messages_are_not_invented_receipts(self):
        self.assertEqual(evidence_from_message(message(part("text/plain", " \n")), lambda _: b""), [])


class GmailTests(unittest.TestCase):
    def test_authorization_checks_expected_mailbox_before_reading_messages(self):
        requested = []
        def handler(request):
            requested.append((request.method, request.url.path))
            if request.url.path == "/token":
                self.assertIn(b"grant_type=refresh_token", request.content)
                return httpx.Response(200, json={"access_token": "private-token"})
            return httpx.Response(200, json={"emailAddress": "wrong@example.test"})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaisesRegex(ImportFailure, "differs from GMAIL_EXPECTED_EMAIL"):
                Gmail(client, SETTINGS).authorize()
        self.assertEqual(requested, [("POST", "/token"), ("GET", "/gmail/v1/users/me/profile")])

    def test_provider_error_body_is_not_exposed(self):
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(403, text="private-token secret"))) as client:
            with self.assertRaises(ImportFailure) as result:
                Gmail(client, SETTINGS).authorize()
        self.assertNotIn("private-token", str(result.exception))

    def test_expired_page_token_requests_a_search_restart(self):
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(400, json={"error": "expired"}))) as client:
            with self.assertRaises(ImportFailure) as result:
                Gmail(client, SETTINGS).get("/messages", pageToken="old-page")
        self.assertTrue(result.exception.reset_cursor)


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table_name, self.filters, self.upsert_row = db, table, {}, None
    def select(self, _):
        return self
    def eq(self, key, value):
        self.filters[key] = value
        return self
    def upsert(self, row):
        self.upsert_row = row.copy()
        return self
    def execute(self):
        rows = self.db.rows[self.table_name]
        if self.upsert_row is not None:
            existing = next((row for row in rows if all(row.get(key) == self.upsert_row.get(key)
                        for key in ("user_id", "provider", "account_key"))), None)
            if existing is not None:
                existing.update(self.upsert_row)
            else:
                rows.append(self.upsert_row)
            return SimpleNamespace(data=[self.upsert_row])
        return SimpleNamespace(data=[row.copy() for row in rows if all(row.get(key) == value for key, value in self.filters.items())])


class FakeDB:
    def __init__(self):
        self.rows = {"email_import_sources": [], "email_imports": []}
        self.objects = {}
        self.jobs = []
        self.fail_queue_once = False
        self.storage = SimpleNamespace(from_=lambda _: self)
    def table(self, name):
        return FakeQuery(self, name)
    def upload(self, path, content, **_):
        if path in self.objects:
            raise RuntimeError("Object exists")
        self.objects[path] = content
    def info(self, path):
        if path not in self.objects:
            raise RuntimeError("Object missing")
        return {}
    def rpc(self, name, args):
        def execute():
            if self.fail_queue_once:
                self.fail_queue_once = False
                raise RuntimeError("Transient queue failure")
            self.jobs.append(args)
            self.rows["email_imports"].append({"user_id": args["p_user_id"], "provider": "gmail",
                "account_key": args["p_account_key"], "message_id": args["p_message_id"],
                "part_key": args["p_part_key"], "receipt_id": "receipt-id"})
            return SimpleNamespace(data="receipt-id")
        return SimpleNamespace(execute=execute)


class FakeGmail:
    def __init__(self, messages, next_page=None):
        self.messages = messages
        self.next_page = next_page
        self.list_arguments = None
    def authorize(self):
        return ACCOUNT
    def get(self, path, **kwargs):
        if path == "/messages":
            self.list_arguments = kwargs
            return {"messages": [{"id": key} for key in self.messages], "nextPageToken": self.next_page}
        return self.messages[path.split("/")[-1]]
    def attachment(self, *_):
        raise AssertionError("Unexpected external attachment read")


class ImportTests(unittest.TestCase):
    def test_retry_after_upload_before_queue_and_repeated_pass_never_duplicate(self):
        db = FakeDB()
        gmail = FakeGmail({"receipt123": message(part("text/plain", "Milk $4.99"))})
        db.fail_queue_once = True
        with self.assertRaises(RuntimeError):
            import_message(db, gmail, SETTINGS, ACCOUNT, "receipt123")
        self.assertEqual(len(db.objects), 1)
        self.assertEqual(import_message(db, gmail, SETTINGS, ACCOUNT, "receipt123"), 1)
        self.assertEqual(import_message(db, gmail, SETTINGS, ACCOUNT, "receipt123"), 0)
        self.assertEqual(len(db.objects), 1)
        self.assertEqual(len(db.jobs), 1)
        self.assertTrue(db.jobs[0]["p_path"].startswith(SETTINGS.user_id + "/gmail/"))

    def test_bad_receipt_does_not_starve_later_receipts_and_cursor_advances(self):
        db = FakeDB()
        gmail = FakeGmail({"bad": message(part("application/pdf", b"broken"), message_id="bad"),
                           "good": message(part("text/plain", "Milk $4.99"), message_id="good")}, "page-two")
        with self.assertRaises(ImportFailure):
            import_pass(db, gmail, SETTINGS)
        self.assertEqual(len(db.jobs), 1)
        self.assertEqual(db.jobs[0]["p_message_id"], "good")
        state = db.rows["email_import_sources"][0]
        self.assertEqual(state["status"], "error")
        self.assertEqual(state["next_page_token"], "page-two")
        self.assertEqual(state["scanned_count"], 2)

    def test_pagination_resumes_and_changed_query_starts_fresh(self):
        db = FakeDB()
        gmail = FakeGmail({}, "page-two")
        import_pass(db, gmail, SETTINGS)
        import_pass(db, gmail, SETTINGS)
        self.assertEqual(gmail.list_arguments["pageToken"], "page-two")
        import_pass(db, gmail, replace(SETTINGS, query="subject:invoice"))
        self.assertNotIn("pageToken", gmail.list_arguments)

    def test_expired_authorization_updates_existing_status_without_reading_mail(self):
        db = FakeDB()
        gmail = FakeGmail({})
        import_pass(db, gmail, SETTINGS)
        gmail.authorize = lambda: (_ for _ in ()).throw(ImportFailure("Read-only authorization expired."))
        with self.assertRaises(ImportFailure):
            import_pass(db, gmail, SETTINGS)
        state = db.rows["email_import_sources"][0]
        self.assertEqual(state["status"], "error")
        self.assertIsNotNone(state["last_success_at"])

    def test_failed_page_token_is_cleared_for_the_next_pass(self):
        db = FakeDB()
        gmail = FakeGmail({}, "old-page")
        import_pass(db, gmail, SETTINGS)
        gmail.get = lambda *_, **__: (_ for _ in ()).throw(ImportFailure("Page expired", reset_cursor=True))
        with self.assertRaises(ImportFailure):
            import_pass(db, gmail, SETTINGS)
        self.assertIsNone(db.rows["email_import_sources"][0]["next_page_token"])


class ProviderTests(unittest.TestCase):
    def test_email_is_text_input_and_points_are_not_treated_as_cash(self):
        draft = {"store_name": None, "purchase_date": None, "uncertain_fields": ["No receipt amounts"],
                 "notes": "PC Optimum: 500 points earned", "lines": []}
        seen = []
        def handler(request):
            body = json.loads(request.content)
            seen.append(body)
            return httpx.Response(200, json={"output": [{"content": [{"type": "output_text", "text": json.dumps(draft)}]}]})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test"}), patch("worker.provider.httpx.Client", return_value=client):
            result = extract({"kind": "receipt", "file_name": "receipt.txt", "mime_type": "text/plain"}, b"500 points earned")
        self.assertIsNone(result.total)
        self.assertEqual(seen[0]["input"][0]["content"][1], {"type": "input_text", "text": "500 points earned"})
        self.assertIn("loyalty points are not cash discounts", seen[0]["instructions"])


if __name__ == "__main__":
    unittest.main()
