# Runtime Environment

This chapter prepares a local server and a WebGPU-compatible browser so that `webg` samples and your own applications run under the same conditions.
If a page fails to open, check WebGPU API availability, the secure context, and file responses in sequence. This helps distinguish code defects from runtime-environment issues.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you know how to run basic JavaScript and work with files and folders.

### What to read first

Read how to choose a WebGPU-compatible browser, start a local server, and open the first sample.

### What to read when you need it

Refer to the relevant section when investigating secure contexts, GPU (graphics processing unit) features, caching, or network execution.

### What you will learn

You will be able to run `webg` samples and your own HTML in a suitable environment, and distinguish environment issues from application issues.

## Check the runtime requirements

To run `webg`, you need a WebGPU-compatible browser and a web server to deliver HTML, JavaScript, images, and models.
First confirm that `navigator.gpu` is available in a secure context, then open a sample from a local server.
Opening files directly in a browser subjects module and asset loading to browser security restrictions.

This chapter explains how to place `webg` on your machine and run its samples and `unittest` applications.
Prepare a reliable runtime environment first; it is the foundation for understanding the project in Chapter 01 and learning to assemble applications from Chapter 04 onward.

The usual way to use `webg` is to download or clone the complete repository and keep its directory structure intact.
Run samples and `unittest` applications through a local server instead of opening their files directly in a browser.

When direct file access causes an asset load to fail, it can be difficult to determine whether the cause is WebGPU code, browser support, or a path setting.
Start by distinguishing server issues from browser WebGPU support.

## Why a local server is required

`webg` samples combine HTML, JavaScript, JSON, images, and models.
They use scripts such as `main.js` and `webg/*.js` together with external assets such as JSON, textures, glTF (GL Transmission Format) scenes, GLB (the binary glTF format), and Collada files.

When a browser loads these files, the same-origin policy (SOP) and cross-origin resource sharing (CORS) matter.
An origin is the combination of a URL's protocol, host, and port. The same-origin policy restricts access to resources from other origins; CORS lets a server explicitly permit that access.

When a file is opened directly in a browser using the `file://` protocol, its origin is treated differently from that of a regular HTTP page. Many browsers restrict ES module `import` and asset loading through `fetch()` in this context.
The exact restrictions vary by browser. A page may appear while module, texture, or model loading fails.
This book therefore uses a local HTTP server as the standard way to run examples under consistent conditions.

The main files in `webg` that use `fetch()` directly include:

* `webg/Texture.js`
* `webg/ModelAsset.js`
* `webg/SceneAsset.js`
* `webg/Gltf.js`
* `webg/AudioSynth.js`
* `webg/util.js`

To load these files reliably, start a local server such as `http://localhost:8000/` and access them over HTTP.
Relative module imports and asset requests then work like they do on a standard web page.

## Place the files

Keep the repository's relative paths intact so that samples, book examples, core modules, and assets can refer to one another without changes.
Keeping the full layout also makes it easier to compare learning material with the implementation and review changes over time.
Start by obtaining the `webg` repository.

### Using `git clone`

This method is recommended when you want to track updates and keep the latest version.

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

### Copying the folder from a ZIP archive

