import os
import smtplib
import logging
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

log = logging.getLogger(__name__)


def _send_email_thread(to_email: str, subject: str, html_content: str):
    host = os.environ.get("SMTP_HOST")
    port = os.environ.get("SMTP_PORT")
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    from_addr = os.environ.get("SMTP_FROM", "no-reply@orgsight.com")

    if not host or not port or not username or not password:
        log.warning("SMTP configuration missing in environment variables. Email notification skipped.")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email

        part = MIMEText(html_content, "html")
        msg.attach(part)

        # Connect and send
        with smtplib.SMTP(host, int(port)) as server:
            server.starttls()
            server.login(username, password)
            server.sendmail(from_addr, to_email, msg.as_string())
        log.info("Project assignment notification email sent successfully to %s", to_email)
    except Exception as e:
        log.error("Failed to send project assignment notification email to %s: %s", to_email, e)


def notify_user_assigned_to_project(username: str, project_name: str, role: str):
    """Notify a user that they have been assigned to a project by sending an email in a background thread."""
    if "@" in username:
        to_email = username
    else:
        to_email = f"{username}@alvarezandmarsal.com"

    subject = f"OrgSight: Assigned to Project - {project_name}"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                background-color: #f4f6f8;
                margin: 0;
                padding: 0;
            }}
            .container {{
                max-width: 600px;
                margin: 40px auto;
                background-color: #ffffff;
                border-radius: 8px;
                border: 1px solid #e1e8ed;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
            }}
            .header {{
                background-color: #01244a;
                padding: 30px;
                text-align: center;
            }}
            .header h1 {{
                color: #ffffff;
                margin: 0;
                font-size: 24px;
                font-weight: 700;
                letter-spacing: 0.5px;
            }}
            .content {{
                padding: 40px 30px;
                color: #333333;
                line-height: 1.6;
            }}
            .content p {{
                margin: 0 0 20px 0;
                font-size: 15px;
            }}
            .details-table {{
                width: 100%;
                border-collapse: collapse;
                margin: 25px 0;
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
            }}
            .details-table td {{
                padding: 12px 16px;
                font-size: 14px;
            }}
            .details-table tr:not(:last-child) {{
                border-bottom: 1px solid #e2e8f0;
            }}
            .label {{
                font-weight: bold;
                color: #01244a;
                width: 30%;
            }}
            .value {{
                color: #4a5568;
            }}
            .footer {{
                background-color: #f8fafc;
                padding: 20px;
                text-align: center;
                border-top: 1px solid #e1e8ed;
                font-size: 12px;
                color: #718096;
            }}
            .button {{
                display: inline-block;
                background-color: #c5a84a;
                color: #01244a !important;
                text-decoration: none;
                padding: 12px 24px;
                font-weight: bold;
                border-radius: 5px;
                margin-top: 15px;
                font-size: 14px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>OrgSight Workspace</h1>
            </div>
            <div class="content">
                <p>Hello,</p>
                <p>An administrator has assigned you to a new project in OrgSight. You can now access and manage this workspace.</p>
                
                <table class="details-table">
                    <tr>
                        <td class="label">Project</td>
                        <td class="value"><strong>{project_name}</strong></td>
                    </tr>
                    <tr>
                        <td class="label">Assigned Role</td>
                        <td class="value"><span style="text-transform: capitalize;">{role}</span></td>
                    </tr>
                </table>
                
                <p>Please log in to your dashboard to view the details and start collaborating.</p>
                <div style="text-align: center;">
                    <a href="http://localhost:3000" class="button">Go to Dashboard</a>
                </div>
            </div>
            <div class="footer">
                This is an automated notification from OrgSight. Please do not reply to this email.
            </div>
        </div>
    </body>
    </html>
    """

    t = threading.Thread(target=_send_email_thread, args=(to_email, subject, html_content), daemon=True)
    t.start()
