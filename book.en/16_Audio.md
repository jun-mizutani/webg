# Sound Design

This chapter uses the Web Audio API to play sound effects and background music, combining volume, timbre, rhythm, and reverberation to fit each scene. `GameAudioSynth` provides a convenient entry point to named sound effects and 24 pieces of BGM, which you can connect to application controls and events. Custom melodies and recorded audio can use the same volume and reverb path, allowing you to tune the overall sound in one place.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the application structure from Chapter 5 and JavaScript event handling. Connect audio activation to a user action, sound effects to in-game events, and BGM selection to scene changes.

### What to read first

Start with “A Minimal Sound Application,” then read the sections on volume, sound effects, and selecting BGM. These steps cover enabling audio from a user action and combining sound effects with background music.

### What to read when you need it

For an original song, see “Register an Eight-Bar Score.” For sound shaping, see “Attack and Release.” For recorded material, see “Play Audio Files.”

### What you will learn

You will be able to select music and sound effects for each scene, adjust their volume and reverb, register chords and melody as a score, and combine synthesized and recorded audio.

## Build Sound in Three Layers

The audio features in webg use three layers: generating a tone, managing audio groups, and providing presets for an application. Each class offers an entry point for the features an application needs.

`ToneSynth` is the foundation. It generates a tone from a waveform and configures its volume envelope, stereo position, delay, and reverb. `AudioSynth` extends `ToneSynth` with separate sound-effect (SE) and background-music (BGM) paths, scheduled music playback, and audio-file management. `GameAudioSynth` extends `AudioSynth` with 18 sound effects, 24 BGM tracks, and playback of eight-bar scores.

Track data is defined in `webg/GameMusicPresets.js`; sound-effect layer data is in `webg/GameSoundPresets.js`; and `webg/GameAudioSynth.js` reads scores and generates game-oriented sounds. Add an application-specific song with `registerMelody()`. Start by integrating sound through `GameAudioSynth`, then explore single-tone methods such as `playTone()` when you need to build a sound from scratch.

## A Minimal Sound Application

Enable audio in response to a user pressing a start button. Call `await synth.resume()` in the click handler, then start sound effects or BGM. `resume()` prepares audio processing and resumes a suspended `AudioContext`.

The following HTML uses paths appropriate to a file in `book/examples/`. Adjust the import path to match your application layout.

```html
<!doctype html>
<html lang="en">
<meta charset="UTF-8">
<title>Start and Stop Audio</title>
<button id="start">Start Audio</button>
<button id="se" disabled>Play Sound Effect</button>
<button id="stop" disabled>Stop BGM</button>
<p id="status">Press Start</p>
<script type="module">
import GameAudioSynth from "../../webg/GameAudioSynth.js";

const synth = new GameAudioSynth();
const start = document.getElementById("start");
const se = document.getElementById("se");
const stop = document.getElementById("stop");
const status = document.getElementById("status");

// Enable audio from the user's action, set the song and levels, and begin playback.
start.addEventListener("click", async () => {
  try {
    await synth.resume();
    synth.setMasterVolume(0.7);
    synth.setSeVolume(0.90);
    synth.setBgmVolume(0.75);
    synth.setMelody("jazz_cafe");
    synth.startBgm();
    se.disabled = false;
    stop.disabled = false;
    status.textContent = synth.getMelodyLabel(synth.melodyName);
  } catch (error) {
    status.textContent = String(error);
    console.error(error);
  }
});

// Confirm a user action with a short sound effect.
se.addEventListener("click", () => {
  synth.playSe("ui_ok");
});

// Stop scheduling BGM and fade its volume smoothly.
stop.addEventListener("click", () => {
  synth.stopBgm(0.2);
  status.textContent = "BGM stopped";
});
</script>
</html>
```

`new GameAudioSynth()` prepares song and timbre settings. Some volume and effect setters also prepare audio processing, so this example groups them after `resume()` in the user click handler.

`startBgm()` starts the selected song. Calling it during playback continues the current performance. After `stopBgm()`, starting again begins at the start of the song. Delay and reverb can remain audible as their configured tails after playback stops.

