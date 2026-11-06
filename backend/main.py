import os
from datetime import datetime
from decimal import Decimal
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from portfolio import Transaction, calculate_portfolio
from price_service import get_market_prices
from ipo_service import get_ipo_overview
from company_service import get_company_overview
from historical_ipo_services import get_stock_history
from financial_data_service import get_financial_data
from financial_analysis_service import analyze_financial_reports
from fastapi import Query
from financial_comparison_service import compare_companies
import logging
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from price_alerts import check_price_alerts

logger = logging.getLogger(__name__)
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
DEV_USER_ID = os.getenv("DEV_USER_ID")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from backend/.env")

if not DEV_USER_ID:
    raise RuntimeError("DEV_USER_ID is missing from backend/.env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(
    title="Mero Invest AI API",
    description="Portfolio calculations and transaction storage.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TransactionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    symbol: str = Field(min_length=1, max_length=20)
    type: Literal["BUY", "SELL"]
    quantity: int = Field(gt=0)
    price: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    fees: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)


class PortfolioRequest(BaseModel):
    transactions: list[TransactionInput]
    current_prices: dict[str, float]


class SavedPortfolioRequest(BaseModel):
    current_prices: dict[str, float]


class PriceAlertCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    condition: str
    target_price: float = Field(gt=0)


def get_transactions(connection):
    rows = (
        connection.execute(
            text("""
            SELECT id, symbol, transaction_type, quantity,
                   price, fees, transaction_date
            FROM public.transactions
            WHERE user_id = CAST(:user_id AS uuid)
            ORDER BY transaction_date ASC, id ASC
        """),
            {"user_id": DEV_USER_ID},
        )
        .mappings()
        .all()
    )

    return [
        {
            "id": row["id"],
            "symbol": row["symbol"],
            "type": row["transaction_type"],
            "quantity": row["quantity"],
            "price": float(row["price"]),
            "fees": float(row["fees"]),
            "transaction_date": row["transaction_date"].isoformat(),
        }
        for row in rows
    ]


def to_engine_transactions(records):
    return [
        Transaction(
            symbol=record["symbol"],
            type=record["type"],
            quantity=record["quantity"],
            price=record["price"],
            fees=record["fees"],
        )
        for record in records
    ]


@app.get("/")
def health_check():
    return {
        "message": "Mero Invest AI API is running",
        "version": "0.2.0",
    }


@app.post("/api/portfolio/calculate")
def calculate(request: PortfolioRequest):
    try:
        transactions = [
            Transaction(
                symbol=tx.symbol,
                type=tx.type,
                quantity=tx.quantity,
                price=float(tx.price),
                fees=float(tx.fees),
            )
            for tx in request.transactions
        ]

        prices = {
            symbol.strip().upper(): price
            for symbol, price in request.current_prices.items()
        }

        return calculate_portfolio(transactions, prices)

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/transactions")
def create_transaction(request: TransactionInput):
    symbol = request.symbol.upper()

    try:
        with engine.begin() as connection:
            existing = get_transactions(connection)

            candidate = existing + [
                {
                    "symbol": symbol,
                    "type": request.type,
                    "quantity": request.quantity,
                    "price": float(request.price),
                    "fees": float(request.fees),
                }
            ]

            # Validate the full transaction sequence before inserting.
            # Dummy prices are only for validation; they are not saved.
            validation_prices = {record["symbol"].upper(): 1.0 for record in candidate}

            calculate_portfolio(
                to_engine_transactions(candidate),
                validation_prices,
            )

            row = (
                connection.execute(
                    text("""
                    INSERT INTO public.transactions (
                        user_id, symbol, transaction_type,
                        quantity, price, fees
                    )
                    VALUES (
                        CAST(:user_id AS uuid), :symbol, :type,
                        :quantity, :price, :fees
                    )
                    RETURNING id, symbol, transaction_type,
                              quantity, price, fees, transaction_date
                """),
                    {
                        "user_id": DEV_USER_ID,
                        "symbol": symbol,
                        "type": request.type,
                        "quantity": request.quantity,
                        "price": request.price,
                        "fees": request.fees,
                    },
                )
                .mappings()
                .one()
            )

            return {
                "message": "Transaction saved successfully",
                "transaction": {
                    "id": row["id"],
                    "symbol": row["symbol"],
                    "type": row["transaction_type"],
                    "quantity": row["quantity"],
                    "price": float(row["price"]),
                    "fees": float(row["fees"]),
                    "transaction_date": row["transaction_date"].isoformat(),
                },
            }

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SQLAlchemyError:
        raise HTTPException(
            status_code=500,
            detail="Database operation failed. Check the backend logs.",
        )


@app.get("/api/transactions")
def list_transactions():
    try:
        with engine.connect() as connection:
            transactions = get_transactions(connection)

        return {"transactions": transactions}

    except SQLAlchemyError:
        logger.exception("Database error while retrieving transactions")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve transactions. Check the backend logs.",
        )
    except Exception:
        logger.exception("Unexpected error while retrieving transactions")
        raise HTTPException(
            status_code=500,
            detail="Unexpected error while retrieving transactions.",
        )


