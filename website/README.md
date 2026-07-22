# Portiq Website

This is a standalone static website for Portiq. It is intentionally separate from the app source so you can host it independently on a free static hosting platform.

## Files

- `index.html` - landing page markup; includes an inline `<script>` in `<head>` that applies the saved theme before first paint (prevents flash of wrong theme), plus the click-handler toggle script at end of `<body>`
- `styles.css` - layout, spacing, responsive behavior, and light/dark theme styles
- `assets/portiq-logo.png` - local logo used by the site
- `screenshots/` - product screenshots used in the gallery

## Free Hosting Options

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

## Quick Local Preview

Open `index.html` directly in a browser, or serve the folder with any static file server.

Example:

```bash
npx serve website
```

## Direct Download Links

The download buttons in `index.html` should point to the exact GitHub release asset URLs, for example:

- `https://github.com/<owner>/<repo>/releases/download/v0.6.2/Portiq-0.6.2-mac-arm64.dmg`
- `https://github.com/<owner>/<repo>/releases/download/v0.6.2/Portiq-0.6.2-win-x64.exe`
- `https://github.com/<owner>/<repo>/releases/download/v0.6.2/Portiq-0.6.2-linux-x86_64.AppImage`

Replace those placeholders with the real repository path and exact packaged artifact names from your release output.