## Volume and Audio Routing

A **bus** combines multiple sounds into one path. Sound effects go to the SE bus and background music to the BGM bus. Each path applies its own volume and reverb before joining the master output.

```text
Sound effects and SE assets → SE volume  → dry, delay, reverb ─┐
                                                               ├→ master volume → output
Scores and BGM assets          → BGM volume → dry, delay, reverb ─┘
```

This structure separates lowering the overall output from making sound effects more prominent than music. Adjust the three levels as follows:

```js
synth.setMasterVolume(0.7); // Overall output multiplier
synth.setSeVolume(0.90);    // Sound-effect bus multiplier
synth.setBgmVolume(0.75);   // Background-music bus multiplier
```

These are the `GameAudioSynth` defaults. A value of `0.40` means a volume multiplier of 40%; perceived loudness also depends on timbre, simultaneous voices, reverb, and the output device. Begin with a moderate master level, balance SE and BGM, and then adjust the overall output. `setBgmVolume()` also applies when BGM is stopped and restarted.

### Set Melody and Rhythm Levels Separately

Score-based BGM supports part multipliers independently of the overall level:

```js
synth.setBgmMelodyVolume(0.8); // Lower the melody slightly
synth.setBgmRhythmVolume(1.2); // Raise bass, chords, and drums
```

Both values range from 0 to 2 and default to 1. At 0, that part stops scheduling new notes. The setting persists through song selection and stop/restart operations and applies to subsequent scheduled notes. Existing sounds and delay or reverb tails decay naturally. Use `setBgmVolume()` to adjust the complete BGM path.

Built-in songs use a restrained melody level and support the beat with kick, snare, and hi-hat. The individual part multipliers apply to score playback in `GameAudioSynth` with `format: "score"`. They do not affect `AudioSynth` degree-based songs or recorded audio sent to the BGM bus with `playAudioBuffer()`. Those sources still share the overall BGM bus level and effects.

## Attach Sound Effects to Events

Sound effects communicate events such as input, impact, collection, and success. Playing them at the same time as the corresponding visual change helps users understand the result of an action.

```js
// Call when coin collection is confirmed.
function onCoinCollected() {
  synth.playSe("coin");
}

// Call when damage is confirmed.
function onPlayerDamaged() {
  synth.playSe("damage");
}
```

Call these functions after enabling audio. If a collision remains active across several frames, let application logic identify the beginning of contact or a confirmed hit as one event before playing the sound. This keeps event count and playback count aligned.

The built-in effects are `paddle`, `wall`, `block`, `levelup`, `gameover`, `poyoon`, `piyoon`, `baan`, `shupa`, `coin`, `jump`, `laser`, `damage`, `powerup`, `ui_move`, `ui_ok`, `countdown`, and `tail_probe`.

Use `getSoundEffectList()` for the names and `getSoundEffectInfo(name)` for details. Its `profiles` field lists the envelope presets used by the sound, and `primaryProfile` identifies the preset to use as a starting point for adjustment. `durationSec` is calculated from the current envelope settings and spans the final layer's attack through release; it excludes delay and reverb tails. Some effects combine a short impact with a longer tail. Use this metadata to select the effect and its controls when building an editing UI.

### Distinguish Impact, Motion, and Notification

The 18 built-in effects combine pitched tones with band-limited noise. Continuous frequency changes suggest jumps or lasers; changes in a noise band suggest debris or moving air; low resonances suggest collisions or explosions.

- `paddle` and `wall`: Short impacts with a low resonance; `wall` is a softer, lower contact sound.
- `block`: A brief, high-pitched fragment of noise with a descending pitch.
- `baan` and `damage`: Descending low tones and noise; `baan` is a longer explosion and `damage` is a short hit.
- `shupa`: Noise that sweeps through frequency bands to suggest movement through air.
- `poyoon`, `piyoon`, and `jump`: Rising or falling phrases that suggest elasticity and jumping.
- `laser`: A smooth descent from high to low pitch with a brief noise layer.
- `coin`, `levelup`, and `powerup`: Stable pitches, rising phrases, or chords.
- `gameover`: A descending phrase with a low resolving tone.
- `ui_move` and `ui_ok`: Small, short sounds designed for repeated interaction.
- `countdown`: Repeated short notes followed by a higher note signaling the start.
- `tail_probe`: A short noise and long tone for checking envelopes and reverb.

