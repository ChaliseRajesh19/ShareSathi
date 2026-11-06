
"use client";

import {
    useEffect,
    useMemo,
    useState,
    type KeyboardEvent,
} from "react";

import {
    getMarketPrices,
    getWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    type MarketPricesResponse,
    type WatchlistItem,
} from "@/lib/api";

type Stock = {
    symbol: string;
    name?: string | null;
    price: number;
};

type HistoricalPrice = {
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
};

type HistoryResponse = {
    symbol: string;
    count: number;
    first_date: string | null;
    last_date: string | null;
    source: string;
    history: HistoricalPrice[];
};

const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const formatNPR = (value: number) =>
    `NPR ${value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

function formatTradingDate(date: string | null | undefined) {
    if (!date) return "Date unavailable";

    return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    });
}

export default function ExploreStocks() {
    const [stocks, setStocks] = useState<Stock[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState("NABIL");

    const [history, setHistory] = useState<HistoryResponse | null>(null);
    const [period, setPeriod] = useState("1Y");
    const [search, setSearch] = useState("");

    const [stocksLoading, setStocksLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(false);

    const [error, setError] = useState("");
    const [historyError, setHistoryError] = useState("");

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [pointerX, setPointerX] = useState<number | null>(null);
    const [historyRequestKey, setHistoryRequestKey] = useState(0);

    const [marketData, setMarketData] =
        useState<MarketPricesResponse | null>(null);

    // Watchlist state
    const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
    const [watchlistLoading, setWatchlistLoading] = useState(true);
    const [watchlistUpdating, setWatchlistUpdating] = useState(false);
    const [watchlistError, setWatchlistError] = useState("");

    // Load market prices
    useEffect(() => {
        let cancelled = false;

        async function loadStocks() {
            setStocksLoading(true);
            setError("");

            try {
                const data = await getMarketPrices();

                if (!cancelled) {
                    setMarketData(data);
                    setStocks(data.prices);

                    setSelectedSymbol((currentSymbol) => {
                        if (
                            data.prices.some(
                                (stock) => stock.symbol === currentSymbol
                            )
                        ) {
                            return currentSymbol;
                        }

                        return data.prices[0]?.symbol ?? currentSymbol;
                    });
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load stocks."
                    );
                }
            } finally {
                if (!cancelled) {
                    setStocksLoading(false);
                }
            }
        }

        void loadStocks();

        return () => {
            cancelled = true;
        };
    }, []);

    // Load saved watchlist
    useEffect(() => {
        let cancelled = false;

        async function loadWatchlist() {
            try {
                const result = await getWatchlist();

                if (!cancelled) {
                    setWatchlist(result.watchlist);
                    setWatchlistError("");
                }
            } catch (err) {
                if (!cancelled) {
                    setWatchlistError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load your watchlist."
                    );
                }
            } finally {
                if (!cancelled) {
                    setWatchlistLoading(false);
                }
            }
        }

        void loadWatchlist();

        return () => {
            cancelled = true;
        };
    }, []);

    // Load historical prices for selected stock
    useEffect(() => {
        if (!selectedSymbol) return;

        let cancelled = false;

        async function loadHistory() {
            setHistoryLoading(true);
            setHistoryError("");

            try {
                const response = await fetch(
                    `${API_URL}/api/stocks/${encodeURIComponent(selectedSymbol)}/history`,
                    { cache: "no-store" }
                );

                if (!response.ok) {
                    throw new Error(
                        `Failed to load ${selectedSymbol} history`
                    );
                }

                const data: HistoryResponse = await response.json();

                if (!cancelled) {
                    setHistory(data);
                }
            } catch (err) {
                if (!cancelled) {
                    setHistory(null);
                    setHistoryError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load history."
                    );
                }
            } finally {
                if (!cancelled) {
                    setHistoryLoading(false);
                }
            }
        }

        void loadHistory();

        return () => {
            cancelled = true;
        };
    }, [selectedSymbol, historyRequestKey]);

    // Search and filter stocks
    const filteredStocks = useMemo(() => {
        const query = search.trim().toLowerCase();

        return stocks
            .filter(
                (stock) =>
                    stock.symbol.toLowerCase().includes(query) ||
                    (stock.name ?? "").toLowerCase().includes(query)
            )
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
    }, [stocks, search]);

    // Select a stock
    const selectSymbol = (symbol: string) => {
        setHistory(null);
        setHistoryError("");
        setHoveredIndex(null);
        setPointerX(null);
        setSelectedSymbol(symbol);

        setHistoryRequestKey((currentKey) => currentKey + 1);
    };

    // Search input handler
    const handleSearchChange = (value: string) => {
        setSearch(value);

        const query = value.trim().toUpperCase();

        const exactMatch = stocks.find(
            (stock) =>
                stock.symbol.toUpperCase() === query ||
                (stock.name ?? "").toUpperCase() === query
        );

        if (exactMatch) {
            selectSymbol(exactMatch.symbol);
        }
    };

    // Search keyboard handler
    const handleSearchKeyDown = (
        event: KeyboardEvent<HTMLInputElement>
    ) => {
        if (event.key !== "Enter") return;

        event.preventDefault();

        const query = search.trim().toLowerCase();

        const match =
            stocks.find(
                (stock) =>
                    stock.symbol.toLowerCase() === query ||
                    (stock.name ?? "").toLowerCase() === query
            ) ?? filteredStocks[0];

        if (match) {
            selectSymbol(match.symbol);
            setSearch(match.symbol);
        }
    };

    // Filter historical data by selected period
    const chartData = useMemo(() => {
        if (!history) return [];

        const cutoff = new Date();

        if (period === "1M") {
            cutoff.setMonth(cutoff.getMonth() - 1);
        } else if (period === "3M") {
            cutoff.setMonth(cutoff.getMonth() - 3);
        } else if (period === "6M") {
            cutoff.setMonth(cutoff.getMonth() - 6);
        } else if (period === "1Y") {
            cutoff.setFullYear(cutoff.getFullYear() - 1);
        } else {
            cutoff.setFullYear(cutoff.getFullYear() - 100);
        }

        return history.history
            .filter(
                (item) =>
                    item.close != null &&
                    Number.isFinite(Number(item.close)) &&
                    new Date(`${item.date}T00:00:00`) >= cutoff
            )
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [history, period]);

    // Prepare chart coordinates
    const chart = useMemo(() => {
        const values = chartData.map((item) => Number(item.close));

        if (values.length === 0) return null;

        const width = 900;
        const height = 300;
        const padding = 30;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const plottedPoints = chartData.map((item, index) => {
            const value = Number(item.close);

            const x =
                padding +
                (index / Math.max(values.length - 1, 1)) *
                (width - padding * 2);

            const y =
                height -
                padding -
                ((value - min) / range) *
                (height - padding * 2);

            return {
                x,
                y,
                value,
                date: item.date,
            };
        });

        return {
            points: plottedPoints
                .map((point) => `${point.x},${point.y}`)
                .join(" "),
            plottedPoints,
            min,
            max,
            width,
            height,
        };
    }, [chartData]);

    // Historical performance calculations
    const latestClose =
        chartData.length > 0
            ? Number(chartData[chartData.length - 1].close)
            : null;

    const firstClose =
        chartData.length > 0
            ? Number(chartData[0].close)
            : null;

    const change =
        latestClose !== null && firstClose !== null
            ? latestClose - firstClose
            : null;

    const changePct =
        change !== null && firstClose
            ? (change / firstClose) * 100
            : null;

    // Selected stock
    const selectedStock = stocks.find(
        (stock) => stock.symbol === selectedSymbol
    );

    // Check whether selected stock is in watchlist
    const watching = watchlist.some(
        (item) => item.symbol === selectedSymbol
    );

    // Add or remove selected stock from watchlist
    const toggleWatchlist = async () => {
        if (!selectedSymbol || watchlistUpdating) return;

        setWatchlistUpdating(true);
        setWatchlistError("");

        try {
            if (watching) {
                await removeFromWatchlist(selectedSymbol);

                setWatchlist((previous) =>
                    previous.filter(
                        (item) => item.symbol !== selectedSymbol
                    )
                );
            } else {
                const result = await addToWatchlist(selectedSymbol);

                setWatchlist((previous) => {
                    // Avoid duplicate entries in local state
                    if (
                        previous.some(
                            (item) => item.symbol === result.symbol
                        )
                    ) {
                        return previous;
                    }

                    return [
                        {
                            symbol: result.symbol,
                            created_at: new Date().toISOString(),
                        },
                        ...previous,
                    ];
                });
            }
        } catch (err) {
            setWatchlistError(
                err instanceof Error
                    ? err.message
                    : "Unable to update watchlist."
            );
        } finally {
            setWatchlistUpdating(false);
        }
    };
    const handleRemoveFromWatchlist = async (symbol: string) => {
        if (watchlistUpdating) return;

        setWatchlistUpdating(true);
        setWatchlistError("");

        try {
            await removeFromWatchlist(symbol);

            setWatchlist((previous) =>
                previous.filter((item) => item.symbol !== symbol)
            );
        } catch (err) {
            setWatchlistError(
                err instanceof Error
                    ? err.message
                    : "Unable to remove stock from watchlist."
            );
        } finally {
            setWatchlistUpdating(false);
        }
    };

    return (
        <section className="explore-stocks">
            {/* Page header */}
            <div className="explore-header">
                <div className="explore-kicker">
                    NEPAL STOCK MARKET
                </div>

                <h1>Explore Stocks</h1>

                <p className="explore-muted">
                    Explore listed companies and their historical prices.
                </p>
            </div>

            {/* Watchlist */}
            <section className="explore-card watchlist-card">
                <div className="watchlist-header">
                    <div>
                        <h3>Your Watchlist</h3>
                        <p>Quick access to stocks you&apos;re tracking.</p>
                    </div>

                    <span>{watchlist.length} stocks</span>
                </div>

                {watchlistLoading ? (
                    <p className="watchlist-status">Loading watchlist...</p>
                ) : watchlistError && watchlist.length === 0 ? (
                    <p role="alert" className="error-message">
                        {watchlistError}
                    </p>
                ) : watchlist.length === 0 ? (
                    <p className="watchlist-status">
                        No stocks added yet. Add a stock below to start tracking it.
                    </p>
                ) : (
                    <>
                        <div className="watchlist-list">
                            {watchlist.map((item) => {
                                const stock = stocks.find(
                                    (s) => s.symbol === item.symbol
                                );

                                return (
                                    <div
                                        key={item.symbol}
                                        className="watch-item"
                                    >
                                        <button
                                            type="button"
                                            className="watch-stock-info"
                                            onClick={() => selectSymbol(item.symbol)}
                                        >
                                            <div>
                                                <strong>{item.symbol}</strong>
                                                <span>
                                                    {stock?.name || "NEPSE Company"}
                                                </span>
                                            </div>

                                            <div className="watch-price">
                                                {stock ? formatNPR(stock.price) : "—"}
                                            </div>
                                        </button>

                                        <button
                                            type="button"
                                            className="watch-remove-btn"
                                            onClick={() =>
                                                handleRemoveFromWatchlist(item.symbol)
                                            }
                                            disabled={watchlistUpdating}
                                        >
                                            {watchlistUpdating ? "..." : "Remove"}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {watchlistError && (
                            <p role="alert" className="error-message">
                                {watchlistError}
                            </p>
                        )}
                    </>
                )}
            </section>

            {/* Search and stock selection */}
            <section className="explore-card explore-search-card">
                <label
                    className="explore-field"
                    htmlFor="stock-search"
                >
                    Search listed stocks

                    <span className="explore-field-hint">
                        Find by symbol or company name
                    </span>

                    <input
                        id="stock-search"
                        value={search}
                        onChange={(event) =>
                            handleSearchChange(event.target.value)
                        }
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search symbol or company..."
                        className="explore-input"
                    />
                </label>

                {stocksLoading ? (
                    <p>Loading available stocks...</p>
                ) : (
                    <label className="explore-field">
                        Select stock

                        <span className="explore-field-hint">
                            Choose a company to analyze
                        </span>

                        <select
                            value={selectedSymbol}
                            onChange={(event) =>
                                selectSymbol(event.target.value)
                            }
                            className="explore-select"
                        >
                            {filteredStocks.map((stock) => (
                                <option
                                    key={stock.symbol}
                                    value={stock.symbol}
                                >
                                    {stock.symbol}
                                    {stock.name
                                        ? ` — ${stock.name}`
                                        : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {!stocksLoading && filteredStocks.length === 0 && (
                    <p>No matching stocks found.</p>
                )}
            </section>

            {/* Watchlist action */}
            <button
                type="button"
                className={`watch-btn ${watching ? "active" : ""}`}
                onClick={toggleWatchlist}
                disabled={
                    watchlistUpdating ||
                    stocksLoading ||
                    !selectedSymbol
                }
            >
                {watchlistUpdating
                    ? "Updating..."
                    : watching
                        ? "★ Watching"
                        : "☆ Add to Watchlist"}
            </button>

            {watchlistError && (
                <p role="alert" className="error-message">
                    {watchlistError}
                </p>
            )}

            {/* Selected stock and historical chart */}
            <section className="explore-card chart-card">
                <div className="explore-company-header">
                    <div className="explore-company-title">
                        <span className="explore-section-label">
                            Selected company
                        </span>

                        <h2>{selectedSymbol}</h2>

                        <p className="explore-muted">
                            {selectedStock?.name ?? selectedSymbol}
                        </p>
                    </div>

                    <div className="explore-latest-price">
                        <span>Latest available price</span>

                        <strong>
                            {selectedStock
                                ? formatNPR(selectedStock.price)
                                : "—"}
                        </strong>
                    </div>
                </div>

                {/* Market data status */}
                {marketData && (
                    <div className="market-data-status">
                        <p
                            className={
                                marketData.stale
                                    ? "market-status-warning"
                                    : marketData.is_live
                                        ? "market-status-live"
                                        : "market-status-closed"
                            }
                        >
                            <strong>
                                {marketData.stale
                                    ? "Data may be outdated"
                                    : marketData.is_live
                                        ? "Live market data"
                                        : "Last available session"}
                            </strong>
                        </p>

                        <p className="explore-muted">
                            Trading date:{" "}
                            {formatTradingDate(
                                marketData.business_date
                            )}
                        </p>

                        {marketData.cached && (
                            <p className="explore-muted">
                                Served from cache
                            </p>
                        )}

                        {marketData.stale && (
                            <p className="explore-muted">
                                The latest refresh failed. Displayed
                                prices may be outdated.
                            </p>
                        )}
                    </div>
                )}

                {/* Chart period selection */}
                <div className="period-controls">
                    {["1M", "3M", "6M", "1Y", "ALL"].map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => setPeriod(item)}
                            className={`period-button ${period === item ? "active" : ""
                                }`}
                        >
                            {item}
                        </button>
                    ))}
                </div>

                {historyLoading && (
                    <p>Loading historical prices...</p>
                )}

                {error && (
                    <p role="alert" className="error-message">
                        {error}
                    </p>
                )}

                {/* Historical performance */}
                {!historyLoading && !historyError && chart && (
                    <>
                        <div className="explore-performance">
                            <span className="explore-section-label">
                                Historical performance
                            </span>

                            <div className="stat-value">
                                {formatNPR(latestClose!)}
                            </div>

                            {change !== null &&
                                changePct !== null && (
                                    <p
                                        className={`price-change ${change >= 0
                                            ? "positive"
                                            : "negative"
                                            }`}
                                    >
                                        {change >= 0 ? "+" : ""}
                                        {formatNPR(change)} (
                                        {changePct.toFixed(2)}%) over
                                        this selected period
                                    </p>
                                )}
                        </div>

                        {/* Interactive chart */}
                        <div
                            className="chart-scroll"
                            onMouseLeave={() => {
                                setHoveredIndex(null);
                                setPointerX(null);
                            }}
                        >
                            <svg
                                viewBox={`0 0 ${chart.width} ${chart.height}`}
                                role="img"
                                aria-label={`${selectedSymbol} historical closing price chart`}
                                className="stock-chart"
                                onMouseMove={(event) => {
                                    const rect =
                                        event.currentTarget.getBoundingClientRect();

                                    const svgX =
                                        ((event.clientX - rect.left) /
                                            rect.width) *
                                        chart.width;

                                    const padding = 30;
                                    const usableWidth =
                                        chart.width - padding * 2;

                                    const index = Math.round(
                                        ((svgX - padding) /
                                            usableWidth) *
                                        (chart.plottedPoints.length - 1)
                                    );

                                    const clampedIndex = Math.max(
                                        0,
                                        Math.min(
                                            chart.plottedPoints.length - 1,
                                            index
                                        )
                                    );

                                    setHoveredIndex(clampedIndex);

                                    setPointerX(
                                        chart.plottedPoints[clampedIndex].x
                                    );
                                }}
                            >
                                <polyline
                                    points={chart.points}
                                    fill="none"
                                    className="chart-line"
                                    strokeWidth="3"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                />

                                {hoveredIndex !== null && (
                                    <>
                                        <line
                                            x1={
                                                pointerX ??
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].x
                                            }
                                            y1="15"
                                            x2={
                                                pointerX ??
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].x
                                            }
                                            y2={chart.height - 15}
                                            className="chart-crosshair"
                                        />

                                        <circle
                                            cx={
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].x
                                            }
                                            cy={
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].y
                                            }
                                            r="5"
                                            className="chart-point-active"
                                        />
                                    </>
                                )}
                            </svg>

                            {hoveredIndex !== null &&
                                chart.plottedPoints[hoveredIndex] && (
                                    <div className="chart-tooltip">
                                        <strong>
                                            {formatNPR(
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].value
                                            )}
                                        </strong>

                                        <span>
                                            {
                                                chart.plottedPoints[
                                                    hoveredIndex
                                                ].date
                                            }
                                        </span>
                                    </div>
                                )}
                        </div>

                        <div className="chart-dates">
                            <span>{chartData[0]?.date}</span>
                            <span>
                                {chartData[chartData.length - 1]?.date}
                            </span>
                        </div>

                        <p className="chart-source">
                            {chartData.length} source records · Source:{" "}
                            {history?.source}. Historical dates have not
                            yet been independently validated as actual
                            trading sessions.
                        </p>
                    </>
                )}

                {historyError && (
                    <p role="alert" className="error-message">
                        {historyError}
                    </p>
                )}

                {!historyLoading &&
                    !error &&
                    history &&
                    !chart && (
                        <p>
                            No historical prices are available for this
                            period.
                        </p>
                    )}
            </section>
        </section>
    );
}
