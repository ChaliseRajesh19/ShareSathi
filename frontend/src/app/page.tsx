
"use client";
import { useState, useEffect, useMemo } from "react";
import {
  getTransactions,
  createTransaction,
  calculateSavedPortfolio,
  getMarketPrices,
  getIPOs,
  type Transaction,
  type Portfolio,
  type MarketPricesResponse,
  type IPOOverview,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type Notification,
} from "@/lib/api";

import ExploreStocks from "./ExploreStocks";
import MyPortfolio from "./MyPortfolio";
import CompanyAnalysis from "./CompanyAnalysis";


const menu = [
  "Overview",
  "My Portfolio",
  "Explore Stocks",
  "Company Analysis",
  "IPO Intelligence",
  "Learn Investing",
];

const companyNames: Record<string, string> = {
  NABIL: "Nabil Bank",
  NICA: "NIC Asia Bank",
  SHIVM: "Shivam Cements",
};

const formatNPR = (value: number) =>
  `NPR ${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [search, setSearch] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentPrices, setCurrentPrices] = useState<
    Record<string, string>
  >({});
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);


  const [ipoData, setIpoData] = useState<IPOOverview | null>(null);
  const [ipoLoading, setIpoLoading] = useState(false);
  const [ipoError, setIpoError] = useState<string | null>(null);

  const [marketData, setMarketData] =
    useState<MarketPricesResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ipoCategory, setIpoCategory] = useState<
    "open" | "upcoming" | "closed"
  >("open");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");

  useEffect(() => {
    if (active !== "IPO Intelligence") return;

    let cancelled = false;

    async function loadIPOs() {
      setIpoLoading(true);
      setIpoError(null);

      try {
        const data = await getIPOs();

        if (!cancelled) {
          setIpoData(data);
        }
      } catch (error) {
        if (!cancelled) {
          setIpoError(
            error instanceof Error
              ? error.message
              : "Failed to load IPO data."
          );
        }
      } finally {
        if (!cancelled) {
          setIpoLoading(false);
        }
      }
    }

    void loadIPOs();

    return () => {
      cancelled = true;
    };
  }, [active]);


  const [form, setForm] = useState({
    symbol: "",
    type: "BUY" as "BUY" | "SELL",
    quantity: "10",
    price: "",
    fees: "0",
  });

  useEffect(() => {
    let cancelled = false;

    getTransactions()
      .then((result) => {
        if (cancelled) return;

        setTransactions(result.transactions);

        setCurrentPrices((previous) => {
          const next = { ...previous };

          for (const transaction of result.transactions) {
            if (!(transaction.symbol in next)) {
              next[transaction.symbol] = "";
            }
          }

          return next;
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    void loadNotifications();
  }, []);


  const loadMarketPrices = async (overwritePrices = false) => {
    setMarketLoading(true);
    setMarketError("");

    try {
      const result = await getMarketPrices();
      setMarketData(result);

      setCurrentPrices((previous) => {
        const next = { ...previous };

        for (const item of result.prices) {
          if (
            overwritePrices ||
            next[item.symbol] === undefined ||
            next[item.symbol] === ""
          ) {
            next[item.symbol] = String(item.price);
          }
        }

        return next;
      });

      setNotice(
        overwritePrices
          ? "Market prices refreshed. Portfolio figures must be recalculated."
          : "Market prices loaded. Check their freshness before relying on them."
      );

      if (overwritePrices) {
        setPortfolio(null);
      }
    } catch (err) {
      setMarketError(
        err instanceof Error
          ? err.message
          : "Unable to fetch NEPSE prices."
      );
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => {
    void loadMarketPrices();
  }, []);



  const symbols = useMemo(
    () =>
      Array.from(
        new Set(transactions.map((transaction) => transaction.symbol))
      ).sort(),
    [transactions]
  );

  const holdings = portfolio?.holdings ?? {};

  const filtered = symbols.filter((symbol) => {
    const name = companyNames[symbol] ?? symbol;

    return (
      symbol.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const updatePrice = (symbol: string, value: string) => {
    setCurrentPrices((previous) => ({
      ...previous,
      [symbol]: value,
    }));
  };

  const calculatePortfolio = async () => {
    setError("");
    setNotice("");

    if (symbols.length === 0) {
      setError("Add a transaction before calculating your portfolio.");
      return;
    }

    const prices: Record<string, number> = {};

    for (const symbol of symbols) {
      const value = currentPrices[symbol]?.trim();

      if (!value || !Number.isFinite(Number(value)) || Number(value) < 0) {
        setError(
          `Enter a valid, non-negative manual price for ${symbol}.`
        );
        return;
      }

      prices[symbol] = Number(value);
    }

    setCalculating(true);

    try {
      const result = await calculateSavedPortfolio(prices);
      setPortfolio(result);
      setNotice("Portfolio calculated using your manually entered prices.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to calculate your portfolio."
      );
    } finally {
      setCalculating(false);
    }
  };

  const summary = portfolio?.summary;
  const totalValue = summary?.total_market_value ?? null;
  const totalInvested = summary?.total_invested ?? null;
  const unrealizedPnl = summary?.total_unrealized_pnl ?? null;
  const realizedPnl = summary?.total_realized_pnl ?? null;

  const pnlClass = (value: number | null) =>
    value === null ? "" : value >= 0 ? "positive" : "negative";

  const handleSaveTransaction = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    const fees = Number(form.fees);

    if (!/^[A-Z0-9.&-]+$/.test(symbol)) {
      setError("Enter a valid stock symbol.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      setError("Price must be greater than zero.");
      return;
    }

    if (!Number.isFinite(fees) || fees < 0) {
      setError("Fees cannot be negative.");
      return;
    }

    setSaving(true);

    try {
      await createTransaction({
        symbol,
        type: form.type,
        quantity,
        price,
        fees,
      });

      const result = await getTransactions();
      setTransactions(result.transactions);

      setCurrentPrices((previous) => ({
        ...previous,
        [symbol]: previous[symbol] ?? "",
      }));

      // The transaction history changed, so old calculations are stale.
      setPortfolio(null);

      setForm({
        symbol: "",
        type: "BUY",
        quantity: "10",
        price: "",
        fees: "0",
      });

      setShowForm(false);
      setNotice(
        "Transaction saved successfully. Recalculate your portfolio to update your results."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save the transaction."
      );
    } finally {
      setSaving(false);
    }
  };

  const loadNotifications = async () => {
    setNotificationLoading(true);
    setNotificationError("");

    try {
      const result = await getNotifications();
      setNotifications(result.notifications);
      setUnreadCount(result.unread_count);
    } catch (error) {
      setNotificationError(
        error instanceof Error
          ? error.message
          : "Failed to load notifications."
      );
    } finally {
      setNotificationLoading(false);
    }
  };
  const handleMarkAsRead = async (notification: Notification) => {
    if (notification.is_read) return;

    try {
      await markNotificationAsRead(notification.id);
      await loadNotifications();
    } catch (error) {
      setNotificationError(
        error instanceof Error
          ? error.message
          : "Failed to update notification."
      );
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsAsRead();
      await loadNotifications();
    } catch (error) {
      setNotificationError(
        error instanceof Error
          ? error.message
          : "Failed to update notifications."
      );
    }
  };


  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-mark">M</span>
          <span>
            <strong>Mero Invest</strong>
            <small>YOUR INVESTMENT COMPANION</small>
          </span>
        </a>

        <div className="nav-label">WORKSPACE</div>

        <nav className="nav-menu">
          {menu.map((item, index) => (
            <button
              key={item}
              className={`nav-item ${active === item ? "active" : ""}`}
              onClick={() => setActive(item)}
            >
              <span className="nav-icon">
                {["◫", "▤", "⌕", "▥", "◇", "▧"][index]}
              </span>
              {item}
              {item === "IPO Intelligence" && (
                <span className="nav-tag">NEW</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✳</div>
            <strong>New to investing?</strong>
            <p>Understand the market, one concept at a time.</p>
            <button onClick={() => setActive("Learn Investing")}>
              Start learning →
            </button>
          </div>

          <div className="profile">
            <div className="avatar">RC</div>
            <div>
              <strong>Demo Investor</strong>
              <small>Development account</small>
            </div>
            <span className="profile-dots">···</span>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{active}</strong>
          </div>

          <div className="topbar-right">

            <div className="market-status">
              <span className="status-dot" />
              <span>
                {marketLoading
                  ? "FETCHING PRICES"
                  : marketError
                    ? "PRICE DATA UNAVAILABLE"
                    : marketData?.is_live
                      ? "LIVE NEPSE DATA"
                      : marketData
                        ? "LAST SESSION PRICES"
                        : "MANUAL PRICE FALLBACK"}
              </span>
            </div>


            <div className="notification-wrapper">
              <button
                className="icon-button"
                aria-label="Notifications"
                title="Notifications"
                onClick={() => {
                  const next = !showNotifications;
                  setShowNotifications(next);

                  if (next) {
                    void loadNotifications();
                  }
                }}
              >
                ♧
                {unreadCount > 0 && (
                  <span className="notification-count">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="notification-dropdown">
                  <div className="notification-header">
                    <strong>Notifications</strong>

                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleMarkAllAsRead()}
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {notificationLoading ? (
                    <p className="notification-empty">Loading...</p>
                  ) : notificationError ? (
                    <p className="notification-error">{notificationError}</p>
                  ) : notifications.length === 0 ? (
                    <p className="notification-empty">
                      No notifications yet.
                    </p>
                  ) : (
                    <div className="notification-list">
                      {notifications.map((notification) => (
                        <button
                          type="button"
                          key={notification.id}
                          className={`notification-item ${notification.is_read ? "read" : "unread"
                            }`}
                          onClick={() => void handleMarkAsRead(notification)}
                        >
                          <strong>{notification.symbol}</strong>

                          <span>{notification.message}</span>

                          <small>
                            {new Date(notification.created_at).toLocaleString()}
                          </small>

                          {!notification.is_read && (
                            <span className="mark-read-label">
                              Mark as read
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="avatar">RC</div>
          </div>
        </header>

        <div className="content">

          {active === "My Portfolio" ? (
            <MyPortfolio />
          ) : active === "Explore Stocks" ? (
            <ExploreStocks />
          ) : active === "Company Analysis" ? (
            <CompanyAnalysis />
          ) : active === "IPO Intelligence" ? (
            // keep your existing IPO section unchanged
            <section className="ipo-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">NEPAL STOCK MARKET</div>
                  <h1>IPO Intelligence</h1>
                  <p className="subtitle">
                    Understand upcoming IPO announcements and check their sources.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => {
                    void (async () => {
                      setIpoLoading(true);
                      setIpoError(null);

                      try {
                        setIpoData(await getIPOs());
                      } catch (error) {
                        setIpoError(
                          error instanceof Error
                            ? error.message
                            : "Failed to load IPO data."
                        );
                      } finally {
                        setIpoLoading(false);
                      }
                    })();
                  }}
                >
                  ↻ Refresh IPOs
                </button>
              </div>

              <div className="ipo-notice">
                IPO announcements are informational, not investment recommendations.
                Verify application dates and eligibility using official sources.
              </div>

              {ipoLoading && <p>Loading IPO announcements...</p>}

              {ipoError && (
                <p role="alert">Unable to load IPOs: {ipoError}</p>
              )}

              {!ipoLoading && !ipoError && ipoData && (
                <>
                  <p className="subtitle">
                    {ipoData.count} announcement entries ·{" "}
                    {ipoData.is_live
                      ? "Feed reachable"
                      : "Feed unavailable"}
                  </p>

                  <div className="ipo-tabs">
                    {(["open", "upcoming", "closed"] as const).map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`ipo-tab ${ipoCategory === category ? "active" : ""}`}
                        onClick={() => setIpoCategory(category)}
                      >
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                        {" ("}
                        {ipoData.counts?.[category] ?? 0}
                        {")"}
                      </button>
                    ))}
                  </div>


                  <div className="ipo-grid">
                    {(
                      ipoCategory === "open"
                        ? ipoData.open_ipos
                        : ipoCategory === "upcoming"
                          ? ipoData.upcoming_ipos
                          : ipoData.closed_ipos
                    ).map((ipo, index) => (
                      <article
                        className="ipo-card"
                        key={`${ipo.company}-${ipo.reserved_for ?? "general"}-${index}`}
                      >

                        <div className="ipo-card-top">
                          <div className="eyebrow">
                            {ipo.is_reserved_share
                              ? "RESERVED ISSUE"
                              : "IPO ANNOUNCEMENT"}
                          </div>

                          <span className={`ipo-status-badge ${ipo.status ?? "unknown"}`}>
                            {(ipo.status ?? "unknown").toUpperCase()}
                          </span>
                        </div>


                        <h2>{ipo.company}</h2>

                        {ipo.units != null && (
                          <p>
                            <strong>Units:</strong>{" "}
                            {String(ipo.units)}
                          </p>
                        )}

                        {ipo.date_range && (
                          <p>
                            <strong>Announced date range:</strong>{" "}
                            {ipo.date_range}
                          </p>
                        )}

                        {ipo.opening_date_ad && (
                          <p>
                            <strong>Opens:</strong> {ipo.opening_date_ad}
                          </p>
                        )}

                        {ipo.closing_date_ad && (
                          <p>
                            <strong>Closes:</strong> {ipo.closing_date_ad}
                          </p>
                        )}

                        {ipo.status === "upcoming" &&
                          typeof ipo.days_remaining === "number" && (
                            <p className="ipo-countdown">
                              Opens in {ipo.days_remaining}{" "}
                              {ipo.days_remaining === 1 ? "day" : "days"}
                            </p>
                          )}

                        {ipo.status === "open" &&
                          typeof ipo.days_remaining === "number" && (
                            <p className="ipo-countdown">
                              {ipo.days_remaining === 0
                                ? "Closing today"
                                : `${ipo.days_remaining} ${ipo.days_remaining === 1 ? "day" : "days"
                                } remaining`}
                            </p>
                          )}
                        <p className="text-sm text-muted-foreground">
                          Last fetched:{" "}
                          {new Date(ipoData.fetched_at).toLocaleString()}
                        </p>



                        {ipo.description && (
                          <p>{ipo.description}</p>
                        )}

                        <div className="ipo-details-panel">
                          <h3>
                            {ipo.status === "open"
                              ? "Evaluate Before Applying"
                              : ipo.status === "closed"
                                ? "Review This IPO"
                                : "Understand This IPO"}
                          </h3>

                          <p>
                            <strong>Company:</strong> {ipo.company}
                          </p>

                          {ipo.units != null && (
                            <p>
                              <strong>Announced units:</strong>{" "}
                              {String(ipo.units)}
                            </p>
                          )}

                          {ipo.status === "open" && (
                            <p>
                              Review the official announcement and confirm
                              eligibility before applying.
                            </p>
                          )}

                          {ipo.status === "upcoming" && (
                            <p>
                              Learn about the company and verify the offer
                              details before applications open.
                            </p>
                          )}

                          {ipo.status === "closed" && (
                            <p>
                              Applications may have closed. Review official
                              sources for allotment and listing updates.
                            </p>
                          )}

                          {(ipo.status === "unknown" || !ipo.status) && (
                            <p>
                              Verify the current offer status using the
                              official announcement before taking action.
                            </p>
                          )}
                        </div>


                        <p className="ipo-source">
                          Source: {ipo.source}
                        </p>

                        {ipo.source_url && (
                          <a
                            href={ipo.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ipo-link"
                          >
                            View announcement ↗
                          </a>
                        )}
                      </article>
                    ))}
                  </div>

                  {ipoData.count === 0 && (
                    <p>No IPO announcement entries were returned by the feed.</p>
                  )}

                  <h2 className="ipo-sources-heading">
                    Verify with official sources
                  </h2>

                  <div className="ipo-official-links">
                    {Object.entries(ipoData.sources)
                      .filter(([key]) => key !== "upcoming_feed")
                      .map(([key, source]) => (
                        <a
                          key={key}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ipo-official-link"
                        >
                          <strong>{source.name}</strong>
                          <span>{source.purpose}</span>
                          <span>Open source ↗</span>
                        </a>
                      ))}
                  </div>

                  <p className="ipo-disclaimer">
                    A reachable feed does not guarantee an IPO is currently open.
                    Check the official issue status before making a decision.
                  </p>
                </>
              )}
            </section>
          ) : (
            <>


              {active !== "IPO Intelligence" && marketData && (
                <div className="notice">
                  <span className="notice-icon">ⓘ</span>
                  <span>
                    <strong>Market data:</strong>{" "}
                    {" "}Business date: {marketData.business_date ?? "Not provided"}.
                    {" "}Fetched at:{" "}
                    {marketData.fetched_at
                      ? new Date(marketData.fetched_at).toLocaleString()
                      : "Unknown"}.
                    {" "}
                    {!marketData.is_live &&
                      "These prices may be delayed or from the previous session."}
                  </span>
                </div>
              )}


              {active !== "IPO Intelligence" && marketError && (
                <div className="notice" role="alert">
                  <span className="notice-icon">!</span>
                  <span>
                    <strong>Market prices unavailable.</strong>{" "}
                    {marketError} You can enter prices manually.
                  </span>
                </div>
              )}


              {active !== "IPO Intelligence" && (
                <div className="transaction-actions">
                  <button
                    className="primary-button"
                    onClick={() => void loadMarketPrices(true)}
                    disabled={marketLoading}
                  >
                    {marketLoading ? "Refreshing prices..." : "↻ Refresh Prices"}
                  </button>
                </div>
              )}

              <div className="welcome-row">
                <div>
                  <div className="eyebrow">YOUR INVESTMENT WORKSPACE</div>
                  <h1>
                    {active === "Overview" ? (
                      <>
                        Your money, <span>made clearer.</span>
                      </>
                    ) : (
                      active
                    )}
                  </h1>
                  <p className="subtitle">
                    Understand your investments. Make more informed decisions.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => setActive("My Portfolio")}
                >
                  <span>＋</span> View portfolio
                </button>
              </div>

              <div className="notice">
                <span className="notice-icon">ⓘ</span>
                <span>
                  <strong>Development mode.</strong> Holdings come from your saved
                  transactions. Enter prices manually; these are not live NEPSE
                  market prices.
                </span>
              </div>

              {error && (
                <div className="notice" role="alert">
                  <span className="notice-icon">!</span>
                  <span>
                    <strong>Action needed.</strong> {error}
                  </span>
                </div>
              )}

              {notice && (
                <div className="notice" role="status">
                  <span className="notice-icon">✓</span>
                  <span>{notice}</span>
                </div>
              )}

              <div className="section-heading">
                <div>
                  <h2>Your financial snapshot</h2>
                  <p>
                    {loading
                      ? "Loading your saved transactions..."
                      : "Calculated from your saved transactions and manual prices."}
                  </p>
                </div>
                <span className="period-pill">
                  {portfolio ? "CALCULATED" : "AWAITING PRICES"}
                </span>
              </div>

              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Total portfolio value</span>
                    <span className="stat-icon purple">◫</span>
                  </div>
                  <div className="stat-value">
                    {totalValue === null ? "—" : formatNPR(totalValue)}
                  </div>
                  <div className="stat-foot">Market value at entered prices</div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Remaining cost basis</span>
                    <span className="stat-icon blue">↗</span>
                  </div>
                  <div className="stat-value">
                    {totalInvested === null ? "—" : formatNPR(totalInvested)}
                  </div>
                  <div className="stat-foot">
                    Cost of shares still held, including allocated fees
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Unrealized P/L</span>
                    <span className="stat-icon green">±</span>
                  </div>
                  <div className={`stat-value ${pnlClass(unrealizedPnl)}`}>
                    {unrealizedPnl === null
                      ? "—"
                      : `${unrealizedPnl >= 0 ? "+" : "−"} ${formatNPR(
                        Math.abs(unrealizedPnl)
                      )}`}
                  </div>
                  <div className="stat-foot">Gain or loss on shares still held</div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Companies held</span>
                    <span className="stat-icon orange">▤</span>
                  </div>
                  <div className="stat-value">
                    {portfolio
                      ? summary?.number_of_companies ?? 0
                      : "—"}
                  </div>
                  <div className="stat-foot">
                    {symbols.length} symbols in transaction history
                  </div>
                </article>
              </div>

              <div className="dashboard-grid">
                <section className="panel portfolio-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>My holdings</h2>
                      <p>Your saved investments at a glance.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActive("My Portfolio")}
                    >
                      View all →
                    </button>
                  </div>
                  <div className="transaction-actions">
                    <button
                      className="primary-button"
                      onClick={() => {
                        setError("");
                        setNotice("");
                        setShowForm((previous) => !previous);
                      }}
                    >
                      {showForm ? "Cancel" : "+ Add transaction"}
                    </button>
                  </div>

                  {showForm && (
                    <form
                      className="transaction-form"
                      onSubmit={handleSaveTransaction}
                    >
                      <h3>Record a transaction</h3>

                      <label htmlFor="transaction-type">Transaction type</label>
                      <select
                        id="transaction-type"
                        value={form.type}
                        onChange={(event) =>
                          setForm((previous) => ({
                            ...previous,
                            type: event.target.value as "BUY" | "SELL",
                          }))
                        }
                      >
                        <option value="BUY">Buy</option>
                        <option value="SELL">Sell</option>
                      </select>

                      <label htmlFor="transaction-symbol">Stock symbol</label>
                      <input
                        id="transaction-symbol"
                        value={form.symbol}
                        onChange={(event) =>
                          setForm((previous) => ({
                            ...previous,
                            symbol: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="e.g. NABIL"
                        required
                      />

                      <label htmlFor="transaction-quantity">Quantity</label>
                      <input
                        id="transaction-quantity"
                        type="number"
                        min="1"
                        step="1"
                        value={form.quantity}
                        onChange={(event) =>
                          setForm((previous) => ({
                            ...previous,
                            quantity: event.target.value,
                          }))
                        }
                        required
                      />

                      <label htmlFor="transaction-price">
                        Price per share (NPR)
                      </label>
                      <input
                        id="transaction-price"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.price}
                        onChange={(event) =>
                          setForm((previous) => ({
                            ...previous,
                            price: event.target.value,
                          }))
                        }
                        required
                      />


                      <button
                        className="primary-button"
                        type="submit"
                        disabled={saving}
                      >
                        {saving ? "Saving..." : "Save transaction"}
                      </button>
                    </form>
                  )}


                  <div className="search-box">
                    <span>⌕</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search company or symbol..."
                      aria-label="Search holdings"
                    />
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>COMPANY</th>
                          <th>SHARES</th>
                          <th>MANUAL PRICE</th>
                          <th>VALUE</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filtered.map((symbol) => {
                          const holding = holdings[symbol];

                          return (
                            <tr key={symbol}>
                              <td>
                                <div className="company-cell">
                                  <span className="company-logo">
                                    {symbol.slice(0, 1)}
                                  </span>
                                  <span>
                                    <strong>{symbol}</strong>
                                    <small>
                                      {companyNames[symbol] ?? symbol}
                                    </small>
                                  </span>
                                </div>
                              </td>

                              <td>{holding?.quantity ?? "—"}</td>

                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={currentPrices[symbol] ?? ""}
                                  onChange={(event) =>
                                    updatePrice(symbol, event.target.value)
                                  }
                                  placeholder="Enter price"
                                  aria-label={`Manual price for ${symbol}`}
                                  className="price-field"
                                />
                              </td>

                              <td className="value-cell">
                                {holding
                                  ? formatNPR(holding.market_value)
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}

                        {!loading && filtered.length === 0 && (
                          <tr>
                            <td colSpan={4}>
                              {transactions.length === 0
                                ? "No saved transactions yet. Add a transaction through the API first."
                                : "No matching holdings found."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="table-foot">
                    <span>
                      {loading
                        ? "Fetching saved transactions..."
                        : "Prices are entered manually"}
                    </span>
                    <span>{symbols.length} symbols</span>
                  </div>

                  <button
                    className="primary-button"
                    onClick={calculatePortfolio}
                    disabled={loading || calculating || symbols.length === 0}
                  >
                    {calculating ? "Calculating..." : "Calculate portfolio"}
                  </button>

                  {portfolio && (
                    <div className="table-foot">
                      <span>Realized P/L: {formatNPR(realizedPnl ?? 0)}</span>
                      <span>
                        Unrealized P/L: {formatNPR(unrealizedPnl ?? 0)}
                      </span>
                    </div>
                  )}
                </section>

                <section className="panel assistant-panel">
                  <div className="assistant-heading">
                    <span className="assistant-mark">✳</span>
                    <div>
                      <h2>Your AI companion</h2>
                      <p>Understand before you invest.</p>
                    </div>
                    <span className="coming-pill">PREVIEW</span>
                  </div>

                  <div className="assistant-message">
                    <span className="message-mark">✳</span>
                    <div>
                      <strong>What would you like to understand?</strong>
                      <p>
                        Soon, you’ll be able to explore company reports, learn
                        financial terms, and compare hypothetical outcomes using
                        evidence-backed explanations.
                      </p>
                    </div>
                  </div>

                  <div className="suggestion-label">EXPLORE AN EXAMPLE</div>

                  <button
                    className="suggestion"
                    onClick={() => setActive("Learn Investing")}
                  >
                    <span>↗</span>
                    What does EPS mean?
                    <span className="suggestion-arrow">→</span>
                  </button>

                  <button
                    className="suggestion"
                    onClick={() => setActive("Explore Stocks")}
                  >
                    <span>◉</span>
                    How do I analyze a company?
                    <span className="suggestion-arrow">→</span>
                  </button>

                  <button
                    className="suggestion"
                    onClick={() => setActive("My Portfolio")}
                  >
                    <span>⌁</span>
                    How does profit and loss work?
                    <span className="suggestion-arrow">→</span>
                  </button>

                  <div className="assistant-disclaimer">
                    AI explanations will be informational, not guaranteed
                    predictions or personalized buy/sell instructions.
                  </div>
                </section>
              </div>

              <footer className="footer">
                <span>✳ Mero Invest AI</span>
                <span>Built for clearer investing in Nepal.</span>
                <span>DEVELOPMENT · MANUAL PRICES</span>
              </footer>
            </>
          )}
        </div>
      </section>
    </main>
  );
}