Pitched and noise layers both go through the existing SE bus, sharing its volume, delay, reverb, and stereo positioning. Each layer uses the envelope in its `profiles`. If attack and decay exceed the short note duration, they are reduced proportionally; release uses the current profile. Preset names remain stable, so existing calls to `playSe(name)` continue to work.

Audio sources, filters, gain nodes, and panning nodes created for each sound are disconnected when playback ends. Noise buffers are reproducible from a shared random seed and reused; BGM drum playback uses a separate random sequence. Call `stopAllTones()` when leaving a scene to stop scheduled noise and pitched layers together. Score-based BGM has its own controls.

## Choose from 24 BGM Tracks

BGM establishes the mood and passage of time in a scene. `GameAudioSynth` provides two songs in each of 12 styles centered on jazz. Each song loops through eight bars in 4/4 and combines melody, bass, chords, and percussion.

Each pair below gives the identifier, title, and BPM:

| Style | Song 1 | Song 2 |
|---|---|---|
| Jazz swing | `jazz_cafe` / Cafe Steps / 112 | `jazz_corner` / Corner Quartet / 132 |
| Blues jazz | `jazz_blue_room` / Blue Room / 96 | `jazz_blue_alley` / Blue Alley / 104 |
| Bossa jazz | `jazz_bossa` / Palm Terrace / 126 | `jazz_coast` / Coastal Breeze / 138 |
| Jazz ballad | `jazz_midnight` / Midnight Window / 72 | `jazz_velvet` / Velvet Rain / 78 |
| Modal jazz | `jazz_modal` / Dorian Walk / 118 | `jazz_quartal` / Quartal Horizon / 128 |
| Jazz funk | `jazz_sunset` / Sunset Pocket / 108 | `jazz_electric` / Electric Crosswalk / 120 |
| Jogging jazz | `run_swing` / River Run / 170 | `run_boardwalk` / Boardwalk Miles / 170 |
| Jogging synth | `run_neon` / Neon Stride / 175 | `run_midnight` / Midnight Circuit / 175 |
| Jogging pop | `run_sunrise` / Sunrise Sprint / 180 | `run_open_road` / Open Road / 180 |
| Upbeat | `music_daylight` / Daylight / 124 | `music_market` / Market Square / 132 |
| Gentle | `music_evening` / Evening / 84 | `music_moonlit` / Moonlit Garden / 90 |
| Tense | `music_pursuit` / Pursuit / 148 | `music_nightfall` / Nightfall Chase / 156 |

The initial selection is `jazz_cafe` at 112 BPM. BPM is the number of quarter-note beats per minute. The six jogging tracks can be compared at 170, 175, and 180 BPM. All timbres are synthesized from waveforms; harmony, melody, accompaniment patterns, and swing give each track its style. Melodies vary in range, repetition, leaps, note placement, rests, and duration. For example, Blue Room and Evening use a lower register, while Cafe Steps and Daylight use a middle register. Funk uses short repeated notes and rests, ballads use longer notes and breathing room, and Quartal Horizon features fourth-based leaps. Compare the two tracks in a style to hear differences such as short rhythmic phrases and sustained melodic lines.

### Display the Song Title

Use the identifier in code and the label in the UI. `getMelodyList()` returns identifiers; `getMelodyLabel(name)` returns an English label with the title, style, and BPM. Connect them to a `select` element and a `bpmOutput` element:

```js
for (const name of synth.getMelodyList()) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = synth.getMelodyLabel(name);
  select.appendChild(option);
}
select.value = synth.melodyName;
bpmOutput.textContent = String(synth.bpm);

// Change the song and show its starting tempo together.
select.addEventListener("change", () => {
  synth.setMelody(select.value);
  bpmOutput.textContent = String(synth.bpm);
});
```

