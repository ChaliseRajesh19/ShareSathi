from collections import defaultdict
from datetime import date, datetime
from statistics import median
from typing import Any

NUMERIC_FIELDS = (
    "eps",
    "profit",
    "pe",
    "paid_up_capital",
    "net_worth_per_share",
)


def _to_number(value: Any) -> float | None:
    """Convert a source value to a finite number, if possible."""
    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, str):
        value = value.strip().replace(",", "")
        if not value:
            return None

    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if number != number or number in (float("inf"), float("-inf")):
        return None

    return number


def normalize_reports(reports: list[dict]) -> list[dict]:
    """Normalize report fields without changing the source objects."""
    normalized = []

    for original in reports:
        if not isinstance(original, dict):
            continue

        report = dict(original)

        for field in NUMERIC_FIELDS:
            report[field] = _to_number(report.get(field))

        report["type"] = str(report.get("type") or "").strip().lower()
        report["quarter"] = str(report.get("quarter") or "").strip()
        report["fiscal_year"] = str(report.get("fiscal_year") or "").strip()

        documents = report.get("documents")
        report["documents"] = documents if isinstance(documents, list) else []

        normalized.append(report)

    return normalized


def get_period_key(report: dict) -> tuple:
    return (
        report.get("fiscal_year"),
        report.get("type"),
        report.get("quarter"),
    )


def find_duplicate_periods(reports: list[dict]) -> list[dict]:
    grouped = defaultdict(list)

    for report in reports:
        grouped[get_period_key(report)].append(report)

    duplicates = []

    for (year, report_type, quarter), entries in grouped.items():
        if len(entries) > 1:
            duplicates.append(
                {
                    "fiscal_year": year,
                    "type": report_type,
                    "quarter": quarter,
                    "count": len(entries),
                }
            )

    return duplicates


def _fiscal_year_sort_key(value: Any) -> tuple:
    """Sort common fiscal-year strings chronologically where possible."""
    text = str(value or "").strip()
    numbers = []

    for part in text.replace("/", "-").split("-"):
        try:
            numbers.append(int(part))
        except ValueError:
            continue

    if numbers:
        return (0, numbers[0], numbers[-1], text)

    return (1, 0, 0, text)


def _quarter_sort_key(value: Any) -> int:
    text = str(value or "").strip().lower()

    for index in range(1, 5):
        if f"q{index}" in text or f"quarter {index}" in text:
            return index

    return 0


def sort_reports(reports: list[dict]) -> list[dict]:
    return sorted(
        reports,
        key=lambda report: (
            _fiscal_year_sort_key(report.get("fiscal_year")),
            _quarter_sort_key(report.get("quarter")),
        ),
    )


def _latest_submission_date(report: dict) -> str:
    dates = []

    for document in report.get("documents", []):
        if not isinstance(document, dict):
            continue

        submitted = document.get("submitted_date")
        if submitted:
            dates.append(str(submitted))

    return max(dates, default="")


def _deduplicate_annual_reports(
    annual_reports: list[dict],
) -> tuple[list[dict], list[dict]]:
    """
    Select one record per fiscal year.

    This is a practical heuristic, not confirmation that the chosen
    record is the authoritative or corrected filing.
    """
    grouped = defaultdict(list)

    for report in annual_reports:
        grouped[report.get("fiscal_year")].append(report)

    selected = []
    resolved_duplicates = []

    for fiscal_year, entries in grouped.items():
        if len(entries) > 1:
            resolved_duplicates.append(
                {
                    "fiscal_year": fiscal_year,
                    "count": len(entries),
                    "selection_method": ("latest_submission_date_then_completeness"),
                }
            )

        chosen = max(
            entries,
            key=lambda report: (
                _latest_submission_date(report),
                sum(report.get(field) is not None for field in NUMERIC_FIELDS),
            ),
        )
        selected.append(chosen)

    return sort_reports(selected), resolved_duplicates


