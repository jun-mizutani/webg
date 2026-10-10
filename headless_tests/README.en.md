# Headless Tests

English | [日本語](README.md)

`headless_tests` checks deterministic webg contracts without launching a browser. It is designed for quick Node.js iteration, regression checks after core changes, and fixed API, resource, and numeric rules.

## Complementary checks

Headless tests cover deterministic contracts. Complete verification with checks suited to the browser and application:

- Use a real WebGPU device to check shader compilation, pipeline validation, and GPU execution
- Use browser checks for canvas, DOM, pointer, touch, and audio integration
- Inspect rendering quality, interaction, effects, and performance in the running application
- Run applications in `unittest/`, `samples/`, or `book/examples/` as appropriate

A passing headless run confirms its API and numeric contracts. Browser checks confirm the rendered result and user interaction.
## Directories

- `core/<core_name>/`: contracts for the owning module in `webg/*.js`
- `integration/<topic>/`: rules spanning multiple core modules and rendering boundaries
- `samples/<sample_name>/`: static contracts for sample startup code and API usage
- `diagnostics/<topic>/`: probes for numeric investigations and fault isolation

Core suite names generally use the target module name in snake_case. For example, `webg/CameraFrame.js` is covered by `core/camera_frame/`, and `webg/ComputeBlurPass.js` by `core/compute_blur_pass/`.

Contracts added during a version migration are owned by the current core, so they do not use time-dependent prefixes such as `v2_`. When one core has multiple concerns, separate them by case name, as in `api_contracts.js`, `depth_contracts.js`, and `hdr_contracts.js`.

## Running the tests

Run the full suite from the repository root:

```sh
node --experimental-default-type=module headless_tests/run_all.js
```

Run one core suite:

```sh
node --experimental-default-type=module headless_tests/core/physics_space/headless_probe.js
```

To inspect one case, run its `*_contracts.js` file directly:

```sh
node --experimental-default-type=module headless_tests/core/camera_frame/api_contracts.js
```

`run_all.js` starts each suite in a separate process, and each suite also starts its cases in separate processes. This keeps mocks, globals, and module cache state from leaking between cases.

## Adding and organizing tests

1. Identify the `webg/*.js` module that owns the contract and add it to that core's suite.
2. Use `integration/` only when the boundary between multiple cores is the subject.
3. Put checks of sample source structure in `samples/`; they are not core contracts.
4. Put numeric probes used for implementation research in `diagnostics/` when they do not fit a pass/fail contract.
5. Combine small probes into one suite when they inspect the same setup and subject.
6. Keep browser-specific checks in the browser when extensive mocks would hide the actual contract.

Current ownership and coverage gaps are recorded in `COVERAGE.md`. A `.txt` beside a test case records its original verification notes; this README defines the current organization and execution method.
