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


@app.get("/api/prices")
def get_prices():
    return get_market_prices()


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