The BPM in a label is that song's starting tempo. If the UI can change tempo during playback, show the current `synth.bpm` separately so users can distinguish the selected song from its current setting.

### Set Tempo and Pitch for a Scene

`setMelody()` chooses a song, applies its starting tempo, and returns playback to the beginning. During playback, it stops scheduled notes before switching. For a scene-specific tempo, call `setBpm()` after selecting the song.

```js
// Select the song, tempo, and pitch for a chase scene.
function enterChaseScene() {
  synth.setMelody("music_pursuit");
  synth.setBpm(156);
  synth.setRootHz(220);
  synth.startBgm();
}
```

`setRootHz()` changes the pitch of melody, bass, and chords by the same ratio. Kick, snare, and hi-hat frequencies and bands remain fixed. At the default 220 Hz root, MIDI pitches use their corresponding frequencies; 440 Hz is one octave higher and 110 Hz one octave lower. Raise the pitch by a semitone with `220 * 2 ** (1 / 12)`. Song changes retain the current root and BGM envelope, so set them together when each scene needs specific values.

## Register an Eight-Bar Score

Add an application-specific song by describing chords and melody numerically. In a score with `format: "score"`, each row of `chords` describes one bar of harmony and the corresponding row of `lead` describes its melody. Pitches use MIDI numbers: 60 is C4 and 69 is A4. With a root of 220 Hz, pitch 69 plays at 440 Hz.

This example creates an eight-bar song centered on C major. It uses the `synth` instance created earlier in this chapter.

```js
synth.registerMelody("story_field", {
  format: "score",
  label: "Story Field — Gentle / 116 BPM",
  bpm: 116,
  swing: 0.5,
  groove: "basic",
  type: "triangle",
  leadGain: 0.034,
  leadGate: 0.84,
  chords: [
    [48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55],
    [57, 60, 64], [53, 57, 60], [55, 59, 62], [48, 52, 55]
  ],
  lead: [
    [72, null, 76, null, 79, null, 76, null],
    [77, null, 76, 74,   72, null, 69, null],
    [71, null, 74, null, 79, null, 77, null],
    [76, null, 74, null, 72, null, -1, -1],
    [76, null, 81, null, 79, null, 76, null],
    [77, null, 76, null, 72, null, 69, null],
    [71, 74,   77, null, 79, null, 74, null],
    [76, null, 74, null, 72, null, -1, -1]
  ]
});

synth.setMelody("story_field");
```

Call `synth.startBgm()` after enabling audio to play the score. The same score is used in the [custom BGM example](../book/examples/16_03.html).

### Score Fields

`label` is the display string. `bpm` sets the song's starting tempo, from 70 to 200. `swing` is the ratio used to divide a beat into two eighth notes, from 0.5 to 0.67. At 0.5, the notes are evenly spaced; at 0.62, the first note occupies 62% and the second 38% of the beat. The pair still totals one beat, preserving the specified BPM.

`chords` and `lead` each have eight rows. Each chord row contains three to five integer pitches from 13 to 115, with the first pitch as the root. The accompaniment uses the root for bass and combines the remaining pitches into a chord. For `walk`, placing root, third, and fifth in that order helps construct the intended bass movement.

Each melody row contains eight entries, one for each eighth-note position. An entry can be an integer pitch from 0 to 127, `null`, or `-1`. An integer starts a new note; `null` extends the previous note; `-1` marks an explicit rest. A note ends at the next note, rest, or bar line. A leading `null` in a bar delays its first melody note rather than extending the preceding bar's note. A row of only `null` or `-1` rests the melody for that bar. Bass, chords, and percussion continue following the accompaniment while the melody rests.

```js
// Play C4, rest for one beat, then play E4 and rest again.
[60, null, -1, -1, 64, null, -1, -1]
```

`leadGate` sets the fraction of the interval to the next note, rest, or bar line during which the note sounds; its range is 0.1 to 1. Lower values sound more detached, while higher values sustain longer. The default is 0.82. Built-in songs set this value individually.

`leadGain` is the base volume for one melody note, from 0 to 0.2. Actual volume also includes the part multiplier, high-frequency compensation, envelope, and BGM-bus multipliers. The default is 0.032 for `square` and 0.058 for other waveforms. The 24 built-in songs specify 0.021–0.036 to balance their accompaniment.

