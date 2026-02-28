<p align="center">
  <img src="src/assets/logo.png" width="200" alt="Commu Logo" />
</p>

# Commu

A modern, fast, and beautifully designed desktop API client built with **React**, **Vite**, and **Electron**. 

Commu (AI API Client) provides an intuitive interface for testing, organizing, and managing your API requests with built-in productivity features:

## ✨ Features

- **Organized Collections**: Nest requests deeply into folders. Drag and drop to reorder or move items easily.
- **Dynamic Workspaces**: Collapsible sidebar, tabs, and adjustable layout panels for a clutter-free environment. All layout resizing and toggles automatically persist across restarts.
- **Smart Environments**: Manage basic URL presets, auth tokens, and specific variables per environment.
  - Mark sensitive variables as **Secrets** to hide their values locally.
  - Default 'No Environment' mode to easily disable interpolation when not needed.
- **Beautiful UI Components**:
  - Hover over inline variables (e.g. `{{baseUrl}}`) anywhere in your request, headers, or body to instantly see their resolved values with a quick-edit button.
  - Multi-line Variable Interpolation support via CodeMirror syntax highlighting.
  - Custom, highly-polished premium dropdowns for Workspaces, Environments, Request Body Type, and Auth Type.
  - Redesigned History cards for a compact, fast overview of past requests.
- **Advanced GitHub Sync**: Safely backup and restore your collections, variables, and workspace state securely to a private `commu-sync` GitHub repository.
  - Interactive Review Screen before pushing allows you to selectively **mask** variables. Masked variables leave your device as placeholders, completely protecting your secrets.
- **Comprehensive Request Builder**: 
  - Visual editors for Query Params, Headers, and Auth.
  - Multi-format request body support (JSON, XML, form-data, urlencoded, raw).
  - Your active request (method, URL, headers, body) fully persists across reloads.
  - **Full-Screen Editing**: Expand the request or response code editors to full-screen mode to get a distraction-free view with natively integrated `Command+F` search functionality.
- **AI Assistant**: Built-in intelligent prompting to generate tests, suggest mock data, and analyze responses.
- **Response Visualization**: View raw data, pretty-printed JSON, tabular data, XML, or CSV exports.
- **Pre & Post Scripts**: Write scripts to run before a request is fired or to assert tests against the response.
- **Import / Export**: Easily share collections via JSON files, text pasting, or direct URL links.

## 🚀 Getting Started Locally

### Prerequisites

Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation

1. Clone or download the repository to your local machine.
2. Open a terminal and navigate to the project directory:
   ```bash
   cd Commu
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

### Running the App in Development Mode

You can run the full Electron desktop app alongside the Vite dev server by running:

```bash
npm run dev
```

*Note: Since the project uses native modules like `better-sqlite3`, if you encounter architecture or Node version mismatches during install, you may need to run `npm run rebuild` to rebuild the SQLite bindings for your specific machine.*

## 📦 Building for Production

This project leverages Vite and Electron Builder. You can compile the project and generate native application binaries for various platforms.

### Desktop Apps (Mac, Windows, Linux)
First, ensure you build the React frontend:
```bash
npm run build
```

Then, use `electron-builder` to package the app for your target OS:

- **macOS (Intel & Apple Silicon)**
  ```bash
  # Builds both x64 and arm64 targets
  npx electron-builder --mac --x64 --arm64
  ```
- **Windows**
  ```bash
  npx electron-builder --win
  ```
- **Linux**
  ```bash
  npx electron-builder --linux
  ```

### Website / Web App
To host the app as a standard website (without Electron's native filesystem APIs):
```bash
npm run build
# The resulting static site will be located in the /dist folder, ready to be deployed.
```

### Mobile Apps (iOS & Android)
Because this is currently architected as an Electron desktop environment, direct compilation to iOS and Android requires porting the web build (`/dist`) via a wrapper framework like **Capacitor** or **Cordova**. 
1. Build the web app: `npm run build`
2. Initialize Capacitor: `npx cap init`
3. Add native platforms: `npx cap add ios` / `npx cap add android`
4. Sync & Build: `npx cap sync` and then open Xcode/Android Studio to compile to device.

## 🛠 Tech Stack

- **Frontend**: React 18, Vite
- **Desktop Environment**: Electron
- **Database / Storage**: `better-sqlite3` (for local persistence)
- **Styling**: Custom CSS with responsive grid layouts and Flexbox.

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's adding a feature, fixing a bug, or improving documentation, your help is appreciated.

Please read our [Contributing Guidelines](CONTRIBUTING.md) to understand how you can help out. Also, make sure to review our [Code of Conduct](CODE_OF_CONDUCT.md).

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
