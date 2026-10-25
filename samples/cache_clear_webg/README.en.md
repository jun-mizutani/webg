# cache_clear_webg

English | [日本語](README.md)

## Overview

This development utility imports every JavaScript module under `webg` with a unique `?v=...` URL so development pages load updated ES modules.

## How to run

Open [`cache_clear_webg.html`](./cache_clear_webg.html) through a web server and press **Re-import all core modules** (`全coreを再import`). Open the target sample again after the import completes.

The target is the webg core ES modules; other browser HTTP cache entries remain intact. It changes only the import URLs for the `webg` core modules on each run so the browser fetches the current files. Core import statements keep their distribution URLs; this page adds cache queries to the generated loading URLs.

Update the core module list in `main.js` when a module is added under `webg`.
