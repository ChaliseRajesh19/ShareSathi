import json
from collections import Counter
from datetime import date
from urllib.request import urlopen

BASE_URL = "https://omitnomis.github.io/ShareSansarScraper/api"


def fetch_json(url):
    with urlopen(url, timeout=20) as response:
        return json.load(response)


def main():
    meta = fetch_json(f"{BASE_URL}/meta.json")
    symbols_data = fetch_json(f"{BASE_URL}/symbols.json")
    latest = fetch_json(f"{BASE_URL}/latest.json")

    print("=== DATASET METADATA ===")
    print(json.dumps(meta, indent=2))

    print("\n=== SYMBOL LIST STRUCTURE ===")
    print("Type:", type(symbols_data).__name__)
    if isinstance(symbols_data, dict):
        print("Keys:", list(symbols_data.keys()))
        symbols = symbols_data.get("symbols", [])
    elif isinstance(symbols_data, list):
        symbols = symbols_data
    else:
        symbols = []

    print("Symbols found:", len(symbols))
    print("First 10:", symbols[:10])

    print("\n=== LATEST DATA STRUCTURE ===")
    if isinstance(latest, dict):
        print("Keys:", list(latest.keys()))
        print(json.dumps(latest, indent=2)[:1500])
    else:
        print("Type:", type(latest).__name__)
        print(str(latest)[:1500])

    # Use a known symbol to inspect the historical schema.
    history = fetch_json(f"{BASE_URL}/history/NABIL.json")

    columns = history.get("cols", [])
    rows = history.get("rows", [])

    print("\n=== NABIL HISTORY ===")
    print("Columns:", columns)
    print("Total rows:", len(rows))

    if not rows:
        print("No historical rows found.")
        return

    dates = [row[0] for row in rows]
    valid_dates = []

    for value in dates:
        try:
            valid_dates.append(date.fromisoformat(value))
        except (ValueError, TypeError):
            print("Invalid date:", repr(value))

    counts = Counter(dates)
    duplicates = {day: count for day, count in counts.items() if count > 1}

    print("First date:", dates[0])
    print("Last date:", dates[-1])
    print("Duplicate dates:", len(duplicates))
    print("Rows not in date order:", dates != sorted(dates))
    print("Weekend-dated rows:", sum(d.weekday() >= 4 for d in valid_dates))

    # Count consecutive identical OHLCV values.
    # This flags records for inspection; it does not automatically call them errors.
    repeated_ohlcv = 0

    for previous, current in zip(rows, rows[1:]):
        if previous[1:5] == current[1:5] and previous[8] == current[8]:
            repeated_ohlcv += 1

    print("Consecutive rows with identical OHLCV:", repeated_ohlcv)


if __name__ == "__main__":
    main()
