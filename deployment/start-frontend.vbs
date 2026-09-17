' start-frontend.vbs
' Launches "npm run dev" (Vite) in the background with no visible window.
' Output is appended to deployment\logs\frontend.log

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim scriptDir : scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim root      : root      = fso.GetParentFolderName(scriptDir)
Dim cwd       : cwd       = root & "\org_lvl_analysis_frontend"
Dim log       : log       = root & "\deployment\logs\frontend.log"

If Not fso.FolderExists(fso.GetParentFolderName(log)) Then
    fso.CreateFolder fso.GetParentFolderName(log)
End If

Dim cmd
cmd = "cmd /c npm run dev" & _
      " >> " & Chr(34) & log & Chr(34) & " 2>&1"

sh.CurrentDirectory = cwd
sh.Run cmd, 0, False   ' 0 = hidden window, False = do not wait
