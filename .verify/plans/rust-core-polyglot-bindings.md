# rust-core-polyglot-bindings

## Target
Transition Project X to a unified Rust core architecture:
1. `crates/project-x-core` serves as the authoritative protocol engine (parsing, validation, DAG, resolution, policy, and audit).
2. `crates/project-x-py` provides PyO3 bindings for Python agent developers (`project_x` module with parse, validate, audit, and execute functions).
3. `crates/project-x-node` provides NAPI-RS native bindings for Node.js/TypeScript developers, ensuring existing TypeScript client interfaces (`ProjectXClient`, `MCPGatewayProxy`) remain fully backwards compatible.
4. Continuous verification via `sh .verify/run.sh all` keeping all reference fixtures immutable.

## Steps
1. **Design PyO3 Crate (`crates/project-x-py`)** | check: `cargo check -p project-x-py` | rollback: `rm -rf crates/project-x-py` and revert `Cargo.toml`
2. **Implement PyO3 Bindings & Tests** | check: `cargo test -p project-x-py` | rollback: `git checkout crates/project-x-py`
3. **Design NAPI-RS Crate (`crates/project-x-node`)** | check: `cargo check -p project-x-node` | rollback: `rm -rf crates/project-x-node` and revert `Cargo.toml`
4. **Implement NAPI-RS Bindings** | check: `cargo test -p project-x-node` | rollback: `git checkout crates/project-x-node`
5. **Bridge TypeScript Layer with Rust Native Bindings** | check: `npm run test` | rollback: `git checkout src/`
6. **Full agstack Verification** | check: `sh .verify/run.sh all` | rollback: inspect failure logs in `.verify/artifacts/`

## Risks
- PyO3 dependency compilation on macOS: likelihood low, impact medium, mitigation: use `pyo3 = { version = "0.22", features = ["extension-module", "abi3-py310"] }`.
- NAPI-RS build setup: likelihood low, impact medium, mitigation: use standard `napi` and `napi-derive` v2.
- Breaking existing Node.js tests: likelihood low, impact high, mitigation: keep high-level TS wrapper APIs identical.

## Order rationale
Implementing Python bindings first proves C-FFI / PyO3 boundary ergonomics on `project-x-core`. Then NAPI-RS bridges Node.js without breaking existing test harnesses.
