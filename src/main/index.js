'use strict'

import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const execAsync = promisify(exec)

let win
let tray
let winStatus = 'visible'

// Detected GPUs: [{ index: 0, name: 'RTX 3080' }, ...]
let detectedGPUs = []

// Fan layout per GPU: [{ gpuIndex: 0, fanStartIndex: 0, fanCount: 1 }, ...]
let gpuFanInfo = []

// Track last-set fan speed per GPU to fill in when nvidia-smi returns N/A
const currentFanSpeeds = {}

// ─── JSON config store ───────────────────────────────────────────────────────

const DEFAULT_GPU_CONFIG = {
  check_temp_interval: 5000,
  min_temp: 26,
  max_temp: 78,
  danger_temp: 78,
  step_temp: 5,
  x_axis_data: '[26,30,35,40,45,50,55,60,65,70,75,78]',
  y_axis_data: '[60,60,60,66,72,75,77,78,78,78,78,78]'
}

function getConfigPath() {
  return app.isPackaged
    ? join(app.getPath('userData'), 'gpu-config.json')
    : join(process.cwd(), 'gpu-config.json')
}

function loadConfig() {
  const path = getConfigPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

// Migrate legacy data.db SQLite config (best-effort, no hard dep)
function migrateLegacyDB(config) {
  const dbPath = join(process.cwd(), 'data.db')
  if (!existsSync(dbPath) || config['0']) return config
  try {
    // Dynamic require so it doesn't crash if sqlite3 is absent
    const sqlite3 = require('sqlite3').verbose()
    const db = new sqlite3.Database(dbPath)
    db.all('SELECT * FROM GRAPHCONFIG', (err, rows) => {
      if (!err && rows && rows.length > 0) {
        const old = rows[0]
        config['0'] = {
          gpu_name: 'GPU 0',
          check_temp_interval: old.checkTempInterval,
          min_temp: old.minTemp,
          max_temp: old.maxTemp,
          danger_temp: old.dangerTemp,
          step_temp: old.stepTemp,
          x_axis_data: old.xAxisData,
          y_axis_data: old.yAxisData
        }
        saveConfig(config)
        console.log('Migrated legacy SQLite config to gpu-config.json')
      }
      db.close()
    })
  } catch {
    // sqlite3 not available — skip migration
  }
  return config
}

function getGPUConfig(gpuIndex) {
  const key = String(gpuIndex)
  const config = loadConfig()
  if (!config[key]) return null
  return { gpu_index: gpuIndex, ...DEFAULT_GPU_CONFIG, ...config[key] }
}

function upsertGPUConfig(gpuIndex, gpuName) {
  const key = String(gpuIndex)
  const config = loadConfig()
  if (!config[key]) {
    config[key] = { gpu_name: gpuName, ...DEFAULT_GPU_CONFIG }
  } else {
    config[key].gpu_name = gpuName
  }
  saveConfig(config)
}

function saveGPUCurve(gpuIndex, xAxisData, yAxisData) {
  const key = String(gpuIndex)
  const config = loadConfig()
  if (config[key]) {
    config[key].x_axis_data = xAxisData
    config[key].y_axis_data = yAxisData
    saveConfig(config)
  }
}

// ─── Profile helpers ─────────────────────────────────────────────────────────

function getProfiles(gpuIndex) {
  const config = loadConfig()
  return config[String(gpuIndex)]?.profiles || {}
}

function saveProfile(gpuIndex, name, xAxisData, yAxisData) {
  const key = String(gpuIndex)
  const config = loadConfig()
  if (!config[key]) return false
  if (!config[key].profiles) config[key].profiles = {}
  config[key].profiles[name] = { x_axis_data: xAxisData, y_axis_data: yAxisData }
  saveConfig(config)
  return true
}

function deleteProfile(gpuIndex, name) {
  const key = String(gpuIndex)
  const config = loadConfig()
  if (!config[key]?.profiles?.[name]) return false
  delete config[key].profiles[name]
  saveConfig(config)
  return true
}

function renameProfile(gpuIndex, oldName, newName) {
  const key = String(gpuIndex)
  const config = loadConfig()
  const profiles = config[key]?.profiles
  if (!profiles?.[oldName] || profiles[newName]) return false
  profiles[newName] = profiles[oldName]
  delete profiles[oldName]
  saveConfig(config)
  return true
}

// ─── GPU / Hardware helpers ──────────────────────────────────────────────────

const displayEnv = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ':0',
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || '',
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
}

// nvidia-settings write operations (GPUFanControlState, GPUTargetFanSpeed) require
// root on modern NVIDIA drivers. sudo -E forwards DISPLAY/WAYLAND_DISPLAY/XDG_RUNTIME_DIR
// which are declared in env_keep in /etc/sudoers.d/nvidia-fan-control.
function nvSet(assignment) {
  return `sudo -E nvidia-settings -a '${assignment}'`
}

async function detectGPUs() {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=name,index --format=csv,noheader'
    )
    return stdout.trim().split('\n').filter(Boolean).map((line, i) => {
      const parts = line.split(', ')
      return { index: i, name: parts[0].trim() }
    })
  } catch (e) {
    console.error('GPU detection failed:', e.message)
    return [{ index: 0, name: 'GPU 0' }]
  }
}

