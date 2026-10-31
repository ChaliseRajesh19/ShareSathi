
"use client";

import { useEffect, useMemo, useState } from "react";
import {
    getFinancialAnalysis,
    getMarketPrices,
    type FinancialAnalysis,
    type FinancialExplanation,
    type FinancialReport,
    type FinancialTrend,
    type MarketPrice,
} from "@/lib/api";

const formatNumber = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const formatNPR = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return `NPR ${formatNumber(value)}`;
};

const formatProfit = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return `NPR ${formatNumber(value / 10000000)} Cr`;
};

const formatDate = (value?: string | null) => {
    if (!value) return "Date unavailable";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
};

function TrendLabel({ trend }: { trend: FinancialTrend }) {
    if (trend.status !== "calculated") {
        return <span className="ca-trend neutral">Insufficient data</span>;
    }

    const direction = trend.direction;

    const label =
        direction === "increased"
            ? "Increased"
            : direction === "decreased"
                ? "Decreased"
                : "Unchanged";

    return (
        <span className={`ca-trend ${direction}`}>
            {direction === "increased"
                ? "↑"
                : direction === "decreased"
                    ? "↓"
                    : "→"}
            {" "}{label}
            {trend.percentage_change != null &&
                ` · ${formatNumber(Math.abs(trend.percentage_change))}%`}
        </span>
    );
}

function MetricCard({
    title,
    value,
    description,
    trend,
}: {
    title: string;
    value: string;
    description: string;
    trend?: FinancialTrend;
}) {
    return (
        <article className="ca-metric-card">
            <span className="ca-label">{title}</span>
            <strong className="ca-metric-value">{value}</strong>
            {trend && <TrendLabel trend={trend} />}
            <p>{description}</p>
        </article>
    );
}

function ExplanationCard({
    explanation,
}: {
    explanation: FinancialExplanation;
}) {
    return (
        <article className="ca-explanation-card">
            <h3>{explanation.label}</h3>
            <p className="ca-explanation-meaning">
                {explanation.meaning}
            </p>

            {explanation.interpretation && (
                <div className="ca-explanation-block">
                    <span>What happened?</span>
                    <p>{explanation.interpretation}</p>
                </div>
            )}

            {explanation.investor_context && (
                <div className="ca-explanation-block investor">
                    <span>Why does it matter?</span>
                    <p>{explanation.investor_context}</p>
                </div>
            )}
        </article>
    );
}

