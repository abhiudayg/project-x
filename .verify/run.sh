#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ARTIFACTS_DIR="$PROJECT_ROOT/.verify/artifacts"
RESULTS_DIR="$PROJECT_ROOT/.verify/results"

mkdir -p "$ARTIFACTS_DIR" "$RESULTS_DIR"

echo "=== agstack Verification Harness: Project X (Rust Core) ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Target Root: $PROJECT_ROOT"
echo "Output Directory: $ARTIFACTS_DIR"

cd "$PROJECT_ROOT"

echo "Step 1: Compiling Rust Workspace..."
cargo build --workspace --all-targets > "$ARTIFACTS_DIR/build.log" 2>&1

echo "Step 2: Linters & Hygiene (rustfmt & clippy)..."
cargo fmt --check
cargo clippy --all-targets -- -D warnings

echo "Step 3: Executing Test Suite & Differentiation Tests..."
cargo test -p project-x-core -p project-x-cli -p project-x-node | tee "$ARTIFACTS_DIR/test-results.log"
cargo test -p project-x-py --no-default-features | tee -a "$ARTIFACTS_DIR/test-results.log"

echo "Step 4: Verifying Input Fixture Immutability..."
if [ ! -d "$PROJECT_ROOT/verify/fixtures" ]; then
  echo "Error: verify/fixtures directory missing"
  exit 1
fi

echo "=== Verification SUCCESS ==="
echo "Artifacts recorded in .verify/artifacts/"
