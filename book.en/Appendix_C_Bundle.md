# Appendix C: Using the Bundled Library

This appendix explains how to load `lib/webg.core.min.js` and convert samples
that use individual modules. Run the commands from the repository root.

## Loading and File Placement

```text
lib/
  webg.core.min.js
  webg.core.min.js.map
  webg.core.js
  webg.core.js.map
  convert_imports.mjs
  build_report.json
  package.json
  package-lock.json
  LICENSE
webg/                     Original source with comments and assets
samples/                  Samples using individual modules
```

For JavaScript at the repository root, use:

```js
import { WebgApp, Shape, Primitive, WaterBody, PbrRenderer }
  from "./lib/webg.core.min.js";
```

Classes use their class names as public export names. Use `WebgApp as App` for a
local alias. Choose `webg.core.js` to inspect bundled code with comments.
Source maps connect bundled code to the original lines and breakpoints in
browser developer tools. Keep the relative layout of `lib/` and `webg/` when
using them.

Both builds use the same APIs. Replace the individual imports shown in the
chapters with named imports from the bundle. Use one loading method for the
core throughout an application, including shared helpers, so that its classes
and module state remain consistent for `instanceof` and collision handling.

## Place the Assets

The bundle combines JavaScript. Images, fonts, models, and environment maps
keep their own URLs. An inline module resolves its imports relative to the
HTML page; an external module resolves them relative to its JavaScript file.
Asset URLs used by `fetch()` or library APIs follow those APIs' URL rules.

Use the HTTP server and WebGPU-capable browser described in Chapter 2.
An application can load the distributed bundle directly. Node.js and the
packages below are tools for converting samples.

## Prepare the Conversion Tool

The tool has been checked with Node.js 22. Install its dependencies:

```bash
npm --prefix lib ci
node lib/convert_imports.mjs --help
```

The script uses `lib/build_report.json` to map original modules to bundle
exports. Use the bundle, converter, and mapping file from the same distribution.

## Preview the Changes

For example, preview conversion of `samples/aquarium/`:

```bash
node lib/convert_imports.mjs samples/aquarium
```

The default mode lists changes. Review the files, number of replacements, and
before-and-after code. `--dry-run` has the same behavior. The tool follows local
JavaScript dependencies, including shared helpers and dynamically loaded files.

## Convert a Copy

Start with a copy that keeps the original samples available for comparison.
Choose a new or empty directory for `--out`:

```bash
node lib/convert_imports.mjs --execute \
  --out user/bundled-samples samples/aquarium samples/water
```

The tool preserves paths relative to the repository root. The copies appear at
`user/bundled-samples/samples/aquarium/` and
`user/bundled-samples/samples/water/`. It copies regular files in the selected
directories, including CSS, models, and documentation, and converts shared
JavaScript dependencies as well. Check assets, CSS, and other URLs outside the
selected directories against the copied layout.

Start the Chapter 2 HTTP server at the repository root and open, for example:

```text
http://localhost:8000/user/bundled-samples/samples/aquarium/aquarium.html
http://localhost:8000/user/bundled-samples/samples/water/water.html
```

Check rendering, camera controls, movement or animation, and effect toggles.
In the developer tools' Network panel, look for `lib/webg.core.min.js` and any
individual core JavaScript requests. If individual core files are still loaded,
review the conversion of shared helpers and dynamic imports.

## Apply Changes to the Originals

After reviewing the preview and testing the copy, omit `--out` to update the
original files and their shared JavaScript dependencies:

```bash
node lib/convert_imports.mjs --execute samples/aquarium
```

Keep the previous state in a commit or backup to compare changes.
`--execute` enables writing. Preview and execution each read the target code
as it exists at that time.

## Import Forms

Default imports and aliases become named imports of the public class name:

```js
// Individual module
import App from "../../webg/WebgApp.js";

// Bundle, when converting the sample in its original location
import { WebgApp as App } from "../../lib/webg.core.min.js";
```

Named exports have unique mapping names. For example:

```js
import { DepthConvention_CAMERA_REVERSE_Z as CAMERA_REVERSE_Z }
  from "../../lib/webg.core.min.js";
```

This preserves the local name and the ES module's live binding. The converter
also handles namespace imports, re-exports, and dynamic imports with literal
paths. In HTML, it processes `type="module"` scripts and preserves the remaining
markup. It retains comments within imports as well.

## Inputs Requiring Review

Review dynamic imports whose paths are variables, unregistered core modules or
exports, import attributes, HTML base elements, core references through URLs or
import maps, and core paths with query strings. The tool reports these cases and
stops before writing changes.

Select the version with comments using `--bundle`:

```bash
node lib/convert_imports.mjs --bundle lib/webg.core.js \
  --out user/bundled-readable samples/water
```

This command previews changes. Add `--execute` to write them. Target paths,
`--bundle`, and `--out` are resolved from the command's working directory.