def _calculate_trend(
    reports: list[dict],
    field: str,
) -> dict:
    """
    Compare the latest two available observations.

    Missing observations are skipped. The returned fiscal years make
    gaps visible rather than implying that observations are consecutive.
    """
    observations = [
        {
            "fiscal_year": report.get("fiscal_year"),
            "value": report.get(field),
        }
        for report in reports
        if report.get(field) is not None
    ]

    if len(observations) < 2:
        return {
            "status": "insufficient_data",
            "field": field,
            "observations_available": len(observations),
            "latest": observations[-1] if observations else None,
            "previous": None,
            "absolute_change": None,
            "percentage_change": None,
            "direction": "unknown",
        }

    previous = observations[-2]
    latest = observations[-1]
    change = latest["value"] - previous["value"]

    percentage_change = None
    if previous["value"] != 0:
        percentage_change = change / abs(previous["value"]) * 100

    direction = (
        "increased" if change > 0 else "decreased" if change < 0 else "unchanged"
    )

    return {
        "status": "calculated",
        "field": field,
        "observations_available": len(observations),
        "latest": latest,
        "previous": previous,
        "absolute_change": round(change, 4),
        "percentage_change": (
            round(percentage_change, 2) if percentage_change is not None else None
        ),
        "direction": direction,
    }


def analyze_pe_valuation(annual_reports: list[dict]) -> dict:
    reports_with_pe = [
        report for report in annual_reports if report.get("pe") is not None
    ]

    if not reports_with_pe:
        return {
            "status": "insufficient_data",
            "latest_pe": None,
            "historical_median_pe": None,
            "comparison": "unavailable",
            "message": "No annual P/E values are available.",
        }

    latest_report = reports_with_pe[-1]
    latest_pe = latest_report["pe"]

    positive_historical_pes = [
        report["pe"] for report in reports_with_pe[:-1] if report["pe"] > 0
    ]

    if latest_pe <= 0:
        return {
            "status": "review_required",
            "latest_pe": latest_pe,
            "latest_fiscal_year": latest_report.get("fiscal_year"),
            "historical_median_pe": (
                round(median(positive_historical_pes), 2)
                if positive_historical_pes
                else None
            ),
            "comparison": "not_meaningful",
            "message": (
                "The latest P/E is zero or negative. Review earnings "
                "and source methodology before interpreting valuation."
            ),
        }

    if not positive_historical_pes:
        return {
            "status": "insufficient_history",
            "latest_pe": latest_pe,
            "latest_fiscal_year": latest_report.get("fiscal_year"),
            "historical_median_pe": None,
            "comparison": "unavailable",
            "message": (
                "There are not enough earlier positive annual P/E values "
                "for a historical comparison."
            ),
        }

    historical_median = median(positive_historical_pes)

    if latest_pe > historical_median:
        comparison = "above_historical_median"
    elif latest_pe < historical_median:
        comparison = "below_historical_median"
    else:
        comparison = "at_historical_median"

    return {
        "status": "calculated",
        "latest_pe": latest_pe,
        "latest_fiscal_year": latest_report.get("fiscal_year"),
        "historical_median_pe": round(historical_median, 2),
        "comparison": comparison,
        "historical_observations": len(positive_historical_pes),
        "message": (
            "This compares reported P/E values with earlier annual "
            "observations. It does not establish whether the stock is "
            "cheap or expensive at today's market price."
        ),
    }


def _build_insights(trends: dict) -> list[str]:
    insights = []

    labels = {
        "eps": "EPS",
        "profit": "reported profit",
        "net_worth_per_share": "net worth per share",
    }

    for field, label in labels.items():
        trend = trends.get(field, {})

        if trend.get("status") != "calculated":
            insights.append(
                f"{label.capitalize()}: insufficient observations "
                "for a year-to-year comparison."
            )
            continue

        previous = trend["previous"]
        latest = trend["latest"]
        direction = trend["direction"]

        if direction == "increased":
            description = "increased"
        elif direction == "decreased":
            description = "decreased"
        else:
            description = "was unchanged"

        insights.append(
            f"{label.capitalize()} {description} from "
            f"{previous['fiscal_year']} ({previous['value']}) to "
            f"{latest['fiscal_year']} ({latest['value']})."
        )

    return insights