@app.post("/api/portfolio/calculate-saved")
def calculate_saved_portfolio(request: SavedPortfolioRequest):
    try:
        with engine.connect() as connection:
            records = get_transactions(connection)

        prices = {
            symbol.strip().upper(): price
            for symbol, price in request.current_prices.items()
        }

        result = calculate_portfolio(
            to_engine_transactions(records),
            prices,
        )

        return {
            **result,
            "transactions_count": len(records),
        }

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SQLAlchemyError:
        raise HTTPException(
            status_code=500,
            detail="Could not calculate the saved portfolio. Check the backend logs.",
        )


class WatchlistInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    symbol: str = Field(min_length=1, max_length=20)


class WatchlistResponse(BaseModel):
    symbol: str
    created_at: datetime


@app.get("/api/prices")
def get_prices():
    try:
        market_data = get_market_prices()

        if not market_data.get("stale", False):
            check_price_alerts(
                engine=engine,
                user_id=DEV_USER_ID,
                prices=market_data.get("prices", []),
            )

        return market_data

    except RuntimeError as exc:
        logger.exception("Failed to retrieve market prices")
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


@app.get("/api/ipos")
def get_ipos():
    return get_ipo_overview()


@app.get("/api/companies")
def get_companies():
    return get_company_overview()


@app.get("/api/stocks/{symbol}/history")
def stock_history(symbol: str):
    try:
        return get_stock_history(symbol)
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


@app.get("/api/financials")
def list_financials(symbol: str | None = None):
    try:
        result = get_financial_data(symbol)

        if symbol and not result["companies"]:
            raise HTTPException(
                status_code=404,
                detail=f"No financial reports found for {symbol.upper()}.",
            )

        return result

    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


@app.get("/api/financial-analysis/{symbol}")
def get_financial_analysis(symbol: str):
    try:
        result = get_financial_data(symbol)

        if not result["companies"]:
            raise HTTPException(
                status_code=404,
                detail=f"No financial reports found for {symbol.upper()}.",
            )

        company = result["companies"][0]

        return analyze_financial_reports(
            symbol=company["symbol"],
            reports=company["reports"],
        )

    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


@app.get("/api/financial-comparison")
def get_financial_comparison(
    symbols: str = Query(
        ...,
        description="Exactly two comma-separated symbols, e.g. NABIL,ACLBSL",
    )
):
    parts = [item.strip().upper() for item in symbols.split(",") if item.strip()]

    if len(parts) != 2:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly two symbols, e.g. NABIL,ACLBSL.",
        )

    if parts[0] == parts[1]:
        raise HTTPException(
            status_code=400,
            detail="Choose two different company symbols.",
        )

    analyses = []

    try:
        for symbol in parts:
            result = get_financial_data(symbol)
            companies = result.get("companies", [])

            if not companies:
                raise HTTPException(
                    status_code=404,
                    detail=f"No financial reports found for {symbol}.",
                )

            company = companies[0]

            analysis = analyze_financial_reports(
                symbol=company["symbol"],
                reports=company["reports"],
            )

            analyses.append(analysis)

        return compare_companies(analyses[0], analyses[1])

    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


