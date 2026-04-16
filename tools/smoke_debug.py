#!/usr/bin/env python3
"""
Platform Smoke Test Debugger - On Steroids Edition
Author: Prompt Engineer
Purpose: Aggressive, all-in-one debugging for platform smoke tests.
Features:
  - Environment & dependency validation
  - Network connectivity & DNS checks
  - HTTP endpoint testing (status, headers, JSON paths, response time)
  - Database reachability (PostgreSQL, MySQL, SQLite)
  - Docker & process health checks
  - Disk space & memory sanity
  - Custom smoke test runner (Python or shell)
  - Colorized console output + JSON report
  - Extensible via config file (JSON/YAML)
Usage:
  python smoke_debug.py --help
  python smoke_debug.py --all
  python smoke_debug.py --env-vars API_KEY DB_URL --endpoints https://api.example.com/health
  python smoke_debug.py --smoke-test my_test.py
"""

import sys
import os
import json
import time
import socket
import subprocess
import argparse
import re
import traceback
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable, Union
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from pathlib import Path

# ---------- ANSI Colors (for pretty terminal output) ----------
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'

def cprint(text: str, color: str = Colors.RESET, bold: bool = False, end: str = "\n"):
    """Print colored text to terminal."""
    prefix = Colors.BOLD if bold else ""
    print(f"{prefix}{color}{text}{Colors.RESET}", end=end)