def _build_company_summary(
    trends: dict,
    valuation: dict,
    data_quality: dict,
) -> dict:
    """
    Produce a transparent trend summary, not a stock recommendation.
    """
    highlights = []
    concerns = []
    evidence = []

    for field, label in (
        ("eps", "EPS"),
        ("profit", "reported profit"),
        ("net_worth_per_share", "net worth per share"),
    ):
        trend = trends.get(field, {})

        if trend.get("status") != "calculated":
            concerns.append(f"Not enough observations to compare {label}.")
            continue

        previous = trend["previous"]
        latest = trend["latest"]
        direction = trend["direction"]

        evidence.append(
            {
                "metric": field,
                "previous_fiscal_year": previous["fiscal_year"],
                "previous_value": previous["value"],
                "latest_fiscal_year": latest["fiscal_year"],
                "latest_value": latest["value"],
                "direction": direction,
                "percentage_change": trend["percentage_change"],
            }
        )

        if direction == "increased":
            highlights.append(
                f"{label.capitalize()} increased between the two "
                "latest available annual observations."
            )
        elif direction == "decreased":
            concerns.append(
                f"{label.capitalize()} decreased between the two "
                "latest available annual observations."
            )
        else:
            highlights.append(
                f"{label.capitalize()} was unchanged between the two "
                "latest available annual observations."
            )

        if previous["fiscal_year"] != latest["fiscal_year"]:
            previous_key = _fiscal_year_sort_key(previous["fiscal_year"])
            latest_key = _fiscal_year_sort_key(latest["fiscal_year"])

            if (
                previous_key[0] == 0
                and latest_key[0] == 0
                and latest_key[1] - previous_key[1] > 1
            ):
                concerns.append(
                    f"The {label} comparison skips one or more fiscal "
                    "years with missing observations."
                )

    pe_comparison = valuation.get("comparison")

    if pe_comparison == "below_historical_median":
        highlights.append("The latest reported P/E is below its historical median.")
    elif pe_comparison == "above_historical_median":
        concerns.append("The latest reported P/E is above its historical median.")
    elif pe_comparison in ("unavailable", "not_meaningful"):
        concerns.append("A meaningful historical P/E comparison is unavailable.")

    if data_quality.get("has_duplicate_periods"):
        concerns.append(
            "Duplicate report periods were found; verify the source "
            "filings and the selected annual records."
        )

    if data_quality.get("missing_values_in_selected_annual_reports", 0):
        concerns.append("Some selected annual reports have missing financial values.")

    if not evidence:
        assessment = "insufficient_data"
        label = "Insufficient data"
        explanation = (
            "There are not enough comparable annual observations to "
            "summarize the company's financial trends reliably."
        )
    else:
        directions = [
            item["direction"]
            for item in evidence
            if item["metric"] in ("eps", "profit")
        ]

        positive = directions.count("increased")
        negative = directions.count("decreased")

        if positive and negative:
            assessment = "mixed_signals"
            label = "Mixed financial trends"
            explanation = (
                "The available earnings and profit indicators do not "
                "all move in the same direction."
            )
        elif positive and not negative:
            assessment = "positive_trends"
            label = "Positive observed trends"
            explanation = (
                "The available EPS and profit comparisons show increases. "
                "This is a limited historical observation, not a forecast."
            )
        elif negative and not positive:
            assessment = "negative_trends"
            label = "Negative observed trends"
            explanation = (
                "The available EPS and profit comparisons show decreases. "
                "This is a limited historical observation, not a forecast."
            )
        else:
            assessment = "mixed_or_limited"
            label = "Mixed or limited evidence"
            explanation = (
                "The available observations do not establish a clear "
                "positive or negative earnings-and-profit trend."
            )

    limitations = [
        "This summary describes historical data; it does not predict "
        "future performance or provide a buy/sell recommendation.",
        "P/E comparisons use reported values that may reflect different "
        "market prices or reporting dates.",
        "Net worth per share is a book-value measure, not a complete "
        "measure of financial strength.",
        "Quarterly trends are excluded because the reporting basis has "
        "not been verified.",
        "Duplicate annual filings are selected using a heuristic and "
        "should be checked against original reports.",
    ]

    return {
        "assessment": assessment,
        "label": label,
        "explanation": explanation,
        "highlights": highlights,
        "concerns": concerns,
        "evidence": evidence,
        "limitations": limitations,
        "is_investment_recommendation": False,
    }


