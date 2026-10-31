from datetime import date

from ipo_service import classify_ipo


def test_classify_ipo_adds_status_fields():
    record = {
        "company": "Example Company",
        "date_range": "11th - 25th Kartik, 2083",
    }

    today = date(2026, 10, 1)

    result = classify_ipo(record, today)

    assert result["company"] == "Example Company"
    assert result["status"] == "upcoming"
    assert result["opening_date_ad"] is not None
    assert result["closing_date_ad"] is not None


def test_ipo_service_with_invalid_date_range():
    record = {
        "company": "Invalid Date Company",
        "date_range": "32nd - 40th Kartik, 2083",  # Invalid dates
    }

    today = date(2026, 10, 1)

    result = classify_ipo(record, today)

    assert result["status"] == "unknown"
    assert result["opening_date_ad"] is None
    assert result["closing_date_ad"] is None
