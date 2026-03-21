<template>
  <div class="container">

    <!-- Top bar: GPU tabs + Profiles dropdown -->
    <div class="topbar">
      <div class="gpu-selector" v-if="gpus.length > 1">
        <button
          v-for="gpu in gpus"
          :key="gpu.index"
          :class="['gpu-tab', { active: selectedGPUIndex === gpu.index }]"
          @click="selectGPU(gpu.index)"
        >
          {{ gpu.name }}
        </button>
      </div>

      <!-- Profiles dropdown -->
      <div class="profiles-wrap" ref="profilesWrap">
        <button class="btn-profiles" @click="toggleDropdown">
          {{ activeProfileName[selectedGPUIndex] || 'Default' }}
          <span v-if="profileChanged" class="changed-dot" title="Unsaved changes"></span>
          <span class="caret">▾</span>
        </button>
        <div class="dropdown" v-if="dropdownOpen">

          <div v-if="profileNames.length === 0" class="dd-empty">No profiles yet</div>

          <!-- Existing profiles -->
          <div
            v-for="name in profileNames"
            :key="name"
            class="dd-item"
          >
            <!-- Delete confirmation -->
            <template v-if="confirmDelete === name">
              <span class="dd-confirm-text">Remove "{{ name }}"?</span>
              <button class="dd-btn dd-btn-yes" @click="confirmDeleteProfile(name)">Yes</button>
              <button class="dd-btn dd-btn-no"  @click="confirmDelete = null">No</button>
            </template>

            <!-- Rename mode -->
            <template v-else-if="editingName === name">
              <input
                class="dd-input"
                v-model="editingValue"
                @keyup.enter="confirmRename"
                @keyup.escape="cancelEdit"
                ref="renameInput"
              />
              <button class="dd-btn dd-btn-ok"  @click="confirmRename">✓</button>
              <button class="dd-btn dd-btn-no"  @click="cancelEdit">✕</button>
            </template>

            <!-- Normal -->
            <template v-else>
              <span class="dd-name" @click="loadProfile(name)">{{ name }}</span>
              <button
                v-if="activeProfileName[selectedGPUIndex] === name"
                class="dd-btn dd-btn-save"
                :disabled="!profileChanged"
                @click.stop="saveActiveProfile"
              >Save</button>
              <button class="dd-btn dd-btn-edit"   @click.stop="startRename(name)">Edit</button>
              <button class="dd-btn dd-btn-remove" @click.stop="confirmDelete = name">Remove</button>
            </template>
          </div>

          <div class="dd-divider" v-if="profileNames.length > 0"></div>

          <!-- New profile -->
          <div class="dd-item dd-new">
            <template v-if="savingProfile">
              <input
                class="dd-input"
                v-model="newProfileName"
                placeholder="Profile name…"
                @keyup.enter="confirmSave"
                @keyup.escape="savingProfile = false"
                ref="saveInput"
              />
              <button class="dd-btn dd-btn-ok" @click="confirmSave">✓</button>
              <button class="dd-btn dd-btn-no" @click="savingProfile = false">✕</button>
            </template>
            <button v-else class="dd-btn-new" @click="startSave">+ New profile</button>
          </div>

        </div>
      </div>
    </div>

    <!-- GPU Info bar -->
    <div class="info">
      <p><img src="../gpu.png" width="36" alt="GPU" /></p>
      <p class="gpu-name">{{ currentGPU?.name || 'GPU Statistics' }}</p>
      <p class="danger-warn" v-if="dangerStatus[selectedGPUIndex]">⚠ HIGH TEMPERATURE</p>
      <p class="stats-row">
        <span>
          <img src="../thermometer.png" class="icon-sm" alt="Temp" />
          {{ currentStats.temp }}°C
        </span>
        <span>
          <img src="../fan.png" class="icon-md" alt="Fan" />
          {{ currentStats.fanSpeed }}%
        </span>
        <span>
          <img src="../clock.png" class="icon-lg" alt="Clock" />
          {{ currentStats.clock }} MHz
        </span>
      </p>
    </div>

    <!-- Fan Curve Chart -->
    <div class="graph">
      <canvas ref="canvas"></canvas>
    </div>

    <!-- Controls -->
    <div class="operations">
      <button class="btn-apply" @click="applyTempGraph">Apply</button>
      <button class="btn-reset" @click="resetGraph">Reset</button>
    </div>


  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

