import json
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://omitnomis.github.io/ShareSansarScraper" "/api/history"

CACHE_TTL_SECONDS = 15 * 60

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def get_stock_history(symbol: str) -> dict[str, Any]:
    """Fetch and cache historical daily prices for one NEPSE symbol."""

    symbol = symbol.strip().upper()

    if not re.fullmatch(r"[A-Z0-9]+", symbol):
        raise ValueError("Invalid stock symbol")

    now = time.monotonic()
    cached = _cache.get(symbol)

    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    url = f"{BASE_URL}/{symbol}.json"
    request = Request(
        url,
        headers={"User-Agent": "MeroInvestAI/1.0"},
    )

    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            raise ValueError(f"No historical data found for {symbol}") from exc
        raise RuntimeError(f"Historical data source returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError("Could not connect to the historical data source") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Historical data source returned invalid JSON") from exc

    columns = payload.get("cols", [])
    rows = payload.get("rows", [])

    required = {"d", "o", "h", "l", "c", "vol"}
    if not required.issubset(columns):
        raise RuntimeError("Unexpected historical data format")

    indices = {name: columns.index(name) for name in columns}
    history = []

    for row in rows:
        try:
            item = {
                "date": row[indices["d"]],
                "open": row[indices["o"]],
                "high": row[indices["h"]],
                "low": row[indices["l"]],
                "close": row[indices["c"]],
                "volume": row[indices["vol"]],
            }

            for field in ("ltp", "vwap", "to", "dp"):
                if field in indices:
                    output_name = {
                        "to": "turnover",
                        "dp": "change_pct",
                    }.get(field, field)
                    item[output_name] = row[indices[field]]

            history.append(item)

        except (IndexError, TypeError):
            continue

    result = {
        "symbol": symbol,
        "count": len(history),
        "first_date": history[0]["date"] if history else None,
        "last_date": history[-1]["date"] if history else None,
        "source": "ShareSansarScraper",
        "history": history,
    }

    _cache[symbol] = (now, result)
    return result
