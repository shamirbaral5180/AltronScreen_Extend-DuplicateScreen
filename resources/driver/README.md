# AltronScreen — Extended Screen (Virtual Display Driver)

AltronScreen can turn a browser device into a **true extended (secondary)**
screen for your computer, not just a mirror. Doing that requires the operating
system to believe an extra monitor exists, which is only possible through a
**virtual display driver**.

## Why a driver is needed

An application can only capture displays the OS already knows about. To create
a *new* monitor (an extended desktop area), the host PC needs a virtual display
device. AltronScreen uses the free, open-source, Microsoft-signed
**Virtual Display Driver (VDD)** for this.

Without the driver, AltronScreen falls back to its normal modes:

- **Entire Screen** — mirror an existing monitor
- **Application Window** — share a single window

With the driver, a third mode becomes available:

- **Extend Screen** — creates a virtual monitor sized to the connecting device
  and streams it over the same connection (same port, same WebRTC pipeline)

## Requirements

- Windows 10 or 11
- Administrator rights (only for the one-time driver install)

## Installation

### Option A — guided script

1. In AltronScreen, click **Extend Screen**. If the driver is missing, a
   dialog appears — click **Get the driver**.
2. Windows shows a **UAC prompt** (administrator). Accept it.
3. The helper installs VDD automatically: it prefers `winget`, and if WinGet
   is unavailable it downloads the latest official release directly and
   extracts it.
4. Follow the on-screen prompt to run the extracted installer, then click
   **Close** in AltronScreen. The **Extend Screen** button becomes active
   without restarting.

### Option B — manual

1. Download the latest release from
   [VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/latest).
2. Run the included installer (or the `.bat`/`.exe` provided in the archive)
   as administrator.
3. Confirm the device appears under **Device Manager → Display adapters**.
4. Restart AltronScreen.

## How AltronScreen uses the driver

- AltronScreen talks to the driver over its local named pipe
  (`\\.\pipe\MTTVirtualDisplayPipe`). No network or admin rights are required
  at runtime.
- When you click **Extend Screen**, AltronScreen:
  1. writes the desired resolution (the connecting device's resolution) to
     `vdd_settings.xml`
  2. issues `SETDISPLAYCOUNT 1` over the pipe to activate a monitor
  3. refreshes capture sources and starts sharing it
- When sharing ends or the app quits, AltronScreen issues `SETDISPLAYCOUNT 0`
  so no phantom monitor is left behind.

## Is the driver trusted?

Short answer: it is a **legitimate, code-signed, widely-used open-source
driver**, but it is a **third-party community project — not a Windows or
Microsoft component.**

Verified facts about VDD:

- **MIT licensed** and developed in the open — review the source at
  [VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver).
- **Code-signed** (free signing via SignPath Foundation). Windows will still
  show a UAC prompt during installation because it is not a Microsoft driver.
- **User-mode (UMDF)** driver — runs without kernel privileges, which greatly
  reduces the chance of a system crash (BSOD).
- **Actively maintained**, ~10k GitHub stars, and distributed via WinGet
  (`VirtualDrivers.Virtual-Display-Driver`).
- **Not WHQL-certified.** The maintainers publish it "AS IS" with no warranty.

Known risks (documented by the maintainers):

- Installing or updating **GPU/chipset drivers while VDD is installed** can
  cause a black screen on boot or scrambled display priority. Their
  recommendation: uninstall VDD before major GPU driver updates, and reinstall
  after. Recovery, if needed: boot into Safe Mode and remove the device from
  Device Manager.
- On **ARM64 Windows 11 24H2+** it may require test-signing to be enabled.

AltronScreen never bundles or silently installs VDD. It only offers a helper
that opens the official release page; installing the driver is always an
explicit, user-initiated choice.

## Notes

- The driver is a separate, user-installed component; AltronScreen does not
  bundle or redistribute the driver binary.
- Everything stays local: the virtual display is created on the host and
  streamed over the existing LAN WebRTC connection.
