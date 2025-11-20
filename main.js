const { app, BrowserWindow } = require('electron');
const path = require('path');
const server = require('./server');

console.log('[main] bootstrap');

let mainWindow;
let serverPort = null;
const PREFERRED_PORT = process.env.PORT ? Number(process.env.PORT) : 0;

function createWindow(port) {
  if (!port) {
    throw new Error('Cannot create window before server port is ready');
  }
  console.log(`[main] creating window for http://localhost:${port}`);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[main] failed to load URL', validatedURL, errorCode, errorDescription);
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady()
  .then(() => {
    console.log('[main] app ready, starting server');
    return server.start(PREFERRED_PORT);
  })
  .then((port) => {
    serverPort = port;
    console.log(`[main] server reported port ${serverPort}`);
    createWindow(serverPort);
  })
  .catch((error) => {
    console.error('[main] failed to initialize application', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null && serverPort) {
    createWindow(serverPort);
  }
});

app.on('before-quit', () => {
  server.stop();
});