Download the repository ZIP from GitHub and extract it in your chosen location.
(Download: https://github.com/jun-mizutani/webg/archive/refs/heads/main.zip)

For example, create a working folder named `my_webg` inside the extracted `webg` folder and build your project there. This lets you use the same core import paths as the samples.

```text
webg/
  book/
  samples/
  unittest/
  webg/
  my_webg/
```

Keep the repository root in place when working with the project. Copying only `samples/` or `webg/` breaks the relative paths.

## Load the Bundled Library

Choose between individual modules in `webg/` and the bundled library,
`lib/webg.core.min.js`. Most chapter examples use individual modules so that
readers can find the implementation of each API. Classes and methods work the
same way in the bundle.

Import classes by name. This example assumes `main.js` is at the repository root:

```js
import { WebgApp, Shape, Primitive, WaterBody, PbrRenderer }
  from "./lib/webg.core.min.js";
```

Use `WebgApp as App` to give the class a local alias. Place inline HTML code in a
`<script type="module">` element. In an external JavaScript file, resolve the
import path relative to that file. Serve the application over HTTP as described
in this chapter.

`lib/webg.core.js` is the version with comments. The `.map` files let browser
developer tools trace bundled code back to lines in the original source.
Keep `lib/` and `webg/` in the same relative layout when using these source maps.
Load images, models, and fonts through their own asset URLs.

See [Appendix C](Appendix_C_Bundle.md) to convert an existing sample. Use one
loading method for the core throughout an application, including shared helpers
and dynamic imports, so that its classes and module state remain consistent.

## Run a sample

Use the included samples to confirm that the environment works before running your own code.
If a known sample runs, later problems can be narrowed down to your own changes rather than the browser or server.
Start a local server as described below, then open this URL in a browser:

```text
http://localhost:8000/samples/
```

## Choose how to open a page

Repository files fall into two groups: files that work when opened directly and files that should be served over HTTP.

### Pages that commonly work when opened directly

Static pages such as the following mainly show catalogs or documentation. They do not depend on asset loading or module execution, so they can be opened through `file://`:

* `samples/index.html`
* `unittest/index.html`
* Documentation files

### Pages to open through an HTTP server

Runnable pages like the following use ES modules through `<script type="module">`, load external files through `fetch()`, or initialize WebGPU through `navigator.gpu`. Serve them from a local, LAN, or internet-connected HTTP server:

* Pages that run the minimal code example
* Sample application pages linked from `samples/index.html` or each sample's explanation page
* Most pages under `unittest/*/index.html`
* Runnable pages under `book/examples/`

## Network environments and secure contexts

### Running from a web server on a LAN

You can place the repository on an existing LAN server, for example `http://192.168.1.20/webg/`.
Module imports and `fetch()` work in this setup as well.

WebGPU requires a secure context.
`localhost` is treated as a secure environment by exception, while `navigator.gpu` may be unavailable when HTTP is served through a LAN IP address or hostname.

Assets may load from a LAN server while WebGPU's requirements remain unmet.
In that case, configure HTTPS or use `localhost` for testing.
Check server configuration separately from browser WebGPU support.

### Running from a public web server on the internet

The basic delivery of HTML, ES modules, images, and models is the same on an internet host as it is on a local server.
HTTPS, MIME types, CORS (cross-origin resource sharing), caching, and security restrictions described here also apply to other web pages that use ES modules, `fetch()`, images, models, and WebGPU.

With a hosting service that supports HTTPS and static-file delivery, place the HTML, JavaScript, and assets on the same origin. The service can provide HTTPS and the JavaScript MIME type through its standard settings, so `webg` can be hosted directly.
Begin by keeping the same relative paths as in the local setup and serving everything from one origin.

The following sections help you locate the relevant setting when configuring your own server or investigating a loading error after publication.

#### Serve the page and all resources over HTTPS

The requirement to expose `navigator.gpu`, WebGPU's entry point, in a secure context is defined by the WebGPU API itself.
`localhost` is treated as secure for development, while a public page on the internet should be served over HTTPS with a valid certificate.

Even when the public HTML page uses HTTPS, the browser may reject JavaScript, images, JSON, GLB files, and other resources loaded over `http://` as mixed content.
Use the same HTTPS origin for referenced resources, or an approved separate origin that also serves HTTPS.

#### Match public URLs to relative paths

Resolving relative imports and `fetch()` URLs against the published directory structure is standard ES module and web-page behavior.
`webg` follows the same rules.
When placing the repository in a subdirectory such as `https://example.com/webg/`, preserve the relative layout of `samples/`, `webg/`, images, and models.

Public servers commonly distinguish uppercase and lowercase letters in file names.
A mismatch such as `WebgApp.js` versus `webgapp.js` may work locally and return `404 Not Found` after publication.
Make strings in HTML, import statements, and `fetch()` match the actual file names.

Some servers return the site's shared `index.html` with status `200` for an unknown URL.
When a JavaScript or JSON URL is wrong, the browser may receive HTML instead of a `404`, resulting in a MIME type error, `Unexpected token '<'`, or a JSON parse error.
In the Network panel, check the Request URL, Status, Content-Type, and Response to confirm that the server returned the requested file.

#### Serve ES modules with the correct MIME type

Every browser requires JavaScript files loaded as ES modules to use a JavaScript MIME type.
`webg` does not require a special Content-Type; use the same type as for ordinary JavaScript, such as `text/javascript`.
The extension `.js` alone does not set the response type: the server must return an appropriate JavaScript MIME type. If it returns `text/plain` or `text/html`, the browser stops module execution.

```text
Content-Type: text/javascript
```

Configure the server to return the appropriate Content-Type for HTML, JSON, images, fonts, and models as well.
For hosting services that do not recognize extensions or use custom static-file settings, check the response headers in the Network panel.

#### Choose a caching policy for publication

As on other websites, public servers and CDNs can store responses in intermediate caches as well as in the browser.
HTML tells users which JavaScript URLs to load, so use a short cache lifetime or revalidation to make updates easy to pick up.
JavaScript, images, and models whose URLs include a content hash or version can be cached for longer, because their URLs change when their content changes.

If your process replaces content at the same URL, configure `Cache-Control` so HTML and JavaScript can be revalidated, and purge or invalidate the CDN cache as needed. Manage update delivery through HTTP caching and the hosting platform, while keeping source URLs stable.
After publication, confirm the final Request URL, Status, response headers, and response body in the Network panel rather than relying only on your own browser's display.

## Start a local server

Run the following command with the repository root as the current directory:

```bash
cd /path/to/webg
```

### Example commands by operating system

Each command serves the repository root over HTTP. Choose the method that fits your OS and installed runtime. One server can serve the entire repository.

#### Mac / Linux

Python 3's built-in server is the simplest option for most users.

```bash
# Use Python 3
python3 -m http.server 8000

# Use Node.js (npx)
npx http-server . -p 8000

# Use PHP
php -S 127.0.0.1:8000
```

The Node.js alternative uses `npx` to run `http-server`.
If the package is not already installed or cached, `npx` needs a network connection to download it.
To run without an external connection, use an already installed Python 3 or PHP server.

#### Windows

On Windows, the Python Launcher (`py`) is a convenient option.

```powershell
# Use the Python Launcher
py -m http.server 8000

# Call Python 3 directly
python -m http.server 8000

# Use Node.js (npx)
npx http-server . -p 8000
```

After starting the server, open either `http://127.0.0.1:8000/samples/index.html` or `http://localhost:8000/samples/index.html` in your browser.

If the port conflicts with another application, replace `8000` with another number such as `9000`.

## Recommended verification sequence

After preparing the environment, check it in stages before trying a complex sample. This makes problems easier to isolate.

1. Open `samples/index.html` to confirm that the server is running and serving files.
2. Run the `low_level` sample to confirm that minimal WebGPU rendering works.
3. Run the `high_level` sample to confirm the standard `WebgApp` structure and application foundation.
4. Run the `scene_model_yaml` sample to confirm that SceneYAML and ModelYAML load correctly, along with their assets.
5. Continue with detailed samples for your goal, such as `sound`, `bloom`, or `dof`.

## Troubleshooting

If an application fails on a local, LAN, or public server, first distinguish server issues from browser WebGPU support.

### Separate server issues from WebGPU issues

* To investigate the server:
  - Does the catalog page open at its URL?
  - Does the browser console show `404 Not Found` or a CORS error?
  - Did you accidentally set an intermediate repository folder, such as `samples/scene/`, as the server root?
* To investigate WebGPU support:
  - Does `navigator.gpu` appear as `undefined` in the browser console?
  - Did `webg/Screen.js` fail to initialize WebGPU?

Return to the minimal `low_level` sample to quickly determine whether the problem is asset loading or the WebGPU runtime environment.

### Browser cache issues

A browser cache stores HTML, JavaScript, images, and other responses so it can reuse them when the same URL is opened again.
This speeds up page display and reduces network traffic by avoiding repeated transfers of every file.
Caching is a normal feature for browsing and published applications.

During development, however, a browser may reuse a saved response after you change the contents of HTML, JavaScript, or an image without changing its URL. The changed file may then appear not to take effect.
If WGSL is embedded in JavaScript, a cached JavaScript response also contains the old WGSL.
If WGSL is fetched as a separate file, a stale response may remain at that URL as well.

Symptoms include an unchanged display after a code edit, logs that were removed but still appear, missing newly added methods, or WebGPU validation errors caused by mismatched versions of application JavaScript and the library.
Before editing the code again, check whether the browser actually loaded the edited file.

#### Check the reload and Network panel

First reload without using the cache.
If the display remains unchanged, check the target file's Request URL, Status, source, and Response body in the Network panel.
If the edited contents still do not arrive, investigate the Service Worker and site data.

A normal reload may reuse a saved response. To inspect the latest files, do a hard reload with the cache disabled:

1. Hold Shift while clicking the browser's Reload button.
2. Open Developer Tools, enable `Disable cache` in the Network panel, and reload the page.

Names and controls vary by browser.
The second method disables caching only while Developer Tools is open, so regular browsing retains its cache, and the Network panel stays available for checking the response.

Use this sequence in the Network panel to identify which files were used:

1. Clear earlier network records in the Network panel.
2. Reload the page with `Disable cache` enabled.
3. Enter the changed file name, such as `main.js` or `WebgApp.js`, in the Filter field.
4. Confirm that the Request URL matches the expected URL on the running HTTP server.
5. Confirm that Status is `200` and that Size or Transferred does not say `memory cache` or `disk cache`.
6. Select the request, open Response, and check for an edited function name, comment, or value.

Status `304` means the browser asked the server whether the resource had changed, the server reported that it had not, and the browser reused the saved response body.
When investigating the exact latest source, reload with the cache disabled and confirm that the edited content appears in the Response for a `200` request.

If the target file does not appear in the Network panel, check that the open HTML imports it.
If its Request URL points to another server or directory, check the HTML import, the URL opened in the browser, and the directory from which the HTTP server was started.
If the Response contains old content, confirm that the HTTP server is reading the same file you edited, in addition to checking the browser cache.

#### Keep manual cache identifiers out of module URLs

In webg source, samples, and `unittest` applications, JavaScript is loaded through its normal relative URL. Keep the HTML entry module and JavaScript imports free of query strings, as in these examples:

```html
<script type="module" src="./main.js"></script>
```

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
```

This rule preserves module identity. In ES modules, the full URL, including any query string, identifies a module. If a cache-busting query is added to only one URL for what appears to be the same `Shape.js`, the browser evaluates it as a separate module. Its classes, prototypes, static fields, registries, and caches are then separate instances as well.

WebgApp assigns initialized shaders to the Shape class. When WebgApp and the application import Shape from the same URL, they share the same class, `instanceof` checks, singleton GPU resources, and module-level pipeline cache. If they import different URLs, the mismatch appears after loading as a shader setup or type-checking problem. Keeping URLs consistent makes the cause easier to trace.

If you suspect stale JavaScript during development, keep the source URL fixed and reload with `Disable cache` enabled in the Network panel, as described above. Check the Request URL, `200` status, transfer source, and Response body to determine whether the edited source ran. Use browser cache controls to verify updates; avoid adding a manual query, timestamp, or random value to the source URL. This checks for stale files while preserving module identity.

Keep import URLs fixed after publication, too. When replacing content at the same URL, use `Cache-Control` revalidation for HTML and JavaScript and invalidate the CDN as needed. If a build system is introduced later to produce content-hashed file names, have the build update imports throughout the dependency graph so every reference to a module resolves to the same generated URL. Centralize versioning in the build or server cache controls.

Query parameters remain useful for application inputs such as search conditions. This section concerns manual cache identifiers added only to make the same JavaScript source appear under different URLs.

#### Clear the cache in iPhone Safari

If iPhone Safari still shows old content after a normal reload, close and reopen Safari, then revisit the page.
Next, check whether your iOS version offers a way to remove data for only the affected site.
Menu names and available clearing options vary by iOS version.
If site-specific removal is unavailable and the content remains stale, use the broad clearing option only as a last resort: open Settings, go to Apps, select Safari, then choose Clear History and Website Data.

```text
Settings / Apps / Safari / Clear History and Website Data
```

This operation affects browsing history and website data saved by Safari, beyond the `webg` page.
It can affect login sessions on other sites, so first try a regular reload or reopening the page, and clear site data only if the stale state persists.
After clearing, reopen the target URL in Safari and check the updated display and behavior.

## Summary

This chapter established the basic development setup for `webg`: preserve the repository's relative paths and run it through a local server.

Static pages can be viewed through `file://`, but pages that render a scene require ES modules, `fetch()`, or WebGPU initialization and should be served over HTTP or HTTPS under the correct conditions.
On a LAN server, check the secure context. On a public server, check HTTPS, MIME types, published paths, and caching.
With these runtime requirements clear, you can distinguish implementation issues from execution-environment issues as you continue learning.

Chapter 03 introduces object positions and rotations, parent and child coordinates, camera distance and field of view, surface normals, and UVs. Chapter 04 uses these concepts to display the first cube. Chapter 41 explains matrix and quaternion calculations in detail.
