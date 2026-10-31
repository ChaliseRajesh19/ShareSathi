from datetime import date, datetime
from zoneinfo import ZoneInfo

import nepali_datetime
import requests

IPO_FEEDS = {
    "upcoming": "https://shubhamnpk.github.io/yonepse/data/ipo/upcoming.json",
    "archive": "https://shubhamnpk.github.io/yonepse/data/ipo/old.json",
}

IPO_SOURCES = {
    "upcoming_feed": {
        "name": "Yonepse IPO Feed",
        "url": IPO_FEEDS["upcoming"],
        "purpose": "Third-party IPO announcements; verify dates officially.",
    },
    "cdsc_current_issues": {
        "name": "CDSC Current Issues",
        "url": "https://cdsc.com.np/ipolist",
        "purpose": "Official source for current public issues",
    },
    "sebon_approved": {
        "name": "SEBON Approved IPOs",
        "url": "https://sebon.gov.np/ipo-approved",
        "purpose": "IPOs approved by the regulator",
    },
    "sebon_pipeline": {
        "name": "SEBON IPO Application List",
        "url": "https://sebon.gov.np/ipo-pipeline",
        "purpose": "IPOs awaiting regulatory decisions",
    },
}

BS_MONTHS = {
    "baisakh": 1,
    "baishakh": 1,
    "jestha": 2,
    "jeth": 2,
    "ashad": 3,
    "asad": 3,
    "shrawan": 4,
    "sawan": 4,
    "bhadra": 5,
    "ashwin": 6,
    "ashoj": 6,
    "kartik": 7,
    "kattik": 7,
    "mangsir": 8,
    "mangshir": 8,
    "poush": 9,
    "push": 9,
    "magh": 10,
    "falgun": 11,
    "fagun": 11,
    "chaitra": 12,
    "chait": 12,
}


def parse_bs_range(text):
    """Parse common Yonepse date ranges such as '11th - 25th Kartik, 2083'."""
    if not text:
        return None

    import re

    text = str(text).strip()
    text = text.replace("–", "-").replace("—", "-")

    # Supported examples:
    # 11th - 25th Kartik, 2083
    # 22nd - 25th Bhadra, 2083
    # 11th Kartik - 25th Kartik, 2083
    pattern = re.compile(
        r"(?P<start>\d{1,2})(?:st|nd|rd|th)?\s*"
        r"(?:(?P<start_month>[A-Za-z]+)\s*)?"
        r"-\s*(?P<end>\d{1,2})(?:st|nd|rd|th)?\s*"
        r"(?P<end_month>[A-Za-z]+),?\s*(?P<year>\d{4})",
        re.IGNORECASE,
    )

    match = pattern.search(text)
    if not match:
        # Single date, if the source provides one
        single = re.search(
            r"(\d{1,2})(?:st|nd|rd|th)?\s+" r"([A-Za-z]+),?\s+(\d{4})",
            text,
            re.IGNORECASE,
        )
        if not single:
            return None

        day = int(single.group(1))
        month = BS_MONTHS.get(single.group(2).lower())
        year = int(single.group(3))
        if not month:
            return None
        return convert_bs_dates(year, month, day, month, day)

    start_day = int(match.group("start"))
    end_day = int(match.group("end"))
    year = int(match.group("year"))

    end_month = BS_MONTHS.get(match.group("end_month").lower())
    start_month_text = match.group("start_month")
    start_month = (
        BS_MONTHS.get(start_month_text.lower()) if start_month_text else end_month
    )

    if not start_month or not end_month:
        return None

    end_year = year + 1 if end_month < start_month else year

    return convert_bs_dates(
        year,
        start_month,
        start_day,
        end_month,
        end_day,
        end_year=end_year,
    )


