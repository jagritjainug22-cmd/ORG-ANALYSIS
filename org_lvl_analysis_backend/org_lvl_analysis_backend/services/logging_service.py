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

def log_chat_query(
    user_id: int,
    project_id: int,
    message: str,
    intent: dict,
    tool_result: dict,
    response_text: str,
    elapsed_ms: Optional[int] = None,
):
    """
    Log detailed chatbot query execution steps to a dedicated chatbot log file.
    """
    import json
    from datetime import datetime
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. Log to standard python logging
    import logging
    logger = logging.getLogger("chatbot")
    logger.info(
        "Chatbot Query [User %s, Project %s] at %s: Message='%s' -> Route='%s', Tool='%s'",
        user_id, project_id, timestamp, message, intent.get("route"), intent.get("tool_name")
    )
    if tool_result.get("sql"):
        logger.debug("Executed SQL: %s", tool_result.get("sql"))
        
    # 2. Write a detailed human-readable entry to logs/chatbot_queries.log
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "chatbot_queries.log"
    
    divider = "=" * 80
    sub_divider = "-" * 80
    
    timing_str = f" | ELAPSED: {elapsed_ms}ms" if elapsed_ms is not None else ""

    entry_parts = [
        divider,
        f"TIMESTAMP: {timestamp}{timing_str}",
        f"USER ID: {user_id} | PROJECT ID: {project_id}",
        f"USER MESSAGE: \"{message}\"",
        sub_divider,
        "INTENT CLASSIFICATION:",
        f"  Route:      {intent.get('route')}",
        f"  Tool:       {intent.get('tool_name')}",
        f"  Complexity: {intent.get('complexity')}",
        f"  Intent Cat: {intent.get('intent')}",
    ]
    
    if intent.get("missing_columns_needed"):
        entry_parts.append(f"  Missing Columns Needed: {intent.get('missing_columns_needed')}")
    if intent.get("cannot_answer_reason"):
        entry_parts.append(f"  Cannot Answer Reason:   {intent.get('cannot_answer_reason')}")
        
    entry_parts.append(sub_divider)
    
    # If SQL was executed, log it
    sql = tool_result.get("sql")
    if sql:
        entry_parts.extend([
            "SQL QUERY EXECUTED:",
            sql,
            sub_divider
        ])
        
    # Log database / tool result summary
    source = tool_result.get("source", "unknown")
    entry_parts.extend([
        "TOOL RESULT INFO:",
        f"  Source:       {source}",
    ])
    
    if "row_count" in tool_result or "row_count" in tool_result.get("data", {}):
        row_count = tool_result.get("row_count", 0)
        truncated = tool_result.get("truncated", False)
        entry_parts.extend([
            f"  Row Count:    {row_count}",
            f"  Truncated:    {truncated}",
        ])
        
    # Log sample data
    data = tool_result.get("data")
    if isinstance(data, list) and data:
        sample_size = min(len(data), 3)
        sample_data = data[:sample_size]
        entry_parts.extend([
            f"  Data Sample (up to {sample_size} rows):",
            f"    {json.dumps(sample_data, default=str)}"
        ])
    elif source == "insight_service" and "insights" in tool_result:
        entry_parts.extend([
            "  Insights Output:",
            f"    {json.dumps(tool_result['insights'], default=str)}"
        ])
    elif "sql_error" in tool_result:
        entry_parts.extend([
            "  SQL Error:",
            f"    {tool_result['sql_error']}"
        ])
        
    entry_parts.extend([
        sub_divider,
        "FINAL NARRATIVE RESPONSE:",
        response_text,
        divider,
        "\n"
    ])
    
    log_entry = "\n".join(entry_parts)
    
    try:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(log_entry)
    except Exception as e:
        logger.error("Failed to write to chatbot_queries.log: %s", e)