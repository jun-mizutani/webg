// Diagnostic instrumentation is injected into responses; production modules stay unchanged.
const { chromium } = require(require.resolve('playwright', { paths: ['C:/Users/01662j-mizutani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on('pageerror', e => console.log('ERROR', e.message));
    await page.addInitScript(() => {
      globalThis.timings = [];
      globalThis.measure = async (name, f) => { const t = performance.now(); try { return await f(); } finally { timings.push({ name, ms: +(performance.now()-t).toFixed(1) }); } };
    });
    await page.route('**/WebgSceneApp.js', async route => {
      const response = await route.fetch(); let body = await response.text();
      for (const [name, code] of [['webg-init','this.app.init()'], ['scene','this.buildScene()'], ['renderer-ready','this.renderer.waitUntilReady()'], ['physics','this.buildPhysics()']]) {
        body = body.replace(`await ${code}`, `await measure('${name}', () => ${code})`);
      }
      body = body.replace('this.renderer = new PbrRenderer(this.app.getGPU(), rendererOptions);', "{ const t = performance.now(); this.renderer = new PbrRenderer(this.app.getGPU(), rendererOptions); timings.push({name:'renderer-constructor',ms:performance.now()-t}); }");
      await route.fulfill({ response, body });
    });
    await page.route('**/PbrRenderer.js', async route => {
      const response = await route.fetch(); let body = await response.text();
      body = body.replace(
        'const sourceRadiance = createProceduralEnvironmentRadiance(this.environmentOptions);',
        "const sourceStarted = performance.now(); const sourceRadiance = createProceduralEnvironmentRadiance(this.environmentOptions); timings.push({name:'environment-radiance-cpu',ms:+(performance.now()-sourceStarted).toFixed(1)});"
      );
      body = body.replace(
        'this.environmentCompute.encode(environmentEncoder, sourceRadiance);',
        "const computeStarted = performance.now(); this.environmentCompute.encode(environmentEncoder, sourceRadiance);"
      );
      body = body.replace(
        'this.environment = this.environmentCompute;',
        "timings.push({name:'environment-compute-ready',ms:+(performance.now()-computeStarted).toFixed(1)}); this.environment = this.environmentCompute;"
      );
      await route.fulfill({response,body});
    });
    await page.goto('http://127.0.0.1:8765/samples/karakuri/karakuri_maker.html');
    await page.waitForFunction(() => !document.getElementById('try').disabled, null, {timeout:120000});
    console.log('initial', await page.evaluate(() => timings.splice(0)));
    for (const [button,ready] of [['try','pause'],['back-edit','try'],['try','pause'],['back-edit','try']]) {
      const t=Date.now(); await page.locator('#'+button).click();
      await page.waitForFunction(id => !document.getElementById(id).disabled, ready, {timeout:120000});
      console.log(button, Date.now()-t, await page.evaluate(() => timings.splice(0)));
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
