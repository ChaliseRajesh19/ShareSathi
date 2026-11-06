from sqlalchemy import text


from sqlalchemy import text


def check_price_alerts(engine, user_id: str, prices: list[dict]) -> int:
    """
    Check active price alerts against the latest available prices.

    Triggered alerts are updated only once, and a notification
    is created for each triggered alert.

    Returns the number of alerts triggered.
    """

    price_by_symbol = {}

    for item in prices:
        symbol = item.get("symbol")
        price = item.get("price")

        if not symbol or price is None:
            continue

        try:
            price = float(price)
        except (TypeError, ValueError):
            continue

        if price <= 0:
            continue

        price_by_symbol[symbol.strip().upper()] = price

    triggered_count = 0

    with engine.begin() as connection:
        for symbol, current_price in price_by_symbol.items():

            triggered_alerts = (
                connection.execute(
                    text("""
                        UPDATE public.price_alerts
                        SET
                            status = 'triggered',
                            triggered_at = NOW()
                        WHERE
                            user_id = CAST(:user_id AS uuid)
                            AND symbol = :symbol
                            AND status = 'active'
                            AND (
                                (condition = 'above' AND :price >= target_price)
                                OR
                                (condition = 'below' AND :price <= target_price)
                            )
                        RETURNING id, symbol, condition, target_price
                    """),
                    {
                        "user_id": user_id,
                        "symbol": symbol,
                        "price": current_price,
                    },
                )
                .mappings()
                .all()
            )

            for alert in triggered_alerts:
                condition_text = (
                    "risen above" if alert["condition"] == "above" else "fallen below"
                )

                message = (
                    f"{symbol} has {condition_text} your target price "
                    f"of NPR {float(alert['target_price']):.2f}. "
                    f"Latest price: NPR {current_price:.2f}."
                )

                connection.execute(
                    text("""
                        INSERT INTO public.notifications (
                            user_id,
                            alert_id,
                            symbol,
                            message
                        )
                        VALUES (
                            CAST(:user_id AS uuid),
                            :alert_id,
                            :symbol,
                            :message
                        )
                    """),
                    {
                        "user_id": user_id,
                        "alert_id": alert["id"],
                        "symbol": symbol,
                        "message": message,
                    },
                )

                triggered_count += 1

    return triggered_count
