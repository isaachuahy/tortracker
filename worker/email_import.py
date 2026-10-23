"""Read-only Gmail receipt intake. Run separately from the extraction worker.

Only fixed Google OAuth/Gmail endpoints are contacted. Refresh credentials never
leave this process's environment, and no email is marked read or otherwise changed.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import logging
import os
import re
import signal
import threading
from typing import Any, Callable
from uuid import UUID

import httpx
from dotenv import load_dotenv

log = logging.getLogger("tortracker.email_import")
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 256 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_PARTS = 100
MAX_ATTACHMENTS = 10
GMAIL_ORIGIN = "https://gmail.googleapis.com/gmail/v1/users/me"
DEFAULT_QUERY = (
    'newer_than:90d -in:spam -in:trash '
    '{from:pcexpress.ca from:loblaw.ca from:loblaws.ca from:pcoptimum.ca '
    'from:metro.ca from:sobeys.com from:voila.ca from:walmart.ca from:instacart.com '
    'from:costco.ca from:longos.com from:freshco.com from:nofrills.ca} '
    '{subject:receipt subject:invoice subject:"order confirmation" subject:"your order"}'
)


class ImportFailure(RuntimeError):
    """A deliberately safe error suitable for sync status, without provider text."""

    def __init__(self, message: str, *, reset_cursor: bool = False) -> None:
        super().__init__(message)
        self.reset_cursor = reset_cursor


@dataclass(frozen=True)
class Settings:
    user_id: str
    client_id: str
    client_secret: str
    refresh_token: str
    expected_email: str | None
    query: str
    page_size: int
    interval: int

    @classmethod
    def from_environment(cls) -> "Settings":
        required = ("GMAIL_IMPORT_USER_ID", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")
        if any(not os.environ.get(name) for name in required):
            raise ImportFailure("Gmail import is not configured. Supply the worker-only Gmail settings.")
        try:
            user_id = str(UUID(os.environ["GMAIL_IMPORT_USER_ID"]))
            page_size = int(os.environ.get("GMAIL_IMPORT_PAGE_SIZE", "25"))
            interval = int(os.environ.get("GMAIL_IMPORT_INTERVAL_SECONDS", "900"))
        except (ValueError, TypeError) as exc:
            raise ImportFailure("The Gmail owner ID, page size or interval is invalid.") from exc
        if not 1 <= page_size <= 100 or not 60 <= interval <= 86400:
            raise ImportFailure("Use a Gmail page size of 1–100 and an interval of 60–86400 seconds.")
        query = os.environ.get("GMAIL_IMPORT_QUERY", DEFAULT_QUERY).strip()
        if not query or len(query) > 2000:
            raise ImportFailure("Use a nonempty Gmail receipt query of at most 2000 characters.")
        return cls(user_id, os.environ["GMAIL_CLIENT_ID"], os.environ["GMAIL_CLIENT_SECRET"],
                   os.environ["GMAIL_REFRESH_TOKEN"], os.environ.get("GMAIL_EXPECTED_EMAIL", "").strip().lower() or None,
                   query, page_size, interval)


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def decode_body(data: str, limit: int = MAX_FILE_BYTES) -> bytes:
    if not isinstance(data, str) or len(data) > (limit + 2) * 4 // 3 + 4:
        raise ImportFailure("An email attachment exceeds the supported size.")
    try:
        result = base64.b64decode(data + "=" * (-len(data) % 4), altchars=b"-_", validate=True)
    except (ValueError, TypeError) as exc:
        raise ImportFailure("An email part could not be decoded.") from exc
    if len(result) > limit:
        raise ImportFailure("An email attachment exceeds the supported size.")
    return result


class _TextHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "head"):
            self.hidden += 1
        if not self.hidden and tag in ("br", "p", "div", "tr", "li", "table", "h1", "h2", "h3"):
            self.chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "head") and self.hidden:
            self.hidden -= 1
        if not self.hidden and tag in ("p", "div", "tr", "li", "td", "th"):
            self.chunks.append("\n" if tag not in ("td", "th") else "\t")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.chunks.append(data)


def html_text(html: str) -> str:
    parser = _TextHTML()
    parser.feed(html)
    return re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", "".join(parser.chunks)).strip()


def headers(part: dict[str, Any]) -> dict[str, str]:
    return {str(h.get("name", "")).lower(): str(h.get("value", "")) for h in part.get("headers", [])}


def sniff_mime(content: bytes) -> str | None:
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


@dataclass(frozen=True)
class Evidence:
    part_key: str
    filename: str
    mime: str
    content: bytes


def evidence_from_message(message: dict[str, Any], fetch_attachment: Callable[[str], bytes]) -> list[Evidence]:
    """Prefer attached receipt documents over the email's duplicate summary.

    HTML is converted to inert text; remote resources and linked receipts are
    never fetched. Inline logos are excluded. Multiple attachment bytes are
    deduplicated before queueing, and unknown formats fail instead of being
    sent as a misleading image to the extraction provider.
    """
    message_id = str(message.get("id", ""))
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", message_id):
        raise ImportFailure("The email message identity is invalid.")
    payload = message.get("payload", {})
    attachments: list[tuple[str, dict[str, Any]]] = []
    plain: list[dict[str, Any]] = []
    html: list[dict[str, Any]] = []
    count = 0

    def walk(part: dict[str, Any], path: str = "0", depth: int = 0) -> None:
        nonlocal count
        count += 1
        if count > MAX_PARTS or depth > 20:
            raise ImportFailure("An email has too many nested parts to import safely.")
        mime = str(part.get("mimeType", "")).lower()
        filename = str(part.get("filename", ""))
        disposition = headers(part).get("content-disposition", "").lower()
        # PDFs and explicitly named receipt photos are useful evidence. Generic
        # inline image parts are usually logos/tracking images, not receipts.
        receipt_photo = bool(re.search(r"receipt|invoice|transaction|purchase|order", filename, re.I))
        if mime == "application/pdf" or (mime in ("image/jpeg", "image/png", "image/webp")
                                           and receipt_photo and not disposition.startswith("inline")):
            part_id = str(part.get("partId") or path)
            attachments.append(("attachment:" + part_id, part))
        elif mime == "text/plain" and not filename and not disposition.startswith("attachment"):
            plain.append(part)
        elif mime == "text/html" and not filename and not disposition.startswith("attachment"):
            html.append(part)
        for index, child in enumerate(part.get("parts", [])):
            walk(child, path + "." + str(index), depth + 1)

    walk(payload)
    if len(attachments) > MAX_ATTACHMENTS:
        raise ImportFailure("An email has more than ten receipt attachments; import it manually.")

    def bytes_for(part: dict[str, Any], limit: int = MAX_FILE_BYTES) -> bytes:
        body = part.get("body", {})
        if int(body.get("size", 0)) > limit:
            raise ImportFailure("An email part exceeds the supported size.")
        if "data" in body:
            return decode_body(body["data"], limit)
        attachment_id = body.get("attachmentId")
        if attachment_id:
            content = fetch_attachment(str(attachment_id))
            if len(content) > limit:
                raise ImportFailure("An email part exceeds the supported size.")
            return content
        return b""

    if attachments:
        output: list[Evidence] = []
        seen: set[str] = set()
        for part_key, part in attachments:
            content = bytes_for(part)
            mime = sniff_mime(content)
            if not content or not mime:
                raise ImportFailure("An email attachment is not a supported receipt file.")
            checksum = digest(content)
            if checksum not in seen:
                suffix = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
                output.append(Evidence(part_key, f"email-{message_id}-{digest(part_key)[:12]}.{suffix}", mime, content))
                seen.add(checksum)
        return output

    body = "\n".join(bytes_for(part, MAX_TEXT_BYTES).decode("utf-8", errors="replace") for part in plain)
    if not body.strip():
        body = html_text("\n".join(bytes_for(part, MAX_TEXT_BYTES).decode("utf-8", errors="replace") for part in html))
    if not body.strip():
        return []
    source_headers = headers(payload)
    text = "\n".join(f"{name.title()}: {source_headers[name]}" for name in ("from", "subject", "date") if name in source_headers)
    text += "\n\n" + body.strip()
    content = text.encode("utf-8")
    if len(content) > MAX_TEXT_BYTES:
        raise ImportFailure("An email body exceeds 256 KB; import its receipt manually.")
    return [Evidence("body", f"email-{message_id}.txt", "text/plain", content)]


class Gmail:
    def __init__(self, client: httpx.Client, settings: Settings) -> None:
        self.client = client
        self.settings = settings
        self.access_token = ""

    def _json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            with self.client.stream(method, url, **kwargs) as response:
                if (response.status_code == 400 and url == GMAIL_ORIGIN + "/messages"
                        and kwargs.get("params", {}).get("pageToken")):
                    raise ImportFailure("Gmail's saved page expired. The next pass will restart the search.", reset_cursor=True)
                if response.status_code in (400, 401, 403):
                    raise ImportFailure("Gmail access failed. Check read-only authorization and worker credentials.")
                if response.status_code == 429:
                    raise ImportFailure("Gmail is rate limiting imports. The worker will retry on its next pass.")
                if response.status_code >= 400:
                    raise ImportFailure("Gmail is temporarily unavailable. The worker will retry on its next pass.")
                chunks = bytearray()
                for chunk in response.iter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > MAX_JSON_BYTES:
                        raise ImportFailure("Gmail returned an email larger than the import limit.")
            value = json.loads(chunks)
            if not isinstance(value, dict):
                raise ImportFailure("Gmail returned an unreadable response.")
            return value
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise ImportFailure("Gmail could not be reached. The worker will retry on its next pass.") from exc

    def authorize(self) -> str:
        token = self._json("POST", "https://oauth2.googleapis.com/token", data={
            "client_id": self.settings.client_id,
            "client_secret": self.settings.client_secret,
            "refresh_token": self.settings.refresh_token,
            "grant_type": "refresh_token",
        })
        self.access_token = str(token.get("access_token") or "")
        if not self.access_token:
            raise ImportFailure("Gmail did not issue an access token. Reconnect its read-only authorization.")
        profile = self.get("/profile")
        address = str(profile.get("emailAddress") or "").strip().lower()
        if not address or "@" not in address:
            raise ImportFailure("The connected Gmail mailbox could not be identified.")
        if self.settings.expected_email and address != self.settings.expected_email:
            raise ImportFailure("The Gmail account differs from GMAIL_EXPECTED_EMAIL. No emails were imported.")
        return digest(address)

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        return self._json("GET", GMAIL_ORIGIN + path,
                          headers={"Authorization": "Bearer " + self.access_token}, params=params)

    def attachment(self, message_id: str, attachment_id: str) -> bytes:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", attachment_id):
            raise ImportFailure("The Gmail attachment identity is invalid.")
        value = self.get(f"/messages/{message_id}/attachments/{attachment_id}")
        return decode_body(value.get("data", ""))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_query(db: Any, settings: Settings, account_key: str) -> Any:
    return db.table("email_import_sources").select("*").eq("user_id", settings.user_id).eq(
        "provider", "gmail").eq("account_key", account_key)


def import_message(db: Any, gmail: Gmail, settings: Settings, account_key: str, message_id: str,
                   on_queued: Callable[[], None] | None = None) -> int:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", message_id):
        raise ImportFailure("The Gmail message identity is invalid.")
    message = gmail.get("/messages/" + message_id, format="full")
    evidence = evidence_from_message(message, lambda aid: gmail.attachment(message_id, aid))
    imported = 0
    for document in evidence:
        existing = db.table("email_imports").select("receipt_id").eq("user_id", settings.user_id).eq(
            "provider", "gmail").eq("account_key", account_key).eq("message_id", message_id).eq(
            "part_key", document.part_key).execute().data
        if existing:
            continue
        source_key = digest(account_key + ":" + message_id + ":" + document.part_key)
        path = settings.user_id + "/gmail/" + source_key
        bucket = db.storage.from_("receipts")
        try:
            bucket.upload(path, document.content, file_options={"content-type": document.mime, "upsert": "false"})
        except Exception:
            # A previous process may have uploaded before a crash. Its
            # immutable, deterministic object can be safely queued again.
            bucket.info(path)
        db.rpc("queue_email_receipt", {"p_user_id": settings.user_id, "p_account_key": account_key,
            "p_message_id": message_id, "p_part_key": document.part_key, "p_path": path,
            "p_name": document.filename, "p_mime": document.mime}).execute()
        imported += 1
        if on_queued:
            on_queued()
    return imported


def import_pass(db: Any, gmail: Gmail, settings: Settings) -> tuple[int, int]:
    query_hash = digest(settings.query)
    try:
        account_key = gmail.authorize()
    except ImportFailure as exc:
        if settings.expected_email:
            # A configured expected mailbox gives us a safe status identity even
            # when authorization expired. Never claim a previous sync is fresh.
            expected_key = digest(settings.expected_email)
            previous_rows = _source_query(db, settings, expected_key).execute().data
            previous = previous_rows[0] if previous_rows else {}
            db.table("email_import_sources").upsert({
                **previous, "user_id": settings.user_id, "provider": "gmail", "account_key": expected_key,
                "query_hash": query_hash, "status": "error", "last_attempt_at": _now(),
                "last_error": str(exc), "imported_count": 0, "scanned_count": 0,
            }).execute()
        raise
    previous_rows = _source_query(db, settings, account_key).execute().data
    previous = previous_rows[0] if previous_rows else {}
    page_token = previous.get("next_page_token") if previous.get("query_hash") == query_hash else None
    source = {"user_id": settings.user_id, "provider": "gmail", "account_key": account_key,
              "query_hash": query_hash, "next_page_token": page_token,
              "status": "running", "last_attempt_at": _now(), "last_error": None,
              "last_success_at": previous.get("last_success_at"), "imported_count": 0, "scanned_count": 0}
    db.table("email_import_sources").upsert(source).execute()
    imported = 0
    scanned = 0
    failures = 0

    def queued() -> None:
        nonlocal imported
        imported += 1

    try:
        arguments: dict[str, Any] = {"q": settings.query, "maxResults": settings.page_size, "includeSpamTrash": "false"}
        if page_token:
            arguments["pageToken"] = page_token
        messages = gmail.get("/messages", **arguments)
        for entry in messages.get("messages", []):
            message_id = str(entry.get("id", ""))
            scanned += 1
            # Check per-part identities after reading so a partial multi-attachment
            # pass resumes the missing parts. Never skip the entire message.
            try:
                import_message(db, gmail, settings, account_key, message_id, queued)
            except Exception as exc:
                # A malformed document must not starve later receipts. Continue
                # pagination; the next complete scan retries failed messages.
                failures += 1
                log.warning("One email could not be imported (%s)", type(exc).__name__)
        source.update(status="error" if failures else "partial" if messages.get("nextPageToken") else "ready",
                      next_page_token=messages.get("nextPageToken"),
                      imported_count=imported, scanned_count=scanned,
                      last_error=f"{failures} email(s) could not be imported. Other receipts were saved; failed emails will be retried on the next scan." if failures else None)
        if not failures:
            source["last_success_at"] = _now()
        db.table("email_import_sources").upsert(source).execute()
        if failures:
            raise ImportFailure(source["last_error"])
        return imported, scanned
    except Exception as exc:
        if isinstance(exc, ImportFailure) and exc.reset_cursor:
            source["next_page_token"] = None
        source.update(status="error", imported_count=imported, scanned_count=scanned,
                      last_error=str(exc) if isinstance(exc, ImportFailure) else
                      "The email import could not finish. Check the worker; saved receipts will not be duplicated.")
        db.table("email_import_sources").upsert(source).execute()
        raise


def run() -> int:
    parser = argparse.ArgumentParser(description="Import Gmail grocery receipts without modifying mail.")
    parser.add_argument("--once", action="store_true", help="Read one bounded page, then exit.")
    args = parser.parse_args()
    load_dotenv(".env.local")
    load_dotenv(".env")
    try:
        settings = Settings.from_environment()
        if not os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or not os.environ.get("SUPABASE_SECRET_KEY"):
            raise ImportFailure("The import worker needs its Supabase URL and secret key.")
    except ImportFailure as exc:
        log.error("%s", exc)
        return 1
    from supabase import create_client
    db = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    log.info("Read-only Gmail import worker ready")
    while not stopping.is_set():
        failed = False
        try:
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                imported, scanned = import_pass(db, Gmail(client, settings), settings)
            log.info("Email pass finished: %s documents queued, %s messages scanned", imported, scanned)
        except Exception as exc:
            failed = True
            # The exception class is useful for operations without leaking token,
            # provider response, message subject/body, or account identifiers.
            log.warning("Email pass failed (%s)", type(exc).__name__)
        if args.once:
            return 1 if failed else 0
        stopping.wait(settings.interval)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    raise SystemExit(run())
