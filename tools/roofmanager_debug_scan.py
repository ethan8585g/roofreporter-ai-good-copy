#!/usr/bin/env python3
"""
roofmanager_debug_scan.py
=========================
Super-admin debug & error scanning tool for RoofManager.ca.

Database backend : Cloudflare D1 (SQLite at the edge), accessed via the
                   Cloudflare D1 REST API.
Deployment       : Cloudflare Pages + Workers
Health endpoints : /api/health, /api/health/solar, /api/health/gemini

Usage
-----
    python roofmanager_debug_scan.py [--full] [--report-id REPORT_ID]
                                     [--since-days N] [--output report.html]

Scans
-----
1. Customer Onboarding  — unverified emails, stuck onboarding, subscription issues
2. Platform Health      — API liveness, Cloudflare D1, log parsing, webhook backlog
3. Report Tracing       — stuck/failed reports, missing PDFs, orphaned jobs
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from jinja2 import Environment, BaseLoader

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

LOG_FILE = Path("debug_scan.log")

def _build_logger() -> logging.Logger:
    logger = logging.getLogger("roofmanager_scan")
    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter("[%(levelname)s] %(asctime)s - %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    fh = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3)
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    logger.addHandler(ch)
    logger.addHandler(fh)
    return logger


log = _build_logger()

# ---------------------------------------------------------------------------
# Configuration (from environment / .env)
# ---------------------------------------------------------------------------

CF_ACCOUNT_ID   = os.getenv("CF_ACCOUNT_ID", "")
CF_API_TOKEN    = os.getenv("CF_API_TOKEN", "")
D1_DATABASE_ID  = os.getenv("D1_DATABASE_ID", "e64c0cf3-43fa-4f41-ac75-ed12694a26c5")
API_BASE_URL    = os.getenv("API_BASE_URL", "https://www.roofmanager.ca")
LOG_PATH        = os.getenv("LOG_PATH", "")   # optional: path to a local log file

DB_TIMEOUT_S    = 10   # seconds for D1 REST calls
HTTP_TIMEOUT_S  = 5    # seconds for API health checks

# ---------------------------------------------------------------------------
# Cloudflare D1 REST client  (read-only — never writes to production data)
# ---------------------------------------------------------------------------

class D1Client:
    """Thin wrapper around the Cloudflare D1 REST API.

    Only SELECT / read queries are issued.  Any accidental mutation is caught
    at the application level (all SQL strings are checked below) and at the CF
    level (token scoped to D1:read).
    """

    _BASE = "https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query"

    def __init__(self, account_id: str, api_token: str, database_id: str) -> None:
        self.url = self._BASE.format(account=account_id, db=database_id)
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        """Execute a read-only SQL statement and return rows as dicts."""
        if not self._is_readonly(sql):
            raise ValueError(f"Non-SELECT SQL rejected for safety: {sql[:80]}")

        payload: dict[str, Any] = {"sql": sql}
        if params:
            payload["params"] = params

        try:
            resp = requests.post(
                self.url, headers=self.headers,
                json=payload, timeout=DB_TIMEOUT_S
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            log.error("D1 query failed: %s", exc)
            return []

        if not data.get("success"):
            errors = data.get("errors", [])
            log.error("D1 error: %s", errors)
            return []

        results = data.get("result", [])
        if results:
            return results[0].get("results", [])
        return []

    @staticmethod
    def _is_readonly(sql: str) -> bool:
        first_word = sql.strip().split()[0].upper()
        return first_word in {"SELECT", "WITH", "EXPLAIN", "PRAGMA"}


def _make_d1() -> D1Client | None:
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        log.warning("CF_ACCOUNT_ID / CF_API_TOKEN not set — DB checks skipped.")
        return None
    return D1Client(CF_ACCOUNT_ID, CF_API_TOKEN, D1_DATABASE_ID)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mask_email(email: str) -> str:
    """Mask PII: user@example.com → u***@example.com"""
    if not email or "@" not in email:
        return "***"
    local, domain = email.rsplit("@", 1)
    return f"{local[0]}***@{domain}"


def _since_ts(days: int) -> str:
    """ISO-8601 timestamp for `days` ago (UTC)."""
    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _age_hours(ts_str: str | None) -> float | None:
    """Return how many hours ago a timestamp string was, or None."""
    if not ts_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            dt = datetime.strptime(ts_str.split("+")[0].split("Z")[0], fmt)
            dt = dt.replace(tzinfo=timezone.utc)
            delta = datetime.now(timezone.utc) - dt
            return delta.total_seconds() / 3600
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# 1. Customer Onboarding Scan
# ---------------------------------------------------------------------------

def scan_onboarding(db: D1Client, since_days: int) -> dict:
    """
    Query the `customers` table for accounts created in the last N days and
    flag common onboarding problems.

    Returns a dict with lists of flagged records (PII masked).
    """
    log.info("Starting customer onboarding scan (last %d days)…", since_days)
    since = _since_ts(since_days)
    issues: dict[str, list] = {
        "unverified_email_over_24h": [],
        "onboarding_incomplete_over_48h": [],
        "no_subscription": [],
        "stripe_payment_errors": [],
        "summary": {}
    }

    # --- Unverified emails ---
    rows = db.query(
        """
        SELECT id, email, created_at, email_verified, onboarding_completed,
               onboarding_step, subscription_status, subscription_plan
        FROM   customers
        WHERE  created_at >= ?
        ORDER  BY created_at DESC
        """,
        [since],
    )

    total = len(rows)
    for row in rows:
        age = _age_hours(row.get("created_at"))
        email_verified = row.get("email_verified")
        masked = _mask_email(row.get("email", ""))

        if not email_verified and age is not None and age >= 24:
            issues["unverified_email_over_24h"].append({
                "id": row["id"],
                "email": masked,
                "created_at": row.get("created_at"),
                "age_hours": round(age, 1),
            })

        if not row.get("onboarding_completed") and age is not None and age >= 48:
            issues["onboarding_incomplete_over_48h"].append({
                "id": row["id"],
                "email": masked,
                "step": row.get("onboarding_step"),
                "created_at": row.get("created_at"),
                "age_hours": round(age, 1),
            })

        sub_status = row.get("subscription_status") or ""
        if sub_status not in ("active", "trialing") and not row.get("subscription_plan"):
            issues["no_subscription"].append({
                "id": row["id"],
                "email": masked,
                "subscription_status": sub_status,
                "created_at": row.get("created_at"),
            })

    # --- Stripe webhook errors for recently-created customers ---
    wh_errors = db.query(
        """
        SELECT event_type, COUNT(*) AS cnt, MAX(created_at) AS last_seen
        FROM   stripe_webhook_events
        WHERE  processed = 0
          AND  created_at >= ?
        GROUP  BY event_type
        ORDER  BY cnt DESC
        """,
        [since],
    )
    issues["stripe_payment_errors"] = [
        {"event_type": r["event_type"], "count": r["cnt"], "last_seen": r.get("last_seen")}
        for r in wh_errors
    ]

    issues["summary"] = {
        "total_new_customers": total,
        "unverified_email": len(issues["unverified_email_over_24h"]),
        "onboarding_incomplete": len(issues["onboarding_incomplete_over_48h"]),
        "no_subscription": len(issues["no_subscription"]),
        "unprocessed_webhook_types": len(issues["stripe_payment_errors"]),
    }

    s = issues["summary"]
    if s["unverified_email"]:
        log.warning("Onboarding: %d customer(s) with unverified email >24h.", s["unverified_email"])
    if s["onboarding_incomplete"]:
        log.warning("Onboarding: %d customer(s) with incomplete onboarding >48h.", s["onboarding_incomplete"])
    if s["unprocessed_webhook_types"]:
        log.warning("Onboarding: %d unprocessed Stripe webhook type(s) found.", s["unprocessed_webhook_types"])
    log.info("Onboarding scan complete — %d new customers scanned.", total)
    return issues


# ---------------------------------------------------------------------------
# 2. Platform Health Scan
# ---------------------------------------------------------------------------

def _check_endpoint(url: str, label: str) -> dict:
    """GET a URL, return status, latency, and any error."""
    result: dict[str, Any] = {"url": url, "label": label}
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT_S)
        result["status_code"] = resp.status_code
        result["latency_ms"] = round(resp.elapsed.total_seconds() * 1000)
        result["ok"] = resp.status_code < 400
        try:
            result["body"] = resp.json()
        except Exception:
            result["body"] = resp.text[:200]
    except requests.Timeout:
        result["status_code"] = None
        result["latency_ms"] = HTTP_TIMEOUT_S * 1000
        result["ok"] = False
        result["error"] = "Timeout"
    except requests.RequestException as exc:
        result["status_code"] = None
        result["latency_ms"] = None
        result["ok"] = False
        result["error"] = str(exc)
    return result


def _parse_local_logs(log_path: str, hours: int = 24) -> list[dict]:
    """Parse a flat error log file and group errors by type (last N hours)."""
    path = Path(log_path)
    if not path.exists():
        log.warning("LOG_PATH=%s does not exist — skipping log parse.", log_path)
        return []

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    error_counts: dict[str, int] = {}
    ts_re = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}")

    try:
        with path.open(errors="replace") as fh:
            for line in fh:
                m = ts_re.search(line)
                if m:
                    raw = m.group(0).replace(" ", "T")
                    try:
                        ts = datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
                    except ValueError:
                        continue
                    if ts < since:
                        continue

                upper = line.upper()
                if "ERROR" in upper or "EXCEPTION" in upper or "FATAL" in upper:
                    # Extract a short key from the line (first 80 chars, no PII)
                    key = re.sub(r"[\w._%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "[EMAIL]", line)
                    key = key.strip()[:80]
                    error_counts[key] = error_counts.get(key, 0) + 1
    except OSError as exc:
        log.error("Cannot read log file: %s", exc)
        return []

    return [{"message": k, "count": v}
            for k, v in sorted(error_counts.items(), key=lambda x: -x[1])[:50]]


def scan_platform(db: D1Client | None, since_days: int) -> dict:
    """Check API liveness, database connectivity, webhook backlog, and local logs."""
    log.info("Starting platform health scan…")
    result: dict[str, Any] = {
        "api_endpoints": [],
        "db_status": {},
        "webhook_backlog": [],
        "log_errors": [],
        "admin_users": [],
        "summary": {},
    }

    # --- API endpoints ---
    endpoints = [
        (f"{API_BASE_URL}/api/health",        "Main Health"),
        (f"{API_BASE_URL}/api/health/solar",  "Solar API Health"),
        (f"{API_BASE_URL}/api/health/gemini", "Gemini AI Health"),
    ]
    for url, label in endpoints:
        r = _check_endpoint(url, label)
        result["api_endpoints"].append(r)
        if r["ok"]:
            log.info("  %s → %s (%dms)", label, r["status_code"], r.get("latency_ms", 0))
        else:
            log.warning("  %s → %s (%s)", label, r.get("status_code", "ERR"),
                        r.get("error", ""))

    # --- Database connectivity ---
    if db:
        try:
            rows = db.query("SELECT COUNT(*) AS cnt FROM orders")
            result["db_status"] = {
                "reachable": True,
                "total_orders": rows[0]["cnt"] if rows else "unknown",
            }
            log.info("  D1 database reachable — %s total orders.",
                     result["db_status"]["total_orders"])
        except Exception as exc:
            result["db_status"] = {"reachable": False, "error": str(exc)}
            log.error("  D1 unreachable: %s", exc)
    else:
        result["db_status"] = {"reachable": False, "error": "No credentials"}

    # --- Webhook backlog ---
    if db:
        since = _since_ts(since_days)
        wh = db.query(
            """
            SELECT event_type, COUNT(*) AS cnt, MAX(created_at) AS newest
            FROM   stripe_webhook_events
            WHERE  processed = 0
            GROUP  BY event_type
            ORDER  BY cnt DESC
            LIMIT  20
            """,
        )
        result["webhook_backlog"] = wh
        if wh:
            total_backlog = sum(r["cnt"] for r in wh)
            log.warning("  Stripe webhook backlog: %d unprocessed events across %d types.",
                        total_backlog, len(wh))
        else:
            log.info("  Stripe webhook backlog: clear.")

    # --- Admin users ---
    if db:
        admins = db.query(
            """
            SELECT id, email, role, is_active, last_login, created_at
            FROM   admin_users
            ORDER  BY created_at DESC
            """,
        )
        result["admin_users"] = [
            {**r, "email": _mask_email(r.get("email", ""))}
            for r in admins
        ]
        log.info("  Admin users: %d registered.", len(admins))

    # --- Local log parsing (optional) ---
    if LOG_PATH:
        log.info("  Parsing local log file: %s", LOG_PATH)
        result["log_errors"] = _parse_local_logs(LOG_PATH)
    else:
        log.info("  LOG_PATH not set — skipping log file parse.")

    # Summary
    api_failures = sum(1 for e in result["api_endpoints"] if not e["ok"])
    result["summary"] = {
        "api_failures": api_failures,
        "db_reachable": result["db_status"].get("reachable", False),
        "webhook_backlog_types": len(result["webhook_backlog"]),
        "log_error_groups": len(result["log_errors"]),
        "admin_count": len(result["admin_users"]),
    }
    log.info("Platform health scan complete.")
    return result


# ---------------------------------------------------------------------------
# 3. Report / Roof Measurement Tracing
# ---------------------------------------------------------------------------

def scan_reports(db: D1Client, since_days: int, report_id: int | None = None) -> dict:
    """
    Analyse the `reports` + `orders` tables for stuck, failed, or broken jobs.

    If report_id is given, also prints a full processing timeline for that row.
    """
    log.info("Starting report tracing scan (last %d days)…", since_days)
    since = _since_ts(since_days)

    result: dict[str, Any] = {
        "status_counts": {},
        "stuck_processing": [],
        "failed_no_error": [],
        "high_retry": [],
        "missing_pdf": [],
        "enhancement_failures": [],
        "ai_imagery_failures": [],
        "single_trace": None,
        "summary": {},
    }

    # --- Status distribution ---
    counts = db.query(
        """
        SELECT r.status, COUNT(*) AS cnt
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  o.created_at >= ?
        GROUP  BY r.status
        """,
        [since],
    )
    result["status_counts"] = {r["status"]: r["cnt"] for r in counts}
    log.info("  Report statuses (last %d days): %s", since_days, result["status_counts"])

    # --- Stuck in 'generating' > 1 hour ---
    stuck = db.query(
        """
        SELECT r.id, r.order_id, o.order_number, o.property_address,
               r.status, r.generation_started_at, r.generation_attempts,
               r.error_message
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.status = 'generating'
          AND  r.generation_started_at IS NOT NULL
          AND  r.generation_started_at < datetime('now', '-1 hour')
        ORDER  BY r.generation_started_at ASC
        LIMIT  50
        """,
    )
    for row in stuck:
        age = _age_hours(row.get("generation_started_at"))
        result["stuck_processing"].append({
            **row,
            "property_address": row.get("property_address", ""),
            "stuck_hours": round(age, 1) if age else None,
        })
    if stuck:
        log.error("  Reports: %d stuck in 'generating' (>1h).", len(stuck))

    # --- Failed with no error_message ---
    failed_silent = db.query(
        """
        SELECT r.id, r.order_id, o.order_number, o.property_address,
               r.status, r.generation_attempts, r.generation_completed_at
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.status = 'failed'
          AND  (r.error_message IS NULL OR r.error_message = '')
          AND  o.created_at >= ?
        LIMIT  50
        """,
        [since],
    )
    result["failed_no_error"] = failed_silent
    if failed_silent:
        log.warning("  Reports: %d failed silently (no error_message).", len(failed_silent))

    # --- High retry count (> 3) ---
    high_retry = db.query(
        """
        SELECT r.id, r.order_id, o.order_number, o.property_address,
               r.status, r.generation_attempts, r.error_message
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.generation_attempts > 3
          AND  o.created_at >= ?
        ORDER  BY r.generation_attempts DESC
        LIMIT  30
        """,
        [since],
    )
    result["high_retry"] = high_retry
    if high_retry:
        log.warning("  Reports: %d with >3 generation attempts.", len(high_retry))

    # --- Completed but missing PDF (HEAD request check) ---
    completed = db.query(
        """
        SELECT r.id, r.order_id, o.order_number, r.report_pdf_url,
               r.generation_completed_at
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.status = 'completed'
          AND  r.report_pdf_url IS NOT NULL
          AND  r.report_pdf_url != ''
          AND  o.created_at >= ?
        ORDER  BY r.generation_completed_at DESC
        LIMIT  100
        """,
        [since],
    )
    for row in completed:
        url = row.get("report_pdf_url", "")
        if not url:
            continue
        try:
            head = requests.head(url, timeout=HTTP_TIMEOUT_S, allow_redirects=True)
            if head.status_code == 404:
                result["missing_pdf"].append({
                    "report_id": row["id"],
                    "order_id": row["order_id"],
                    "order_number": row.get("order_number"),
                    "pdf_url": url,
                    "http_status": 404,
                })
        except requests.RequestException as exc:
            result["missing_pdf"].append({
                "report_id": row["id"],
                "order_id": row["order_id"],
                "order_number": row.get("order_number"),
                "pdf_url": url,
                "error": str(exc),
            })
    if result["missing_pdf"]:
        log.warning("  Reports: %d completed reports with missing/404 PDFs.",
                    len(result["missing_pdf"]))

    # --- Enhancement failures ---
    enh_fail = db.query(
        """
        SELECT r.id, r.order_id, o.order_number,
               r.enhancement_status, r.enhancement_error,
               r.enhancement_sent_at, r.enhancement_completed_at
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.enhancement_status IN ('enhancement_failed', 'sent')
          AND  o.created_at >= ?
        ORDER  BY r.enhancement_sent_at DESC
        LIMIT  30
        """,
        [since],
    )
    result["enhancement_failures"] = enh_fail
    if any(r.get("enhancement_status") == "enhancement_failed" for r in enh_fail):
        log.warning("  Reports: %d enhancement failures.", sum(
            1 for r in enh_fail if r.get("enhancement_status") == "enhancement_failed"
        ))

    # Stuck in 'sent' (never got callback) > 2 hours
    stuck_sent = [
        r for r in enh_fail
        if r.get("enhancement_status") == "sent"
        and (_age_hours(r.get("enhancement_sent_at")) or 0) > 2
    ]
    if stuck_sent:
        log.warning("  Reports: %d stuck in enhancement 'sent' state >2h.", len(stuck_sent))

    # --- AI Imagery failures ---
    ai_img_fail = db.query(
        """
        SELECT r.id, r.order_id, o.order_number,
               r.ai_imagery_status, r.ai_imagery_error
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.ai_imagery_status = 'failed'
          AND  o.created_at >= ?
        LIMIT  20
        """,
        [since],
    )
    result["ai_imagery_failures"] = ai_img_fail

    # --- Single report trace ---
    if report_id is not None:
        result["single_trace"] = _trace_single_report(db, report_id)

    result["summary"] = {
        "total_in_period": sum(result["status_counts"].values()),
        "stuck_generating": len(result["stuck_processing"]),
        "failed_silent": len(result["failed_no_error"]),
        "high_retry_count": len(result["high_retry"]),
        "missing_pdfs": len(result["missing_pdf"]),
        "enhancement_failures": sum(
            1 for r in result["enhancement_failures"]
            if r.get("enhancement_status") == "enhancement_failed"
        ),
        "ai_imagery_failures": len(result["ai_imagery_failures"]),
    }
    log.info("Report tracing scan complete.")
    return result


def _trace_single_report(db: D1Client, report_id: int) -> dict | None:
    """Print and return the full processing timeline for a single report row."""
    rows = db.query(
        """
        SELECT r.*,
               o.order_number, o.property_address, o.property_city,
               o.status AS order_status, o.created_at AS order_created_at,
               o.homeowner_email, o.source
        FROM   reports r
        JOIN   orders  o ON o.id = r.order_id
        WHERE  r.id = ?
        """,
        [report_id],
    )
    if not rows:
        log.warning("  No report found for id=%d", report_id)
        return None

    r = rows[0]
    # Mask PII
    r["homeowner_email"] = _mask_email(r.get("homeowner_email", ""))

    timeline = []
    def _event(label: str, ts: str | None, detail: str = "") -> None:
        timeline.append({"event": label, "timestamp": ts or "—", "detail": detail})

    _event("Order created",           r.get("order_created_at"))
    _event("Report row created",      r.get("created_at"))
    _event("Generation started",      r.get("generation_started_at"),
           f"attempt #{r.get('generation_attempts', '?')}")
    _event("Generation completed",    r.get("generation_completed_at"),
           f"status={r.get('status')}")
    _event("Enhancement sent",        r.get("enhancement_sent_at"))
    _event("Enhancement completed",   r.get("enhancement_completed_at"),
           f"status={r.get('enhancement_status')}")
    _event("AI imagery started",      None)   # no explicit ts column
    _event("AI imagery status",       None,   str(r.get("ai_imagery_status")))
    _event("Vision analysis",         r.get("ai_analyzed_at"),
           f"status={r.get('ai_status')}")

    trace = {
        "report_id": report_id,
        "order_number": r.get("order_number"),
        "address": r.get("property_address") + ", " + (r.get("property_city") or ""),
        "source": r.get("source"),
        "current_status": r.get("status"),
        "error_message": r.get("error_message"),
        "enhancement_error": r.get("enhancement_error"),
        "ai_error": r.get("ai_error"),
        "generation_attempts": r.get("generation_attempts"),
        "has_pdf": bool(r.get("report_pdf_url")),
        "has_professional_html": bool(r.get("professional_report_html")),
        "has_enhanced_html": bool(r.get("enhanced_report_html")),
        "timeline": timeline,
    }

    log.info("  Trace for report #%d (order %s):", report_id, r.get("order_number"))
    for ev in timeline:
        log.info("    %-30s %s  %s", ev["event"], ev["timestamp"], ev["detail"])

    return trace


# ---------------------------------------------------------------------------
# HTML Report Generation
# ---------------------------------------------------------------------------

REPORT_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>RoofManager Debug Scan — {{ generated_at }}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #f5f6fa; color: #222; padding: 2rem; }
  h1 { font-size: 1.6rem; color: #1a1a2e; margin-bottom: 0.3rem; }
  h2 { font-size: 1.2rem; color: #16213e; margin: 2rem 0 0.8rem; border-bottom: 2px solid #e0e4ef;
       padding-bottom: 0.4rem; }
  h3 { font-size: 1rem; color: #0f3460; margin: 1.2rem 0 0.4rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
  .card { background: #fff; border-radius: 8px; padding: 1.2rem 1.5rem;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 1rem; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px;
           font-size: 0.78rem; font-weight: 600; }
  .ok   { background: #e8f5e9; color: #2e7d32; }
  .warn { background: #fff8e1; color: #f57f17; }
  .err  { background: #fce4ec; color: #c62828; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th    { background: #f0f2f8; text-align: left; padding: 6px 10px;
          font-weight: 600; border-bottom: 1px solid #d0d5e8; }
  td    { padding: 6px 10px; border-bottom: 1px solid #eef0f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr));
                  gap: 0.8rem; margin-bottom: 1rem; }
  .stat { background: #fff; border-radius: 8px; padding: 0.8rem 1rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.07); text-align: center; }
  .stat-num { font-size: 2rem; font-weight: 700; color: #0f3460; }
  .stat-lbl { font-size: 0.75rem; color: #888; margin-top: 2px; }
  pre  { background: #f8f9fc; padding: 0.6rem 1rem; border-radius: 6px;
         font-size: 0.78rem; overflow-x: auto; white-space: pre-wrap; }
  .empty { color: #aaa; font-style: italic; font-size: 0.85rem; }
  .tl-row { display: flex; gap: 1rem; padding: 4px 0; font-size: 0.83rem; }
  .tl-label { min-width: 200px; color: #555; }
  .tl-ts    { min-width: 180px; color: #333; font-family: monospace; }
  .tl-detail{ color: #888; }
</style>
</head>
<body>
<h1>RoofManager.ca — Super Admin Debug Scan</h1>
<div class="meta">Generated {{ generated_at }} · Lookback: {{ since_days }} days · Target: {{ api_base_url }}</div>

<!-- ====== 1. ONBOARDING ====== -->
<h2>1. Customer Onboarding Issues</h2>
<div class="summary-grid">
  <div class="stat"><div class="stat-num">{{ ob.summary.total_new_customers }}</div><div class="stat-lbl">New Customers</div></div>
  <div class="stat"><div class="stat-num {{ 'err' if ob.summary.unverified_email else 'ok' }}">{{ ob.summary.unverified_email }}</div><div class="stat-lbl">Unverified Email &gt;24h</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if ob.summary.onboarding_incomplete else 'ok' }}">{{ ob.summary.onboarding_incomplete }}</div><div class="stat-lbl">Onboarding Stuck &gt;48h</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if ob.summary.no_subscription else 'ok' }}">{{ ob.summary.no_subscription }}</div><div class="stat-lbl">No Subscription</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if ob.summary.unprocessed_webhook_types else 'ok' }}">{{ ob.summary.unprocessed_webhook_types }}</div><div class="stat-lbl">Webhook Error Types</div></div>
</div>

{% if ob.unverified_email_over_24h %}
<h3>Unverified Email &gt;24h</h3>
<div class="card">
<table>
<tr><th>ID</th><th>Email</th><th>Created</th><th>Age (hrs)</th></tr>
{% for r in ob.unverified_email_over_24h %}
<tr><td>{{ r.id }}</td><td>{{ r.email }}</td><td>{{ r.created_at }}</td><td>{{ r.age_hours }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if ob.onboarding_incomplete_over_48h %}
<h3>Onboarding Incomplete &gt;48h</h3>
<div class="card">
<table>
<tr><th>ID</th><th>Email</th><th>Step</th><th>Created</th><th>Age (hrs)</th></tr>
{% for r in ob.onboarding_incomplete_over_48h %}
<tr><td>{{ r.id }}</td><td>{{ r.email }}</td><td>{{ r.step }}</td><td>{{ r.created_at }}</td><td>{{ r.age_hours }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if ob.stripe_payment_errors %}
<h3>Unprocessed Stripe Webhook Events</h3>
<div class="card">
<table>
<tr><th>Event Type</th><th>Count</th><th>Last Seen</th></tr>
{% for r in ob.stripe_payment_errors %}
<tr><td>{{ r.event_type }}</td><td>{{ r.count }}</td><td>{{ r.last_seen }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if not ob.unverified_email_over_24h and not ob.onboarding_incomplete_over_48h and not ob.stripe_payment_errors %}
<p class="empty">No onboarding issues found.</p>
{% endif %}


<!-- ====== 2. PLATFORM HEALTH ====== -->
<h2>2. Platform Health</h2>
<div class="summary-grid">
  <div class="stat"><div class="stat-num {{ 'err' if ph.summary.api_failures else 'ok' }}">{{ ph.summary.api_failures }}</div><div class="stat-lbl">API Failures</div></div>
  <div class="stat"><div class="stat-num {{ 'ok' if ph.summary.db_reachable else 'err' }}">{{ 'OK' if ph.summary.db_reachable else 'DOWN' }}</div><div class="stat-lbl">D1 Database</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if ph.summary.webhook_backlog_types else 'ok' }}">{{ ph.summary.webhook_backlog_types }}</div><div class="stat-lbl">Webhook Backlog Types</div></div>
  <div class="stat"><div class="stat-num">{{ ph.summary.admin_count }}</div><div class="stat-lbl">Admin Users</div></div>
</div>

<h3>API Endpoints</h3>
<div class="card">
<table>
<tr><th>Endpoint</th><th>Status</th><th>Latency</th><th>Result</th></tr>
{% for e in ph.api_endpoints %}
<tr>
  <td>{{ e.label }}</td>
  <td><span class="badge {{ 'ok' if e.ok else 'err' }}">{{ e.status_code or 'ERR' }}</span></td>
  <td>{{ e.latency_ms }}ms</td>
  <td>{% if e.ok %}<span class="badge ok">OK</span>{% else %}<span class="badge err">{{ e.get('error', 'Failed') }}</span>{% endif %}</td>
</tr>
{% endfor %}
</table></div>

{% if ph.webhook_backlog %}
<h3>Stripe Webhook Backlog (unprocessed)</h3>
<div class="card">
<table>
<tr><th>Event Type</th><th>Count</th><th>Newest</th></tr>
{% for r in ph.webhook_backlog %}
<tr><td>{{ r.event_type }}</td><td>{{ r.cnt }}</td><td>{{ r.newest }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if ph.log_errors %}
<h3>Local Log Errors (last 24h, top 50)</h3>
<div class="card">
<table>
<tr><th>Count</th><th>Message (truncated)</th></tr>
{% for r in ph.log_errors %}
<tr><td>{{ r.count }}</td><td><code>{{ r.message }}</code></td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if ph.admin_users %}
<h3>Admin Users</h3>
<div class="card">
<table>
<tr><th>ID</th><th>Email</th><th>Role</th><th>Active</th><th>Last Login</th></tr>
{% for r in ph.admin_users %}
<tr><td>{{ r.id }}</td><td>{{ r.email }}</td><td>{{ r.role }}</td>
    <td><span class="badge {{ 'ok' if r.is_active else 'warn' }}">{{ 'Yes' if r.is_active else 'No' }}</span></td>
    <td>{{ r.last_login or '—' }}</td></tr>
{% endfor %}
</table></div>
{% endif %}


<!-- ====== 3. REPORT TRACING ====== -->
<h2>3. Roof Measurement Report Tracing</h2>
<div class="summary-grid">
  <div class="stat"><div class="stat-num">{{ rp.summary.total_in_period }}</div><div class="stat-lbl">Total Reports</div></div>
  <div class="stat"><div class="stat-num {{ 'err' if rp.summary.stuck_generating else 'ok' }}">{{ rp.summary.stuck_generating }}</div><div class="stat-lbl">Stuck Generating</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if rp.summary.failed_silent else 'ok' }}">{{ rp.summary.failed_silent }}</div><div class="stat-lbl">Failed (no error msg)</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if rp.summary.high_retry_count else 'ok' }}">{{ rp.summary.high_retry_count }}</div><div class="stat-lbl">High Retry (&gt;3)</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if rp.summary.missing_pdfs else 'ok' }}">{{ rp.summary.missing_pdfs }}</div><div class="stat-lbl">Missing PDFs</div></div>
  <div class="stat"><div class="stat-num {{ 'warn' if rp.summary.enhancement_failures else 'ok' }}">{{ rp.summary.enhancement_failures }}</div><div class="stat-lbl">Enhancement Failures</div></div>
</div>

<h3>Status Distribution</h3>
<div class="card">
<table>
<tr><th>Status</th><th>Count</th></tr>
{% for status, cnt in rp.status_counts.items() %}
<tr><td>{{ status }}</td><td>{{ cnt }}</td></tr>
{% endfor %}
</table></div>

{% if rp.stuck_processing %}
<h3>Stuck in 'generating' (&gt;1 hour)</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>Address</th><th>Started</th><th>Stuck (hrs)</th><th>Attempts</th></tr>
{% for r in rp.stuck_processing %}
<tr><td>{{ r.id }}</td><td>{{ r.order_number }}</td><td>{{ r.property_address }}</td>
    <td>{{ r.generation_started_at }}</td><td>{{ r.stuck_hours }}</td><td>{{ r.generation_attempts }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.failed_no_error %}
<h3>Failed with no error message</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>Address</th><th>Attempts</th><th>Completed</th></tr>
{% for r in rp.failed_no_error %}
<tr><td>{{ r.id }}</td><td>{{ r.order_number }}</td><td>{{ r.property_address }}</td>
    <td>{{ r.generation_attempts }}</td><td>{{ r.generation_completed_at }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.high_retry %}
<h3>High Retry Count (&gt;3 attempts)</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>Status</th><th>Attempts</th><th>Last Error</th></tr>
{% for r in rp.high_retry %}
<tr><td>{{ r.id }}</td><td>{{ r.order_number }}</td><td>{{ r.status }}</td>
    <td>{{ r.generation_attempts }}</td><td>{{ (r.error_message or '')[:80] }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.missing_pdf %}
<h3>Completed Reports with Missing PDFs</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>HTTP</th><th>URL</th></tr>
{% for r in rp.missing_pdf %}
<tr><td>{{ r.report_id }}</td><td>{{ r.order_number }}</td>
    <td><span class="badge err">{{ r.get('http_status', 'ERR') }}</span></td>
    <td style="word-break:break-all">{{ r.pdf_url }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.enhancement_failures %}
<h3>Enhancement Pipeline Issues</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>Status</th><th>Sent</th><th>Completed</th><th>Error</th></tr>
{% for r in rp.enhancement_failures %}
<tr><td>{{ r.id }}</td><td>{{ r.order_number }}</td>
    <td><span class="badge {{ 'err' if r.enhancement_status == 'enhancement_failed' else 'warn' }}">{{ r.enhancement_status }}</span></td>
    <td>{{ r.enhancement_sent_at }}</td><td>{{ r.enhancement_completed_at or '—' }}</td>
    <td>{{ (r.enhancement_error or '')[:60] }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.ai_imagery_failures %}
<h3>AI Imagery Failures</h3>
<div class="card">
<table>
<tr><th>Report ID</th><th>Order #</th><th>Error</th></tr>
{% for r in rp.ai_imagery_failures %}
<tr><td>{{ r.id }}</td><td>{{ r.order_number }}</td><td>{{ (r.ai_imagery_error or '')[:80] }}</td></tr>
{% endfor %}
</table></div>
{% endif %}

{% if rp.single_trace %}
<h3>Single Report Trace — Report #{{ rp.single_trace.report_id }}</h3>
<div class="card">
  <table style="margin-bottom:1rem">
    <tr><th>Order #</th><td>{{ rp.single_trace.order_number }}</td></tr>
    <tr><th>Address</th><td>{{ rp.single_trace.address }}</td></tr>
    <tr><th>Source</th><td>{{ rp.single_trace.source }}</td></tr>
    <tr><th>Status</th><td>{{ rp.single_trace.current_status }}</td></tr>
    <tr><th>Attempts</th><td>{{ rp.single_trace.generation_attempts }}</td></tr>
    <tr><th>Has PDF</th><td>{{ rp.single_trace.has_pdf }}</td></tr>
    <tr><th>Has Professional HTML</th><td>{{ rp.single_trace.has_professional_html }}</td></tr>
    <tr><th>Has Enhanced HTML</th><td>{{ rp.single_trace.has_enhanced_html }}</td></tr>
    {% if rp.single_trace.error_message %}<tr><th>Error</th><td class="err">{{ rp.single_trace.error_message }}</td></tr>{% endif %}
  </table>
  <strong>Processing Timeline</strong>
  {% for ev in rp.single_trace.timeline %}
  <div class="tl-row">
    <span class="tl-label">{{ ev.event }}</span>
    <span class="tl-ts">{{ ev.timestamp }}</span>
    <span class="tl-detail">{{ ev.detail }}</span>
  </div>
  {% endfor %}
</div>
{% endif %}

{% if not rp.stuck_processing and not rp.failed_no_error and not rp.high_retry and not rp.missing_pdf and not rp.enhancement_failures %}
<p class="empty">No report issues found in this period.</p>
{% endif %}

</body>
</html>
"""


