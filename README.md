# AI API Client (Commu)

A modern, fast, and beautifully designed desktop API client built with **React**, **Vite**, and **Electron**. 

It provides an intuitive interface for testing, organizing, and managing your API requests with built-in environments, collection management, and an AI-powered assistant.

## ✨ Features

- **Organized Collections**: Nest requests deeply into folders. Drag and drop to reorder or move items easily.
- **Dynamic Workspaces**: Collapsible sidebar, tabs, and adjustable layout panels for a clutter-free environment. All layout resizing and toggles automatically persist across restarts.
- **Smart Environments**: Manage basic URL presets, auth tokens, and specific variables per environment.
  - Mark sensitive variables as **Secrets** to hide their values.
- **Beautiful Environment Management**:
  - Hover over inline variables (e.g. `{{baseUrl}}`) anywhere in your request, headers, or body to instantly see their resolved values with a quick-edit button.
  - Multi-line Variable Interpolation support via CodeMirror syntax highlighting.
  - Command your data via an overhauled, modern two-pane Manage Environments grid modal.
- **GitHub Sync**: Safely backup and restore your collections and environments directly to a private GitHub Gist.
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

To compile the React front-end using Vite before packaging the Electron app:

```bash
npm run build
```

*(Note: Additional Electron packager/builder dependencies may be required to generate final `.app` or `.exe` distribution files depending on your target platform.)*

## 🛠 Tech Stack

- **Frontend**: React 18, Vite
- **Desktop Environment**: Electron
- **Database / Storage**: `better-sqlite3` (for local persistence)
- **Styling**: Custom CSS with responsive grid layouts and Flexbox.
