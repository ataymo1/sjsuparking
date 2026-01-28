import datetime as dt
import json
import os
import re
import urllib3

import requests
from bs4 import BeautifulSoup
from http.server import BaseHTTPRequestHandler

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


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


def send_to_supabase(
    *,
    source_url: str,
    fetched_at: str,
    last_updated: str | None,
    statuses: dict[str, int],
) -> tuple[int, str | None]:
    """
    Send statuses to Supabase.
    Returns tuple of (inserted_count, error_message).
    """
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        return (0, "SUPABASE_URL or SUPABASE_KEY not set")
    
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/garage_status"
    
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
        return (0, None)
    
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    
    try:
        resp = requests.post(endpoint, headers=headers, json=rows, timeout=10)
        resp.raise_for_status()
        return (len(rows), None)
    except requests.RequestException as e:
        error_msg = str(e)
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_msg = e.response.text[:2000]
            except:
                pass
        return (0, error_msg)


def get_request_token(query_params: dict) -> str | None:
    """Extract token from query parameters."""
    token = query_params.get("token")
    if isinstance(token, list):
        return token[0] if token else None
    return token


def parse_query_string(query_string: str) -> dict:
    """Parse query string into a dictionary."""
    params = {}
    if not query_string:
        return params
    for pair in query_string.split("&"):
        if "=" in pair:
            key, value = pair.split("=", 1)
            if key in params:
                if not isinstance(params[key], list):
                    params[key] = [params[key]]
                params[key].append(value)
            else:
                params[key] = value
    return params


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.handle_request()
    
    def do_HEAD(self):
        self.handle_request()
    
    def handle_request(self):
        """Handle the cron job request."""
        # Check HTTP method
        if self.command not in ("GET", "HEAD"):
            self.send_response(405)
            self.send_header("Allow", "GET, HEAD")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Method not allowed"}).encode("utf-8"))
            return
        
        # Check CRON_SECRET
        cron_secret = os.getenv("CRON_SECRET")
        if not cron_secret:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "CRON_SECRET is not set in the environment"}).encode("utf-8"))
            return
        
        # Check authentication
        auth_header = self.headers.get("Authorization", "")
        query_string = self.path.split("?")[1] if "?" in self.path else ""
        query_params = parse_query_string(query_string)
        token = get_request_token(query_params)
        
        authed = auth_header == f"Bearer {cron_secret}" or token == cron_secret
        if not authed:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode("utf-8"))
            return
        
        # Check Supabase environment variables
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "SUPABASE_URL or SUPABASE_KEY is not set"}).encode("utf-8"))
            return
        
        source_url = "https://sjsuparkingstatus.sjsu.edu/GarageStatusPlain"
        
        try:
            # Fetch and parse HTML
            html = fetch_html(source_url)
            last_updated = parse_last_updated(html)
            statuses = parse_statuses(html)
            fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
            
            # Prepare rows
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
            
            # If no statuses parsed, return early
            if len(rows) == 0:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                response = {
                    "ok": True,
                    "inserted": 0,
                    "fetchedAt": fetched_at,
                    "lastUpdated": last_updated,
                    "statuses": statuses,
                    "note": "No statuses parsed; nothing inserted",
                }
                self.wfile.write(json.dumps(response).encode("utf-8"))
                return
            
            # Send to Supabase
            inserted, error = send_to_supabase(
                source_url=source_url,
                fetched_at=fetched_at,
                last_updated=last_updated,
                statuses=statuses,
            )
            
            if error:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                response = {
                    "error": "Supabase insert failed",
                    "message": error,
                    "fetchedAt": fetched_at,
                    "lastUpdated": last_updated,
                    "statuses": statuses,
                }
                self.wfile.write(json.dumps(response).encode("utf-8"))
                return
            
            # Success response
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "ok": True,
                "inserted": inserted,
                "fetchedAt": fetched_at,
                "lastUpdated": last_updated,
                "statuses": statuses,
            }
            self.wfile.write(json.dumps(response).encode("utf-8"))
            
        except requests.RequestException as e:
            message = str(e)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "error": "Failed to fetch garage status page",
                "message": message,
            }
            self.wfile.write(json.dumps(response).encode("utf-8"))
        except Exception as e:
            message = str(e)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "error": "Cron failed",
                "message": message,
            }
            self.wfile.write(json.dumps(response).encode("utf-8"))