`type` selects the melody waveform. `sine` is rounded, `triangle` is soft but focused, `square` has a strong edge, and `sawtooth` has rich harmonics. Bass uses `triangle` and chords use `sine`. A low-pass filter reduces harsh upper harmonics in the melody. Its cutoff follows pitch from 1400 to 3000 Hz, with a Q of 0.5. Melody notes above 880 Hz are gradually reduced in volume according to their actual frequency. This correction also applies after transposition with `setRootHz()`.

`registerMelody()` validates these fields and copies the chord and melody arrays. Invalid settings raise an exception that names the field. After editing and registering a score again, call `setMelody()` to hear the updated song from the beginning.

### Choose an Accompaniment Groove

`groove` selects when bass, chords, and percussion play. With the same harmony, emphasizing strong beats or offbeats can create a walking or bouncing rhythm.

| Value | Accompaniment pattern |
|---|---|
| `basic` | Bass on beats 1 and 3, chords on beats 2 and 4 |
| `walk` | Bass on every beat and chords including offbeats |
| `bossa` | Bass and chords placed before and after beats |
| `ballad` | Spacious pattern with longer chords supporting the melody |
| `funk` | Short notes including offbeats for a detailed pulse |
| `run` | Bass on every beat and offbeat chords to mark tempo |

On beat 4 of `walk`, the bass approaches the next bar's root from a semitone below. `basic` and `run` use all chord tones. The other grooves separate the root into the bass and use the remaining pitches for chords. Combine any style label with a groove: for example, built-in modal jazz uses the `bossa` pattern and creates its style through harmony and melody.

### Support the Beat with Percussion

The kick is a sine wave with descending frequency. Snare and hi-hat are short, band-limited noise. They are generated without external audio files and use the BGM bus. Since the drums are scheduled with the same BPM and `swing` as the melody, their timing stays aligned.

- `basic`: Kick on beats 1 and 3, snare on 2 and 4, hi-hat on every beat.
- `walk`: Kick on 1 and 3, snare on 2 and 4, hi-hat on eighth notes.
- `bossa`: Kick before and after beats, with snare and hi-hat on 2 and 4.
- `ballad`: Kick on beat 1, snare on 4, and hi-hat on 2 and 4.
- `funk`: Kick on offbeats as well, snare on 2 and 4, and hi-hat on eighth notes.
- `run`: Kick on every beat, snare on 2 and 4, and hi-hat on eighth notes.

The percussion level is 0.8 of standard for `walk` and `bossa`, and 0.55 for `ballad`. For `basic` songs with a `sine` melody, it is 0.5 to support the gentler lead. Offbeat hi-hats are quieter to create rhythmic accents. Adjust bass, chords, and drums together with `setBgmRhythmVolume()`.

Drums use their own short volume envelopes and are independent of `setBgmEnvelope()`. They follow the BGM volume, delay, and reverb, so a strong reverb setting also gives the drums a tail.

## Attack and Release

The sound of one note depends on its waveform and how its volume changes over time. This volume shape is called an **envelope**, or ADSR: Attack, Decay, Sustain, and Release.

Attack is the time to reach peak volume; Decay is the time from the peak to the sustained level; Sustain is the sustained fraction of peak volume; Release is the time for the sound to fade out. Times are in seconds. The default BGM envelope is:

```js
synth.setBgmEnvelope({
  attack: 0.03,
  decay: 0.20,
  sustain: 0.60,
  release: 0.40
});
```

For score playback, Attack and Decay are shortened proportionally when their total would exceed the note duration. Release uses the smaller of its configured value and the note duration. For melody notes, Release also fits within the time remaining before the next note or rest. Bass and chords use the note duration for Release, while percussion has a dedicated short envelope. This timing lets short notes retain their attack, decay, sustain, and release sequence. Release and bus reverb can make the audible tail longer than the note's nominal duration. Set BGM Sustain from 0 to 1 and each time to 0 or greater.

