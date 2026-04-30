import os
import psycopg2
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env_file = ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                val = val.split(" #")[0].strip().strip('"').strip("'")
                os.environ.setdefault(key, val)

DB_URL = os.environ.get("DATABASE_URL", "postgresql://deepak:mysecretpassword@localhost:5432/balance_db")

def migrate():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    migrations_dir = Path(__file__).parent.parent / "db" / "migrations"
    migrations = sorted([f for f in migrations_dir.iterdir() if f.name.endswith(".sql")])
    
    for mf in migrations:
        cur.execute("SELECT version FROM schema_migrations WHERE version = %s", (mf.name,))
        if not cur.fetchone():
            print(f"Applying {mf.name}...")
            with open(mf, "r") as f:
                cur.execute(f.read())
            cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (mf.name,))
            print(f"Successfully applied {mf.name}")
        else:
            print(f"Skipping {mf.name} (already applied).")
            
    cur.close()
    conn.close()
    print("Migration sequence completed.")

if __name__ == "__main__":
    migrate()
