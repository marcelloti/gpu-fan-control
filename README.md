# gpu-fan-control

<p align="center">
    <img width='500' src='https://raw.githubusercontent.com/marcelloti/gpu-fan-control/main/screenshot.png'/>
</p>

<p>Control your GPU fan speed and monitor real-time statistics from a desktop app.</p>
<p>Supports <strong>multiple NVIDIA GPUs</strong> simultaneously, with per-GPU fan curves and profiles.</p>
<br/>
<p>The current version only supports NVIDIA GPU cards.</p>
<p>v0.3.0 tested with RTX 5070 on Fedora (Wayland/KDE) using <b>nvidia-driver</b> 580.x.<br/>
v0.1.0 was previously tested with GTX 560 and GTX 1050 Ti on Debian using <b>nvidia-driver</b> and <b>nvidia-legacy-390xx-driver</b> — compatibility with legacy drivers in v0.3.0 is untested.</p>
<br/>

## Features

- Interactive fan curve editor — drag points on the graph to adjust speed per temperature step
- Real-time GPU statistics (temperature, fan speed, clock frequency)
- Multi-GPU support — switch between GPUs via tabs
- **Fan curve profiles** — create, load, rename and delete named profiles per GPU
- Danger temperature alert with audio notification
- System tray integration
- Wayland and X11 support

## Dependencies

- `nvidia-settings` — fan speed control
- `nvidia-smi` — temperature and clock readings
- Node.js v18+

## Pre-configuration

### X11 systems

```bash
# Enable all GPUs and fan control in xorg
nvidia-xconfig --enable-all-gpus
nvidia-xconfig --cool-bits=4

# Reboot, then enable fan control state per GPU (no sudo needed on X11)
nvidia-settings -a '[gpu:0]/GPUFanControlState=1'
# nvidia-settings -a '[gpu:1]/GPUFanControlState=1'  # second GPU

# Required for Electron sandbox on some Linux systems
sudo sysctl kernel.unprivileged_userns_clone=1
```

### Wayland systems (KDE, GNOME, etc.)

On Wayland, `nvidia-settings` write operations require root. The app handles this automatically via `sudo -E`, but you must grant passwordless access first:

```bash
# Create sudoers rule (replace "youruser" with your username)
echo 'youruser ALL=(ALL) NOPASSWD:SETENV: /usr/bin/nvidia-settings' | \
  sudo tee /etc/sudoers.d/nvidia-fan-control
sudo chmod 440 /etc/sudoers.d/nvidia-fan-control
```

Then enable fan control state once per boot (consider adding to a startup script):

```bash
sudo -E nvidia-settings -a '[gpu:0]/GPUFanControlState=1'
# sudo -E nvidia-settings -a '[gpu:1]/GPUFanControlState=1'  # second GPU
```

> **Driver version mismatch:** If `nvidia-smi` shows `Driver/library version mismatch`, reboot — a driver update was installed but the old kernel module is still loaded.

## Running from source

```bash
git clone https://github.com/marcelloti/gpu-fan-control
cd gpu-fan-control
npm install
npm run dev
```

To open with DevTools:

```bash
npm run dev:debug
```

## Building the AppImage

```bash
npm run electron:build
```

## Running the AppImage

**X11:**
```bash
# Enable fan control state (no sudo needed on X11)
nvidia-settings -a '[gpu:0]/GPUFanControlState=1'

./gpu-fan-control-0.3.0.AppImage
```

**Wayland** (after completing the sudoers setup above):
```bash
# Enable fan control state
sudo -E nvidia-settings -a '[gpu:0]/GPUFanControlState=1'

# On some systems (Debian/Ubuntu):
sudo sysctl kernel.unprivileged_userns_clone=1

./gpu-fan-control-0.3.0.AppImage
```

## Using profiles

1. Adjust the fan curve by dragging points on the graph
2. Open the **Profiles** dropdown (top-right)
3. Click **+ New profile** and enter a name to save the current curve
4. Click a profile name to load it onto the graph
5. After making changes, the **Save** button appears next to the active profile — click it to overwrite
6. Use **Edit** to rename or **Remove** to delete (with confirmation)
