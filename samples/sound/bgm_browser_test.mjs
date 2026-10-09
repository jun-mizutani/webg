// ローカルHTTPサーバーとPlaywright／Chromeを使用するBGMの実ブラウザ検証。
// 実行条件と依存関係は docs/game_audio_bgm_validation.md を参照。
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.WEBG_PLAYWRIGHT_MODULE ?? 'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseUrl=process.env.WEBG_TEST_BASE_URL ?? 'http://127.0.0.1:8765';
const browser=await chromium.launch({...(process.env.WEBG_CHROME_EXECUTABLE ? {executablePath:process.env.WEBG_CHROME_EXECUTABLE} : {channel:'chrome'}),headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-webgpu']});
const results=[];
try {
 const context=await browser.newContext();
 await context.addInitScript(()=>{window.__bgmInstances=[];});
 await context.route('**/webg/GameAudioSynth.js',route=>route.fulfill({contentType:'application/javascript',body:readFileSync(root+'/webg/GameAudioSynth.js','utf8').replace('super(options);','super(options); globalThis.__bgmInstances.push(this);')}));
 for(const [sample,file,action] of [
 ['sound','sound.html','sound'],['lumen','lumen.html','music'],['neon_coaster','neon_coaster.html','music'],
 ['void_strike','void_strike.html','sound-button'],['cube4','cube4.html','keyboard'],
 ['circular_breaker','circular_breaker.html','canvas'],['circular_breaker2','circular_breaker2.html','canvas']]) {
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const entry={sample};
  try {
   await page.goto(baseUrl+'/samples/'+sample+'/'+file,{waitUntil:'domcontentloaded'});
   if(action==='sound') {await page.locator('#btnInit').click({timeout:12000});await page.locator('#btnBgmOn').click();}
   else if(action==='keyboard') {await page.waitForFunction(()=>window.__bgmInstances.length>0,{},{timeout:15000});await page.keyboard.press('Space');}
   else if(action==='canvas') {await page.waitForFunction(()=>window.__bgmInstances.length>0,{},{timeout:15000});await page.locator('canvas').first().click();await page.keyboard.press('Space');}
   else {if(sample==='void_strike'){await page.locator('#loading').waitFor({state:'hidden',timeout:20000});await page.locator('#start-run').click();}await page.locator('#'+action).click({timeout:15000});}
   await page.waitForTimeout(400);
   entry.initial=await page.evaluate(()=>{const a=window.__bgmInstances.at(-1);return {name:a?.melodyName,bpm:a?.bpm,playing:a?.playingBgm,state:a?.ctx?.state,step:a?.songStep,voices:a?.scoreVoices.size,volume:a?.requestedBgmVolume};});
   if(!entry.initial.playing||entry.initial.state!=='running'||entry.initial.step===0) throw Error('BGM did not start/progress');
   entry.lifecycle=await page.evaluate(async()=>{
    const a=window.__bgmInstances.at(-1);a.stopBgm(.05);await new Promise(r=>setTimeout(r,250));
    if(a.playingBgm||a.bgmTimer!==null) throw Error('stop did not clear scheduler');
    a.startBgm();a.scheduleBgm(.2);if(!a.playingBgm||a.songStep===0) throw Error('restart failed');
    const volume=a.requestedBgmVolume;await new Promise(r=>setTimeout(r,120));
    if(Math.abs(a.bgmBus.gain.value-volume)>.01) throw Error('restart lost BGM volume');
    a.setMelody('music_evening');a.scheduleBgm(.2);if(a.bpm!==84||a.songStep===0) throw Error('live switch failed');
    a.stopBgm(.05);a.stopScoreVoices();await new Promise(r=>setTimeout(r,250));
    return {volume,remainingVoices:a.scoreVoices.size};
   });
   if(sample==='sound') {
    await page.locator('#bgmMelodyVol').fill('0');await page.locator('#bgmRhythmVol').fill('1.2');
    entry.mix=await page.evaluate(()=>({melody:window.__bgmInstances[0].bgmMelodyVolume,rhythm:window.__bgmInstances[0].bgmRhythmVolume}));
    if(entry.mix.melody!==0||entry.mix.rhythm!==1.2) throw Error('mixer UI mismatch');
   }
   entry.ok=errors.length===0;
  } catch(error) {entry.ok=false;entry.failure=error.message;}
  entry.errors=errors;results.push(entry);console.log(JSON.stringify(entry));await page.close();
 }
 const page=await browser.newPage();
 await page.goto(baseUrl+'/samples/sound/sound.html');
 const render=await page.evaluate(async()=>{
  const {default:GameAudioSynth}=await import('/webg/GameAudioSynth.js');
  const names=new GameAudioSynth().getMelodyList(), results=[];
  for(const name of names) {
   const a=new GameAudioSynth();a.setMelody(name);
   const sr=22050,seconds=32*a.beat+5;
   a.ctx=new OfflineAudioContext(2,Math.ceil(seconds*sr),sr);
   a.master=a.ctx.createGain();a.master.gain.value=a.masterGainValue;a.master.connect(a.ctx.destination);
   a.bgmBus=a.ctx.createGain();a.bgmBus.gain.value=.75;a.buildBgmFxChain();
   a.playingBgm=true;a.nextBeatTime=.05;a.scheduleBgm(32*a.beat+.049);
   const buffer=await a.ctx.startRendering();let peak=0,sum=0;
   for(let ch=0;ch<buffer.numberOfChannels;ch++) {
    const data=buffer.getChannelData(ch);
    for(let i=0;i<data.length;i++) {if(!Number.isFinite(data[i]))throw Error(name+': non-finite audio');peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]**2;}
   }
   const rms=Math.sqrt(sum/(buffer.length*buffer.numberOfChannels));
   if(peak>=1||rms<.00001)throw Error(name+': clipping or silence');
   if(a.scoreVoices.size!==0)throw Error(name+': voices not released');
   results.push({name,peak,rms});
  }
  return results;
 });
 console.log('Native Web Audio render: '+render.length+' presets; peak max '+Math.max(...render.map(r=>r.peak)).toFixed(4)+'; no NaN/clipping/silence; voices released');
 for(const path of ['16_03','16_05']) {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl+'/book/examples/'+path+'.html');
  await page.locator('#startButton').click();
  await page.locator(path==='16_03'?'#playButton':'#playLoopButton').click();await page.waitForTimeout(250);
  const playing=await page.locator('#status').textContent();
  await page.locator(path==='16_03'?'#stopButton':'#stopLoopButton').click();
  console.log(path+': '+playing+'; stopped; errors='+JSON.stringify(errors));
  if(errors.length)throw Error(path+': '+errors.join(';'));
  await page.close();
 }
} finally {await browser.close();}
if(results.some(r=>!r.ok)) process.exitCode=1;