def convert_bs_dates(
    start_year,
    start_month,
    start_day,
    end_month,
    end_day,
    end_year=None,
):
    try:
        end_year = end_year or start_year

        start_ad = nepali_datetime.date(
            start_year, start_month, start_day
        ).to_datetime_date()

        end_ad = nepali_datetime.date(end_year, end_month, end_day).to_datetime_date()

        if end_ad < start_ad:
            return None

        return start_ad, end_ad
    except (ValueError, TypeError):
        return None


def classify_ipo(record, today):
    """Add date-based status fields to one IPO record."""
    date_text = record.get("date_range") or record.get("full_text")
    parsed = parse_bs_range(date_text)

    result = dict(record)

    if not parsed:
        result.update(
            {
                "status": "unknown",
                "days_remaining": None,
                "opening_date_ad": None,
                "closing_date_ad": None,
            }
        )
        return result

    start_date, end_date = parsed

    if today < start_date:
        status = "upcoming"
        days_remaining = (start_date - today).days
    elif today <= end_date:
        status = "open"
        days_remaining = (end_date - today).days
    else:
        status = "closed"
        days_remaining = 0

    result.update(
        {
            "status": status,
            "days_remaining": days_remaining,
            "opening_date_ad": start_date.isoformat(),
            "closing_date_ad": end_date.isoformat(),
            "opening_day": start_date.strftime("%A"),
            "closing_day": end_date.strftime("%A"),
        }
    )

    return result


def get_ipo_overview():
    fetched_at = datetime.now(ZoneInfo("Asia/Kathmandu")).isoformat()
    today = datetime.now(ZoneInfo("Asia/Kathmandu")).date()

    all_records = []
    feed_errors = []

    for feed_name, feed_url in IPO_FEEDS.items():
        try:
            response = requests.get(feed_url, timeout=15)
            response.raise_for_status()
            records = response.json()

            if not isinstance(records, list):
                raise ValueError("Unexpected IPO feed format")

            for record in records:
                if not isinstance(record, dict) or not record.get("company"):
                    continue

                item = {
                    "company": record.get("company"),
                    "units": record.get("units"),
                    "date_range": record.get("date_range"),
                    "announcement_date": record.get("announcement_date"),
                    "description": record.get("full_text"),
                    "source_url": record.get("url"),
                    "is_reserved_share": bool(record.get("is_reserved_share", False)),
                    "reserved_for": record.get("reserved_for"),
                    "source_updated_at": record.get("scraped_at"),
                    "source": "Merolagani via Yonepse",
                    "feed": feed_name,
                }

                all_records.append(classify_ipo(item, today))

        except (requests.RequestException, ValueError) as exc:
            feed_errors.append(f"{feed_name}: {exc}")

    # Avoid duplicate records when the same IPO appears in both feeds.
    unique_records = []
    seen = set()

    for ipo in all_records:
        key = (
            ipo.get("company"),
            ipo.get("date_range"),
            ipo.get("reserved_for"),
        )
        if key not in seen:
            seen.add(key)
            unique_records.append(ipo)

    open_ipos = [x for x in unique_records if x["status"] == "open"]
    upcoming_ipos = [x for x in unique_records if x["status"] == "upcoming"]
    closed_ipos = [x for x in unique_records if x["status"] == "closed"]
    unknown_ipos = [x for x in unique_records if x["status"] == "unknown"]

    return {
        "sources": IPO_SOURCES,
        "ipos": unique_records,
        "count": len(unique_records),
        "open_ipos": open_ipos,
        "upcoming_ipos": upcoming_ipos,
        "closed_ipos": closed_ipos,
        "unknown_ipos": unknown_ipos,
        "counts": {
            "open": len(open_ipos),
            "upcoming": len(upcoming_ipos),
            "closed": len(closed_ipos),
            "unknown": len(unknown_ipos),
        },
        "fetched_at": fetched_at,
        "data_source": "Yonepse JSON feeds",
        "is_live": not feed_errors,
        "message": (
            "IPO announcements loaded. Verify application status and dates "
            "with official sources."
            if not feed_errors
            else "One or more IPO feeds could not be loaded. "
            "Check official source links."
        ),
        "errors": feed_errors,
    }