def _explain_trend(
    metric: str,
    label: str,
    trend: dict,
    meaning: str,
    investor_context: str,
) -> dict:
    """Convert a calculated financial trend into beginner-friendly language."""

    if trend.get("status") != "calculated":
        latest = trend.get("latest")

        return {
            "metric": metric,
            "label": label,
            "value": latest.get("value") if latest else None,
            "fiscal_year": latest.get("fiscal_year") if latest else None,
            "meaning": meaning,
            "interpretation": (
                "There is not enough historical data to determine "
                "whether this metric has improved or declined."
            ),
            "investor_context": investor_context,
            "status": "insufficient_data",
        }

    latest = trend["latest"]
    previous = trend["previous"]
    direction = trend["direction"]

    if direction == "increased":
        interpretation = (
            f"{label} increased from {previous['value']} in "
            f"{previous['fiscal_year']} to {latest['value']} "
            f"in {latest['fiscal_year']}."
        )
    elif direction == "decreased":
        interpretation = (
            f"{label} decreased from {previous['value']} in "
            f"{previous['fiscal_year']} to {latest['value']} "
            f"in {latest['fiscal_year']}."
        )
    else:
        interpretation = (
            f"{label} remained unchanged between "
            f"{previous['fiscal_year']} and {latest['fiscal_year']}."
        )

    if trend.get("percentage_change") is not None:
        interpretation += f" The reported change was " f"{trend['percentage_change']}%."

    return {
        "metric": metric,
        "label": label,
        "value": latest["value"],
        "fiscal_year": latest["fiscal_year"],
        "previous_value": previous["value"],
        "previous_fiscal_year": previous["fiscal_year"],
        "meaning": meaning,
        "interpretation": interpretation,
        "investor_context": investor_context,
        "status": direction,
    }


def _build_financial_explanations(
    trends: dict,
    valuation: dict,
    annual_reports: list[dict],
) -> dict:
    """Build plain-language explanations from reported financial data."""

    explanations = {
        "eps": _explain_trend(
            metric="eps",
            label="Earnings Per Share (EPS)",
            trend=trends.get("eps", {}),
            meaning=(
                "EPS represents the reported earnings attributable "
                "to each share of the company."
            ),
            investor_context=(
                "Increasing EPS can indicate improving earnings per share. "
                "However, it does not guarantee future growth or make "
                "a stock automatically attractive."
            ),
        ),
        "profit": _explain_trend(
            metric="profit",
            label="Reported Profit",
            trend=trends.get("profit", {}),
            meaning=(
                "Reported profit is the profit figure provided "
                "in the company's annual financial report."
            ),
            investor_context=(
                "Increasing profit can indicate improving business results. "
                "Compare it with company size, revenue, expenses, "
                "and other financial information."
            ),
        ),
        "net_worth_per_share": _explain_trend(
            metric="net_worth_per_share",
            label="Net Worth Per Share",
            trend=trends.get("net_worth_per_share", {}),
            meaning=(
                "Net worth per share represents reported book value "
                "attributable to each share."
            ),
            investor_context=(
                "This provides a book-value perspective. It is not "
                "the same as the current market price or a complete "
                "measure of financial strength."
            ),
        ),
    }

    pe = valuation.get("pe", {})
    latest_pe = pe.get("latest_pe")

    if latest_pe is None:
        pe_explanation = {
            "metric": "pe",
            "label": "Price-to-Earnings Ratio (P/E)",
            "value": None,
            "meaning": (
                "P/E relates a share's market price to its earnings per share."
            ),
            "interpretation": ("A usable annual P/E value is not available."),
            "investor_context": (
                "P/E should be interpreted alongside earnings, "
                "growth, industry conditions, and the price date."
            ),
            "status": "insufficient_data",
        }
    else:
        comparison = pe.get("comparison")

        interpretations = {
            "below_historical_median": (
                "The latest reported P/E is below the company's "
                "historical median P/E."
            ),
            "above_historical_median": (
                "The latest reported P/E is above the company's "
                "historical median P/E."
            ),
            "at_historical_median": (
                "The latest reported P/E is approximately equal "
                "to its historical median."
            ),
            "not_meaningful": (
                "The latest P/E is zero or negative, so the "
                "historical valuation comparison is not meaningful."
            ),
            "unavailable": (
                "There is insufficient historical data for a " "P/E comparison."
            ),
        }

        pe_explanation = {
            "metric": "pe",
            "label": "Price-to-Earnings Ratio (P/E)",
            "value": latest_pe,
            "fiscal_year": pe.get("latest_fiscal_year"),
            "historical_median": pe.get("historical_median_pe"),
            "meaning": (
                "P/E indicates how much investors are paying "
                "for each unit of reported earnings."
            ),
            "interpretation": interpretations.get(
                comparison,
                "The historical P/E comparison is unavailable.",
            ),
            "investor_context": (
                "A lower P/E is not automatically better or proof "
                "that a stock is undervalued. Reported P/E may use "
                "different market prices or reporting dates."
            ),
            "status": comparison or "unavailable",
        }

    explanations["pe"] = pe_explanation

    return {
        "explanations": explanations,
        "data_basis": {
            "report_type": "annual",
            "annual_periods_available": len(annual_reports),
            "latest_fiscal_year": (
                annual_reports[-1].get("fiscal_year") if annual_reports else None
            ),
            "quarterly_data_used": False,
        },
        "disclaimer": (
            "These explanations describe historical reported figures. "
            "They are educational information, not financial advice "
            "or buy/sell recommendations."
        ),
    }


