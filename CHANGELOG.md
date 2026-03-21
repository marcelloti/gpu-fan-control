# Changelog

## [0.3.0] — 2026-03-21

### New features
- **Fan curve profiles** — create, load, rename and delete named profiles per GPU, stored in `gpu-config.json`
- **Active profile tracking** — the dropdown button shows the currently loaded profile name ("Default" when none)
- **Profile change detection** — a Save button appears next to the active profile and enables automatically when the curve differs from the saved state; an amber dot on the dropdown button signals unsaved changes
- **`npm run dev:debug`** — new dev script that opens DevTools (controlled via `OPEN_DEVTOOLS=1` env var, absent from `npm run dev`)

### Bug fixes
- **Wayland fan control** — `nvidia-settings` write commands now use `sudo -E` with `SETENV` in sudoers, forwarding `DISPLAY`, `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR` correctly; previous approach of passing env vars inline was blocked by sudo policy
- **`GPUFanCount` attribute** — removed query for `GPUFanCount` which is unsupported on driver 580.x+; replaced with probe-based detection that queries `fan:N/GPUTargetFanSpeed` incrementally until an error is returned
- **Chart drag (Y axis)** — the `moveHandler` was computing the dragged value using temperature min/max (26–78) instead of fan speed (0–100); replaced manual pixel math with `chartInstance.scales.y.getValueForPixel()` which is the correct Chart.js v4 API
- **Chart drag (`Chart.helpers.getRelativePosition`)** — this helper was removed in Chart.js v4; replaced with `canvas.getBoundingClientRect()` + `event.clientY`
- **Pointer capture** — added `canvas.setPointerCapture(event.pointerId)` on drag start so pointermove events are not lost when the pointer moves outside the canvas
- **Reset button** — `chartInstance.data.datasets[0].data = [...]` (array replacement) was not reliably detected by Chart.js v4; replaced with `Array.splice()` which mutates the tracked array in place
- **Profiles dropdown click-outside** — used `e.composedPath()` instead of `el.contains(e.target)`; when Vue re-renders synchronously on state change (e.g. showing the name input), the original target element is removed from the DOM before the document click listener fires, causing `contains()` to return false and closing the dropdown immediately
- **Y axis range** — chart Y axis was using temperature values (min\_temp − 5 to max\_temp + 5) for fan speed percentage; corrected to fixed 0–100 range with step size of 10

### Internal
- `displayEnv` now includes `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR` in addition to `DISPLAY`
- Introduced `nvSet(assignment)` helper that wraps nvidia-settings assignments with `sudo -E`
- `buildGPUFanInfo` refactored to use `getTotalFanCount()` (probe-based) and distribute fans evenly across detected GPUs
- Profile data stored under `profiles` key inside each GPU entry in `gpu-config.json`; IPC handlers: `getProfiles`, `saveProfile`, `deleteProfile`, `renameProfile`

---

## [0.2.0]

- Multi-GPU support — each GPU gets its own fan curve and statistics display
- Migrated build system from `vue-cli-service` to `electron-vite`
- Upgraded to Vue 3, Electron 29, and Chart.js 4
- Configuration stored in `gpu-config.json` (replaced SQLite dependency)
- Automatic migration of legacy `data.db` configuration
- Context isolation and preload script
- Fan speed now read from `nvidia-smi`
- Improved tray menu with Quit option

## [0.1.0]

- Initial release
