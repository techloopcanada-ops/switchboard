import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { startSwitchboard, type App } from '@switchboard/core';
import { isExternalWebUrl, isSameOrigin } from './navigation.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(directory, '..', 'assets', 'icon.png');
let daemon: App | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let changingChannels = false;
const notifications = new Set<Notification>();

function showWindow(route?: string): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (route && daemon) void window.loadURL(`${daemon.url}/#/${route}`).catch(reportError);
  window.show();
  window.focus();
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  dialog.showErrorBox('Switchboard', message);
}

async function openExternal(url: string): Promise<void> {
  if (isExternalWebUrl(url)) await shell.openExternal(url).catch(reportError);
}

function updateTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const paused = daemon?.channelsPaused() ?? false;
  tray.setToolTip(`Switchboard — ${paused ? 'channels paused' : 'running in the background'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Switchboard', click: () => showWindow() },
    { type: 'separator' },
    { label: paused ? 'Resume channels' : 'Pause channels', enabled: !changingChannels, click: () => { void toggleChannels(); } },
    { type: 'separator' },
    { label: 'Quit Switchboard', click: () => app.quit() },
  ]));
}

async function toggleChannels(): Promise<void> {
  if (!daemon || changingChannels) return;
  changingChannels = true;
  updateTrayMenu();
  try {
    if (daemon.channelsPaused()) await daemon.resumeChannels();
    else await daemon.pauseChannels();
  } catch (error) { reportError(error); }
  finally { changingChannels = false; updateTrayMenu(); }
}

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.setAppUserModelId('ca.techloop.switchboard');
app.on('second-instance', () => showWindow());
app.on('activate', () => showWindow());
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', event => {
  if (!daemon) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  for (const notification of notifications) notification.close();
  window?.destroy();
  const stopping = daemon.stop();
  // In-flight HTTP requests must not keep the app alive after Quit.
  daemon.server.server.closeAllConnections();
  void stopping.catch(error => console.error('Shutdown failed:', error)).finally(() => {
    daemon = undefined;
    tray?.destroy();
    app.quit();
  });
});

export const ready = primary ? app.whenReady().then(async () => {
  daemon = await startSwitchboard({
    webDir: app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(directory, '..', '..', 'web', 'dist'),
    log: line => console.log(line),
  });
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 360, minHeight: 500,
    title: 'Switchboard', icon: iconPath, autoHideMenuBar: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  const appUrl = daemon.url;
  window.webContents.session.setPermissionCheckHandler((_contents, permission, origin) =>
    permission === 'clipboard-sanitized-write' && isSameOrigin(origin, appUrl));
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(permission === 'clipboard-sanitized-write' && isSameOrigin(details.requestingUrl, appUrl)));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, appUrl)) void window?.loadURL(url).catch(reportError);
    else void openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, appUrl)) { event.preventDefault(); void openExternal(url); }
  });
  window.webContents.session.on('will-download', event => event.preventDefault());
  window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window?.hide(); } });
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
  updateTrayMenu();
  tray.on('click', () => showWindow());
  daemon.sb.on('approval', request => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: `${request.botName} needs approval`, body: request.summary, icon: iconPath });
    notifications.add(notification);
    notification.on('click', () => showWindow('approvals'));
    notification.on('close', () => notifications.delete(notification));
    notification.on('failed', (_event, error) => { notifications.delete(notification); console.error('Notification failed:', error); });
    notification.show();
  });
  await window.loadURL(appUrl);
  window.show();
  return daemon;
}) : Promise.resolve(undefined);

void ready.catch(error => { reportError(error); app.quit(); });
