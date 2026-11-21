# Project Metropolis

A 3D sand table visualization of your GitHub repositories, built with Three.js and React.

Each repository becomes a connected district on the sand table, with roads linking them. Every text file in each repository becomes a building — height represents lines of code, and footprint represents file size.

## Features

- **Connected districts**: Repositories are laid out with roads connecting them, forming a coherent city
- **Live from GitHub**: Data is fetched directly from the GitHub API at runtime
- **Auto-update**: Automatically refreshes every 5 minutes to reflect repo changes
- **Performance optimized**: Uses instanced rendering for buildings and roads
- **Lazy loading**: Files are fetched and processed incrementally as you watch
- **Interactive**: Drag to rotate, scroll to zoom, hover to inspect buildings

## Tech Stack

- React 19
- Three.js for 3D rendering
- Motion (Framer Motion) for animations
- Tailwind CSS for styling
- Vite for bundling

## Development

```bash
npm install
npm run dev
```

## Deploy

The site is configured for GitHub Pages deployment via GitHub Actions.
