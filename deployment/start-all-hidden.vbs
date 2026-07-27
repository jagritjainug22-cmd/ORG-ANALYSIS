' start-all-hidden.vbs
' Entry point used by Windows Task Scheduler at system boot.
' Calls both service launchers with no windows or prompts of any kind.

Set sh = CreateObject("WScript.Shell")

Dim dir : dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

sh.Run "wscript //B """ & dir & "start-backend.vbs""",  0, False
sh.Run "wscript //B """ & dir & "start-frontend.vbs""", 0, False
