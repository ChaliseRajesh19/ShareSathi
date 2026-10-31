
const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type Transaction = {
    id: number;
    symbol: string;
    type: "BUY" | "SELL";
    quantity: number;
    price: number;
    fees: number;
    transaction_date: string;
};

export type Holding = {
    quantity: number;
    average_cost: number;
    cost_basis: number;
    current_price: number;
    market_value: number;
    realized_pnl: number;
    unrealized_pnl: number;
    unrealized_return_pct: number;
    total_buy_fees: number;
    total_sell_fees: number;
};

export type Portfolio = {
    holdings: Record<string, Holding>;
    summary: {
        total_invested: number;
        total_market_value: number;
        total_realized_pnl: number;
        total_unrealized_pnl: number;
        total_pnl: number;
        number_of_companies: number;
    };
    transactions_count: number;
};

async function request<T>(
    path: string,
    options?: RequestInit
): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options?.headers,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
            body?.detail ?? `API request failed (${response.status})`
        );
    }

    return response.json() as Promise<T>;
}

export function getTransactions() {
    return request<{ transactions: Transaction[] }>("/api/transactions");
}

export function createTransaction(
    transaction: Omit<Transaction, "id" | "transaction_date">
) {
    return request<{ message: string; transaction: Transaction }>(
        "/api/transactions",
        {
            method: "POST",
            body: JSON.stringify(transaction),
        }
    );
}

export function calculateSavedPortfolio(
    currentPrices: Record<string, number>
) {
    return request<Portfolio>("/api/portfolio/calculate-saved", {
        method: "POST",
        body: JSON.stringify({ current_prices: currentPrices }),
    });
}

export type MarketPrice = {
    symbol: string;
    name: string | null;
    price: number;
    business_date: string | null;
    last_updated: string | null;
    is_live: boolean;
};


export type MarketPricesResponse = {
    market_status: string;
    market_as_of: string | null;
    source: string;
    is_live: boolean;
    business_date: string | null;
    fetched_at: string;
    count: number;
    prices: MarketPrice[];
    cached?: boolean;
    stale?: boolean;
    refresh_error?: string;
};


export function getMarketPrices() {
    return request<MarketPricesResponse>("/api/prices");
}


export type IPO = {
    company: string;
    units: string | number | null;
    date_range: string | null;
    announcement_date: string | null;
    description: string | null;
    source_url: string | null;
    is_reserved_share: boolean;
    reserved_for: string | null;
    source_updated_at: string | null;
    source: string;
    feed?: string;
    status?: "open" | "upcoming" | "closed" | "unknown";
    days_remaining?: number | null;
    opening_date_ad?: string | null;
    closing_date_ad?: string | null;
    weekdays?: number | null;
};

export type IPOOverview = {
    sources: Record<
        string,
        {
            name: string;
            url: string;
            purpose: string;
        }
    >;
    ipos: IPO[];
    open_ipos: IPO[];
    upcoming_ipos: IPO[];
    closed_ipos: IPO[];
    unknown_ipos: IPO[];
    count: number;
    counts?: {
        open?: number;
        upcoming?: number;
        closed?: number;
        unknown?: number;
        total?: number;
    };
    fetched_at: string;
    data_source: string;
    is_live: boolean;
    message: string;
    errors?: string[];
};


export function getIPOs() {
    return request<IPOOverview>("/api/ipos");
}

export type FinancialObservation = {
    fiscal_year: string;
    value: number;
};

export type FinancialTrend = {
    status: string;
    field: string;
    observations_available: number;
    latest: FinancialObservation | null;
    previous: FinancialObservation | null;
    absolute_change: number | null;
    percentage_change: number | null;
    direction: "increased" | "decreased" | "unchanged" | string;
};

export type FinancialReport = {
    type: string;
    quarter: string;
    fiscal_year: string;
    fiscal_year_nepali: string;
    eps: number | null;
    profit: number | null;
    pe: number | null;
    paid_up_capital: number | null;
    net_worth_per_share: number | null;
    documents: Array<{
        submitted_date: string;
        path: string;
    }>;
};

export type FinancialExplanation = {
    metric: string;
    label: string;
    value: number | null;
    fiscal_year?: string | null;
    previous_value?: number | null;
    previous_fiscal_year?: string | null;
    historical_median?: number | null;
    meaning: string;
    interpretation: string;
    investor_context: string;
    status: string;
};

export type FinancialAnalysis = {
    symbol: string;
    reports_count: number;
    annual_reports_count: number;
    quarterly_reports_count: number;
    annual_periods_analyzed: number;

    duplicate_periods: Array<{
        fiscal_year: string;
        type: string;
        quarter: string;
        count: number;
    }>;

    data_quality: {
        missing_values_in_selected_annual_reports: number;
        has_duplicate_periods: boolean;
        quarterly_trends_included: boolean;
    };

    annual_trends: {
        eps: FinancialTrend;
        profit: FinancialTrend;
        net_worth_per_share: FinancialTrend;
    };

    valuation: {
        pe: {
            status: string;
            latest_pe: number | null;
            latest_fiscal_year: string | null;
            historical_median_pe: number | null;
            comparison: string;
            historical_observations: number;
            message: string;
        };
    };

    insights: string[];

    company_summary: {
        assessment: string;
        label: string;
        explanation: string;
        highlights: string[];
        concerns: string[];
        limitations: string[];
        evidence: Array<{
            metric: string;
            previous_fiscal_year: string;
            previous_value: number;
            latest_fiscal_year: string;
            latest_value: number;
            direction: string;
            percentage_change: number | null;
        }>;
        is_investment_recommendation: boolean;
    };

    annual_reports_used: FinancialReport[];

    financial_explanations: {
        explanations: {
            eps: FinancialExplanation;
            profit: FinancialExplanation;
            net_worth_per_share: FinancialExplanation;
            pe: FinancialExplanation;
        };
        data_basis: {
            report_type: string;
            annual_periods_available: number;
            latest_fiscal_year: string | null;
            quarterly_data_used: boolean;
        };
        disclaimer: string;
    };

    analysis_status: string;
    quarterly_reports: QuarterlyFinancialReport[];
    latest_quarterly: QuarterlyFinancialReport | null;
    latest_quarterly_available: boolean;
};

export function getFinancialAnalysis(symbol: string) {
    return request<FinancialAnalysis>(
        `/api/financial-analysis/${encodeURIComponent(symbol.trim().toUpperCase())}`
    );
}

export interface QuarterlyFinancialReport {
    type: string;
    quarter: string;
    fiscal_year: string;
    fiscal_year_nepali?: string;
    eps: number | null;
    profit: number | null;
    pe: number | null;
    paid_up_capital: number | null;
    net_worth_per_share: number | null;
    documents: {
        submitted_date?: string;
        path?: string;
    }[];
}
