# ABOUTME: Task runner for DBUI project.
# ABOUTME: Run `just --list` to see available commands.

# Generate all icon formats from the SVG source
icons:
    #!/usr/bin/env bash
    set -euo pipefail
    cd src-tauri/icons

    echo "Generating PNGs..."
    rsvg-convert -w 32 -h 32 icon.svg -o 32x32.png
    rsvg-convert -w 128 -h 128 icon.svg -o 128x128.png
    rsvg-convert -w 256 -h 256 icon.svg -o 128x128@2x.png
    rsvg-convert -w 512 -h 512 icon.svg -o icon.png
    rsvg-convert -w 30 -h 30 icon.svg -o Square30x30Logo.png
    rsvg-convert -w 44 -h 44 icon.svg -o Square44x44Logo.png
    rsvg-convert -w 71 -h 71 icon.svg -o Square71x71Logo.png
    rsvg-convert -w 89 -h 89 icon.svg -o Square89x89Logo.png
    rsvg-convert -w 107 -h 107 icon.svg -o Square107x107Logo.png
    rsvg-convert -w 142 -h 142 icon.svg -o Square142x142Logo.png
    rsvg-convert -w 150 -h 150 icon.svg -o Square150x150Logo.png
    rsvg-convert -w 284 -h 284 icon.svg -o Square284x284Logo.png
    rsvg-convert -w 310 -h 310 icon.svg -o Square310x310Logo.png
    rsvg-convert -w 50 -h 50 icon.svg -o StoreLogo.png

    echo "Generating macOS icns..."
    mkdir -p icon.iconset
    rsvg-convert -w 16 -h 16 icon.svg -o icon.iconset/icon_16x16.png
    rsvg-convert -w 32 -h 32 icon.svg -o icon.iconset/icon_16x16@2x.png
    rsvg-convert -w 32 -h 32 icon.svg -o icon.iconset/icon_32x32.png
    rsvg-convert -w 64 -h 64 icon.svg -o icon.iconset/icon_32x32@2x.png
    rsvg-convert -w 128 -h 128 icon.svg -o icon.iconset/icon_128x128.png
    rsvg-convert -w 256 -h 256 icon.svg -o icon.iconset/icon_128x128@2x.png
    rsvg-convert -w 256 -h 256 icon.svg -o icon.iconset/icon_256x256.png
    rsvg-convert -w 512 -h 512 icon.svg -o icon.iconset/icon_256x256@2x.png
    rsvg-convert -w 512 -h 512 icon.svg -o icon.iconset/icon_512x512.png
    rsvg-convert -w 1024 -h 1024 icon.svg -o icon.iconset/icon_512x512@2x.png
    iconutil -c icns icon.iconset
    rm -rf icon.iconset

    echo "Generating Windows ico..."
    rsvg-convert -w 16 -h 16 icon.svg -o icon_16.png
    rsvg-convert -w 24 -h 24 icon.svg -o icon_24.png
    rsvg-convert -w 32 -h 32 icon.svg -o icon_32.png
    rsvg-convert -w 48 -h 48 icon.svg -o icon_48.png
    rsvg-convert -w 64 -h 64 icon.svg -o icon_64.png
    rsvg-convert -w 256 -h 256 icon.svg -o icon_256.png
    magick icon_16.png icon_24.png icon_32.png icon_48.png icon_64.png icon_256.png icon.ico
    rm icon_16.png icon_24.png icon_32.png icon_48.png icon_64.png icon_256.png

    echo "Done!"

# Run the app in development mode
dev:
    pnpm run tauri dev

# Build the app for production
build:
    pnpm run tauri build
