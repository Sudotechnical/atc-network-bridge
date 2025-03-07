#SingleInstance Force
#NoEnv
SetWorkingDir %A_ScriptDir%

; Initialize with VATSIM mode
FileDelete, active_mode.txt
FileAppend, vatsim, active_mode.txt

; Left Alt key
~LAlt::
    FileRead, mode, active_mode.txt
    if (mode = "beyondatc") {
        ; Block the key when BeyondATC is active
        return
    }
return
