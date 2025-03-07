#SingleInstance Force
#NoEnv

; Read mode from the shared file
ReadMode() {
    FileRead, mode, %A_ScriptDir%\active_mode.txt
    return mode
}

; Left Alt key
~LAlt::
    mode := ReadMode()
    if (mode = "beyondatc") {
        return  ; Block the key when BeyondATC is active
    }
return