def generate_html_report(
    ob: dict,
    ph: dict,
    rp: dict,
    output_path: str,
    since_days: int,
) -> None:
    """Render the three-section HTML report using Jinja2."""
    env = Environment(loader=BaseLoader())
    tmpl = env.from_string(REPORT_TEMPLATE)
    html = tmpl.render(
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        since_days=since_days,
        api_base_url=API_BASE_URL,
        ob=ob,
        ph=ph,
        rp=rp,
    )
    Path(output_path).write_text(html, encoding="utf-8")
    log.info("HTML report written to %s", output_path)


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="RoofManager.ca super-admin debug & error scanning tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python roofmanager_debug_scan.py --full
              python roofmanager_debug_scan.py --report-id 42
              python roofmanager_debug_scan.py --since-days 3 --output weekly.html
        """),
    )
    p.add_argument("--full",       action="store_true",
                   help="Run all scans (default behaviour when no other flags given)")
    p.add_argument("--report-id",  type=int, default=None,
                   help="Detailed trace for a specific report row ID")
    p.add_argument("--since-days", type=int, default=7,
                   help="Look back N days (default: 7)")
    p.add_argument("--output",     default="debug_report.html",
                   help="Output HTML filename (default: debug_report.html)")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    run_all = args.full or args.report_id is None
    since   = args.since_days

    log.info("Starting RoofManager debug scan (since %d days)", since)
    log.info("Target: %s | D1: %s", API_BASE_URL, D1_DATABASE_ID)

    db = _make_d1()

    # --- Run scans ---
    ob: dict = {}
    ph: dict = {}
    rp: dict = {}

    if run_all or True:   # always run onboarding + platform
        if db:
            ob = scan_onboarding(db, since)
        else:
            ob = {"summary": {}, "unverified_email_over_24h": [],
                  "onboarding_incomplete_over_48h": [], "no_subscription": [],
                  "stripe_payment_errors": []}

        ph = scan_platform(db, since)

        if db:
            rp = scan_reports(db, since, report_id=args.report_id)
        else:
            rp = {"summary": {}, "status_counts": {}, "stuck_processing": [],
                  "failed_no_error": [], "high_retry": [], "missing_pdf": [],
                  "enhancement_failures": [], "ai_imagery_failures": [],
                  "single_trace": None}

    elif args.report_id is not None and db:
        rp = scan_reports(db, since, report_id=args.report_id)

    # --- Generate HTML ---
    generate_html_report(ob, ph, rp, args.output, since)

    # --- Final console summary ---
    total_issues = (
        ob.get("summary", {}).get("unverified_email", 0)
        + ob.get("summary", {}).get("onboarding_incomplete", 0)
        + ph.get("summary", {}).get("api_failures", 0)
        + rp.get("summary", {}).get("stuck_generating", 0)
        + rp.get("summary", {}).get("failed_silent", 0)
        + rp.get("summary", {}).get("missing_pdfs", 0)
    )
    if total_issues:
        log.warning("Scan complete — %d issue(s) found. See %s", total_issues, args.output)
    else:
        log.info("Scan complete — no issues found. See %s", args.output)

    return 0 if total_issues == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
