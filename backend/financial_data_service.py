from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import requests

BASE_URL = "https://shubhamnpk.github.io/yonepse/data/company"
FINANCIALS_URL = f"{BASE_URL}/financials.json"
METADATA_URL = f"{BASE_URL}/metadata.json"

HEADERS = {"User-Agent": "MeroInvestAI/0.1 (financial data integration)"}

TIMEOUT = 20

# Cache configuration
CACHE_TTL_SECONDS = 30 * 60  # 30 minutes

_cache_lock = Lock()
_financial_cache = {
    "data": None,
    "fetched_at": None,
    "expires_at": 0.0,
}


def _fetch_json(url: str):
    """Fetch JSON data from a URL."""
    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        return response.json()

    except (requests.RequestException, ValueError) as exc:
        raise RuntimeError(f"Could not retrieve financial data from {url}") from exc


def _normalize_financial_data(raw_data: list) -> list[dict]:
    """Convert the complete raw YONEPSE dataset into our internal format."""
    companies = []

    for item in raw_data:
        if not isinstance(item, dict):
            continue

        company_symbol = str(item.get("symbol") or "").strip().upper()

        if not company_symbol:
            continue

        raw_reports = item.get("reports", [])

        if not isinstance(raw_reports, list):
            raw_reports = []

        reports = []

        for report in raw_reports:
            if not isinstance(report, dict):
                continue

            reports.append(
                {
                    "type": report.get("type"),
                    "quarter": report.get("quarter"),
                    "fiscal_year": report.get("fy"),
                    "fiscal_year_nepali": report.get("fy_nepali"),
                    "eps": report.get("eps"),
                    "profit": report.get("profit"),
                    "pe": report.get("pe"),
                    "paid_up_capital": report.get("paid_up_capital"),
                    "net_worth_per_share": report.get("net_worth_per_share"),
                    "documents": report.get("documents", []),
                }
            )

        companies.append(
            {
                "symbol": company_symbol,
                "company_id": item.get("id"),
                "reports_count": len(reports),
                "reports": reports,
            }
        )

    return companies


def _refresh_cache() -> dict:
    """
    Download and normalize the complete dataset.

    The lock prevents multiple simultaneous requests from downloading
    the same dataset at the same time.
    """
    with _cache_lock:
        # Another request may have refreshed the cache while this
        # request was waiting for the lock.
        if (
            _financial_cache["data"] is not None
            and monotonic() < _financial_cache["expires_at"]
        ):
            return {
                "data": deepcopy(_financial_cache["data"]),
                "status": "hit",
            }

        raw_data = _fetch_json(FINANCIALS_URL)

        if not isinstance(raw_data, list):
            raise RuntimeError("Unexpected financial dataset format.")

        companies = _normalize_financial_data(raw_data)

        # Metadata is optional. Financial records remain usable
        # if the metadata endpoint is unavailable.
        try:
            metadata = _fetch_json(METADATA_URL)
        except RuntimeError:
            metadata = None

        fetched_at = datetime.now(timezone.utc).isoformat()

        dataset = {
            "source": "YONEPSE",
            "source_url": FINANCIALS_URL,
            "fetched_at": fetched_at,
            "company_count": len(companies),
            "companies": companies,
            "metadata": metadata,
        }

        _financial_cache["data"] = dataset
        _financial_cache["fetched_at"] = fetched_at
        _financial_cache["expires_at"] = monotonic() + CACHE_TTL_SECONDS

        return {
            "data": deepcopy(dataset),
            "status": "miss",
        }


def _get_cached_dataset() -> dict:
    """Return fresh cached data or refresh it; use stale data on failure."""
    with _cache_lock:
        cached_data = _financial_cache["data"]
        is_fresh = (
            cached_data is not None and monotonic() < _financial_cache["expires_at"]
        )

        if is_fresh:
            return {
                "data": deepcopy(cached_data),
                "status": "hit",
            }

        stale_data = deepcopy(cached_data)

    try:
        return _refresh_cache()

    except RuntimeError:
        if stale_data is not None:
            return {
                "data": stale_data,
                "status": "stale",
            }

        raise


def get_financial_data(symbol: str | None = None) -> dict:
    """
    Get financial reports for all companies or one symbol.

    Uses a shared in-memory cache with a 30-minute TTL.
    If refreshing fails, the last successful dataset is used when available.
    """
    result = _get_cached_dataset()

    dataset = result["data"]
    companies = dataset["companies"]

    if symbol:
        requested_symbol = symbol.strip().upper()
        companies = [
            company for company in companies if company["symbol"] == requested_symbol
        ]

    return {
        "source": dataset["source"],
        "source_url": dataset["source_url"],
        "fetched_at": dataset["fetched_at"],
        "company_count": len(companies),
        "companies": companies,
        "metadata": dataset["metadata"],
        "cache_status": result["status"],
    }
