# 1.4.0

- Fixed the extended screen not being removed on close: the app now removes the
  virtual display device, since the driver has no zero-monitor mode (a count of
  "0" is internally treated as 1). The device is recreated on demand when a
  screen is added again.
- The virtual display is now removed reliably on close while captures are
  stopped first, so no leftover "Screen 2" remains and the PC does not freeze.
- Faster startup: the window is shown as soon as it is ready, and the signaling
  server, LAN discovery, and driver checks now run in the background instead of
  blocking the first paint. The UI appears in well under a second.
- The startup driver check uses the installed driver package (not the device),
  so no re-download is triggered after the device is removed on close.

# 1.3.0

- Fixed a freeze that could require a PC restart when closing the app, especially
  with several extended screens and multiple viewers connected.
- The app no longer runs `pnputil /restart-device` at all. Restarting the display
  device resets the whole display stack (freezing a live desktop) and could even
  remove the virtual display device.
- On close, all live captures are stopped first (releasing the desktop
  duplication handles), then the extended displays are removed via a soft driver
  reload, then the app quits. Cleanup is bounded and skipped when no extended
  screen was created.
- The extended (virtual) display now advertises several resolutions, so its
  resolution can be changed in Windows Display Settings without recreating it.
- Added the default extended-screen resolution of 1360x768, and a Settings
  option to choose the default resolution (Windows can still change it live).
- Removing the extended screen from Settings uses a soft reload with no display
  device restart.

# 1.2.0

- The viewer now opens a home screen with a list of nearby AltronScreen computers instead of the previous error dialog after disconnecting.
- Clicking a nearby computer or the current address sends a fresh access request that the host can Allow or Deny, as before.
- Nearby computers are discovered over the local network; a manual URL entry is available when discovery broadcasts are blocked.
- A Disconnect button in the player and automatic disconnect handling return to the home screen without re-requesting access.
- Added saved streaming settings (preset, frame rate, resolution, bitrate, latency, and content preference) under Settings, with live options.
- Frame rate, resolution, and content hint apply to capture; bitrate, frame rate cap, and degradation preference apply to the encoder; latency applies to receiver buffering where supported.

# 1.1.0

- Connect multiple viewing devices simultaneously using the same LAN URL.
- Isolate signaling, capture selection, and disconnection for each viewer.
- Queue host approvals when multiple devices request access at once.
- Keep the QR code available while other viewers are sharing.
- Support up to 16 active or pending viewer sessions.
- Preserve the Windows administrator-mode capture and stable viewer playback fixes.

# 1.0.0

Initial AltronScreen release.

Changes:

- Rebranded the application to **AltronScreen** (app, installer, viewer, and all 15 languages).
- **Extended Screen**: create a real secondary (extended) display on the host and stream it to any browser device.
  - Uses the free, open-source Virtual Display Driver (VDD) on Windows (code-signed, user-installed, opt-in).
  - The virtual monitor is automatically sized to the connecting device's resolution.
  - The virtual display is cleaned up automatically when sharing ends or the app quits.
  - Guided one-click installer helper (prefers `winget`, falls back to the official download).
- Removed all third-party telemetry (Google Analytics) and the client-viewer consent dialogs.
- Removed unused third-party dependencies (`axios`, `@vercel/blob`, `electron-updater`).
- Windows builds now produce a single self-contained portable `.exe` (no installation required).

<br/>
<br/>

# 1.0.11 (8 Mar 2021)

Changes:

- add Danish language translations. Special thanks to @LauritsLL
- add German language translations. Special thanks to @Aceto1

<br/>
<br/>

# 1.0.10 (25 Feb 2021)

Changes:

- add Spanish language translations. Special thanks to @schiappa

<br/>
<br/>

# 1.0.9 (24 Feb 2021)

Changes:

- remove severe Windows UI lags.
- Increase performance on weak Windows machines.

<br/>
<br/>

# 1.0.8 (23 Feb 2021)

Changes:

- added locales for Traditional Chinese language, special thanks to @taotieren
- minor UI improvements

<br/>
<br/>

# 1.0.7 (21 Feb 2021)

Changes:

- added locales for Chinese language, special thanks to @taotieren
- minor UI improvements

<br/>
<br/>

# 1.0.6 (20 Feb 2021)

Changes:

- added locales for Russian and Ukrainian languages
- minor UI improvements

<br/>
<br/>

# 1.0.5 (7 Feb 2021)

Changes:

- Fix quality is not set to 100% when sharing started (issue #100)

<br/>
<br/>

# 1.0.4 (4 Feb 2021)

Changes:

- add Flip button in client web view (gear icon button, next to play button) for use a tablet as a teleprompter
- set 100% video quality by default when screen sharing starts
- add polyfills to remove issue of blank pages on old browsers. Thanks @klarkc
- display error message in client viewer if there is WebRTC error

<br/>
<br/>

# 1.0.3 (29 Jan 2021)

Changes:

- remove pulsing animation on orange step bubbles
- portable version on windows
- release draft before publishing release
- remove non-working macOS zip from release

<br/>
<br/>

# 1.0.2 (27 Jan 2021)

Changes:

- Security patches
- Updated electron version to 11.2.1
- fix for issue #45
- ? fix for issue #56
- ? fix for issue #17

<br/>
<br/>

# 1.0.1 (25 Jan 2021)

Changes:

- Fix typos in AltronScreen. Special thanks to @EdwardBetts

<br/>
<br/>

# 1.0.0 (18 Jan 2021)

Features:

- works with WiFi or LAN
- use any device with web browser as second screen for your computer (using Display Dummy Plug)
- use any device web browser to mirror your computer's screen
- use any device web browser to view a single application window from your computer's screen
- supports multiple screen sharing sessions to as many devices as you want
- supports changing picture quality while sharing a screen.
- Picture auto quality change supported. (for performance boost while watching youtube video for example)
- End-to-end security
- dark mode UI support
- available for Win / Mac / Linux