// ─── State ───────────────────────────────────────────────────────────────────

const canvas = ref(null)
let chartInstance = null

const gpus = ref([])
const selectedGPUIndex = ref(0)

// Per-GPU data (keyed by GPU index)
const configs = reactive({})
const stats = reactive({})
const dangerStatus = reactive({})
const xData = reactive({}) // temperature axis (labels)
const yData = reactive({}) // fan-speed axis (editable)

let pollInterval = null
let activePoint = null

// ─── Profiles state ──────────────────────────────────────────────────────────

const profiles = reactive({})
const dropdownOpen = ref(false)
const savingProfile = ref(false)
const newProfileName = ref('')
const editingName = ref(null)
const editingValue = ref('')
const confirmDelete = ref(null)
const profilesWrap = ref(null)
const saveInput = ref(null)
const renameInput = ref(null)

const profileNames = computed(() =>
  Object.keys(profiles[selectedGPUIndex.value] || {}).sort()
)

// Track which profile is currently loaded, per GPU
const activeProfileName = reactive({})

// True when current curve differs from the loaded profile
const profileChanged = computed(() => {
  const idx = selectedGPUIndex.value
  const name = activeProfileName[idx]
  if (!name) return false
  const stored = profiles[idx]?.[name]
  if (!stored) return false
  const storedY = JSON.parse(stored.y_axis_data)
  const currentY = yData[idx]
  if (!currentY || storedY.length !== currentY.length) return false
  return storedY.some((v, i) => v !== currentY[i])
})

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (!dropdownOpen.value) resetDropdownState()
}

function closeDropdown() {
  dropdownOpen.value = false
  resetDropdownState()
}

function resetDropdownState() {
  savingProfile.value = false
  newProfileName.value = ''
  editingName.value = null
  editingValue.value = ''
  confirmDelete.value = null
}

// ─── Computed ────────────────────────────────────────────────────────────────

const currentGPU = computed(() => gpus.value.find(g => g.index === selectedGPUIndex.value))
const currentConfig = computed(() => configs[selectedGPUIndex.value])
const currentStats = computed(() => stats[selectedGPUIndex.value] || { temp: 0, fanSpeed: 0, clock: 0 })

// ─── Initialisation ──────────────────────────────────────────────────────────

async function init() {
  const gpuList = await window.electronAPI.getGPUs()
  gpus.value = gpuList

  for (const gpu of gpuList) {
    const config = await window.electronAPI.getConfiguration(gpu.index)
    configs[gpu.index] = config
    xData[gpu.index] = JSON.parse(config.x_axis_data)
    yData[gpu.index] = JSON.parse(config.y_axis_data)
    stats[gpu.index] = { temp: 0, fanSpeed: 0, clock: 0 }
    dangerStatus[gpu.index] = false
  }

  if (gpuList.length > 0) {
    selectedGPUIndex.value = gpuList[0].index
  }

  for (const gpu of gpuList) {
    profiles[gpu.index] = await window.electronAPI.getProfiles(gpu.index)
  }

  await nextTick()
  loadChart()
  startPolling()
}

// ─── Polling ─────────────────────────────────────────────────────────────────

function startPolling() {
  if (pollInterval) clearInterval(pollInterval)
  const interval = currentConfig.value?.check_temp_interval || 5000
  pollAllGPUs()
  pollInterval = setInterval(pollAllGPUs, interval)
}

async function pollAllGPUs() {
  for (const gpu of gpus.value) {
    try {
      const result = await window.electronAPI.checkStatistics(gpu.index)
      stats[gpu.index] = result

      const cfg = configs[gpu.index]
      if (cfg && result.temp >= cfg.danger_temp) {
        if (!dangerStatus[gpu.index]) {
          dangerStatus[gpu.index] = true
          playAlert()
        }
      } else {
        dangerStatus[gpu.index] = false
      }
    } catch (e) {
      console.error(`Polling error GPU ${gpu.index}:`, e)
    }
  }
}

