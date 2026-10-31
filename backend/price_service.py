from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any

from nepsepy import NepseClient

# Keep cached prices in backend memory.
_cache_lock = Lock()
_cached_result: dict[str, Any] | None = None
_cache_expires_at = 0.0

LIVE_CACHE_SECONDS = 30
CLOSED_CACHE_SECONDS = 300


def _fetch_market_prices() -> dict[str, Any]:
    """Fetch all available prices and overlay live prices when the market is open."""

    client = NepseClient()

    try:
        market_status = client.market_status()
        is_market_open = market_status.get("isOpen") == "OPEN"

        # Always fetch the full latest available price list.
        all_records = client.today_price_all() or []

        # Index full price records by symbol.
        records_by_symbol = {}

        for row in all_records:
            symbol = row.get("symbol")

            if symbol:
                records_by_symbol[symbol.strip().upper()] = row

        source = "today_price_all"
        is_live = False

        # Overlay currently traded prices when the market is open.
        if is_market_open:
            live_records = client.live_market() or []

            for row in live_records:
                symbol = row.get("symbol")

                if symbol:
                    records_by_symbol[symbol.strip().upper()] = row

            if live_records:
                source = "today_price_all+live_market"
                is_live = True

        prices = []

        for symbol, row in records_by_symbol.items():
            price = (
                row.get("lastTradedPrice")
                or row.get("lastUpdatedPrice")
                or row.get("closePrice")
            )

            if price is None:
                continue

            try:
                price = float(price)
            except (TypeError, ValueError):
                continue

            if price <= 0:
                continue

            prices.append(
                {
                    "symbol": symbol,
                    "name": row.get("securityName"),
                    "price": price,
                    "business_date": row.get("businessDate"),
                    "last_updated": row.get("lastUpdatedTime"),
                    "is_live": symbol
                    in {
                        item.get("symbol", "").strip().upper()
                        for item in (live_records if is_market_open else [])
                        if item.get("symbol")
                    },
                }
            )

        if not prices:
            raise RuntimeError("NEPSE returned no usable stock prices.")

        dates = [row.get("businessDate") for row in prices if row.get("business_date")]

        valid_dates = [date for date in dates if date is not None]
        business_date = max(valid_dates) if valid_dates else None

        return {
            "market_status": market_status.get("isOpen", "UNKNOWN"),
            "market_as_of": market_status.get("asOf"),
            "source": source,
            "is_live": is_live,
            "business_date": business_date,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "count": len(prices),
            "prices": prices,
            "cached": False,
            "stale": False,
        }

    finally:
        client.close()


def get_market_prices() -> dict[str, Any]:
    """Return cached prices when fresh, or fetch and retain new prices."""

    global _cached_result, _cache_expires_at

    with _cache_lock:
        now = monotonic()

        # Return fresh cached data without calling NEPSE again.
        if _cached_result is not None and now < _cache_expires_at:
            result = deepcopy(_cached_result)
            result["cached"] = True
            return result

        try:
            result = _fetch_market_prices()

            # Live prices should refresh more frequently than closed-market data.
            ttl = LIVE_CACHE_SECONDS if result["is_live"] else CLOSED_CACHE_SECONDS

            _cached_result = deepcopy(result)
            _cache_expires_at = monotonic() + ttl

            return result

        except Exception as exc:
            # Preserve the previous successful result if NEPSE is unavailable.
            if _cached_result is not None:
                result = deepcopy(_cached_result)
                result["cached"] = True
                result["stale"] = True
                result["refresh_error"] = f"Price refresh failed: {type(exc).__name__}"
                return result

            # No successful data has been fetched yet.
            raise RuntimeError(
                "Could not fetch NEPSE prices and no cached prices are available."
            ) from exc
