const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

let mainWindow;
let bridgeProcess = null;
let keyboardListener = null;
let isScanning = false;

// Set app name for process identification
app.name = 'ATC Network Bridge';

// Get the correct path for .env file
function getEnvPath() {
    if (app.isPackaged) {
        const userDataPath = path.join(app.getPath('userData'), '.env');
        if (fs.existsSync(userDataPath)) {
            return userDataPath;
        }
        const defaultEnvPath = path.join(process.resourcesPath, '.env.default');
        if (fs.existsSync(defaultEnvPath)) {
            fs.copyFileSync(defaultEnvPath, userDataPath);
        }
        return userDataPath;
    }
    return path.join(__dirname, '..', '.env');
}

// Initialize keyboard listener
async function initKeyboardListener() {
    try {
        const { GlobalKeyboardListener } = require('node-global-key-listener');
        keyboardListener = new GlobalKeyboardListener();
        console.log('Keyboard listener initialized');
        
        // Setup PTT key monitoring
        keyboardListener.addListener(function (e, down) {
            if (!mainWindow) return;
            
            const keyName = e.name.toLowerCase();
            const currentPttKey = process.env.PTT_KEY || 'ralt';
            
            if (keyName === currentPttKey) {
                mainWindow.webContents.send('ptt-state-change', {
                    pressed: down,
                    key: keyName
                });
            }
            
            // Handle key scanning
            if (isScanning && down) {
                mainWindow.webContents.send('ptt-key-selected', {
                    key: keyName
                });
                isScanning = false;
            }
        });
        
        return true;
    } catch (error) {
        console.error('Failed to initialize keyboard listener:', error);
        return false;
    }
}

// Create the main window
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'ATC Network Bridge',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const guiPath = app.isPackaged
        ? path.join(process.resourcesPath, 'src', 'gui', 'index.html')
        : path.join(__dirname, 'gui', 'index.html');

    mainWindow.loadFile(guiPath);
    mainWindow.setMenuBarVisibility(false);
    
    // Initialize keyboard listener after window creation
    const keyboardInitialized = await initKeyboardListener();
    if (!keyboardInitialized && mainWindow) {
        mainWindow.webContents.send('keyboard-error', 'Failed to initialize keyboard listener');
    }
    
    // Start bridge process
    startBridgeProcess();
}

// Start the bridge process
function startBridgeProcess() {
    if (bridgeProcess) {
        try {
            bridgeProcess.kill();
            bridgeProcess = null;
        } catch (error) {
            console.error('Error killing bridge process:', error);
        }
    }

    try {
        const scriptPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'src', 'index.js')
            : path.join(__dirname, 'index.js');

        // Ensure the script exists
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Bridge script not found at: ${scriptPath}`);
        }

        // Load environment variables
        const envPath = getEnvPath();
        const env = {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            NODE_ENV: app.isPackaged ? 'production' : 'development'
        };

        if (fs.existsSync(envPath)) {
            Object.assign(env, dotenv.parse(fs.readFileSync(envPath)));
        } else {
            // Create default environment if not exists
            const defaultEnv = {
                CURRENT_AIRCRAFT_CALLSIGN: 'N9632J',
                PTT_KEY: 'ralt',
                BEYONDATC_PORT: '41716'
            };
            const envContent = Object.entries(defaultEnv)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n');
            fs.writeFileSync(envPath, envContent);
            Object.assign(env, defaultEnv);
        }

        bridgeProcess = spawn(process.execPath, [scriptPath], {
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        bridgeProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log('[Bridge]', line);
                    if (mainWindow) {
                        mainWindow.webContents.send('bridge-output', line);
                    }
                }
            }
        });

        bridgeProcess.stderr.on('data', (data) => {
            console.error('[Bridge Error]', data.toString());
            if (mainWindow) {
                mainWindow.webContents.send('bridge-error', data.toString());
            }
        });

        bridgeProcess.on('error', (error) => {
            console.error('[Bridge] Process error:', error);
            if (mainWindow) {
                mainWindow.webContents.send('bridge-error', error.message);
            }
        });

        bridgeProcess.on('close', (code) => {
            console.log('[Bridge] Process exited with code', code);
            bridgeProcess = null;
            if (mainWindow) {
                mainWindow.webContents.send('bridge-status', { 
                    status: 'closed',
                    code: code
                });
            }
        });

        // Send initial status
        if (mainWindow) {
            mainWindow.webContents.send('bridge-status', {
                status: 'started',
                pid: bridgeProcess.pid
            });
        }
    } catch (error) {
        console.error('Failed to start bridge process:', error);
        if (mainWindow) {
            mainWindow.webContents.send('bridge-error', error.message);
        }
    }
}

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC handlers
ipcMain.on('start-ptt-scan', () => {
    isScanning = true;
    if (mainWindow) {
        mainWindow.webContents.send('scan-status', { scanning: true });
    }
});

ipcMain.on('stop-ptt-scan', () => {
    isScanning = false;
    if (mainWindow) {
        mainWindow.webContents.send('scan-status', { scanning: false });
    }
});

// Handle environment variable updates
ipcMain.on('update-env', (event, data) => {
    try {
        const envPath = getEnvPath();
        const currentEnv = fs.existsSync(envPath) 
            ? dotenv.parse(fs.readFileSync(envPath))
            : {};
        const newEnv = { ...currentEnv, ...data };
        
        const envString = Object.entries(newEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        fs.writeFileSync(envPath, envString);
        process.env = { ...process.env, ...data };
        event.reply('env-updated', { success: true });

        // Restart bridge process to apply new environment
        startBridgeProcess();
    } catch (error) {
        console.error('Failed to update env:', error);
        event.reply('env-updated', { success: false, error: error.message });
    }
});

// Get current environment variables
ipcMain.on('get-env', (event) => {
    try {
        const envPath = getEnvPath();
        const env = fs.existsSync(envPath) 
            ? dotenv.parse(fs.readFileSync(envPath))
            : {};
        event.reply('env-loaded', { success: true, env });
    } catch (error) {
        console.error('Failed to load env:', error);
        event.reply('env-loaded', { success: false, error: error.message });
    }
});

// Handle reconnect request
ipcMain.on('reconnect', () => {
    try {
        console.log('Restarting bridge process...');
        startBridgeProcess();
    } catch (error) {
        console.error('Failed to restart bridge:', error);
        if (mainWindow) {
            mainWindow.webContents.send('bridge-error', error.message);
        }
    }
});

// Clean up on exit
app.on('before-quit', () => {
    if (bridgeProcess) {
        bridgeProcess.kill();
    }
    if (keyboardListener) {
        keyboardListener.kill();
    }
});
