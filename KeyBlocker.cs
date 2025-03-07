using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.IO;

class KeyBlocker {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int VK_LMENU = 0xA4;  // Left Alt

    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;

    public static void Main() {
        _hookID = SetHook(_proc);
        Console.WriteLine("Key blocker started. Press Ctrl+C to exit.");
        Application.Run();
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr SetHook(LowLevelKeyboardProc proc) {
        using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
        using (var curModule = curProcess.MainModule) {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && wParam == (IntPtr)WM_KEYDOWN) {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == VK_LMENU) {
                try {
                    string mode = File.ReadAllText("active_mode.txt").Trim().ToLower();
                    if (mode == "beyondatc") {
                        Console.WriteLine("[BLOCKED] PTT Key blocked for VATSIM (BeyondATC is active)");
                        return (IntPtr)1;
                    }
                    Console.WriteLine("[ALLOWED] PTT Key allowed for VATSIM (VATSIM is active)");
                } catch (Exception) {
                    // If file doesn't exist or can't be read, default to allowing the key
                    Console.WriteLine("[ALLOWED] PTT Key allowed (default)");
                }
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}
