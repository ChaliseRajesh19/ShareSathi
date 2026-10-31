from math import isclose

METRICS = {
    "eps": {
        "label": "EPS",
        "unit": "per share",
        "note": "Higher EPS alone does not establish better investment value.",
    },
    "profit": {
        "label": "Reported profit",
        "unit": "reported amount",
        "note": "Absolute profit depends partly on company size.",
    },
    "pe": {
        "label": "Reported P/E",
        "unit": "ratio",
        "note": "A lower P/E is not automatically better.",
    },
    "net_worth_per_share": {
        "label": "Net worth per share",
        "unit": "per share",
        "note": "This is book value per share, not market value.",
    },
}


def _number(value):
    if value is None or isinstance(value, bool):
        return None

    try:
        result = float(value)

        if result != result or abs(result) == float("inf"):
            return None

        return result

    except (TypeError, ValueError, OverflowError):
        return None


def _fiscal_year_key(value):
    """Sort common fiscal-year strings chronologically."""
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


def _get_annual_reports(analysis):
    reports = analysis.get("annual_reports_used") or []

    valid_reports = [
        report
        for report in reports
        if isinstance(report, dict) and report.get("fiscal_year")
    ]

    return sorted(
        valid_reports,
        key=lambda report: _fiscal_year_key(report.get("fiscal_year")),
    )


def _latest_annual_report(analysis):
    reports = _get_annual_reports(analysis)
    return reports[-1] if reports else None


def _report_for_year(analysis, fiscal_year):
    """Find a company's annual report for a specific fiscal year."""
    for report in _get_annual_reports(analysis):
        if str(report.get("fiscal_year")) == str(fiscal_year):
            return report

    return None


def _build_metric_comparisons(
    report_a,
    report_b,
    symbol_a,
    symbol_b,
    fiscal_year,
):
    """Build comparable metrics for two reports from the same fiscal year."""
    metrics = {}

    for key, definition in METRICS.items():
        value_a = _number(report_a.get(key)) if report_a else None
        value_b = _number(report_b.get(key)) if report_b else None

        metrics[key] = {
            **definition,
            "values": {
                symbol_a: {
                    "value": value_a,
                    "fiscal_year": fiscal_year,
                },
                symbol_b: {
                    "value": value_b,
                    "fiscal_year": fiscal_year,
                },
            },
            "comparison": _compare_values(
                value_a,
                value_b,
                symbol_a,
                symbol_b,
            ),
            "comparison_period": fiscal_year,
        }

    return metrics


def _get_fiscal_years(analysis):
    reports = _get_annual_reports(analysis)

    return sorted(
        {str(report["fiscal_year"]) for report in reports if report.get("fiscal_year")},
        key=_fiscal_year_key,
    )


def _compare_values(value_a, value_b, symbol_a, symbol_b):
    if value_a is None or value_b is None:
        return {
            "result": "unavailable",
            "message": "Insufficient data to compare both companies.",
        }

    if isclose(value_a, value_b, rel_tol=1e-9, abs_tol=1e-9):
        return {
            "result": "equal",
            "message": "The reported values are approximately equal.",
        }

    higher_symbol = symbol_a if value_a > value_b else symbol_b

    return {
        "result": "higher_for_" + higher_symbol,
        "message": f"{higher_symbol} has the higher reported value.",
    }


def _trend_summary(analysis, metric):
    trend = (analysis.get("annual_trends") or {}).get(metric)

    if not trend:
        return None

    return trend


def _build_period_alignment(
    symbol_a,
    symbol_b,
    years_a,
    years_b,
    latest_year_a,
    latest_year_b,
):
    set_a = set(years_a)
    set_b = set(years_b)

    common_years = sorted(
        set_a.intersection(set_b),
        key=_fiscal_year_key,
    )

    only_a = sorted(set_a - set_b, key=_fiscal_year_key)
    only_b = sorted(set_b - set_a, key=_fiscal_year_key)

    if not years_a or not years_b:
        status = "insufficient_data"
        message = "At least one company has no usable annual reports."

    elif latest_year_a == latest_year_b:
        status = "aligned"
        message = "The latest annual reports cover the same fiscal year."

    else:
        status = "different_periods"
        message = "The latest annual reports cover different fiscal years."

    return {
        "status": status,
        "latest_fiscal_years": {
            symbol_a: latest_year_a,
            symbol_b: latest_year_b,
        },
        "available_fiscal_years": {
            symbol_a: years_a,
            symbol_b: years_b,
        },
        "common_fiscal_years": common_years,
        "only_available_for": {
            symbol_a: only_a,
            symbol_b: only_b,
        },
        "latest_periods_match": (
            latest_year_a is not None and latest_year_a == latest_year_b
        ),
        "message": message,
    }


