const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getGPUs: () => ipcRenderer.invoke('getGPUs'),
  getConfiguration: (gpuIndex) => ipcRenderer.invoke('getConfiguration', gpuIndex),
  checkStatistics: (gpuIndex) => ipcRenderer.invoke('checkStatistics', gpuIndex),
  applyTempGraph: (data) => ipcRenderer.invoke('applyTempGraph', data),
  getProfiles: (gpuIndex) => ipcRenderer.invoke('getProfiles', gpuIndex),
  saveProfile: (data) => ipcRenderer.invoke('saveProfile', data),
  deleteProfile: (data) => ipcRenderer.invoke('deleteProfile', data),
  renameProfile: (data) => ipcRenderer.invoke('renameProfile', data)
})