function playAlert() {
  try {
    new Audio(new URL('../beep.mp3', import.meta.url).href).play()
  } catch (e) {
    console.error('Alert playback error:', e)
  }
}

// ─── GPU Selection ───────────────────────────────────────────────────────────

function selectGPU(gpuIndex) {
  selectedGPUIndex.value = gpuIndex
}

watch(selectedGPUIndex, () => {
  updateChartData()
})

// ─── Chart ───────────────────────────────────────────────────────────────────

const OK_COLOR = '#3e95cd'
const ERR_COLOR = '#FF0055'

function loadChart() {
  if (!canvas.value) return

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  removePointerListeners()

  const ctx = canvas.value.getContext('2d')
  const idx = selectedGPUIndex.value
  const cfg = configs[idx]

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: xData[idx] || [],
      datasets: [{
        data: [...(yData[idx] || [])],
        label: currentGPU.value?.name || 'GPU',
        borderColor: OK_COLOR,
        backgroundColor: 'rgba(62,149,205,0.15)',
        tension: 0,
        fill: true,
        pointRadius: 6,
        pointHoverRadius: 9
      }]
    },
    options: {
      animation: { duration: 50 },
      plugins: {
        tooltip: { mode: 'nearest' }
      },
      scales: {
        x: {
          title: { display: true, text: 'Temperature (°C)', color: '#ccc' },
          ticks: { color: '#ccc' },
          grid: { color: 'rgba(255,255,255,0.1)' }
        },
        y: {
          min: 0,
          max: 100,
          title: { display: true, text: 'Fan Speed (%)', color: '#ccc' },
          ticks: { color: '#ccc', stepSize: 10 },
          grid: { color: 'rgba(255,255,255,0.1)' }
        }
      }
    }
  })

  addPointerListeners()
}

function updateChartData() {
  if (!chartInstance) {
    loadChart()
    return
  }

  removePointerListeners()

  const idx = selectedGPUIndex.value
  const cfg = configs[idx]

  chartInstance.data.labels = xData[idx] || []
  chartInstance.data.datasets[0].data = [...(yData[idx] || [])]
  chartInstance.data.datasets[0].label = currentGPU.value?.name || 'GPU'
  chartInstance.data.datasets[0].borderColor = OK_COLOR
  chartInstance.options.scales.y.min = 0
  chartInstance.options.scales.y.max = 100
  chartInstance.update()

  addPointerListeners()
}

// ─── Drag interaction ────────────────────────────────────────────────────────

function addPointerListeners() {
  if (!canvas.value) return
  canvas.value.addEventListener('pointerdown', downHandler)
  canvas.value.addEventListener('pointerup', upHandler)
}

function removePointerListeners() {
  if (!canvas.value) return
  canvas.value.removeEventListener('pointerdown', downHandler)
  canvas.value.removeEventListener('pointerup', upHandler)
  canvas.value.removeEventListener('pointermove', moveHandler)
}

function downHandler(event) {
  if (!chartInstance) return
  const points = chartInstance.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false)
  if (points.length > 0) {
    activePoint = points[0]
    canvas.value.setPointerCapture(event.pointerId)
    canvas.value.addEventListener('pointermove', moveHandler)
  }
}

function upHandler(event) {
  if (canvas.value && event.pointerId != null) {
    try { canvas.value.releasePointerCapture(event.pointerId) } catch (_) {}
  }
  activePoint = null
  if (canvas.value) canvas.value.removeEventListener('pointermove', moveHandler)
}

function moveHandler(event) {
  if (!activePoint || !chartInstance) return

  const rect = canvas.value.getBoundingClientRect()
  const y = event.clientY - rect.top
  const yValue = chartInstance.scales.y.getValueForPixel(y)
  const clamped = Math.round(Math.max(0, Math.min(100, yValue)))

  const dataIndex = activePoint.index
  chartInstance.data.datasets[0].data[dataIndex] = clamped
  yData[selectedGPUIndex.value][dataIndex] = clamped
  chartInstance.update('none')
}