@app.get("/api/watchlist")
def get_watchlist():
    try:
        with engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""
                        SELECT symbol, created_at
                        FROM public.watchlist
                        WHERE user_id = CAST(:user_id AS uuid)
                        ORDER BY created_at DESC
                    """),
                    {"user_id": DEV_USER_ID},
                )
                .mappings()
                .all()
            )

        return {
            "watchlist": [
                {
                    "symbol": row["symbol"],
                    "created_at": row["created_at"].isoformat(),
                }
                for row in rows
            ]
        }

    except SQLAlchemyError:
        logger.exception("Failed to retrieve watchlist")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve watchlist.",
        )


@app.post("/api/watchlist")
def add_to_watchlist(request: WatchlistInput):
    symbol = request.symbol.upper()

    if not symbol.replace(".", "").replace("&", "").replace("-", "").isalnum():
        raise HTTPException(
            status_code=422,
            detail="Enter a valid stock symbol.",
        )

    try:
        with engine.begin() as connection:
            row = (
                connection.execute(
                    text("""
                        INSERT INTO public.watchlist (user_id, symbol)
                        VALUES (CAST(:user_id AS uuid), :symbol)
                        ON CONFLICT (user_id, symbol) DO NOTHING
                        RETURNING symbol, created_at
                    """),
                    {
                        "user_id": DEV_USER_ID,
                        "symbol": symbol,
                    },
                )
                .mappings()
                .first()
            )

        if row is None:
            raise HTTPException(
                status_code=409,
                detail=f"{symbol} is already in your watchlist.",
            )

        return {
            "message": f"{symbol} added to watchlist.",
            "symbol": row["symbol"],
            "created_at": row["created_at"].isoformat(),
        }

    except SQLAlchemyError:
        logger.exception("Failed to add stock to watchlist")
        raise HTTPException(
            status_code=500,
            detail="Could not add stock to watchlist.",
        )


@app.delete("/api/watchlist/{symbol}")
def remove_from_watchlist(symbol: str):
    symbol = symbol.strip().upper()

    try:
        with engine.begin() as connection:
            result = connection.execute(
                text("""
                    DELETE FROM public.watchlist
                    WHERE user_id = CAST(:user_id AS uuid)
                    AND symbol = :symbol
                """),
                {
                    "user_id": DEV_USER_ID,
                    "symbol": symbol,
                },
            )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail=f"{symbol} is not in your watchlist.",
            )

        return {"message": f"{symbol} removed from watchlist."}

    except SQLAlchemyError:
        logger.exception("Failed to remove stock from watchlist")
        raise HTTPException(
            status_code=500,
            detail="Could not remove stock from watchlist.",
        )


@app.post("/api/price-alerts")
def create_price_alert(alert: PriceAlertCreate):
    symbol = alert.symbol.strip().upper()
    condition = alert.condition.strip().lower()

    if condition not in ("above", "below"):
        raise HTTPException(
            status_code=400,
            detail="Condition must be 'above' or 'below'.",
        )

    try:
        with engine.begin() as conn:
            result = (
                conn.execute(
                    text("""
                    INSERT INTO public.price_alerts
                        (user_id, symbol, condition, target_price)
                    VALUES
                        (:user_id, :symbol, :condition, :target_price)
                    RETURNING id, symbol, condition, target_price, status, created_at
                """),
                    {
                        "user_id": DEV_USER_ID,
                        "symbol": symbol,
                        "condition": condition,
                        "target_price": alert.target_price,
                    },
                )
                .mappings()
                .first()
            )

        return {"alert": dict(result)}

    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=409,
                detail="This price alert already exists.",
            )
        raise HTTPException(status_code=500, detail="Could not create price alert.")


@app.get("/api/price-alerts")
def get_price_alerts():
    with engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
                SELECT id, symbol, condition, target_price, status,
                       created_at, triggered_at
                FROM public.price_alerts
                WHERE user_id = :user_id
                ORDER BY created_at DESC
            """),
                {"user_id": DEV_USER_ID},
            )
            .mappings()
            .all()
        )

    return {"alerts": [dict(row) for row in rows]}


@app.delete("/api/price-alerts/{alert_id}")
def delete_price_alert(alert_id: int):
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                DELETE FROM public.price_alerts
                WHERE id = :alert_id AND user_id = :user_id
                RETURNING id
            """),
            {
                "alert_id": alert_id,
                "user_id": DEV_USER_ID,
            },
        ).first()

    if not result:
        raise HTTPException(status_code=404, detail="Price alert not found.")

    return {"message": "Price alert deleted successfully."}


@app.get("/api/notifications")
def get_notifications():
    try:
        with engine.connect() as connection:
            notifications = (
                connection.execute(
                    text("""
                        SELECT
                            id,
                            alert_id,
                            symbol,
                            message,
                            is_read,
                            created_at
                        FROM public.notifications
                        WHERE user_id = CAST(:user_id AS uuid)
                        ORDER BY created_at DESC
                    """),
                    {"user_id": DEV_USER_ID},
                )
                .mappings()
                .all()
            )

            unread_count = sum(
                1 for notification in notifications if not notification["is_read"]
            )

            return {
                "notifications": [dict(notification) for notification in notifications],
                "unread_count": unread_count,
            }

    except SQLAlchemyError as exc:
        logger.exception("Failed to retrieve notifications")
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve notifications.",
        ) from exc


@app.patch("/api/notifications/{notification_id}/read")
def mark_notification_as_read(notification_id: int):
    try:
        with engine.begin() as connection:
            result = (
                connection.execute(
                    text("""
                    UPDATE public.notifications
                    SET is_read = TRUE
                    WHERE id = :notification_id
                      AND user_id = CAST(:user_id AS uuid)
                    RETURNING id, is_read
                """),
                    {
                        "notification_id": notification_id,
                        "user_id": DEV_USER_ID,
                    },
                )
                .mappings()
                .first()
            )

            if result is None:
                raise HTTPException(
                    status_code=404,
                    detail="Notification not found.",
                )

            return {
                "message": "Notification marked as read.",
                "notification": dict(result),
            }

    except SQLAlchemyError as exc:
        logger.exception("Failed to mark notification as read")
        raise HTTPException(
            status_code=500,
            detail="Failed to update notification.",
        ) from exc


@app.patch("/api/notifications/read-all")
def mark_all_notifications_as_read():
    try:
        with engine.begin() as connection:
            result = connection.execute(
                text("""
                    UPDATE public.notifications
                    SET is_read = TRUE
                    WHERE user_id = CAST(:user_id AS uuid)
                      AND is_read = FALSE
                """),
                {"user_id": DEV_USER_ID},
            )

            return {
                "message": "All notifications marked as read.",
                "updated_count": result.rowcount,
            }

    except SQLAlchemyError as exc:
        logger.exception("Failed to mark all notifications as read")
        raise HTTPException(
            status_code=500,
            detail="Failed to update notifications.",
        ) from exc