function AnnualPerformanceTable({
    reports,
}: {
    reports: FinancialReport[];
}) {
    if (!reports.length) {
        return (
            <div className="ca-no-data">
                No annual reports are available for this company.
            </div>
        );
    }

    return (
        <div className="ca-table-scroll">
            <table className="ca-table">
                <thead>
                    <tr>
                        <th>Fiscal year</th>
                        <th>EPS</th>
                        <th>Profit</th>
                        <th>P/E</th>
                        <th>Net worth / share</th>
                    </tr>
                </thead>
                <tbody>
                    {reports.map((report, index) => (
                        <tr key={`${report.fiscal_year}-${report.type}-${index}`}>
                            <td>
                                <strong>{report.fiscal_year}</strong>
                                {report.fiscal_year_nepali && (
                                    <small>{report.fiscal_year_nepali}</small>
                                )}
                            </td>
                            <td>{formatNumber(report.eps)}</td>
                            <td>{formatProfit(report.profit)}</td>
                            <td>{formatNumber(report.pe)}</td>
                            <td>{formatNPR(report.net_worth_per_share)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function QuarterlySnapshot({
    report,
}: {
    report: NonNullable<FinancialAnalysis["latest_quarterly"]>;
}) {
    const document = report.documents?.[0];

    return (
        <div className="ca-detail-content">
            <div className="ca-detail-intro">
                {report.quarter} · FY {report.fiscal_year}
                {report.fiscal_year_nepali
                    ? ` (${report.fiscal_year_nepali})`
                    : ""}
            </div>

            <div className="ca-metrics-grid">
                <MetricCard
                    title="Earnings per share"
                    value={formatNPR(report.eps)}
                    description="EPS reported in this filing."
                />
                <MetricCard
                    title="Reported profit"
                    value={formatProfit(report.profit)}
                    description="Profit figure in this filing."
                />
                <MetricCard
                    title="Price-to-earnings"
                    value={formatNumber(report.pe)}
                    description="Reported P/E ratio."
                />
                <MetricCard
                    title="Net worth per share"
                    value={formatNPR(report.net_worth_per_share)}
                    description="Reported book value per share."
                />
            </div>

            <div className="ca-report-meta">
                <span>
                    <strong>Paid-up capital</strong>
                    {formatProfit(report.paid_up_capital)}
                </span>
                <span>
                    <strong>Submitted</strong>
                    {formatDate(document?.submitted_date)}
                </span>

                {document?.path && (
                    <a
                        href={
                            document.path.startsWith("http")
                                ? document.path
                                : `https://shubhamnpk.github.io/yonepse/data/company/${document.path}`
                        }
                        target="_blank"
                        rel="noreferrer"
                    >
                        View source document ↗
                    </a>
                )}
            </div>

            <p className="ca-note">
                These figures come from the reported quarterly filing.
                They are not automatically equivalent to audited annual
                results or standalone quarterly results. Check the original
                filing for its reporting basis.
            </p>
        </div>
    );
}

function AnnualTrendChart({
    reports,
}: {
    reports: FinancialReport[];
}) {
    const validReports = [...reports]
        .filter(
            (report) =>
                report.profit != null &&
                Number.isFinite(report.profit)
        )
        .reverse();

    if (validReports.length < 2) {
        return (
            <div className="ca-no-data">
                At least two annual profit observations are needed to show a trend.
            </div>
        );
    }

    const max = Math.max(
        ...validReports.map((report) => report.profit ?? 0),
        1
    );

    return (
        <div className="ca-chart">
            <div className="ca-chart-bars">
                {validReports.map((report, index) => {
                    const profit = report.profit ?? 0;
                    const height = Math.max((profit / max) * 100, 3);

                    return (
                        <div
                            className="ca-chart-column"
                            key={`${report.fiscal_year}-${index}`}
                        >
                            <div className="ca-chart-value">
                                {formatNumber(profit / 10000000)}
                            </div>

                            <div className="ca-chart-track">
                                <div
                                    className="ca-chart-bar"
                                    style={{ height: `${height}%` }}
                                    title={`${report.fiscal_year}: ${formatProfit(profit)}`}
                                />
                            </div>

                            <span>{report.fiscal_year}</span>
                        </div>
                    );
                })}
            </div>

            <p className="ca-chart-caption">
                Annual reported profit · NPR crore
            </p>
        </div>
    );
}

function DetailSection({
    title,
    description,
    children,
    defaultOpen = false,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    return (
        <details
            className="ca-accordion"
            open={defaultOpen || undefined}
        >
            <summary>
                <div>
                    <strong>{title}</strong>
                    {description && <span>{description}</span>}
                </div>
                <span className="ca-accordion-icon">⌄</span>
            </summary>

            <div className="ca-accordion-body">
                {children}
            </div>
        </details>
    );
}

export default function CompanyAnalysis() {
    const [symbol, setSymbol] = useState("NABIL");
    const [search, setSearch] = useState("");
    const [stocks, setStocks] = useState<MarketPrice[]>([]);
    const [stocksLoading, setStocksLoading] = useState(true);
    const [stocksError, setStocksError] = useState("");

    const [analysis, setAnalysis] = useState<FinancialAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [showAllStocks, setShowAllStocks] = useState(false);

    useEffect(() => {
        let active = true;

        async function loadStocks() {
            setStocksLoading(true);
            setStocksError("");

            try {
                const result = await getMarketPrices();
                if (!active) return;

                setStocks(result.prices ?? []);
            } catch (err) {
                if (!active) return;

                setStocksError(
                    err instanceof Error
                        ? err.message
                        : "Unable to load the stock list."
                );
            } finally {
                if (active) setStocksLoading(false);
            }
        }

        void loadStocks();

        return () => {
            active = false;
        };
    }, []);

    const filteredStocks = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) return stocks.slice(0, 12);

        return stocks
            .filter(
                (stock) =>
                    stock.symbol.toLowerCase().includes(query) ||
                    (stock.name ?? "").toLowerCase().includes(query)
            )
            .slice(0, 12);
    }, [stocks, search]);

    const loadAnalysis = async (requestedSymbol: string) => {
        const normalizedSymbol = requestedSymbol.trim().toUpperCase();

        if (!/^[A-Z0-9.&-]+$/.test(normalizedSymbol)) {
            setError("Enter a valid NEPSE company symbol.");
            return;
        }

        setSymbol(normalizedSymbol);
        setSearch(normalizedSymbol);
        setShowAllStocks(false);
        setAnalysis(null);
        setError("");
        setLoading(true);

        try {
            const result = await getFinancialAnalysis(normalizedSymbol);
            setAnalysis(result);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load company financial analysis."
            );
        } finally {
            setLoading(false);
        }
    };

    const explanations = analysis?.financial_explanations.explanations;
    const summary = analysis?.company_summary;
    const trends = analysis?.annual_trends;

    const selectedStock = stocks.find(
        (stock) => stock.symbol === analysis?.symbol
    );

    return (
        <section className="company-analysis ca-redesigned">

            {/* PAGE HEADER */}
            <header className="ca-page-header">
                <div>
                    <span className="ca-eyebrow">NEPAL STOCK MARKET</span>
                    <h1>Company Analysis</h1>
                    <p>
                        Understand a company&apos;s financial health without
                        getting lost in complicated numbers.
                    </p>
                </div>
            </header>

            {/* COMPANY SEARCH */}
            <section className="ca-search-panel">
                <div className="ca-search-top">
                    <div>
                        <span className="ca-eyebrow">EXPLORE COMPANIES</span>
                        <h2>Which company are you interested in?</h2>
                    </div>

                    <span className="ca-stock-count">
                        {stocksLoading
                            ? "Loading..."
                            : `${stocks.length} stocks`}
                    </span>
                </div>

                <div className="ca-search-controls">
                    <div className="ca-search-input-wrap">
                        <span className="ca-search-icon">⌕</span>

                        <input
                            value={search}
                            onChange={(event) => {
                                setSearch(event.target.value.toUpperCase());
                                setShowAllStocks(true);
                            }}
                            onFocus={() => setShowAllStocks(true)}
                            onKeyDown={(event) => {
                                if (
                                    event.key === "Enter" &&
                                    filteredStocks[0]
                                ) {
                                    event.preventDefault();
                                    void loadAnalysis(filteredStocks[0].symbol);
                                }
                            }}
                            placeholder="Search company name or symbol..."
                            aria-label="Search companies"
                        />

                        {search && (
                            <button
                                type="button"
                                className="ca-clear-search"
                                onClick={() => setSearch("")}
                                aria-label="Clear search"
                            >
                                ×
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        className="ca-search-button"
                        disabled={loading || !search.trim()}
                        onClick={() => {
                            const exact = stocks.find(
                                (stock) =>
                                    stock.symbol.toLowerCase() ===
                                    search.trim().toLowerCase()
                            );

                            void loadAnalysis(exact?.symbol ?? search);
                        }}
                    >
                        {loading ? "Analyzing..." : "Analyze"}
                    </button>
                </div>

                {showAllStocks && search.trim() && (
                    <div className="ca-search-results">
                        {filteredStocks.length ? (
                            filteredStocks.map((stock) => (
                                <button
                                    type="button"
                                    className="ca-stock-option"
                                    key={stock.symbol}
                                    onClick={() => {
                                        void loadAnalysis(stock.symbol);
                                    }}
                                >
                                    <span className="ca-stock-symbol">
                                        {stock.symbol}
                                    </span>
                                    <span className="ca-stock-name">
                                        {stock.name || stock.symbol}
                                    </span>
                                    <span className="ca-stock-arrow">↗</span>
                                </button>
                            ))
                        ) : (
                            <div className="ca-search-no-results">
                                No matching stock found. You can still
                                enter a valid company symbol manually.
                            </div>
                        )}
                    </div>
                )}

                {stocksError && (
                    <p className="ca-search-hint">
                        Stock suggestions are temporarily unavailable.
                        You can still search by symbol.
                    </p>
                )}

                <div className="ca-search-footer">
                    <span>
                        {selectedStock
                            ? selectedStock.name ?? selectedStock.symbol
                            : `Current symbol: ${symbol}`}
                    </span>

                    <button
                        type="button"
                        className="ca-text-button"
                        onClick={() => {
                            setSearch("");
                            setShowAllStocks(false);
                        }}
                    >
                        Clear
                    </button>
                </div>
            </section>

            {error && (
                <div className="ca-alert error" role="alert">
                    {error}
                </div>
            )}

            {/* EMPTY STATE */}
            {!analysis && !loading && !error && (
                <div className="ca-empty">
                    <div className="ca-empty-icon">⌕</div>
                    <h2>Start exploring a company</h2>
                    <p>
                        Search for a NEPSE-listed company to see its
                        financial performance, strengths and risks.
                    </p>

                    <button
                        type="button"
                        onClick={() => void loadAnalysis("NABIL")}
                    >
                        Explore NABIL
                    </button>
                </div>
            )}

            {/* LOADING */}
            {loading && (
                <div className="ca-loading">
                    <div className="ca-spinner" />
                    <strong>Analyzing {symbol}</strong>
                    <p>Preparing the company&apos;s financial overview...</p>
                </div>
            )}

            {/* ANALYSIS */}
            {analysis && !loading && (
                <>
                    {/* COMPANY IDENTITY */}
                    <section className="ca-company-banner">
                        <div className="ca-company-identity">
                            <div className="ca-company-avatar">
                                {analysis.symbol.slice(0, 2)}
                            </div>

                            <div>
                                <span className="ca-eyebrow">
                                    COMPANY OVERVIEW
                                </span>
                                <h2>{analysis.symbol}</h2>
                                <p>
                                    {selectedStock?.name ??
                                        "NEPSE-listed company"}
                                </p>
                            </div>
                        </div>

                        <div className="ca-company-period">
                            <span>Latest annual period</span>
                            <strong>
                                {analysis.financial_explanations.data_basis
                                    .latest_fiscal_year ?? "Unavailable"}
                            </strong>
                            <small>
                                {analysis.annual_periods_analyzed} annual periods
                                {" · "}
                                {analysis.reports_count} total reports
                            </small>
                        </div>
                    </section>

                    {/* DASHBOARD SUMMARY */}
                    <section className="ca-dashboard-grid">
                        <article className="ca-assessment">
                            <div className="ca-assessment-icon">✦</div>

                            <div>
                                <span className="ca-eyebrow">
                                    HISTORICAL FINANCIAL ASSESSMENT
                                </span>
                                <h2>
                                    {summary?.label ?? "Assessment unavailable"}
                                </h2>
                                <p>
                                    {summary?.explanation ??
                                        "No assessment explanation is available."}
                                </p>
                            </div>

                            <span className="ca-badge neutral">
                                Historical data
                            </span>
                        </article>

                        <aside className="ca-coverage-card">
                            <div className="ca-coverage-heading">
                                <div>
                                    <span className="ca-eyebrow">DATA COVERAGE</span>
                                    <h3>Analysis confidence</h3>
                                </div>
                                <span className="ca-coverage-mark">✓</span>
                            </div>

                            <div className="ca-coverage-meter">
                                <span style={{
                                    width: `${Math.min(
                                        Math.max(analysis.annual_periods_analyzed * 20, 20),
                                        100
                                    )}%`
                                }} />
                            </div>

                            <div className="ca-coverage-stats">
                                <span>
                                    <strong>{analysis.annual_periods_analyzed}</strong>
                                    annual periods
                                </span>
                                <span>
                                    <strong>{analysis.reports_count}</strong>
                                    total reports
                                </span>
                            </div>
                        </aside>
                    </section>

                    {/* KEY METRICS */}
                    <section className="ca-section">
                        <div className="ca-section-heading">
                            <div>
                                <span className="ca-eyebrow">
                                    THE IMPORTANT NUMBERS
                                </span>
                                <h2>Financial health at a glance</h2>
                                <p>Based on the latest available annual report.</p>
                            </div>
                        </div>

                        <div className="ca-metrics-grid">
                            <MetricCard
                                title="Earnings per share"
                                value={formatNPR(explanations?.eps.value)}
                                description="Earnings attributable to each share."
                                trend={trends?.eps}
                            />

                            <MetricCard
                                title="Net profit"
                                value={formatProfit(explanations?.profit.value)}
                                description="Profit reported for the year."
                                trend={trends?.profit}
                            />

                            <MetricCard
                                title="Net worth per share"
                                value={formatNPR(
                                    explanations?.net_worth_per_share.value
                                )}
                                description="Book value attributable to each share."
                                trend={trends?.net_worth_per_share}
                            />

                            <MetricCard
                                title="P/E ratio"
                                value={formatNumber(explanations?.pe.value)}
                                description="Reported price-to-earnings ratio."
                            />
                        </div>
                    </section>

                    {/* PERFORMANCE STORY */}
                    <section className="ca-section ca-performance-section">
                        <div className="ca-section-heading">
                            <div>
                                <span className="ca-eyebrow">PERFORMANCE STORY</span>
                                <h2>Is the business building momentum?</h2>
                                <p>
                                    Annual reported profit gives a long-term view
                                    of the company&apos;s earning power.
                                </p>
                            </div>
                            <span className="ca-section-tag">Annual view</span>
                        </div>

                        <div className="ca-performance-grid">
                            <div className="ca-chart-card">
                                <AnnualTrendChart reports={analysis.annual_reports_used} />
                            </div>

                            <div className="ca-signal-card">
                                <span className="ca-eyebrow">INVESTOR READOUT</span>
                                <h3>What stands out</h3>
                                <div className="ca-signal-list">
                                    <div>
                                        <span className="ca-signal-icon positive">↗</span>
                                        <p>
                                            {summary?.highlights[0] ??
                                                "No positive signal was reported."}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="ca-signal-icon caution">!</span>
                                        <p>
                                            {summary?.concerns[0] ??
                                                "No concern was reported."}
                                        </p>
                                    </div>
                                </div>
                                <span className="ca-signal-footnote">
                                    Based on available historical filings
                                </span>
                            </div>
                        </div>
                    </section>

                    {/* HIGHLIGHTS AND CONCERNS */}
                    <section className="ca-section">
                        <div className="ca-section-heading">
                            <div>
                                <span className="ca-eyebrow">
                                    INVESTOR CHECKLIST
                                </span>
                                <h2>What should you notice?</h2>
                                <p>
                                    Key observations from the available
                                    historical financial data.
                                </p>
                            </div>
                        </div>

                        <div className="ca-insight-grid">
                            <div className="ca-insight-card positive">
                                <h3><span>↗</span> Positive signals</h3>

                                {summary?.highlights.length ? (
                                    <ul>
                                        {summary.highlights.map((item, index) => (
                                            <li key={index}>{item}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p>No highlights available.</p>
                                )}
                            </div>

                            <div className="ca-insight-card caution">
                                <h3><span>!</span> Things to watch</h3>

                                {summary?.concerns.length ? (
                                    <ul>
                                        {summary.concerns.map((item, index) => (
                                            <li key={index}>{item}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p>No concerns reported.</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* DETAILED INFORMATION */}
                    <section className="ca-section ca-details-section">
                        <div className="ca-section-heading">
                            <div>
                                <span className="ca-eyebrow">
                                    EXPLORE THE DETAILS
                                </span>
                                <h2>Go deeper into the numbers</h2>
                                <p>
                                    Open any section to explore the supporting
                                    financial information.
                                </p>
                            </div>
                        </div>

                        {analysis.latest_quarterly_available &&
                            analysis.latest_quarterly && (
                                <DetailSection
                                    title="Latest quarterly report"
                                    description="Review the most recently reported quarterly figures."
                                >
                                    <QuarterlySnapshot
                                        report={analysis.latest_quarterly}
                                    />
                                </DetailSection>
                            )}

                        <DetailSection
                            title="Annual profit trend"
                            description="Visual comparison of reported annual profit."
                        >
                            <AnnualTrendChart
                                reports={analysis.annual_reports_used}
                            />
                        </DetailSection>

                        <DetailSection
                            title="Annual financial performance"
                            description={`${analysis.annual_reports_used.length} annual reporting periods`}
                        >
                            <AnnualPerformanceTable
                                reports={analysis.annual_reports_used}
                            />
                        </DetailSection>

                        <DetailSection
                            title="Understand financial metrics"
                            description="Learn what each metric means and why it matters."
                        >
                            <div className="ca-explanations-grid">
                                {explanations &&
                                    Object.values(explanations).map((item) => (
                                        <ExplanationCard
                                            key={item.metric}
                                            explanation={item}
                                        />
                                    ))}
                            </div>
                        </DetailSection>

                        {explanations?.pe && (
                            <DetailSection
                                title="P/E valuation context"
                                description="Compare reported P/E with historical observations."
                            >
                                <div className="ca-valuation-grid">
                                    <div>
                                        <span className="ca-label">
                                            Latest reported P/E
                                        </span>
                                        <strong>
                                            {formatNumber(
                                                analysis.valuation.pe.latest_pe
                                            )}
                                        </strong>
                                    </div>

                                    <div>
                                        <span className="ca-label">
                                            Historical median P/E
                                        </span>
                                        <strong>
                                            {formatNumber(
                                                analysis.valuation.pe
                                                    .historical_median_pe
                                            )}
                                        </strong>
                                    </div>

                                    <div>
                                        <span className="ca-label">
                                            Historical comparison
                                        </span>
                                        <strong>
                                            {analysis.valuation.pe.comparison
                                                .replaceAll("_", " ")}
                                        </strong>
                                    </div>
                                </div>

                                <p className="ca-note">
                                    {analysis.valuation.pe.message}
                                </p>

                                <p className="ca-muted">
                                    Historical P/E is context, not proof that
                                    a share is currently cheap or expensive.
                                    Compare with peers and check the price
                                    and earnings dates.
                                </p>
                            </DetailSection>
                        )}

                        <DetailSection
                            title="Data quality and limitations"
                            description="Check the completeness of the available information."
                        >
                            <div className="ca-quality-stats">
                                <div>
                                    <span>Annual reports</span>
                                    <strong>
                                        {analysis.annual_reports_count}
                                    </strong>
                                </div>

                                <div>
                                    <span>Quarterly reports</span>
                                    <strong>
                                        {analysis.quarterly_reports_count}
                                    </strong>
                                </div>

                                <div>
                                    <span>Missing annual values</span>
                                    <strong>
                                        {analysis.data_quality
                                            .missing_values_in_selected_annual_reports}
                                    </strong>
                                </div>
                            </div>

                            {analysis.data_quality.has_duplicate_periods && (
                                <div className="ca-alert warning">
                                    Duplicate reporting periods were found.
                                    The backend selected annual records using
                                    a submission-date and completeness
                                    heuristic. Verify original filings when
                                    necessary.
                                </div>
                            )}

                            {summary?.limitations.length ? (
                                <ul className="ca-limitations">
                                    {summary.limitations.map((item, index) => (
                                        <li key={index}>{item}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="ca-muted">
                                    No additional limitations were reported.
                                </p>
                            )}
                        </DetailSection>
                    </section>

                    {/* DISCLAIMER */}
                    <footer className="ca-disclaimer">
                        <strong>Important information</strong>
                        <p>
                            {analysis.financial_explanations.disclaimer}
                            {" "}This page describes historical reported
                            information. It does not predict future
                            performance or provide personalized investment
                            recommendations.
                        </p>
                    </footer>
                </>
            )}
        </section>
    );
}