// ─── Profiles ────────────────────────────────────────────────────────────────

function startSave() {
  newProfileName.value = ''
  savingProfile.value = true
  nextTick(() => saveInput.value?.focus())
}

async function confirmSave() {
  const name = newProfileName.value.trim()
  if (!name) return
  const idx = selectedGPUIndex.value
  await window.electronAPI.saveProfile({
    gpuIndex: idx,
    name,
    temperature: JSON.stringify(xData[idx]),
    fanSpeed: JSON.stringify(yData[idx])
  })
  profiles[idx] = await window.electronAPI.getProfiles(idx)
  savingProfile.value = false
  newProfileName.value = ''
}

async function loadProfile(name) {
  const idx = selectedGPUIndex.value
  const profile = profiles[idx]?.[name]
  if (!profile) return
  const newY = JSON.parse(profile.y_axis_data)
  xData[idx] = JSON.parse(profile.x_axis_data)
  yData[idx] = newY
  activeProfileName[idx] = name
  if (chartInstance) {
    const data = chartInstance.data.datasets[0].data
    data.splice(0, data.length, ...newY)
    chartInstance.data.labels = xData[idx]
    chartInstance.update()
  }
  closeDropdown()
}

async function saveActiveProfile() {
  const idx = selectedGPUIndex.value
  const name = activeProfileName[idx]
  if (!name) return
  await window.electronAPI.saveProfile({
    gpuIndex: idx,
    name,
    temperature: JSON.stringify(xData[idx]),
    fanSpeed: JSON.stringify(yData[idx])
  })
  profiles[idx] = await window.electronAPI.getProfiles(idx)
}

async function confirmDeleteProfile(name) {
  const idx = selectedGPUIndex.value
  await window.electronAPI.deleteProfile({ gpuIndex: idx, name })
  profiles[idx] = await window.electronAPI.getProfiles(idx)
  confirmDelete.value = null
}

function startRename(name) {
  confirmDelete.value = null
  editingName.value = name
  editingValue.value = name
  nextTick(() => renameInput.value?.focus())
}

async function confirmRename() {
  const newName = editingValue.value.trim()
  const oldName = editingName.value
  if (!newName || newName === oldName) { cancelEdit(); return }
  const idx = selectedGPUIndex.value
  await window.electronAPI.renameProfile({ gpuIndex: idx, oldName, newName })
  profiles[idx] = await window.electronAPI.getProfiles(idx)
  cancelEdit()
}

function cancelEdit() {
  editingName.value = null
  editingValue.value = ''
}

// ─── Apply / Reset ───────────────────────────────────────────────────────────

async function applyTempGraph() {
  const idx = selectedGPUIndex.value
  await window.electronAPI.applyTempGraph({
    gpuIndex: idx,
    temperature: JSON.stringify(xData[idx]),
    fanSpeed: JSON.stringify(yData[idx])
  })
}

