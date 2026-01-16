# DBUI

A cross-platform database UI application built with Tauri, SolidJS, and TypeScript.

## Installation

### Quick Install (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/serialexp/dbui/main/install.sh | bash
```

### Manual Installation

Download the appropriate installer for your platform from the [releases page](https://github.com/serialexp/dbui/releases):

- **macOS**: Download the `.dmg` file for your architecture (Apple Silicon or Intel)
- **Windows**: Download and run the `.msi` installer
- **Linux**: Download the `.AppImage` or `.deb` package

## Development

### Prerequisites

- Node.js (LTS version)
- pnpm
- Rust (latest stable)
- Platform-specific dependencies:
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
just dev

# Build for production
just build
```

### Available Commands

```bash
just dev                      # Run in development mode
just build                    # Build for production
just build-macos-arm          # Build for macOS Apple Silicon
just build-macos-intel        # Build for macOS Intel
just build-macos-universal    # Build for both macOS architectures
just icons                    # Regenerate icons from SVG
just clean                    # Clean build artifacts
just test-install             # Test the install script
```

## Building Releases

The project uses GitHub Actions to build releases for all platforms. To create a release:

1. Create and push a tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. GitHub will automatically build packages for:
   - macOS (Apple Silicon and Intel)
   - Linux (AppImage and .deb)
   - Windows (MSI installer)

3. A draft release will be created with all artifacts attached

## IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