`setBgmEnvelope()` merges supplied fields into the current settings, so you can adjust one value at a time, for example `synth.setBgmEnvelope({ attack: 0.01 })`. SE settings use named timbre presets.

```js
// Read the current timbre preset, change its attack, and register it again.
const piano = synth.getSeEnvelopePreset("piano");
synth.setSeEnvelopePreset("piano", {
  ...piano,
  attack: 0.005
});
```

SE presets are registered as a group of four fields; merge the current values when changing only one. Available presets are `percussion`, `brass`, `woodwind`, `organ`, `piano`, and `guitar`. Built-in effects use these envelopes for pitched and noise layers. Values supplied directly to `playGameTone()` such as `attack` override the preset. Use `getSoundEffectInfo()` to identify which preset an effect uses while tuning it.

## Adjust Delay and Reverb

Delay repeats a sound after an interval; reverb creates reflections that spread through a space. SE and BGM have independent settings, allowing crisp controls and spacious music.

```js
// Repeat interval in seconds, feedback, and repeat mix.
synth.setSeDelay(0.11, 0.26, 0.22);
synth.setBgmDelay(0.18, 0.22, 0.18);

// Send level into reverb and return level to the output.
synth.setSeReverb(0.32, 0.55);
synth.setBgmReverb(0.28, 0.48);
```

The delay feedback controls how much of the returning sound is sent back into the delay. Values below 1 create repeats that gradually fade. The internal `DelayNode` accepts times from 0 to 2 seconds.

Use `setSeReverb()` and `setBgmReverb()` to set the amount of reverb, and choose its character with an impulse setting:

```js
synth.setSeReverbImpulse({
  kind: "room",
  durationSec: 2.2,
  decay: 1.6
});
synth.setBgmReverbImpulse({
  kind: "hall",
  durationSec: 4.0,
  decay: 1.9
});
```

Choose `room`, `hall`, or `plate` for `kind`. `durationSec` is the length of the impulse data; `decay` controls its later falloff. For the same duration, a higher decay value makes the latter part diminish faster.

Reverb uses an impulse response: the response of a space to a short input. webg generates stereo reverb data from decaying noise and early reflections, then applies it with a `ConvolverNode`. Since changing settings regenerates the data, update them from a settings screen or during a scene transition. Use `tail_probe`, which combines a short sound with a longer one, to compare settings.

## Layer Single Tones to Create an Effect

Create application-specific sounds by layering tones with different frequencies, timings, and levels. `playGameTone(freq, dur, profile, options)` accepts frequency in hertz and duration in seconds, along with an envelope preset.

```js
// Call after enabling audio; layer three notes into a treasure sound.
function playTreasureOpen() {
  const when = synth.ctx.currentTime;
  synth.playGameTone(523.25, 0.08, "guitar", {
    when, type: "triangle", gain: 0.07, pan: -0.08
  });
  synth.playGameTone(783.99, 0.12, "piano", {
    when: when + 0.04, type: "triangle", gain: 0.06, pan: 0.06
  });
  synth.playGameTone(1174.66, 0.16, "woodwind", {
    when: when + 0.09, type: "sine", gain: 0.04, pan: 0.20
  });
}
```

`when` is an absolute time in seconds in the `AudioContext`. Read the time once and add offsets to preserve the relationship among notes. `pan` ranges from -1 (left) through 0 (center) to 1 (right). `detune` adjusts pitch in cents; 100 cents is one semitone.

When using `ToneSynth.playTone()` directly, choose an envelope preset with `options.profile`. The playback handle returned by `playTone()` can control a sustained sound individually.

## Play Audio Files

Load voices, ambience, or recorded instruments as named `AudioBuffer` assets. `loadAudioBuffer(name, url)` fetches and decodes the file; `playAudioBuffer(name, options)` plays it by its registered name. These methods are also available through `GameAudioSynth`.

After audio has been enabled, load an asset once and play it in response to an in-game event. Set the URL to an audio file provided by the application.

```js
await synth.loadAudioBuffer("door", "./audio/door.mp3");

// Play the prepared asset when the door opens.
function playDoorSound() {
  return synth.playAudioBuffer("door", {
    bus: "se",
    gain: 0.8,
    pan: -0.15
  });
}
```

