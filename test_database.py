import requests
from datetime import date

url = "https://omitnomis.github.io/ShareSansarScraper/api/history/NABIL.json"
data = requests.get(url, timeout=20).json()

cols = data["cols"]
rows = data["rows"]

date_idx = cols.index("d")
close_idx = cols.index("c")
volume_idx = cols.index("vol")

for i, row in enumerate(rows):
    day = date.fromisoformat(row[date_idx])

    if day.weekday() >= 4:  # Friday or Saturday
        previous = rows[i - 1] if i > 0 else None

        print(
            day,
            "close:",
            row[close_idx],
            "volume:",
            row[volume_idx],
            "previous date:",
            previous[date_idx] if previous else None,
            "previous close:",
            previous[close_idx] if previous else None,
            "previous volume:",
            previous[volume_idx] if previous else None,
        )