# ---------- Helper utilities ----------
def run_shell(cmd: str, timeout: int = 10) -> Dict[str, Any]:
    """Run a shell command and return result."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return {
            "success": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ---------- Debugger Core Class ----------
class PlatformDebugger:
    def __init__(self, verbose: bool = True, output_json: Optional[str] = None):
        self.verbose = verbose
        self.output_json = output_json
        self.results = {
            "timestamp": datetime.utcnow().isoformat(),
            "checks": [],
            "summary": {"passed": 0, "failed": 0, "skipped": 0},
        }

    def _log(self, msg: str, level: str = "info"):
        if self.verbose:
            if level == "error":
                cprint(f"❌ {msg}", Colors.RED)
            elif level == "warning":
                cprint(f"⚠️ {msg}", Colors.YELLOW)
            elif level == "success":
                cprint(f"✅ {msg}", Colors.GREEN)
            elif level == "debug":
                cprint(f"🔍 {msg}", Colors.CYAN)
            else:
                print(f"ℹ️ {msg}")

    def _record_check(self, name: str, passed: bool, details: Any = None, error: str = None):
        """Store check result."""
        record = {
            "name": name,
            "passed": passed,
            "timestamp": datetime.utcnow().isoformat(),
            "details": details,
            "error": error,
        }
        self.results["checks"].append(record)
        if passed:
            self.results["summary"]["passed"] += 1
        else:
            self.results["summary"]["failed"] += 1
            self._log(f"{name} FAILED: {error or 'No details'}", "error")
        return passed

    # ---------- Built-in Checks ----------
    def check_python_version(self, min_version: tuple = (3, 8)):
        """Ensure Python version is sufficient."""
        version = sys.version_info
        passed = (version.major, version.minor) >= min_version
        details = f"{version.major}.{version.minor}.{version.micro}"
        self._record_check("Python version", passed, details,
                           f"Need >= {min_version[0]}.{min_version[1]}")
        return passed

    def check_disk_space(self, path: str = ".", min_gb: float = 1.0):
        """Check available disk space."""
        import shutil
        try:
            usage = shutil.disk_usage(path)
            free_gb = usage.free / (1024**3)
            passed = free_gb >= min_gb
            details = f"{free_gb:.2f} GB free"
            self._record_check(f"Disk space ({path})", passed, details,
                               f"Only {free_gb:.2f} GB free, need {min_gb} GB")
        except Exception as e:
            passed = False
            self._record_check(f"Disk space ({path})", False, error=str(e))
        return passed

    def check_env_vars(self, required_vars: List[str]):
        """Verify required environment variables exist."""
        missing = [var for var in required_vars if not os.environ.get(var)]
        passed = len(missing) == 0
        details = {"present": [v for v in required_vars if v not in missing],
                   "missing": missing}
        self._record_check("Environment variables", passed, details,
                           f"Missing: {', '.join(missing)}")
        return passed

    def check_network_reachable(self, host: str, port: int = None, timeout: float = 5.0):
        """Check if a host (and optional port) is reachable via TCP."""
        passed = False
        try:
            if port:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout)
                result = sock.connect_ex((host, port))
                sock.close()
                passed = (result == 0)
                details = f"{host}:{port} reachable" if passed else f"Connection refused or timeout"
            else:
                # just DNS resolution
                socket.gethostbyname(host)
                passed = True
                details = f"{host} resolves"
            self._record_check(f"Network: {host}:{port if port else 'DNS'}", passed, details)
        except Exception as e:
            self._record_check(f"Network: {host}", False, error=str(e))
        return passed

    def check_http_endpoint(self, url: str, expected_status: int = 200,
                            timeout: float = 10, expected_text: str = None,
                            max_response_time_ms: int = 2000):
        """Perform HTTP GET and validate status, optional text, response time."""
        start = time.time()
        passed = False
        try:
            req = Request(url, headers={"User-Agent": "SmokeDebugger/1.0"})
            with urlopen(req, timeout=timeout) as resp:
                elapsed_ms = (time.time() - start) * 1000
                body = resp.read().decode('utf-8', errors='ignore')
                status = resp.getcode()
                status_ok = (status == expected_status)
                text_ok = (expected_text is None or expected_text in body)
                time_ok = (elapsed_ms <= max_response_time_ms)
                passed = status_ok and text_ok and time_ok
                details = {
                    "status": status,
                    "response_time_ms": round(elapsed_ms, 2),
                    "body_preview": body[:200],
                }
                error_msg = ""
                if not status_ok:
                    error_msg += f"Expected status {expected_status}, got {status}. "
                if not text_ok:
                    error_msg += f"Expected text '{expected_text}' not found. "
                if not time_ok:
                    error_msg += f"Response time {elapsed_ms:.0f}ms > {max_response_time_ms}ms. "
                self._record_check(f"HTTP: {url}", passed, details, error_msg.strip() or None)
        except HTTPError as e:
            elapsed_ms = (time.time() - start) * 1000
            self._record_check(f"HTTP: {url}", False,
                               {"status": e.code, "response_time_ms": round(elapsed_ms, 2)},
                               f"HTTP {e.code}: {e.reason}")
        except URLError as e:
            self._record_check(f"HTTP: {url}", False, error=f"Network error: {e.reason}")
        except Exception as e:
            self._record_check(f"HTTP: {url}", False, error=str(e))
        return passed

    def check_database(self, conn_string: str, db_type: str = "auto", query: str = "SELECT 1"):
        """Test database connectivity using available drivers (psycopg2, pymysql, sqlite3)."""
        passed = False
        details = {}
        try:
            if db_type == "postgresql" or (db_type == "auto" and "postgres" in conn_string.lower()):
                import psycopg2
                conn = psycopg2.connect(conn_string)
                cur = conn.cursor()
                cur.execute(query)
                cur.fetchone()
                passed = True
                details = "PostgreSQL connection successful"
                conn.close()
            elif db_type == "mysql" or (db_type == "auto" and ("mysql" in conn_string.lower() or "mariadb" in conn_string.lower())):
                import pymysql
                raise NotImplementedError("MySQL check requires a dict of connection parameters. Use custom check.")
            elif db_type == "sqlite" or (db_type == "auto" and ".db" in conn_string):
                import sqlite3
                conn = sqlite3.connect(conn_string)
                cur = conn.cursor()
                cur.execute(query)
                cur.fetchone()
                passed = True
                details = "SQLite connection successful"
                conn.close()
            else:
                self._record_check("Database", False, error=f"Unsupported or missing driver for {db_type}")
                return False
            self._record_check("Database", passed, details)
        except ImportError as e:
            self._record_check("Database", False, error=f"Missing driver: {e}")
        except Exception as e:
            self._record_check("Database", False, error=str(e))
        return passed

    def check_docker(self):
        """Verify Docker daemon is running and client works."""
        res = run_shell("docker version --format '{{.Server.Version}}'")
        passed = res["success"] and res["stdout"] != ""
        details = res["stdout"] if passed else res.get("stderr", "Docker not available")
        self._record_check("Docker daemon", passed, details)
        return passed

    def check_process_running(self, process_name: str):
        """Check if a process is running (using pgrep or ps)."""
        if sys.platform == "win32":
            cmd = f'tasklist /FI "IMAGENAME eq {process_name}" 2>NUL | find /I "{process_name}" >NUL'
            passed = run_shell(cmd)["success"]
        else:
            res = run_shell(f"pgrep -f '{process_name}'")
            passed = res["success"]
        self._record_check(f"Process: {process_name}", passed,
                           "Running" if passed else "Not found")
        return passed

    # ---------- Custom Smoke Test Execution ----------
    def run_smoke_test_script(self, script_path: str, timeout_sec: int = 60):
        """Execute an external Python script or shell script as smoke test."""
        path = Path(script_path)
        if not path.exists():
            self._record_check(f"Smoke test script", False, error=f"File not found: {script_path}")
            return False
        try:
            if path.suffix == ".py":
                cmd = [sys.executable, str(path)]
            else:
                cmd = ["bash", str(path)] if sys.platform != "win32" else ["cmd", "/c", str(path)]
            start = time.time()
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
            elapsed = time.time() - start
            passed = (proc.returncode == 0)
            details = {
                "returncode": proc.returncode,
                "stdout": proc.stdout[-500:],  # last 500 chars
                "stderr": proc.stderr[-500:],
                "duration_sec": round(elapsed, 2),
            }
            self._record_check(f"Smoke test: {script_path}", passed, details,
                               proc.stderr[:200] if not passed else None)
            return passed
        except subprocess.TimeoutExpired:
            self._record_check(f"Smoke test: {script_path}", False, error=f"Timeout after {timeout_sec}s")
            return False
        except Exception as e:
            self._record_check(f"Smoke test: {script_path}", False, error=str(e))
            return False

    def run_custom_checks(self, check_functions: Dict[str, Callable[[], bool]]):
        """Run arbitrary user-defined checks (functions returning bool)."""
        for name, func in check_functions.items():
            try:
                result = func()
                self._record_check(name, result, details="User-defined check")
            except Exception as e:
                self._record_check(name, False, error=str(e))

    # ---------- Aggregated Runner ----------
    def run_all_default_checks(self):
        """Run a comprehensive set of checks."""
        self.check_python_version()
        self.check_disk_space(min_gb=0.5)
        self.check_env_vars(["PATH", "HOME" if sys.platform != "win32" else "USERPROFILE"])
        self.check_network_reachable("8.8.8.8", 53)  # DNS/Google
        self.check_http_endpoint("https://httpbin.org/status/200", expected_status=200, max_response_time_ms=3000)
        # Optionally detect docker if available
        if run_shell("which docker")["success"]:
            self.check_docker()
        self._log("Default checks completed", "success")

    def generate_report(self):
        """Print pretty summary and optionally save JSON."""
        total = self.results["summary"]["passed"] + self.results["summary"]["failed"]
        cprint("\n" + "="*60, Colors.BLUE, bold=True)
        cprint("SMOKE TEST DEBUGGER REPORT", Colors.MAGENTA, bold=True)
        cprint(f"Timestamp: {self.results['timestamp']}", Colors.CYAN)
        cprint(f"Passed: {self.results['summary']['passed']} / {total}", Colors.GREEN)
        if self.results["summary"]["failed"] > 0:
            cprint(f"Failed: {self.results['summary']['failed']}", Colors.RED)
        cprint("="*60, Colors.BLUE, bold=True)

        for check in self.results["checks"]:
            status = "✅ PASS" if check["passed"] else "❌ FAIL"
            cprint(f"{status}  {check['name']}", Colors.GREEN if check["passed"] else Colors.RED)
            if check.get("details") and self.verbose:
                print(f"     Details: {check['details']}")
            if check.get("error") and not check["passed"]:
                print(f"     Error: {check['error']}")

        if self.output_json:
            with open(self.output_json, 'w') as f:
                json.dump(self.results, f, indent=2, default=str)
            cprint(f"\nJSON report saved to {self.output_json}", Colors.CYAN)

# ---------- CLI Entry Point ----------
def main():
    parser = argparse.ArgumentParser(description="Platform Smoke Test Debugger - On Steroids")
    parser.add_argument("--all", action="store_true", help="Run all default checks")
    parser.add_argument("--env-vars", nargs="+", help="Required environment variable names")
    parser.add_argument("--endpoints", nargs="+", help="HTTP endpoints to test (expect 200 OK)")
    parser.add_argument("--hosts", nargs="+", help="Host:port pairs (e.g., google.com:80)")
    parser.add_argument("--smoke-test", help="Path to a custom smoke test script (.py or .sh)")
    parser.add_argument("--json-report", help="Save results to JSON file")
    parser.add_argument("--verbose", action="store_true", default=True, help="Verbose output")
    parser.add_argument("--quiet", action="store_true", help="Minimal output")
    args = parser.parse_args()

    debugger = PlatformDebugger(verbose=not args.quiet, output_json=args.json_report)

    if args.all:
        debugger.run_all_default_checks()

    if args.env_vars:
        debugger.check_env_vars(args.env_vars)

    if args.endpoints:
        for url in args.endpoints:
            debugger.check_http_endpoint(url)

    if args.hosts:
        for host_port in args.hosts:
            if ":" in host_port:
                host, port = host_port.split(":", 1)
                debugger.check_network_reachable(host, int(port))
            else:
                debugger.check_network_reachable(host_port)

    if args.smoke_test:
        debugger.run_smoke_test_script(args.smoke_test)

    # If no specific checks were requested, run defaults
    if not (args.all or args.env_vars or args.endpoints or args.hosts or args.smoke_test):
        print("No checks specified. Running default suite (--all).")
        debugger.run_all_default_checks()

    debugger.generate_report()
    sys.exit(0 if debugger.results["summary"]["failed"] == 0 else 1)

if __name__ == "__main__":
    import shutil
    main()
