
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    calculateSavedPortfolio,
    getMarketPrices,
    getTransactions,
    type Holding,
    type MarketPricesResponse,
    type Portfolio,
    type Transaction,
} from "@/lib/api";

const money = new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 2,
});


function formatNPR(value: number) {
    return money.format(value);
}

function formatDate(value: string | null | undefined) {
    if (!value) return "Unavailable";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function formatPercent(value: number) {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

type HistoricalPrice = {
    date: string;
    close: number | null;
};

type HistoryResponse = {
    symbol: string;
    history: HistoricalPrice[];
};

type PortfolioHistoryPoint = {
    date: string;
    value: number;
};

type ChartPeriod = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

function getPortfolioHistory(
    transactions: Transaction[],
    histories: Record<string, HistoricalPrice[]>
): PortfolioHistoryPoint[] {
    const dates = new Set<string>();

    Object.values(histories).forEach((history) => {
        history.forEach((item) => {
            if (item.close != null && Number.isFinite(Number(item.close))) {
                dates.add(item.date);
            }
        });
    });

    return Array.from(dates)
        .sort()
        .map((date) => {
            const prices = new Map<string, number>();

            for (const [symbol, history] of Object.entries(histories)) {
                const available = history
                    .filter(
                        (item) =>
                            item.date <= date &&
                            item.close != null &&
                            Number.isFinite(Number(item.close))
                    )
                    .sort((a, b) => a.date.localeCompare(b.date));

                const latest = available[available.length - 1];

                if (latest) {
                    prices.set(symbol, Number(latest.close));
                }
            }

            const quantities: Record<string, number> = {};

            for (const transaction of [...transactions].sort(
                (a, b) =>
                    new Date(a.transaction_date).getTime() -
                    new Date(b.transaction_date).getTime()
            )) {
                const transactionDate = transaction.transaction_date.slice(0, 10);

                if (transactionDate > date) continue;

                const symbol = transaction.symbol.toUpperCase();

                quantities[symbol] ??= 0;

                quantities[symbol] +=
                    transaction.type === "BUY"
                        ? transaction.quantity
                        : -transaction.quantity;
            }

            let value = 0;
            let complete = true;

            for (const [symbol, quantity] of Object.entries(quantities)) {
                if (quantity <= 0) continue;

                const price = prices.get(symbol);

                if (price === undefined) {
                    complete = false;
                    break;
                }

                value += quantity * price;
            }

            return {
                date,
                value: complete ? value : NaN,
            };
        })
        .filter((point) => Number.isFinite(point.value));
}


function pnlClass(value: number) {
    if (value > 0) return "portfolio-positive";
    if (value < 0) return "portfolio-negative";
    return "";
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Something went wrong.";
}


export default function MyPortfolio() {
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [marketData, setMarketData] =
        useState<MarketPricesResponse | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("market_value");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const [historicalPrices, setHistoricalPrices] = useState<
        Record<string, HistoricalPrice[]>
    >({});
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState("");
    const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("1M");


    const loadPortfolio = useCallback(async (isRefresh = false) => {
        if (isRefresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }


        setError("");

        try {
            const [market, transactionResponse] = await Promise.all([
                getMarketPrices(),
                getTransactions(),
            ]);

            setMarketData(market);
            setTransactions(transactionResponse.transactions);

            const currentPrices: Record<string, number> = {};

            for (const item of market.prices) {
                currentPrices[item.symbol.toUpperCase()] = item.price;
            }

            const calculated = await calculateSavedPortfolio(currentPrices);

            setPortfolio(calculated);

            setSelectedSymbol((previous) => {
                if (
                    previous &&
                    calculated.holdings[previous]
                ) {
                    return previous;
                }

                return Object.keys(calculated.holdings)[0] ?? null;
            });
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);
    useEffect(() => {
        void loadPortfolio();

        const interval = window.setInterval(() => {
            void loadPortfolio();
        }, marketData?.is_live ? 30_000 : 300_000);

        return () => window.clearInterval(interval);
    }, [loadPortfolio, marketData?.is_live]);

    useEffect(() => {
        const symbols = Array.from(
            new Set(transactions.map((item) => item.symbol.toUpperCase()))
        );

        if (symbols.length === 0) {
            setHistoricalPrices({});
            setHistoryError("");
            setHistoryLoading(false);
            return;
        }

        let cancelled = false;

        async function loadAllHistory() {
            setHistoryLoading(true);
            setHistoryError("");

            try {
                const results = await Promise.all(
                    symbols.map(async (symbol) => {
                        const response = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"}/api/stocks/${encodeURIComponent(symbol)}/history`,
                            { cache: "no-store" }
                        );

                        if (!response.ok) {
                            throw new Error(`Could not load ${symbol} history`);
                        }

                        const data: HistoryResponse = await response.json();

                        return [symbol, data.history] as const;
                    })
                );

                if (!cancelled) {
                    setHistoricalPrices(Object.fromEntries(results));
                }
            } catch (err) {
                if (!cancelled) {
                    setHistoricalPrices({});
                    setHistoryError(
                        err instanceof Error
                            ? err.message
                            : "Could not load historical prices."
                    );
                }
            } finally {
                if (!cancelled) setHistoryLoading(false);
            }
        }

        void loadAllHistory();

        return () => {
            cancelled = true;
        };
    }, [transactions]);


    const holdings = useMemo(() => {
        if (!portfolio) return [];

        return Object.entries(portfolio.holdings)
            .map(([symbol, holding]) => ({
                symbol,
                ...holding,
            }))
            .filter((holding) => holding.quantity > 0)
            .filter((holding) =>
                holding.symbol.toLowerCase().includes(search.toLowerCase())
            )
            .sort((a, b) => {
                const first = a[sortBy as keyof typeof a];
                const second = b[sortBy as keyof typeof b];

                if (typeof first === "number" && typeof second === "number") {
                    return second - first;
                }

                return a.symbol.localeCompare(b.symbol);
            });
    }, [portfolio, search, sortBy]);

    const selectedHolding: Holding | null = selectedSymbol
        ? portfolio?.holdings[selectedSymbol] ?? null
        : null;

    const selectedTransactions = useMemo(() => {
        if (!selectedSymbol) return [];

        return transactions
            .filter(
                (transaction) =>
                    transaction.symbol.toUpperCase() ===
                    selectedSymbol.toUpperCase()
            )
            .sort(
                (a, b) =>
                    new Date(b.transaction_date).getTime() -
                    new Date(a.transaction_date).getTime()
            );
    }, [transactions, selectedSymbol]);


    const portfolioHistory = useMemo(
        () => getPortfolioHistory(transactions, historicalPrices),
        [transactions, historicalPrices]
    );

    const filteredPortfolioHistory = useMemo(() => {
        if (chartPeriod === "ALL" || portfolioHistory.length === 0) {
            return portfolioHistory;
        }

        const cutoff = new Date();
        const periods: Record<Exclude<ChartPeriod, "ALL">, number> = {
            "1W": 7,
            "1M": 30,
            "3M": 90,
            "6M": 180,
            "1Y": 365,
        };

        cutoff.setDate(cutoff.getDate() - periods[chartPeriod]);

        const cutoffDate = cutoff.toISOString().slice(0, 10);

        return portfolioHistory.filter((point) => point.date >= cutoffDate);
    }, [portfolioHistory, chartPeriod]);

    const portfolioChart = useMemo(() => {
        const points = filteredPortfolioHistory;

        if (points.length === 0) return null;

        const width = 900;
        const height = 280;
        const padding = 32;

        const values = points.map((point) => point.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const plotted = points.map((point, index) => ({
            ...point,
            x:
                padding +
                (index / Math.max(points.length - 1, 1)) *
                (width - padding * 2),
            y:
                height -
                padding -
                ((point.value - min) / range) * (height - padding * 2),
        }));

        return {
            width,
            height,
            padding,
            points: plotted,
            line: plotted.map((point) => `${point.x},${point.y}`).join(" "),
        };
    }, [filteredPortfolioHistory]);


    if (loading) {
        return (
            <section className="my-portfolio">
                <p className="portfolio-muted">Loading your portfolio...</p>
            </section>
        );
    }

    return (
        <section className="my-portfolio">
            <header className="portfolio-header">
                <div>
                    <h1>My Portfolio</h1>
                    <p className="portfolio-muted">
                        Understand your holdings and investment performance.
                    </p>
                </div>

                <button
                    className="portfolio-button"
                    onClick={() => void loadPortfolio(true)}
                    disabled={refreshing}
                >
                    {refreshing ? "Refreshing..." : "Refresh data"}
                </button>
            </header>

            {error && (
                <div className="portfolio-error" role="alert">
                    <p>{error}</p>
                    <button
                        className="portfolio-button"
                        onClick={() => void loadPortfolio()}
                    >
                        Try again
                    </button>
                </div>
            )}

            {marketData && (
                <div className="portfolio-market-status">
                    <strong>
                        {marketData.stale
                            ? "Market data may be outdated"
                            : marketData.is_live
                                ? "Live market data"
                                : "Latest available market session"}
                    </strong>

                    <span>
                        Trading date: {formatDate(marketData.business_date)}
                    </span>

                    {marketData.stale && (
                        <span>
                            The last refresh failed. Check the price date before
                            making decisions.
                        </span>
                    )}
                </div>
            )}

            {portfolio && (
                <>
                    <div className="market-status-banner">
                        <span
                            className={`market-status-dot ${marketData?.market_status === "OPEN" ? "is-open" : "is-closed"
                                }`}
                        />

                        <div>
                            <strong>
                                NEPSE: {marketData?.market_status ?? "Loading"}
                            </strong>

                            <p>
                                {marketData?.is_live
                                    ? "Live market prices"
                                    : "Latest available market prices"}
                                {marketData?.fetched_at &&
                                    ` · Updated ${new Date(
                                        marketData.fetched_at
                                    ).toLocaleTimeString()}`}
                            </p>
                        </div>
                    </div>
                    <div className="portfolio-summary-grid">
                        <SummaryCard
                            label="Portfolio market value"
                            value={formatNPR(
                                portfolio.summary.total_market_value
                            )}
                        />

                        <SummaryCard
                            label="Invested amount"
                            value={formatNPR(
                                portfolio.summary.total_invested
                            )}
                        />

                        <SummaryCard
                            label="Unrealized P/L"
                            value={formatNPR(
                                portfolio.summary.total_unrealized_pnl
                            )}
                            valueClass={pnlClass(
                                portfolio.summary.total_unrealized_pnl
                            )}
                        />

                        <SummaryCard
                            label="Realized P/L"
                            value={formatNPR(
                                portfolio.summary.total_realized_pnl
                            )}
                            valueClass={pnlClass(
                                portfolio.summary.total_realized_pnl
                            )}
                        />

                        <SummaryCard
                            label="Total P/L"
                            value={formatNPR(portfolio.summary.total_pnl)}
                            valueClass={pnlClass(portfolio.summary.total_pnl)}
                        />

                        <SummaryCard
                            label="Companies held"
                            value={String(holdings.length)}
                        />
                    </div>

                    <section className="portfolio-history-card">
                        <div className="portfolio-section-header">
                            <div>
                                <h2>Portfolio Performance</h2>
                                <p className="portfolio-muted">
                                    Historical market value based on recorded transactions
                                    and available closing prices.
                                </p>
                            </div>
                        </div>

                        <div className="portfolio-period-controls">
                            {(["1W", "1M", "3M", "6M", "1Y", "ALL"] as ChartPeriod[]).map(
                                (period) => (
                                    <button
                                        key={period}
                                        type="button"
                                        className={
                                            chartPeriod === period
                                                ? "portfolio-period-button active"
                                                : "portfolio-period-button"
                                        }
                                        onClick={() => setChartPeriod(period)}
                                    >
                                        {period}
                                    </button>
                                )
                            )}
                        </div>

                        {historyLoading && (
                            <p className="portfolio-muted">Loading historical prices...</p>
                        )}

                        {historyError && (
                            <p className="portfolio-error" role="alert">{historyError}</p>
                        )}

                        {!historyLoading && !historyError && portfolioChart && (
                            <>
                                <div className="portfolio-history-latest">
                                    <strong>
                                        {formatNPR(
                                            portfolioChart.points[
                                                portfolioChart.points.length - 1
                                            ].value
                                        )}
                                    </strong>
                                    <span className="portfolio-muted">
                                        Value on{" "}
                                        {formatDate(
                                            portfolioChart.points[
                                                portfolioChart.points.length - 1
                                            ].date
                                        )}
                                    </span>
                                </div>

                                <div className="portfolio-history-chart">
                                    <svg
                                        viewBox={`0 0 ${portfolioChart.width} ${portfolioChart.height}`}
                                        role="img"
                                        aria-label="Historical portfolio market value chart"
                                    >
                                        <defs>
                                            <linearGradient
                                                id="portfolio-area-gradient"
                                                x1="0"
                                                x2="0"
                                                y1="0"
                                                y2="1"
                                            >
                                                <stop offset="0%" stopColor="#5eead4" stopOpacity="0.24" />
                                                <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
                                            </linearGradient>
                                        </defs>
                                        {[0.25, 0.5, 0.75].map((ratio) => (
                                            <line
                                                key={ratio}
                                                x1={portfolioChart.padding}
                                                x2={portfolioChart.width - portfolioChart.padding}
                                                y1={
                                                    portfolioChart.padding +
                                                    ratio *
                                                    (portfolioChart.height - portfolioChart.padding * 2)
                                                }
                                                y2={
                                                    portfolioChart.padding +
                                                    ratio *
                                                    (portfolioChart.height - portfolioChart.padding * 2)
                                                }
                                                className="portfolio-history-grid"
                                            />
                                        ))}
                                        <polygon
                                            points={`${portfolioChart.points[0].x},${portfolioChart.height - portfolioChart.padding} ${portfolioChart.line} ${portfolioChart.points[portfolioChart.points.length - 1].x},${portfolioChart.height - portfolioChart.padding}`}
                                            className="portfolio-history-area"
                                        />
                                        <polyline
                                            points={portfolioChart.line}
                                            fill="none"
                                            className="portfolio-history-line"
                                            strokeWidth="3"
                                            strokeLinejoin="round"
                                            strokeLinecap="round"
                                        />
                                        <circle
                                            cx={portfolioChart.points[portfolioChart.points.length - 1].x}
                                            cy={portfolioChart.points[portfolioChart.points.length - 1].y}
                                            r="5"
                                            className="portfolio-history-point"
                                        />
                                    </svg>
                                </div>

                                <div className="portfolio-history-dates">
                                    <span>{portfolioChart.points[0].date}</span>
                                    <span>
                                        {portfolioChart.points[
                                            portfolioChart.points.length - 1
                                        ].date}
                                    </span>
                                </div>

                                <p className="portfolio-muted">
                                    {portfolioChart.points.length} historical data points.
                                    Values may exclude dates with incomplete price coverage.
                                </p>
                            </>
                        )}

                        {!historyLoading && !historyError && !portfolioChart && (
                            <p className="portfolio-muted">
                                No historical portfolio values are available for this period.
                            </p>
                        )}
                    </section>


                    {holdings.length === 0 ? (
                        <div className="portfolio-empty">
                            <h2>Your portfolio is empty</h2>
                            <p>
                                Add a buy transaction to start tracking your
                                investments here.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="portfolio-section-header">
                                <div>
                                    <h2>Your holdings</h2>
                                    <p className="portfolio-muted">
                                        {holdings.length} companies in your
                                        filtered view
                                    </p>
                                </div>

                                <input
                                    className="portfolio-search"
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                    placeholder="Search symbol..."
                                    aria-label="Search holdings"
                                />
                            </div>

                            <div className="portfolio-table-wrapper">
                                <table className="portfolio-table">
                                    <thead>
                                        <tr>
                                            <th>Company</th>
                                            <th>Quantity</th>
                                            <th>Average cost</th>
                                            <th>Market price</th>
                                            <th>Market value</th>
                                            <th>Unrealized P/L</th>
                                            <th>Return</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {holdings.map((holding) => (
                                            <tr
                                                key={holding.symbol}
                                                className={
                                                    selectedSymbol ===
                                                        holding.symbol
                                                        ? "portfolio-selected-row"
                                                        : ""
                                                }
                                                onClick={() =>
                                                    setSelectedSymbol(
                                                        holding.symbol
                                                    )
                                                }
                                            >
                                                <td>
                                                    <button
                                                        className="portfolio-symbol-button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setSelectedSymbol(
                                                                holding.symbol
                                                            );
                                                        }}
                                                    >
                                                        {holding.symbol}
                                                    </button>
                                                </td>

                                                <td>
                                                    {holding.quantity}
                                                </td>
                                                <td>
                                                    {formatNPR(
                                                        holding.average_cost
                                                    )}
                                                </td>
                                                <td>
                                                    {formatNPR(
                                                        holding.current_price
                                                    )}
                                                </td>
                                                <td>
                                                    {formatNPR(
                                                        holding.market_value
                                                    )}
                                                </td>
                                                <td
                                                    className={pnlClass(
                                                        holding.unrealized_pnl
                                                    )}
                                                >
                                                    {formatNPR(
                                                        holding.unrealized_pnl
                                                    )}
                                                </td>
                                                <td
                                                    className={pnlClass(
                                                        holding.unrealized_return_pct
                                                    )}
                                                >
                                                    {formatPercent(
                                                        holding.unrealized_return_pct
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {holdings.length === 0 && (
                                    <p className="portfolio-muted">
                                        No holdings match your search.
                                    </p>
                                )}
                            </div>

                            {selectedHolding && selectedSymbol && (
                                <div className="portfolio-details">
                                    <div className="portfolio-section-header">
                                        <div>
                                            <h2>
                                                {selectedSymbol} details
                                            </h2>
                                            <p className="portfolio-muted">
                                                Your current position and
                                                transaction history
                                            </p>
                                        </div>

                                        <button
                                            className="portfolio-button"
                                            onClick={() =>
                                                setSelectedSymbol(null)
                                            }
                                        >
                                            Close details
                                        </button>
                                    </div>

                                    <div className="portfolio-detail-grid">
                                        <DetailItem
                                            label="Shares held"
                                            value={String(
                                                selectedHolding.quantity
                                            )}
                                        />
                                        <DetailItem
                                            label="Average cost"
                                            value={formatNPR(
                                                selectedHolding.average_cost
                                            )}
                                        />
                                        <DetailItem
                                            label="Remaining cost basis"
                                            value={formatNPR(
                                                selectedHolding.cost_basis
                                            )}
                                        />
                                        <DetailItem
                                            label="Current market value"
                                            value={formatNPR(
                                                selectedHolding.market_value
                                            )}
                                        />
                                        <DetailItem
                                            label="Buy fees"
                                            value={formatNPR(
                                                selectedHolding.total_buy_fees
                                            )}
                                        />
                                        <DetailItem
                                            label="Sell fees"
                                            value={formatNPR(
                                                selectedHolding.total_sell_fees
                                            )}
                                        />
                                    </div>

                                    <h3>Transaction history</h3>

                                    {selectedTransactions.length === 0 ? (
                                        <p className="portfolio-muted">
                                            No transactions found for this
                                            holding.
                                        </p>
                                    ) : (
                                        <div className="portfolio-table-wrapper">
                                            <table className="portfolio-table">
                                                <thead>
                                                    <tr>
                                                        <th>Date</th>
                                                        <th>Type</th>
                                                        <th>Quantity</th>
                                                        <th>Price</th>
                                                        <th>Fees</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedTransactions.map(
                                                        (transaction) => (
                                                            <tr
                                                                key={
                                                                    transaction.id
                                                                }
                                                            >
                                                                <td>
                                                                    {formatDate(
                                                                        transaction.transaction_date
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    <span
                                                                        className={
                                                                            transaction.type ===
                                                                                "BUY"
                                                                                ? "portfolio-buy"
                                                                                : "portfolio-sell"
                                                                        }
                                                                    >
                                                                        {
                                                                            transaction.type
                                                                        }
                                                                    </span>
                                                                </td>
                                                                <td>
                                                                    {
                                                                        transaction.quantity
                                                                    }
                                                                </td>
                                                                <td>
                                                                    {formatNPR(
                                                                        transaction.price
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {formatNPR(
                                                                        transaction.fees
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </section>
    );
}

function SummaryCard({
    label,
    value,
    valueClass = "",
}: {
    label: string;
    value: string;
    valueClass?: string;
}) {
    return (
        <div className="portfolio-summary-card">
            <p>{label}</p>
            <strong className={valueClass}>{value}</strong>
        </div>
    );
}

function DetailItem({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="portfolio-detail-item">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}
