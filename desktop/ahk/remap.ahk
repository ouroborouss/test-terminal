; Remap mouse side buttons to F13/F14 for Trading Terminal shortcuts
; Run this script with AutoHotkey v2 (https://www.autohotkey.com)

; Mouse Button 4 (Back) → F13 → Buy
XButton1:: {
    Send "{F13}"
}

; Mouse Button 5 (Forward) → F14 → Sell
XButton2:: {
    Send "{F14}"
}
