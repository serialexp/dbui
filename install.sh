#!/bin/bash
# ABOUTME: Universal installer script for DBUI
# ABOUTME: Downloads and installs the appropriate release for the current platform

set -euo pipefail

REPO="serialexp/dbui"
APP_NAME="dbui"
DISPLAY_NAME="DBUI"
ICON_URL="https://raw.githubusercontent.com/${REPO}/main/src-tauri/icons/icon.png"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}warning:${NC} $1"; }
error() { echo -e "${RED}error:${NC} $1" >&2; exit 1; }

# Create desktop entry for Linux systems that support XDG
create_desktop_entry() {
    local bin_path="$1"
    local icon_dir="${HOME}/.local/share/icons/hicolor/256x256/apps"
    local desktop_dir="${HOME}/.local/share/applications"
    local icon_path="${icon_dir}/${APP_NAME}.png"
    local desktop_path="${desktop_dir}/${APP_NAME}.desktop"

    # Check if the system supports XDG desktop entries
    if [[ ! -d "${HOME}/.local/share" ]]; then
        warn "XDG data directory not found, skipping desktop entry creation"
        return 0
    fi

    info "Creating desktop entry..."

    # Create directories if needed
    mkdir -p "$icon_dir"
    mkdir -p "$desktop_dir"

    # Download icon
    if curl -sL "$ICON_URL" -o "$icon_path" 2>/dev/null; then
        info "Downloaded application icon"
    else
        warn "Could not download icon, desktop entry will use generic icon"
        icon_path=""
    fi

    # Create desktop entry file
    cat > "$desktop_path" << EOF
[Desktop Entry]
Name=${DISPLAY_NAME}
Comment=Database User Interface
Exec=${bin_path}
Icon=${icon_path:-application-x-executable}
Type=Application
Categories=Development;Database;
Terminal=false
StartupWMClass=${APP_NAME}
EOF

    # Make desktop entry executable (required by some desktop environments)
    chmod +x "$desktop_path"

    # Update desktop database if available
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "$desktop_dir" 2>/dev/null || true
    fi

    info "Desktop entry created at ${desktop_path}"
}

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="macos" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) error "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}-${arch}"
}

# Get the latest release version from GitHub
get_latest_version() {
    local version
    version=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" |
              grep '"tag_name":' |
              sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')

    if [[ -z "$version" ]]; then
        error "Failed to fetch latest version from GitHub"
    fi

    echo "$version"
}

# Install on Linux
install_linux() {
    local version="$1"
    local arch="$2"

    info "Fetching release assets..."
    local assets_json
    assets_json=$(curl -sL "https://api.github.com/repos/${REPO}/releases/tags/${version}")

    # Try to find AppImage first (most portable)
    local asset_name
    asset_name=$(echo "$assets_json" | grep -o "\"name\": *\"[^\"]*\.AppImage\"" | sed 's/"name": *"\(.*\)"/\1/' | head -1)

    if [[ -z "$asset_name" ]]; then
        # Fall back to .deb
        asset_name=$(echo "$assets_json" | grep -o "\"name\": *\"[^\"]*_amd64\.deb\"" | sed 's/"name": *"\(.*\)"/\1/' | head -1)

        if [[ -z "$asset_name" ]]; then
            error "Could not find Linux installation package"
        fi
    fi

    local url="https://github.com/${REPO}/releases/download/${version}/${asset_name}"
    local tmp_dir
    tmp_dir=$(mktemp -d)

    info "Downloading ${APP_NAME} ${version}..."
    curl -sL "$url" -o "${tmp_dir}/${asset_name}"

    if [[ "$asset_name" == *.AppImage ]]; then
        # Install AppImage
        local bin_dir
        if [[ -w "/usr/local/bin" ]]; then
            bin_dir="/usr/local/bin"
        else
            bin_dir="${HOME}/.local/bin"
            mkdir -p "$bin_dir"
        fi

        info "Installing AppImage to ${bin_dir}..."
        mv "${tmp_dir}/${asset_name}" "${bin_dir}/${APP_NAME}"
        chmod +x "${bin_dir}/${APP_NAME}"

        # Create desktop entry for application menu integration
        create_desktop_entry "${bin_dir}/${APP_NAME}"

        info "Installation complete!"
        echo ""
        echo "  Binary installed to: ${bin_dir}/${APP_NAME}"
        echo "  Desktop entry: ~/.local/share/applications/${APP_NAME}.desktop"
        echo ""

        # Check if bin_dir is in PATH
        if [[ ":$PATH:" != *":${bin_dir}:"* ]]; then
            warn "${bin_dir} is not in your PATH"
            echo "  Add it with: export PATH=\"\$PATH:${bin_dir}\""
        fi
    elif [[ "$asset_name" == *.deb ]]; then
        # Install .deb
        info "Installing .deb package..."
        if command -v apt &> /dev/null; then
            sudo apt install -y "${tmp_dir}/${asset_name}"
            info "Installation complete!"
        else
            error ".deb package found but apt is not available"
        fi
    fi

    rm -rf "$tmp_dir"
}

