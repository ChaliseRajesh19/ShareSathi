from dataclasses import dataclass
from collections import defaultdict


@dataclass
class Transaction:
    symbol: str
    type: str  # "BUY" or "SELL"
    quantity: int
    price: float
    fees: float = 0.0


def calculate_portfolio(transactions, current_prices):
    """
    Calculate portfolio holdings using the weighted-average cost method.

    Buy fees are added to acquisition cost.
    Sell fees are deducted from sale proceeds.
    Current prices are supplied separately from transactions.
    """

    holdings = defaultdict(
        lambda: {
            "quantity": 0,
            "cost_basis": 0.0,
            "realized_pnl": 0.0,
            "total_buy_fees": 0.0,
            "total_sell_fees": 0.0,
        }
    )

    for tx in transactions:
        symbol = tx.symbol.strip().upper()

        if not symbol:
            raise ValueError("Transaction symbol cannot be empty.")

        if tx.type not in {"BUY", "SELL"}:
            raise ValueError(f"Invalid transaction type: {tx.type}")

        if (
            not isinstance(tx.quantity, int)
            or isinstance(tx.quantity, bool)
            or tx.quantity <= 0
        ):
            raise ValueError("Quantity must be a positive integer.")

        if tx.price <= 0:
            raise ValueError("Transaction price must be greater than zero.")

        if tx.fees < 0:
            raise ValueError("Fees cannot be negative.")

        holding = holdings[symbol]

        if tx.type == "BUY":
            holding["quantity"] += tx.quantity
            holding["cost_basis"] += tx.quantity * tx.price + tx.fees
            holding["total_buy_fees"] += tx.fees

        else:  # SELL
            if tx.quantity > holding["quantity"]:
                raise ValueError(
                    f"Cannot sell {tx.quantity} shares of {symbol}; "
                    f"only {holding['quantity']} available."
                )

            average_cost = holding["cost_basis"] / holding["quantity"]
            cost_of_shares_sold = average_cost * tx.quantity
            net_sale_proceeds = tx.quantity * tx.price - tx.fees

            holding["realized_pnl"] += net_sale_proceeds - cost_of_shares_sold
            holding["cost_basis"] -= cost_of_shares_sold
            holding["quantity"] -= tx.quantity
            holding["total_sell_fees"] += tx.fees

            # Avoid tiny floating-point leftovers when all shares are sold.
            if holding["quantity"] == 0:
                holding["cost_basis"] = 0.0

    results = {}
    total_invested = 0.0
    total_market_value = 0.0
    total_realized_pnl = 0.0
    total_unrealized_pnl = 0.0

    for symbol, holding in holdings.items():
        quantity = holding["quantity"]
        cost_basis = holding["cost_basis"]
        realized_pnl = holding["realized_pnl"]

        if quantity > 0 and symbol not in current_prices:
            raise ValueError(f"Missing current market price for {symbol}.")

        market_price = current_prices.get(symbol, 0.0)

        if market_price < 0:
            raise ValueError(f"Current price for {symbol} cannot be negative.")

        market_value = quantity * market_price
        unrealized_pnl = market_value - cost_basis

        average_cost = cost_basis / quantity if quantity else 0.0
        unrealized_return_pct = (
            (unrealized_pnl / cost_basis) * 100 if cost_basis > 0 else 0.0
        )

        results[symbol] = {
            "quantity": quantity,
            "average_cost": round(average_cost, 2),
            "cost_basis": round(cost_basis, 2),
            "current_price": market_price,
            "market_value": round(market_value, 2),
            "realized_pnl": round(realized_pnl, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "unrealized_return_pct": round(unrealized_return_pct, 2),
            "total_buy_fees": round(holding["total_buy_fees"], 2),
            "total_sell_fees": round(holding["total_sell_fees"], 2),
        }

        total_invested += cost_basis
        total_market_value += market_value
        total_realized_pnl += realized_pnl
        total_unrealized_pnl += unrealized_pnl

    return {
        "holdings": results,
        "summary": {
            "total_invested": round(total_invested, 2),
            "total_market_value": round(total_market_value, 2),
            "total_realized_pnl": round(total_realized_pnl, 2),
            "total_unrealized_pnl": round(total_unrealized_pnl, 2),
            "total_pnl": round(total_realized_pnl + total_unrealized_pnl, 2),
            "number_of_companies": sum(
                1 for h in results.values() if h["quantity"] > 0
            ),
        },
    }
