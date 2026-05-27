# services/logging_service.py
import os
import csv
from datetime import datetime
from typing import Optional
from pathlib import Path

# ============================
#     ACTIVITY LOGGING SYSTEM
# ============================

LOGS_DIR = "logs"
os.makedirs(LOGS_DIR, exist_ok=True)
LOGFILE = os.path.join(LOGS_DIR, "activity_log.csv")

# Create CSV header if not exists
if not os.path.exists(LOGFILE):
    with open(LOGFILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp",
            "username", 
            "action",
            "module",
            "rows_input",
            "rows_output",
            "status",
            "details"
        ])

def write_activity_log(
    username: str,
    action: str,
    module: str = "",
    rows_input: Optional[int] = None,
    rows_output: Optional[int] = None,
    status: str = "success",
    details: str = ""
):
    """
    Append one line to activity_log.csv
    
    Args:
        username: Username performing the action
        action: Type of action (login, logout, process, download, etc.)
        module: Module name (Upload, Cleanup, Validate, etc.)
        rows_input: Number of input rows
        rows_output: Number of output rows
        status: Status of operation (success, error)
        details: Additional details or error message
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Sanitize fields for CSV
    username_safe = str(username).replace(",", " ").replace("\n", " ")
    action_safe = str(action).replace(",", " ").replace("\n", " ")
    module_safe = str(module).replace(",", " ").replace("\n", " ")
    status_safe = str(status).replace(",", " ").replace("\n", " ")
    details_safe = str(details).replace(",", " ").replace("\n", " ")
    
    # Convert None to empty string
    rows_in = "" if rows_input is None else str(rows_input)
    rows_out = "" if rows_output is None else str(rows_output)
    
    with open(LOGFILE, "a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            timestamp,
            username_safe,
            action_safe,
            module_safe,
            rows_in,
            rows_out,
            status_safe,
            details_safe
        ])

def get_activity_logs(limit: Optional[int] = None):
    """
    Read activity logs from CSV
    
    Args:
        limit: Maximum number of recent logs to return (None = all)
    
    Returns:
        List of dictionaries containing log entries
    """
    if not os.path.exists(LOGFILE):
        return []
    
    logs = []
    with open(LOGFILE, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            logs.append(row)
    
    # Return most recent logs first
    logs.reverse()
    
    if limit:
        return logs[:limit]
    return logs

def get_user_stats(username: str):
    """
    Get statistics for a specific user
    
    Args:
        username: Username to get stats for
    
    Returns:
        Dictionary with user statistics
    """
    logs = get_activity_logs()
    user_logs = [log for log in logs if log["username"] == username]
    
    total_actions = len(user_logs)
    successful_actions = len([log for log in user_logs if log["status"] == "success"])
    failed_actions = len([log for log in user_logs if log["status"] == "error"])
    
    modules_used = {}
    for log in user_logs:
        if log["module"]:
            modules_used[log["module"]] = modules_used.get(log["module"], 0) + 1
    
    return {
        "username": username,
        "total_actions": total_actions,
        "successful_actions": successful_actions,
        "failed_actions": failed_actions,
        "modules_used": modules_used,
        "last_login": next(
            (log["timestamp"] for log in user_logs if log["action"] == "login"),
            None
        )
    }