// Probe-based fan count: try fan:0, fan:1, ... until nvidia-settings errors out.
// GPUFanCount attribute is not supported on all driver versions, so we use this
// approach for reliable detection across driver versions.
async function getTotalFanCount() {
  let count = 0
  while (count < 32) { // safety cap
    try {
      await execAsync(
        `nvidia-settings -q '[fan:${count}]/GPUTargetFanSpeed' -t`,
        { env: displayEnv }
      )
      count++
    } catch {
      break
    }
  }
  return count || 1
}

async function buildGPUFanInfo(gpus) {
  const totalFans = await getTotalFanCount()
  const fansPerGPU = Math.max(1, Math.floor(totalFans / gpus.length))

  let startIndex = 0
  const info = []
  for (const gpu of gpus) {
    info.push({ gpuIndex: gpu.index, fanStartIndex: startIndex, fanCount: fansPerGPU })
    startIndex += fansPerGPU
  }
  return info
}

async function getGPUStats(gpuIndex) {
  try {
    const { stdout } = await execAsync(
      `nvidia-smi --query-gpu=temperature.gpu,clocks.current.graphics,fan.speed --format=csv,noheader --id=${gpuIndex}`
    )
    const [tempStr, clockStr, fanStr] = stdout.trim().split(', ')
    const fanSpeed = fanStr && !fanStr.includes('N/A')
      ? parseInt(fanStr)
      : (currentFanSpeeds[gpuIndex] ?? 0)
    return {
      temp: parseInt(tempStr) || 0,
      clock: parseInt(clockStr) || 0,
      fanSpeed
    }
  } catch (e) {
    console.error(`Stats error GPU ${gpuIndex}:`, e.message)
    return { temp: 0, clock: 0, fanSpeed: currentFanSpeeds[gpuIndex] ?? 0 }
  }
}

async function setGPUFanSpeed(gpuIndex, speed) {
  const fanInfo = gpuFanInfo.find(f => f.gpuIndex === gpuIndex)
  if (!fanInfo) return

  try {
    await execAsync(nvSet(`[gpu:${gpuIndex}]/GPUFanControlState=1`), { env: displayEnv })
    for (let f = fanInfo.fanStartIndex; f < fanInfo.fanStartIndex + fanInfo.fanCount; f++) {
      await execAsync(nvSet(`[fan:${f}]/GPUTargetFanSpeed=${parseInt(speed)}`), { env: displayEnv })
    }
    currentFanSpeeds[gpuIndex] = speed
  } catch (e) {
    console.error(`Fan speed error GPU ${gpuIndex}:`, e.message)
  }
}

async function applyFanCurve(gpuIndex) {
  const cfg = getGPUConfig(gpuIndex)
  if (!cfg) return

  const stats = await getGPUStats(gpuIndex)
  const temperatures = JSON.parse(cfg.x_axis_data)
  const fanSpeeds = JSON.parse(cfg.y_axis_data)

  let targetSpeed = -1
  temperatures.forEach((temp, i) => {
    if (stats.temp >= temp) targetSpeed = fanSpeeds[i]
  })

  if (targetSpeed !== -1) {
    await setGPUFanSpeed(gpuIndex, targetSpeed)
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('getGPUs', () => detectedGPUs)

ipcMain.handle('getConfiguration', (_event, gpuIndex) => getGPUConfig(gpuIndex))

ipcMain.handle('checkStatistics', async (_event, gpuIndex) => {
  await applyFanCurve(gpuIndex)
  const stats = await getGPUStats(gpuIndex)
  return { ...stats, fanSpeed: currentFanSpeeds[gpuIndex] ?? stats.fanSpeed }
})

ipcMain.handle('applyTempGraph', async (_event, { gpuIndex, temperature, fanSpeed }) => {
  saveGPUCurve(gpuIndex, temperature, fanSpeed)
  await applyFanCurve(gpuIndex)
  return true
})

ipcMain.handle('getProfiles', (_event, gpuIndex) => getProfiles(gpuIndex))
ipcMain.handle('saveProfile', (_event, { gpuIndex, name, temperature, fanSpeed }) =>
  saveProfile(gpuIndex, name, temperature, fanSpeed))
ipcMain.handle('deleteProfile', (_event, { gpuIndex, name }) =>
  deleteProfile(gpuIndex, name))
ipcMain.handle('renameProfile', (_event, { gpuIndex, oldName, newName }) =>
  renameProfile(gpuIndex, oldName, newName))

// ─── Window / Tray ───────────────────────────────────────────────────────────

function getIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'logo.png')
    : join(process.cwd(), 'resources/logo.png')
}

function toggleWindow() {
  if (winStatus === 'visible') {
    winStatus = 'hidden'
    win.hide()
  } else {
    winStatus = 'visible'
    win.show()
  }
}

async function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: getIconPath()
  })

  try {
    tray = new Tray(getIconPath())
    tray.setToolTip('GPU Fan Control')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]))
  } catch (e) {
    console.error('Tray init failed:', e.message)
  }

  win.on('minimize', event => {
    event.preventDefault()
    toggleWindow()
  })

  win.setMenu(null)

  if (!app.isPackaged) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    if (process.env.OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(async () => {
  const config = loadConfig()
  migrateLegacyDB(config)

  detectedGPUs = await detectGPUs()
  gpuFanInfo = await buildGPUFanInfo(detectedGPUs)

  for (const gpu of detectedGPUs) {
    upsertGPUConfig(gpu.index, gpu.name)
  }

  createWindow()
})

if (!app.isPackaged) {
  if (process.platform === 'win32') {
    process.on('message', data => { if (data === 'graceful-exit') app.quit() })
  } else {
    process.on('SIGTERM', () => app.quit())
  }
}