def compare_companies(analysis_a, analysis_b):
    symbol_a = str(analysis_a.get("symbol", "")).upper()
    symbol_b = str(analysis_b.get("symbol", "")).upper()

    if not symbol_a or not symbol_b:
        raise ValueError("Both company analyses must contain a symbol.")

    if symbol_a == symbol_b:
        raise ValueError("Choose two different companies to compare.")

    reports_a = _get_annual_reports(analysis_a)
    reports_b = _get_annual_reports(analysis_b)

    report_a = reports_a[-1] if reports_a else None
    report_b = reports_b[-1] if reports_b else None

    year_a = report_a.get("fiscal_year") if report_a else None
    year_b = report_b.get("fiscal_year") if report_b else None

    years_a = _get_fiscal_years(analysis_a)
    years_b = _get_fiscal_years(analysis_b)

    alignment = _build_period_alignment(
        symbol_a=symbol_a,
        symbol_b=symbol_b,
        years_a=years_a,
        years_b=years_b,
        latest_year_a=year_a,
        latest_year_b=year_b,
    )

    # Find the latest fiscal year available for both companies.
    common_years = alignment["common_fiscal_years"]

    latest_common_year = common_years[-1] if common_years else None

    common_report_a = (
        _report_for_year(analysis_a, latest_common_year) if latest_common_year else None
    )

    common_report_b = (
        _report_for_year(analysis_b, latest_common_year) if latest_common_year else None
    )

    latest_common_period_metrics = (
        _build_metric_comparisons(
            common_report_a,
            common_report_b,
            symbol_a,
            symbol_b,
            latest_common_year,
        )
        if common_report_a and common_report_b
        else {}
    )

    # Only compare metric values when both latest reports cover
    # the same fiscal year.
    can_compare_latest_metrics = (
        year_a is not None and year_b is not None and str(year_a) == str(year_b)
    )

    metrics = {}

    for key, definition in METRICS.items():
        value_a = _number(report_a.get(key)) if report_a else None
        value_b = _number(report_b.get(key)) if report_b else None

        if not can_compare_latest_metrics:
            comparison = {
                "result": "not_comparable",
                "message": (
                    "Latest fiscal years differ. "
                    "Metric comparison is withheld to avoid "
                    "comparing different reporting periods."
                ),
            }
        else:
            comparison = _compare_values(
                value_a,
                value_b,
                symbol_a,
                symbol_b,
            )

        metrics[key] = {
            **definition,
            "values": {
                symbol_a: {
                    "value": value_a,
                    "fiscal_year": year_a,
                },
                symbol_b: {
                    "value": value_b,
                    "fiscal_year": year_b,
                },
            },
            "comparison": comparison,
            "comparison_period": (year_a if can_compare_latest_metrics else None),
        }

    return {
        "companies": [symbol_a, symbol_b],
        # Retained for compatibility with the existing response.
        "fiscal_year_alignment": {
            "status": alignment["status"],
            "fiscal_years": alignment["latest_fiscal_years"],
            "message": alignment["message"],
        },
        # More detailed reporting-period information.
        "period_coverage": alignment,
        "metrics": metrics,
        "trends": {
            symbol_a: {
                "eps": _trend_summary(analysis_a, "eps"),
                "profit": _trend_summary(analysis_a, "profit"),
            },
            symbol_b: {
                "eps": _trend_summary(analysis_b, "eps"),
                "profit": _trend_summary(analysis_b, "profit"),
            },
        },
        "data_quality": {
            symbol_a: analysis_a.get("data_quality", {}),
            symbol_b: analysis_b.get("data_quality", {}),
        },
        "limitations": [
            "Comparisons use the latest selected annual report for each company.",
            "Metric comparisons are withheld when the latest fiscal years differ.",
            "Missing metrics are reported as unavailable rather than filled from older reports.",
            "Available fiscal-year coverage may differ between companies.",
            "Higher or lower individual metrics do not establish an overall investment winner.",
            "This comparison is informational, not a buy or sell recommendation.",
        ],
        "is_investment_recommendation": False,
        "latest_common_period_comparison": {
            "fiscal_year": latest_common_year,
            "available": bool(latest_common_period_metrics),
            "metrics": latest_common_period_metrics,
            "message": (
                f"Both companies are compared using fiscal year {latest_common_year}."
                if latest_common_period_metrics
                else "No common fiscal year is available for comparison."
            ),
        },
    }
