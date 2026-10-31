import pytest

from portfolio import Transaction, calculate_portfolio


def test_multiple_buys_and_unrealized_profit():
    transactions = [
        Transaction("NABIL", "BUY", 10, 400),
        Transaction("NABIL", "BUY", 5, 500),
    ]

    result = calculate_portfolio(transactions, {"NABIL": 450})
    holding = result["holdings"]["NABIL"]
    summary = result["summary"]

    assert holding["quantity"] == 15
    assert holding["average_cost"] == 433.33
    assert holding["cost_basis"] == 6500
    assert holding["market_value"] == 6750
    assert holding["unrealized_pnl"] == 250
    assert holding["unrealized_return_pct"] == 3.85
    assert summary["total_pnl"] == 250


def test_partial_sale():
    transactions = [
        Transaction("NABIL", "BUY", 10, 400),
        Transaction("NABIL", "BUY", 5, 500),
        Transaction("NABIL", "SELL", 5, 480),
    ]

    result = calculate_portfolio(transactions, {"NABIL": 450})
    holding = result["holdings"]["NABIL"]

    assert holding["quantity"] == 10
    assert holding["cost_basis"] == pytest.approx(4333.33, abs=0.01)
    assert holding["realized_pnl"] == pytest.approx(233.33, abs=0.01)
    assert holding["unrealized_pnl"] == pytest.approx(166.67, abs=0.01)


def test_fees_are_included():
    transactions = [
        Transaction("NABIL", "BUY", 10, 400, fees=20),
        Transaction("NABIL", "SELL", 2, 450, fees=10),
    ]

    result = calculate_portfolio(transactions, {"NABIL": 450})
    holding = result["holdings"]["NABIL"]

    # Acquisition cost = 4,020; average cost = 402.
    # Cost basis sold = 804; net sale proceeds = 890.
    assert holding["quantity"] == 8
    assert holding["cost_basis"] == pytest.approx(3216)
    assert holding["realized_pnl"] == pytest.approx(86)
    assert holding["unrealized_pnl"] == pytest.approx(384)


def test_cannot_sell_more_than_owned():
    transactions = [
        Transaction("NABIL", "BUY", 5, 400),
        Transaction("NABIL", "SELL", 6, 450),
    ]

    with pytest.raises(ValueError, match="only 5 available"):
        calculate_portfolio(transactions, {"NABIL": 450})


def test_invalid_quantity_is_rejected():
    transactions = [Transaction("NABIL", "BUY", 0, 400)]

    with pytest.raises(ValueError, match="positive integer"):
        calculate_portfolio(transactions, {"NABIL": 450})


def test_missing_market_price_is_rejected():
    transactions = [Transaction("NABIL", "BUY", 5, 400)]

    with pytest.raises(ValueError, match="Missing current market price"):
        calculate_portfolio(transactions, {})


def test_selling_all_shares():
    transactions = [
        Transaction("NABIL", "BUY", 10, 400),
        Transaction("NABIL", "SELL", 10, 450),
    ]

    result = calculate_portfolio(transactions, {"NABIL": 450})
    holding = result["holdings"]["NABIL"]

    assert holding["quantity"] == 0
    assert holding["cost_basis"] == 0
    assert holding["realized_pnl"] == 500
    assert result["summary"]["number_of_companies"] == 0