def analyze_financial_reports(
    symbol: str,
    reports: list[dict],
) -> dict:
    normalized = normalize_reports(reports)
    sorted_reports = sort_reports(normalized)
    print(f"\n--- FINANCIAL REPORT DEBUG: {symbol} ---")
    print("KAHL REPORT:", normalized)

    for report in sorted_reports:
        print(
            {
                "type": report.get("type"),
                "fiscal_year": report.get("fiscal_year"),
                "quarter": report.get("quarter"),
                "available_fields": list(report.keys()),
            }
        )

    print("--- END DEBUG ---\n")

    annual_reports = [
        report
        for report in sorted_reports
        if report.get("type") in ("annual", "annual report")
    ]

    quarterly_reports = [
        report
        for report in sorted_reports
        if report.get("type") in ("quarterly", "quarterly report")
    ]

    duplicate_periods = find_duplicate_periods(sorted_reports)

    selected_annual, annual_duplicates_resolved = _deduplicate_annual_reports(
        annual_reports
    )
    selected_quarterly = sort_reports(quarterly_reports)

    latest_quarterly = selected_quarterly[-1] if selected_quarterly else None

    trends = {
        field: _calculate_trend(selected_annual, field)
        for field in ("eps", "profit", "net_worth_per_share")
    }

    valuation = {
        "pe": analyze_pe_valuation(selected_annual),
        "net_worth_per_share": trends["net_worth_per_share"],
    }

    missing_values = sum(
        report.get(field) is None
        for report in selected_annual
        for field in NUMERIC_FIELDS
    )

    data_quality = {
        "missing_values_in_selected_annual_reports": missing_values,
        "has_duplicate_periods": bool(duplicate_periods),
        "duplicate_periods": duplicate_periods,
        "annual_duplicates_resolved": annual_duplicates_resolved,
        "quarterly_trends_included": False,
    }

    company_summary = _build_company_summary(
        trends=trends,
        valuation=valuation["pe"],
        data_quality=data_quality,
    )

    financial_explanations = _build_financial_explanations(
        trends=trends,
        valuation=valuation,
        annual_reports=selected_annual,
    )

    if len(selected_annual) < 2:
        analysis_status = "insufficient_data"
    else:
        analysis_status = "calculated"

    return {
        "symbol": symbol.upper(),
        "reports_count": len(sorted_reports),
        "annual_reports_count": len(annual_reports),
        "quarterly_reports_count": len(quarterly_reports),
        "annual_periods_analyzed": len(selected_annual),
        "duplicate_periods": duplicate_periods,
        "annual_duplicates_resolved": annual_duplicates_resolved,
        "data_quality": data_quality,
        "annual_trends": trends,
        "valuation": valuation,
        "insights": _build_insights(trends),
        "company_summary": company_summary,
        "annual_reports_used": selected_annual,
        "analysis_status": analysis_status,
        "financial_explanations": financial_explanations,
        "quarterly_reports": selected_quarterly,
        "latest_quarterly": latest_quarterly,
        "latest_quarterly_available": latest_quarterly is not None,
    }
