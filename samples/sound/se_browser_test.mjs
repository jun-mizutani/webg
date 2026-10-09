// ローカルHTTPサーバー、Playwright、Chromeで効果音の合成と試聴UIを検証する。
// WEBG_PLAYWRIGHT_MODULE / WEBG_CHROME_EXECUTABLE / WEBG_TEST_BASE_URLは
// bgm_browser_test.mjsと同じ設定を使用する。
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.WEBG_PLAYWRIGHT_MODULE ?? "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const baseUrl = process.env.WEBG_TEST_BASE_URL ?? "http://127.0.0.1:8765";
const browser = await chromium.launch({
  ...(process.env.WEBG_CHROME_EXECUTABLE
    ? {executablePath:process.env.WEBG_CHROME_EXECUTABLE} : {channel:"chrome"}),
  headless:true,
  args:["--autoplay-policy=no-user-gesture-required"]
});

try {
  const page = await browser.newPage();
  await page.goto(baseUrl + "/samples/sound/sound.html");
  const rendered = await page.evaluate(async () => {
    const {default:GameAudioSynth} = await import("/webg/GameAudioSynth.js");
    const names = new GameAudioSynth().getSoundEffectList();
    const results = [];
    for (const name of names) {
      const synth = new GameAudioSynth({randomSeed:123});
      const info = synth.getSoundEffectInfo(name);
      const sr = 22050;
      synth.ctx = new OfflineAudioContext(2, Math.ceil((info.durationSec + 4.5) * sr), sr);
      synth.master = synth.ctx.createGain();
      synth.master.gain.value = synth.masterGainValue;
      synth.master.connect(synth.ctx.destination);
      synth.toneBus = synth.ctx.createGain();
      synth.toneBus.gain.value = .90;
      synth.buildToneFxChain();
      synth.playSe(name);
      const buffer = await synth.ctx.startRendering();
      let peak = 0, power = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (const sample of data) {
          if (!Number.isFinite(sample)) throw Error(name + ": non-finite sample");
          peak = Math.max(peak, Math.abs(sample));
          power += sample * sample;
        }
      }
      const rms = Math.sqrt(power / (buffer.length * buffer.numberOfChannels));
      if (peak >= 1 || rms < .00001) throw Error(name + ": clipping or silence");
      if (synth.activeVoices.size !== 0) throw Error(name + ": voices not released");
      results.push({name, durationSec:info.durationSec, peak, rms});
    }
    return results;
  });
  assert.equal(rendered.length, 18);
  console.log("Native SE render: 18 presets; peak max " +
    Math.max(...rendered.map(result => result.peak)).toFixed(4) +
    "; no silence/clipping/NaN; all voices released");
  console.log(JSON.stringify(rendered.map(({name, durationSec, peak}) =>
    ({name, durationSec, peak:Number(peak.toFixed(4))}))));
  await page.close();

  // SEだけを使うKarakuriのラッパーも、既存の呼出しで動く。
  const karakuriPage = await browser.newPage();
  await karakuriPage.goto(baseUrl + "/samples/sound/sound.html");
  const karakuri = await karakuriPage.evaluate(async () => {
    const {KarakuriAudio} = await import("/samples/karakuri/karakuri_audio.js");
    const audio = new KarakuriAudio();
    if (!await audio.resume()) throw Error("Karakuri resume failed");
    const played = [audio.playBounce(), audio.playGoalBounce(), audio.playGoal()];
    audio.synth.stopAllTones({release:.01});
    await new Promise(resolve => setTimeout(resolve, 100));
    return {played, remaining:audio.synth.activeVoices.size};
  });
  assert.deepEqual(karakuri.played, [true,true,true]);
  assert.equal(karakuri.remaining, 0);
  console.log("Karakuri: collision/goal sounds and stopAllTones OK");
  await karakuriPage.close();

  const context = await browser.newContext();
  await context.addInitScript(() => { window.__seInstances = []; });
  await context.route("**/webg/GameAudioSynth.js", route => route.fulfill({
    contentType:"application/javascript",
    body:readFileSync(root + "/webg/GameAudioSynth.js", "utf8").replace(
      "super(options);", "super(options); globalThis.__seInstances.push(this);")
  }));
  const uiPage = await context.newPage();
  const errors = [];
  uiPage.on("pageerror", error => errors.push(error.message));
  await uiPage.goto(baseUrl + "/samples/sound/sound.html");
  await uiPage.locator("#btnInit").click();
  for (const {name} of rendered) {
    await uiPage.locator("#soundEffect").selectOption(name);
    await uiPage.locator("#btnPlaySe").click();
    assert.ok((await uiPage.locator("#status").textContent()).includes(name));
  }
  await uiPage.locator("#seAttack").fill("0.2");
  await uiPage.locator("#seRelease").fill("0.4");
  const edited = await uiPage.evaluate(() => window.__seInstances[0].getSeEnvelopePreset("organ"));
  assert.equal(edited.attack, .2);
  assert.equal(edited.release, .4);
  await uiPage.locator("#btnAuditionSe").click();
  await uiPage.waitForFunction(() =>
    document.getElementById("status").textContent.includes("sound audition complete"),
    {}, {timeout:25000});
  await uiPage.locator("#btnBgmOn").click();
  const coexist = await uiPage.evaluate(async () => {
    const synth = window.__seInstances[0];
    for (let i = 0; i < 10; i++) {
      synth.playSe("wall"); synth.playSe("ui_move");
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    synth.stopAllTones({release:.01});
    await new Promise(resolve => setTimeout(resolve, 100));
    const result = {playing:synth.playingBgm, step:synth.songStep, remaining:synth.activeVoices.size};
    synth.stopBgm();
    return result;
  });
  assert.equal(coexist.playing, true);
  assert.ok(coexist.step > 0);
  assert.equal(coexist.remaining, 0);
  assert.deepEqual(errors, []);
  console.log("sound UI: 18 selections, envelope edits, full audition, repeated SE with BGM OK");
} finally {
  await browser.close();
}
