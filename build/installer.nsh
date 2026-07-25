!macro customInstall
  ; Append the app's bin dir to the per-user PATH (idempotent).
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\resources\bin"
  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$1"
  ${Else}
    ; Only append if not already present.
    ${WordFind} "$0" "$1" "E+1{" $2
    ${If} $2 == "$0"
      WriteRegExpandStr HKCU "Environment" "Path" "$0;$1"
    ${EndIf}
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  ; Remove the app's bin dir from the per-user PATH.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\resources\bin"
  ${WordReplace} "$0" ";$1" "" "+" $2
  ${WordReplace} "$2" "$1" "" "+" $3
  WriteRegExpandStr HKCU "Environment" "Path" "$3"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
