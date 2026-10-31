
"use client";

import { useEffect, useState } from "react";
import { getTransactions, type Transaction } from "@/lib/api";

export default function ApiTestPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getTransactions()
            .then((result) => setTransactions(result.transactions))
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="api-test-page">
            <h1>Mero Invest AI — API Test</h1>

            {loading && <p>Loading transactions...</p>}

            {error && (
                <p className="error-message">
                    Connection error: {error}
                </p>
            )}

            {!loading && !error && (
                <div>
                    <p>Connected successfully.</p>
                    <p>Saved transactions: {transactions.length}</p>

                    {transactions.map((tx) => (
                        <div key={tx.id} className="transaction-result">
                            <p>
                                {tx.type} {tx.quantity} shares of {tx.symbol}
                            </p>
                            <p>Price: NPR {tx.price.toFixed(2)}</p>
                            <p>Fees: NPR {tx.fees.toFixed(2)}</p>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
