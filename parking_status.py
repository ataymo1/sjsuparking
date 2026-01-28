import argparse
import datetime as dt
import os
import re
import sys
import urllib3

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

load_dotenv()


def fetch_html(url: str) -> str:
    response = requests.get(url, timeout=10, verify=False)
    response.raise_for_status()
    return response.text


def parse_last_updated(html: str) -> str | None:
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


def send_to_supabase(
    *,
    source_url: str,
    fetched_at: str,
    last_updated: str | None,
    statuses: dict[str, int],
) -> int:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        print("Warning: SUPABASE_URL or SUPABASE_KEY not set; skipping Supabase insert.", file=sys.stderr)
        return 0

    endpoint = f"{supabase_url}/rest/v1/garage_status"

    rows = [
        {
            "fetched_at": fetched_at,
            "last_updated": last_updated,
            "garage": garage,
            "status": status,
            "source_url": source_url,
        }
        for garage, status in statuses.items()
    ]
    if not rows:
        return 0

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    try:
        resp = requests.post(endpoint, headers=headers, json=rows, timeout=10)
        resp.raise_for_status()
        return len(rows)
    except requests.RequestException as e:
        print(f"Error inserting into Supabase: {e}", file=sys.stderr)
        if hasattr(e.response, 'text'):
            print(f"  Response: {e.response.text}", file=sys.stderr)
        return 0


def main():
    parser = argparse.ArgumentParser(description="Scrape SJSU garage status and store in Supabase.")
    parser.add_argument(
        "--no-print",
        action="store_true",
        help="Do not print statuses; only store them in Supabase.",
    )
    args = parser.parse_args()

    url = "https://sjsuparkingstatus.sjsu.edu/GarageStatusPlain"
    
    try:
        html = fetch_html(url)
        last_updated = parse_last_updated(html)
        statuses = parse_statuses(html)
        fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

        inserted = send_to_supabase(
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
