# Portiq Mobile Packaging Plan

Portiq currently ships as an Electron desktop application.

That means this repository can produce desktop installers such as:

- macOS `.dmg`
- Windows `.exe`
- Linux `.AppImage`, `.deb`, `.rpm`

It cannot directly produce an Android `.apk` from the current codebase.

## Why APK Is Not Available Today

Electron targets desktop runtimes, not Android native packaging. To ship Portiq on Android, we would need a dedicated mobile shell and packaging pipeline.

## Recommended Android Paths

### Option 1: Capacitor Wrapper

Best fit if we want to reuse the current React UI heavily.

What it would require:

- extract the UI into a browser-safe mobile surface
- replace Electron-only APIs with a mobile bridge
- move local persistence to a mobile-friendly layer
- add Android packaging/signing with Capacitor

Good for:

- faster mobile MVP
- UI reuse
- lighter engineering lift than a full native rewrite

### Option 2: React Native Client

Best fit if we want a stronger native mobile experience.

What it would require:

- separate mobile app shell
- shared business logic where possible
- native networking, storage, auth, and file handling

Good for:

- best Android UX
- stronger long-term mobile product

### Option 3: Progressive Web App / TWA

Best fit for a lighter mobile access path.

What it would require:

- make the app fully browser-safe
- remove Electron dependencies from the runtime path
- add offline and installability support

Good for:

- low-friction access
- faster experimentation

## Recommended Approach

For Portiq, the most practical path is:

1. keep desktop releases on Electron
2. introduce a browser-safe abstraction for Electron APIs
3. evaluate Capacitor first for Android packaging

## Suggested Milestones

1. Separate renderer logic from Electron-only APIs
2. Define a shared storage/auth/network abstraction
3. Build a browser-safe preview target
4. Create a Capacitor Android shell
5. Add APK signing and release automation
