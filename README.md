# Smart Mirror (Reflect)

Reflect is a modular smart-mirror interface built with React and Tailwind CSS. The project ships as a collection of draggable, resizable widgets (clock, weather, news, calendar, etc.) that can be enabled or disabled through an on-device settings page. This guide explains, in detail, how to take the ZIP archive available from Patreon or [concept-bytes.com](https://concept-bytes.com) and deploy it onto a Raspberry Pi so that it can power a real-world smart mirror installation.

## What You Get in the ZIP

The downloadable archive contains the full project source tree:

- `package.json` / `package-lock.json` – npm dependencies and scripts
- `src/` – React application source
- `public/` – static assets served by Vite/React
- `build/` – production-ready assets (optional if you want to deploy without rebuilding)
- Configuration files such as `tailwind.config.js` and `postcss.config.js`

> **Tip:** The archive does not ship with compiled binaries; you will build or run the project with Node.js on the Raspberry Pi.

## Prerequisites

### Hardware

- Raspberry Pi 3B, 3B+, 4, 400, or 5 (2 GB RAM minimum recommended)
- 16 GB or larger microSD card (Class 10/UHS-1)
- MicroSD card reader for your computer
- Power supply appropriate for the Pi model
- Optional: USB keyboard, mouse, and HDMI display for initial setup (or headless setup with SSH)

### Software on Your Computer

- [Raspberry Pi Imager](https://www.raspberrypi.com/software/) (Windows/macOS/Linux)
- A file archiver (built-in OS tools, 7-Zip, The Unarchiver, etc.)
- Web browser to download the ZIP

## Step 1 – Prepare the microSD Card

1. Insert the microSD card into your computer.
2. Launch **Raspberry Pi Imager** and choose an operating system:
   - For a full desktop experience, select **Raspberry Pi OS (32-bit)**.
   - For headless setups, select **Raspberry Pi OS Lite (32-bit)**.
3. Click the gear icon to open **Advanced Options** and configure:
   - **Hostname** (e.g., `reflect.local`)
   - **Enable SSH** (use password or SSH keys)
   - **Set username and password** (default `pi` user is fine)
   - **Configure Wi-Fi** (SSID, password, and country) if not using Ethernet
   - **Set locale/timezone** to match your installation
4. Choose the microSD card as the **Storage** target and click **Write**.
5. Safely eject the card once imaging completes.

## Step 2 – Boot and Update the Raspberry Pi

1. Insert the imaged microSD card into the Raspberry Pi and connect power.
2. If you chose Raspberry Pi OS Desktop, complete the first-boot wizard.
3. Update the system packages:

   ```bash
   sudo apt update
   sudo apt full-upgrade -y
   sudo reboot
   ```

4. After reboot, install useful tools:

   ```bash
   sudo apt install -y git curl unzip
   ```

## Step 3 – Install Node.js and npm

Reflect is a React application that runs under Node.js. Install a version compatible with Raspberry Pi OS.

### Option A – Install via NodeSource (Recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Option B – Install via nvm (Node Version Manager)

If you want more control over Node versions:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

Confirm the installation:

```bash
node -v
npm -v
```

You should see Node.js ≥ 18.x and npm ≥ 9.x. If not, rerun the installation steps.

## Step 4 – Transfer the Project ZIP to the Raspberry Pi

1. Log in to your Patreon account or [concept-bytes.com](https://concept-bytes.com) from your computer and download the latest Reflect ZIP archive.
2. Copy the ZIP file to the Raspberry Pi:
   - **Using scp (macOS/Linux):**

     ```bash
     scp ~/Downloads/reflect-smart-mirror.zip pi@reflect.local:~/
     ```

   - **Using Windows PowerShell:**

     ```powershell
     scp C:\Users\you\Downloads\reflect-smart-mirror.zip pi@reflect.local:~
     ```

   - **Using USB drive:** Copy the ZIP onto a USB stick, plug it into the Pi, and copy it with the file manager or `cp`.
   - **Using direct download on the Pi:** Open a browser or use `wget`/`curl` if a direct link is provided.

## Step 5 – Unpack the ZIP and Install Dependencies

1. SSH into the Raspberry Pi (or open a terminal window):

   ```bash
   ssh pi@reflect.local
   ```

2. Unzip the archive:

   ```bash
   unzip reflect-smart-mirror.zip -d ~/reflect
   cd ~/reflect
   ```

3. Install JavaScript dependencies:

   ```bash
   npm install
   ```

   This reads `package.json` and downloads React, Tailwind CSS, and other required packages into `node_modules/`.

4. (Optional) If you received the project without a `build/` directory or you want to customize the code, build a fresh production bundle:

   ```bash
   npm run build
   ```

## Step 6 – Run the Smart Mirror

### Development Mode (live reload, debugging)

```bash
npm run dev
```

- The command starts the Vite development server at `http://localhost:5173` by default.
- For remote access from another device, add the `-- --host` flag:

  ```bash
  npm run dev -- --host 0.0.0.0
  ```

- Open the URL in Chromium on the Pi or from another device on the same network.

### Production Mode (optimized, no dev tools)

```bash
npm run preview
```

- Serves the files generated in `build/`.
- Use this for demonstration or when running the mirror unattended.

### Autostart on Boot with `pm2`

To launch the mirror automatically when the Pi starts:

```bash
sudo npm install -g pm2
pm2 start npm --name "reflect" -- start
pm2 save
pm2 startup systemd
```

Follow the instructions printed by `pm2 startup` to enable the service. After setup, the smart mirror will start on boot.

## Display Considerations

- Configure the Raspberry Pi to boot into kiosk mode to hide the desktop and launch the browser automatically. For Raspberry Pi OS Desktop:
  1. Open **Raspberry Pi Configuration → System → Auto login** and enable `Login as user 'pi'`.
  2. Add a Chromium autostart entry by creating `~/.config/lxsession/LXDE-pi/autostart` with:

     ```
     @chromium-browser --kiosk http://localhost:5173
     ```

  3. Adjust the URL if you use `npm run preview` or host the site elsewhere.
- To rotate the display (for portrait mirrors), add `display_rotate=1` (90°) or `display_rotate=3` (270°) to `/boot/firmware/config.txt` and reboot.

## Customization Workflow

1. Modify components in `src/` to change layout, styling, or logic.
2. Update `src/data/apps.js` to register new widgets.
3. Tailwind CSS classes live alongside components; global tweaks go into `src/index.css`.
4. Run `npm run dev` during development for hot reloads.
5. Rebuild with `npm run build` before deploying production assets.

## Troubleshooting

| Symptom | Possible Cause | Resolution |
| --- | --- | --- |
| `npm install` is slow or fails | MicroSD is slow, missing swap, or network issues | Ensure a quality card, enable swap with `sudo dphys-swapfile setup`, or run `npm install --prefer-offline` after an initial successful install |
| `node: command not found` | Node.js not installed or PATH not updated | Re-run NodeSource or nvm installation steps; reopen the terminal to load nvm |
| `npm run dev` shows "address already in use" | Port 5173 is occupied | Stop other services or run `npm run dev -- --port 3000` |
| Blank browser window in kiosk mode | Browser launched before server ready | Delay launch via a small shell script that waits for port 5173 before starting Chromium |
| Weather/news widgets show no data | API keys not configured | Inspect `src/data/apps.js` or settings UI; supply required API keys if applicable |

## Maintaining Your Installation

- Periodically update the OS:

  ```bash
  sudo apt update && sudo apt full-upgrade -y
  ```

- Update npm dependencies inside the project:

  ```bash
  cd ~/reflect
  npm update
  ```

- Back up the microSD card image using Raspberry Pi Imager or `dd` so you can restore quickly if the card fails.

## Getting Help

- Review the source code inside the ZIP for comments and component-level documentation.
- Check Patreon or concept-bytes.com for release notes, FAQs, and community discussions.
- For Raspberry Pi OS issues, consult the [official documentation](https://www.raspberrypi.com/documentation/).

With these steps, you can transform a Raspberry Pi and a one-way mirror into a fully featured smart mirror powered by Reflect. Enjoy customizing your layout, widgets, and data sources to suit your space!
