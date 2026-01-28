import argparse
import datetime as dt
import re
import sqlite3
import sys
import urllib3
from pathlib import Path

import requests
from bs4 import BeautifulSoup
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def fetch_html(url: str) -> str:
    response = requests.get(url, timeout=10, verify=False)
    response.raise_for_status()
    return response.text


def parse_last_updated(html: str) -> str | None:
    """
    Extract the 'Last updated ...' timestamp string if present.

    Stored as a raw string because the site format is not guaranteed.
    """
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    m = re.search(r"\bLast updated\b\s+(.+?)(?:\s+Refresh\b|$)", text, re.IGNORECASE)
    if not m:
        return None
    return m.group(1).strip()


def parse_statuses(html: str) -> dict[str, int]:
    soup = BeautifulSoup(html, "html.parser")
    statuses = {}
    garage_names = ["South Garage", "North Garage", "West Garage", "South Campus Garage"]
    
    for garage_name in garage_names:
        heading = soup.find("h2", string=lambda t: t and garage_name in t.strip())
        if not heading:
            continue
        
        parent = heading.parent
        if not parent:
            continue
        
        parent_text = parent.get_text()
        

        garage_pattern = re.escape(garage_name.strip())

        pattern = rf"{garage_pattern}.*?(?:\d+\s+[SNWE].*?)?\s+(Full|\d+\s*%)"
        match = re.search(pattern, parent_text, re.IGNORECASE | re.DOTALL)
        
        if match:
            status_text = match.group(1).strip()
            if "Full" in status_text or status_text.lower() == "full":
                statuses[garage_name] = 100
            elif "%" in status_text:
                try:
                    number_str = status_text.replace("%", "").strip()
                    statuses[garage_name] = int(number_str)
                except ValueError:
                    continue
    
    return statuses


def print_statuses(statuses: dict[str, int]):
    garage_order = ["South Garage", "North Garage", "West Garage", "South Campus Garage"]
    
    for garage_name in garage_order:
        if garage_name in statuses:
            print(f"{garage_name}: {statuses[garage_name]}")


def default_db_path() -> Path:
    return Path(__file__).resolve().with_name("sjsu_parking.db")


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS garage_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fetched_at TEXT NOT NULL,
            last_updated TEXT,
            garage TEXT NOT NULL,
            status INTEGER NOT NULL,
            source_url TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_garage_status_garage ON garage_status(garage)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_garage_status_fetched_at ON garage_status(fetched_at)")
    conn.commit()


def store_statuses(
    *,
    db_path: Path,
    source_url: str,
    fetched_at: str,
    last_updated: str | None,
    statuses: dict[str, int],
) -> int:
    rows = [(fetched_at, last_updated, garage, status, source_url) for garage, status in statuses.items()]
    if not rows:
        return 0

    with sqlite3.connect(db_path) as conn:
        init_db(conn)
        conn.executemany(
            """
            INSERT INTO garage_status (fetched_at, last_updated, garage, status, source_url)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="Scrape SJSU garage status and store in SQLite.")
    parser.add_argument(
        "--db",
        default=str(default_db_path()),
        help="Path to SQLite DB file (default: ./sjsu_parking.db next to this script).",
    )
    parser.add_argument(
        "--no-print",
        action="store_true",
        help="Do not print statuses; only store them in the DB.",
    )
    args = parser.parse_args()

    url = "https://sjsuparkingstatus.sjsu.edu/GarageStatusPlain"
    
    try:
        html = fetch_html(url)
        last_updated = parse_last_updated(html)
        statuses = parse_statuses(html)
        fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

        inserted = store_statuses(
            db_path=Path(args.db),
            source_url=url,
            fetched_at=fetched_at,
            last_updated=last_updated,
            statuses=statuses,
        )

        if not args.no_print:
            print_statuses(statuses)
        if inserted == 0:
            print("No statuses parsed; nothing stored.", file=sys.stderr)
    except requests.RequestException as e:
        print(f"Error fetching parking status: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error parsing parking status: {e}", file=sys.stderr)
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
