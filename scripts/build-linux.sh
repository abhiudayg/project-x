#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-aarch64-unknown-linux-musl}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building static Linux binary for target: ${TARGET}"
cd "${PROJECT_ROOT}"

if command -v cross >/dev/null 2>&1; then
    cross build --release --target "${TARGET}" -p project-x-cli
    mkdir -p "${PROJECT_ROOT}/target/linux"
    cp "${PROJECT_ROOT}/target/${TARGET}/release/project-x" "${PROJECT_ROOT}/target/linux/project-x"
    echo "Static binary written to ${PROJECT_ROOT}/target/linux/project-x"
else
    echo "Note: 'cross' tool not installed. To build static Linux binaries on macOS, install cross via:"
    echo "  cargo install cross --git https://github.com/cross-rs/cross"
    echo "Attempting cargo build directly..."
    rustup target add "${TARGET}" || true
    cargo build --release --target "${TARGET}" -p project-x-cli || {
        echo "Direct musl build failed on macOS host. Cross-compilation requires cross or a Linux builder container."
        exit 1
    }
fi