# Install on macOS
install_macos() {
    local version="$1"
    local arch="$2"

    info "Fetching release assets..."
    local assets_json
    assets_json=$(curl -sL "https://api.github.com/repos/${REPO}/releases/tags/${version}")

    # Find the appropriate DMG for this architecture
    local asset_name
    if [[ "$arch" == "aarch64" ]]; then
        asset_name=$(echo "$assets_json" | grep -o "\"name\": *\"[^\"]*aarch64[^\"]*\.dmg\"" | sed 's/"name": *"\(.*\)"/\1/' | head -1)
    else
        asset_name=$(echo "$assets_json" | grep -o "\"name\": *\"[^\"]*x64[^\"]*\.dmg\"" | sed 's/"name": *"\(.*\)"/\1/' | head -1)
    fi

    if [[ -z "$asset_name" ]]; then
        error "Could not find macOS DMG for architecture: ${arch}"
    fi

    local url="https://github.com/${REPO}/releases/download/${version}/${asset_name}"
    local tmp_dir
    tmp_dir=$(mktemp -d)
    local dmg_path="${tmp_dir}/${APP_NAME}.dmg"

    info "Downloading ${APP_NAME} ${version}..."
    curl -sL "$url" -o "$dmg_path"

    info "Mounting DMG..."
    local mount_point
    mount_point=$(hdiutil attach -nobrowse -readonly "$dmg_path" 2>/dev/null | grep "/Volumes" | cut -f3)

    if [[ -z "$mount_point" ]]; then
        error "Failed to mount DMG"
    fi

    info "Installing to /Applications..."
    local app_path="/Applications/${DISPLAY_NAME}.app"

    # Find the .app bundle in the mounted DMG
    local app_bundle
    app_bundle=$(find "$mount_point" -maxdepth 1 -name "*.app" -type d | head -1)

    if [[ -z "$app_bundle" ]]; then
        hdiutil detach "$mount_point" -quiet
        error "Could not find .app bundle in DMG"
    fi

    # Remove existing installation
    if [[ -d "$app_path" ]]; then
        rm -rf "$app_path"
    fi

    cp -R "$app_bundle" "/Applications/"

    info "Unmounting DMG..."
    hdiutil detach "$mount_point" -quiet

    rm -rf "$tmp_dir"

    info "Installation complete!"
    echo ""
    echo "  App installed to: ${app_path}"
    echo "  Launch from Applications or Spotlight"
}

# Install on Windows
install_windows() {
    local version="$1"

    info "Fetching release assets..."
    local assets_json
    assets_json=$(curl -sL "https://api.github.com/repos/${REPO}/releases/tags/${version}")

    local asset_name
    asset_name=$(echo "$assets_json" | grep -o "\"name\": *\"[^\"]*\.msi\"" | sed 's/"name": *"\(.*\)"/\1/' | head -1)

    if [[ -z "$asset_name" ]]; then
        error "Could not find Windows MSI installer"
    fi

    local url="https://github.com/${REPO}/releases/download/${version}/${asset_name}"

    echo ""
    echo "Windows installation via this script is not fully supported."
    echo "Please download manually from:"
    echo "  $url"
    echo ""
    echo "Or use PowerShell:"
    echo "  Invoke-WebRequest -Uri '$url' -OutFile '${asset_name}'"
    echo "  Start-Process msiexec.exe -Wait -ArgumentList '/i ${asset_name} /quiet'"
}

main() {
    echo ""
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║          DBUI Installer               ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo ""

    local platform
    platform=$(detect_platform)
    info "Detected platform: ${platform}"

    local version
    version=$(get_latest_version)
    info "Latest version: ${version}"

    case "$platform" in
        linux-x86_64|linux-aarch64)
            install_linux "$version" "${platform#linux-}"
            ;;
        macos-x86_64)
            install_macos "$version" "x86_64"
            ;;
        macos-aarch64)
            install_macos "$version" "aarch64"
            ;;
        windows-x86_64)
            install_windows "$version"
            ;;
        *)
            error "No installation method for platform: ${platform}"
            ;;
    esac
}

main "$@"