`bus: "se"` routes the asset through sound-effect volume and effects; `bus: "bgm"` routes it through BGM settings. Loaded assets can be reused, and a playback node is created for each voice. For looping ambience, keep the returned handle and stop it when the sound is no longer needed.

```js
await synth.loadAudioBuffer("forest", "./audio/forest_loop.ogg");
const voice = synth.playAudioBuffer("forest", {
  bus: "bgm",
  loop: true,
  gain: 0.45
});

// Fade the ambience when leaving the scene.
voice.stop(synth.ctx.currentTime, { fadeSec: 0.4 });
```

`playbackRate` changes playback speed; `detune` adjusts pitch in cents; `offset` is the start time within the asset; and `duration` is the playback length, both in seconds. Pitch and playback speed change according to these settings.

Register fetched binary data with `decodeAudioBuffer(name, arrayBuffer)` or an existing `AudioBuffer` with `registerAudioBuffer(name, buffer)`. Use `getAudioBufferList()` to list assets. Handle load or registration errors as exceptions and surface them in the application's status UI.

Score playback and audio assets have separate start and stop operations. Stop a score with `stopBgm()` and an asset with `voice.stop()` or `stopAllAudioBuffers()`. If both use the BGM bus, they share the bus-volume fade from `stopBgm()`, so a scene-exit function can stop both together.

## Schedule Music with the Audio Clock

BGM playback schedules notes slightly ahead of time. By default, `GameAudioSynth` runs the scheduler every 25 milliseconds and schedules sounds up to 0.20 seconds ahead on the `AudioContext` clock. Since audio owns the note start times, note spacing remains consistent as rendering frame intervals change.

`scheduleBgm()` cycles through 64 eighth-note positions and `scheduleScoreStep()` coordinates playback at each position. `scheduleAccompaniment()` creates bass and chords; `scheduleScoreDrums()` creates percussion; `playScoreVoice()` schedules melody, bass, and chord voices; and `playScoreDrum()` schedules each drum sound. When playback ends, sources, gain nodes, and filters are disconnected and removed from the scheduled set. Song changes and restarts stop scheduled score audio, including noise sources, so sounds from a previous performance do not continue.

Changes to tempo, pitch, envelopes, and part levels apply to subsequently scheduled notes. This look-ahead interval explains the short delay between moving a slider and hearing the change. The application calls `startBgm()` when a scene starts and `stopBgm()` when it ends, leaving note scheduling to the audio class.

## Compare Settings in the Sample

`samples/sound/sound.html` provides one screen for adjusting general settings, sound effects, and BGM. Press **Audio Start** to enable audio, select a song with **Melody**, then press **BGM Start**. The selected song's BPM appears alongside controls for tempo, level, ADSR, delay, and reverb. **BGM Vol** changes the whole BGM path; **Melody Vol** changes the melody; and **Rhythm Vol** changes bass, chords, and percussion. Set Melody Vol to 0 to hear only the rhythm, then restore it to compare the balance. Changes to BGM ADSR affect melody, bass, and chords while the short drum envelope remains in use.

Use **Play SE** to hear one effect, **Next SE** to advance, or **Audition All** to play the full list. Audition All waits an additional 0.15 seconds after each effect's sound and release so longer success and game-over sounds finish before the next one starts. Choose the envelope preset used by the selected effect when editing an SE. First listen to the original sound's shape; then adjust reverb amount and type to compare sound duration separately from the spatial tail. When moving settings into an application, group song identifiers and audio settings in scene-specific functions or data.

## Summary

Integrate audio by calling `resume()` in response to a user action, setting volume, and starting sound effects and BGM. `GameAudioSynth` plays 24 songs with eight-bar melody, bass, chords, and percussion. Add original songs in the same score format.

Adjust master, SE, and BGM levels, as well as melody and rhythm parts in score playback. Combine rests, note durations, and pitch ranges for each song; shape timbre with ADSR and spatial character with delay and reverb. Audio assets can use the same output paths, letting applications combine synthesis and recordings.
