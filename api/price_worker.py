import os
import time
import psycopg2
import psycopg2.extras
import yfinance as yf

DB_URL = os.environ.get("DATABASE_URL", "postgresql://deepak:mysecretpassword@localhost:5432/balance_db")
POLL_INTERVAL = 60 * 60 # 1 hour

def fetch_prices():
    conn = psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.DictCursor)
    conn.autocommit = True
    cur = conn.cursor()

    print("Beginning price fetch cycle...")
    cur.execute("SELECT symbol FROM holdings WHERE deleted_at IS NULL GROUP BY symbol")
    symbols = [row["symbol"].upper() for row in cur.fetchall()]

    if not symbols:
        print("No active symbols to track.")
        cur.close()
        conn.close()
        return

    for symbol in symbols:
        try:
            # Basic fallback heuristics to normalize names for yfinance
            yf_sym = symbol
            if yf_sym == "SPY": yf_sym = "SPY"
            elif yf_sym == "BTC": yf_sym = "BTC-USD"
            elif yf_sym == "ETH": yf_sym = "ETH-USD"
            
            ticker = yf.Ticker(yf_sym)
            history = ticker.history(period="1d")
            
            if not history.empty:
                price = history['Close'].iloc[-1]
                
                # Update holding state natively
                cur.execute(
                    "UPDATE holdings SET price = %s, last_price_at = CURRENT_TIMESTAMP WHERE symbol = %s",
                    (float(price), symbol)
                )
                
                # Log immutable snapshot
                cur.execute(
                    "INSERT INTO price_snapshots (symbol, price, source) VALUES (%s, %s, %s)",
                    (symbol, float(price), "yfinance")
                )
                print(f"Updated {symbol} -> {price:,.2f}")
            else:
                print(f"Warning: No valid price history found for natively mapped {yf_sym}.")
        except Exception as e:
            print(f"Failed pulling {symbol}: {str(e)}")
            
        time.sleep(1) # courteous rate limit for Yahoo

    cur.close()
    conn.close()
    print("Price fetch cycle complete.")

if __name__ == "__main__":
    print("Balance Tracker Universal Price Worker Booted.")
    # Enter perpetual loop
    while True:
        try:
            fetch_prices()
        except Exception as e:
            print(f"Fatally errored during cycle: {str(e)}")
            
        print(f"Sleeping for {POLL_INTERVAL} seconds...")
        time.sleep(POLL_INTERVAL)