async function resetGraph() {
  const idx = selectedGPUIndex.value
  const config = await window.electronAPI.getConfiguration(idx)
  configs[idx] = config
  const newY = JSON.parse(config.y_axis_data)
  xData[idx] = JSON.parse(config.x_axis_data)
  yData[idx] = newY

  if (chartInstance) {
    const data = chartInstance.data.datasets[0].data
    data.splice(0, data.length, ...newY)
    chartInstance.data.labels = xData[idx]
    chartInstance.update()
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function onDocClick(e) {
  if (dropdownOpen.value && profilesWrap.value && !e.composedPath().includes(profilesWrap.value)) {
    closeDropdown()
  }
}

onMounted(() => {
  init()
  document.addEventListener('click', onDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  if (pollInterval) clearInterval(pollInterval)
  removePointerListeners()
  if (chartInstance) chartInstance.destroy()
})
</script>

<style>
* {
  box-sizing: border-box;
}

body {
  background: #31363b;
  margin: 0;
  color: #fff;
  font-family: sans-serif;
}

#app {
  color: #fff;
}

.container {
  padding: 16px;
}

/* Top bar */
.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 32px;
  margin-bottom: 4px;
}

/* GPU selector tabs */
.gpu-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gpu-tab {
  padding: 6px 14px;
  background: #3d4349;
  border: 1px solid #555;
  color: #ccc;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.gpu-tab:hover {
  background: #4a5158;
  color: #fff;
}

.gpu-tab.active {
  background: #3e95cd;
  border-color: #3e95cd;
  color: #fff;
}

/* Info bar */
.info {
  text-align: center;
  margin-bottom: 4px;
}

.gpu-name {
  font-size: 15px;
  font-weight: 600;
  margin: 4px 0;
}

.danger-warn {
  color: #ff4444;
  font-weight: bold;
  font-size: 14px;
  margin: 4px 0;
}

.stats-row {
  display: flex;
  justify-content: center;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}

.stats-row span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-sm { width: 12px; }
.icon-md { width: 28px; }
.icon-lg { width: 32px; }

/* Chart */
.graph {
  max-width: 820px;
  margin: 12px auto;
  background: #222629;
  border-radius: 4px;
  padding: 8px;
}

/* Buttons */
.operations {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 14px;
}

button {
  padding: 8px 20px;
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid #555;
  font-size: 14px;
}

.btn-apply {
  background: #3e95cd;
  border-color: #3e95cd;
  color: #fff;
}

.btn-apply:hover {
  background: #2d7db5;
}

.btn-reset {
  background: #3d4349;
  color: #ccc;
}

.btn-reset:hover {
  background: #4a5158;
  color: #fff;
}

/* Profiles dropdown */
.profiles-wrap {
  position: relative;
  margin-left: auto;
}

.btn-profiles {
  background: #3d4349;
  border: 1px solid #555;
  color: #ccc;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-profiles:hover {
  background: #4a5158;
  color: #fff;
}

.caret {
  font-size: 10px;
  margin-left: 4px;
}

.dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: #2a2e33;
  border: 1px solid #444;
  border-radius: 6px;
  min-width: 260px;
  z-index: 100;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  padding: 4px 0;
}

.dd-empty {
  font-size: 12px;
  color: #555;
  padding: 8px 12px;
}

.dd-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
}

.dd-item:hover:not(.dd-new) {
  background: rgba(255,255,255,0.04);
}

.dd-name {
  flex: 1;
  font-size: 13px;
  color: #ddd;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dd-name:hover { color: #3e95cd; }

.dd-confirm-text {
  flex: 1;
  font-size: 12px;
  color: #f0a;
  white-space: nowrap;
}

.dd-btn {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
}

.dd-btn-edit   { background: transparent; color: #888; border-color: #444; }
.dd-btn-edit:hover { color: #fff; border-color: #666; }
.dd-btn-remove { background: transparent; color: #888; border-color: #444; }
.dd-btn-remove:hover { color: #ff4444; border-color: #ff4444; }
.dd-btn-yes    { background: #c0392b; color: #fff; border-color: #c0392b; }
.dd-btn-yes:hover { background: #e74c3c; }
.dd-btn-no     { background: transparent; color: #888; border-color: #444; }
.dd-btn-no:hover { color: #fff; }
.dd-btn-ok     { background: transparent; color: #4caf50; border-color: #4caf50; }
.dd-btn-ok:hover { color: #66bb6a; }
.dd-btn-save   { background: transparent; color: #3e95cd; border-color: #3e95cd; }
.dd-btn-save:hover:not(:disabled) { background: #3e95cd; color: #fff; }
.dd-btn-save:disabled { opacity: 0.35; cursor: default; }

.changed-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f0a500;
  vertical-align: middle;
  margin: 0 3px 1px;
}

.dd-input {
  flex: 1;
  background: #1a1d20;
  border: 1px solid #3e95cd;
  border-radius: 3px;
  color: #fff;
  font-size: 12px;
  padding: 3px 7px;
  outline: none;
  min-width: 0;
}

.dd-divider {
  border-top: 1px solid #3a3f44;
  margin: 4px 0;
}

.dd-new { padding: 6px 10px; }

.dd-btn-new {
  background: transparent;
  border: none;
  color: #3e95cd;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.dd-btn-new:hover { color: #5ba8d8; }
</style>
