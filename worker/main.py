from __future__ import annotations

import logging
import os
import signal
import threading
import time
from decimal import Decimal

from dotenv import load_dotenv
from supabase import create_client

from worker.provider import extract

log = logging.getLogger("tortracker.worker")
stopping = threading.Event()


def run() -> None:
    load_dotenv(".env.local")
    load_dotenv(".env")
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(url, key)
    lease = max(2, int(os.environ.get("JOB_LEASE_SECONDS", "120")))
    poll = max(0.1, float(os.environ.get("WORKER_POLL_SECONDS", "2")))
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    log.info("Worker ready")
    while not stopping.is_set():
        try:
            claimed = db.rpc("claim_job", {"p_lease_seconds": lease}).execute().data
            if not claimed:
                stopping.wait(poll)
                continue
            job, receipt = claimed["job"], claimed["receipt"]
            heartbeat_stop = threading.Event()

            def heartbeat(claim: dict, stop_event: threading.Event) -> None:
                # Own client: do not share a synchronous transport across threads.
                heartbeat_db = create_client(url, key)
                while not stop_event.wait(lease / 3):
                    try:
                        renewed = heartbeat_db.rpc("renew_job", {"p_id": claim["id"],
                            "p_token": claim["lease_token"], "p_lease_seconds": lease}).execute().data
                        if not renewed:
                            return
                    except Exception:
                        log.warning("Lease renewal failed for job %s", claim["id"])

            thread = threading.Thread(target=heartbeat, args=(job, heartbeat_stop), daemon=True)
            thread.start()
            try:
                evidence = db.storage.from_("receipts").download(receipt["file_path"])
                draft = extract(receipt, evidence)
                if receipt["kind"] == "receipt":
                    known_lines = [line.line_amount for line in draft.lines if line.line_amount is not None]
                    if len(known_lines) != len(draft.lines):
                        draft.uncertain_fields.append("Missing item amounts")
                    if draft.subtotal is not None and len(known_lines) == len(draft.lines):
                        if sum(known_lines, Decimal("0")) != draft.subtotal:
                            draft.uncertain_fields.append("Item amounts do not match the subtotal")
                    if all(value is not None for value in [draft.subtotal, draft.tax, draft.total]):
                        calculated = draft.subtotal + draft.tax - (draft.receipt_discount or Decimal("0")) + (draft.fees or Decimal("0"))
                        if calculated != draft.total:
                            draft.uncertain_fields.append("Subtotal, tax, discounts and fees do not match the total")
                    draft.uncertain_fields = list(dict.fromkeys(draft.uncertain_fields))
                mappings = db.table("item_mappings").select("original_key,item_id").eq(
                    "user_id", receipt["user_id"]).eq("store_key", (draft.store_name or "").strip().lower()).execute().data
                item_ids = [mapping["item_id"] for mapping in mappings]
                items = db.table("items").select("*").in_("id", item_ids).execute().data if item_ids else []
                by_id = {item["id"]: item for item in items}
                known = {mapping["original_key"]: by_id[mapping["item_id"]] for mapping in mappings
                         if mapping["item_id"] in by_id}
                for line in draft.lines:
                    item = known.get(line.original_text.strip().lower())
                    if item:
                        line.item_name = item["name"]
                        line.category = item["category"]
                        line.comparison_group = item["comparison_group"]
                db.rpc("complete_job", {"p_id": job["id"], "p_token": job["lease_token"],
                                       "p_draft": draft.model_dump(mode="json")}).execute()
                log.info("Processed job %s", job["id"])
            except Exception as exc:
                # Do not log provider response bodies, evidence, tokens, or receipt contents.
                log.warning("Job %s failed (%s)", job["id"], type(exc).__name__)
                db.rpc("fail_job", {"p_id": job["id"], "p_token": job["lease_token"]}).execute()
            finally:
                heartbeat_stop.set()
                thread.join(timeout=2)
        except Exception as exc:
            log.warning("Queue operation failed (%s)", type(exc).__name__)
            stopping.wait(max(1, poll))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # HTTP client debug logs can contain authenticated URLs; keep them quiet.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    run()
