' start-backend.vbs
' Launches uvicorn in the background with no visible window.
' Output is appended to deployment\logs\backend.log

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim scriptDir : scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim root      : root      = fso.GetParentFolderName(scriptDir)
Dim py        : py        = root & "\.venv\Scripts\python.exe"
Dim cwd       : cwd       = root & "\org_lvl_analysis_backend"
Dim log       : log       = root & "\deployment\logs\backend.log"

If Not fso.FolderExists(fso.GetParentFolderName(log)) Then
    fso.CreateFolder fso.GetParentFolderName(log)
End If

Dim cmd
cmd = "cmd /c " & py & _
      " -m uvicorn main:app --host 0.0.0.0 --port 8601" & _
      " >> " & Chr(34) & log & Chr(34) & " 2>&1"

sh.CurrentDirectory = cwd
sh.Run cmd, 0, False   ' 0 = hidden window, False = do not wait
