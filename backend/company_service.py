from datetime import datetime, timezone

from price_service import get_market_prices


def get_company_overview():
    """Combine available market data with the future company-data layer."""

    market = get_market_prices()

    return {
        "companies": [
            {
                "symbol": item["symbol"],
                "name": item.get("name"),
                "market": {
                    "price": item["price"],
                    "business_date": item.get("business_date"),
                    "last_updated": item.get("last_updated"),
                    "is_live": item["is_live"],
                    "source": market["source"],
                },
                "fundamentals": None,
                "official_documents": [],
            }
            for item in market["prices"]
        ],
        "count": market["count"],
        "market_status": market["market_status"],
        "market_as_of": market["market_as_of"],
        "market_is_live": market["is_live"],
        "market_business_date": market["business_date"],
        "market_fetched_at": market["fetched_at"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "message": (
            "Market prices are available. Company financials and official "
            "documents have not been integrated yet."
        ),
    }
