# sound

## Audition the new eight-bar pieces

GameAudioSynth now includes 24 BGM presets: two pieces for each of twelve styles. Melody labels are English, with matching styles placed together. Cafe Steps (112 BPM) is selected initially. Press Audio Start, then BGM Start. Selecting a piece restarts its phrase and applies its suggested BPM, which remains adjustable. BPM counts quarter notes. Every piece has eight bars in 4/4. Swing lengthens the first half of each beat and shortens the second. Jogging presets include two pieces each at 170, 175, and 180 BPM. Scores are stored in webg/GameMusicPresets.js: each row is one bar with eight eighth-note positions, MIDI pitches, null to extend the previous note, and -1 for an explicit rest. GameAudioSynth.js performs melody, bass, chords, and percussion. Melody duration uses each piece’s leadGate fraction of the interval to the next onset, rest, or bar end. Attack and Decay are proportionally shortened when their total exceeds the note duration; Release is limited to that duration, and the lead also ends its release before the next onset or rest. The default setRootHz value of 220 Hz preserves the written pitches; changing it transposes melody, bass, and chords by the same ratio. Percussion pitches remain fixed. Existing controls adjust volume, reverberation, and envelopes.

The lead uses a low-pass filter to soften strong harmonics and gradually reduces the gain above 880 Hz. Kick, snare, and hi-hat patterns follow each style and share the melody’s BPM and swing. Jazz uses softer percussion, funk and jogging pieces have a stronger pulse, and ballads and gentle pieces use fewer or quieter hits. Percussion follows BGM volume, delay, and reverb, but has its own short envelope independent of BGM Envelope.


All 24 melodies have been rewritten with distinct registers, motifs, onset patterns, rests, and note lengths. Blue Room and Evening use low registers; Cafe Steps and Daylight use middle registers; Corner Quartet and Market Square sit higher. Funk and tense pieces use short repeated figures, ballads use sustained notes and rests, and Quartal Horizon uses fourths. Paired styles also contrast busier phrases with longer singing lines. Titles, suggested BPM, and chord progressions are preserved.

Lead gains are lower and kick, snare, and hi-hat gains are higher. Melody Vol scales the lead; Rhythm Vol scales bass, chords, and percussion (0–2, default 1). Set either to zero to compare parts separately. These values persist across song changes and affect newly scheduled notes; existing notes and effect tails decay naturally. BGM Vol controls the overall level.

The score format currently supports eight bars in 4/4, eighth-note positions, and a monophonic lead. It cannot encode sixteenth notes, independent triplets, lead chords, or ties across bar lines. Swing controls the ratio between paired eighth notes. Instruments use basic waveforms and filters rather than recorded instrument samples. Separate part volumes apply to GameAudioSynth scores, not AudioSynth degree-based melodies.

| Style | Preset / BPM | Preset / BPM |
|---|---|---|
| Jazz swing | Cafe Steps · 112 | Corner Quartet · 132 |
| Blues jazz | Blue Room · 96 | Blue Alley · 104 |
| Bossa jazz | Palm Terrace · 126 | Coastal Breeze · 138 |
| Jazz ballad | Midnight Window · 72 | Velvet Rain · 78 |
| Modal jazz | Dorian Walk · 118 | Quartal Horizon · 128 |
| Jazz funk | Sunset Pocket · 108 | Electric Crosswalk · 120 |
| Jogging jazz | River Run · 170 | Boardwalk Miles · 170 |
| Jogging synth | Neon Stride · 175 | Midnight Circuit · 175 |
| Jogging pop | Sunrise Sprint · 180 | Open Road · 180 |
| Upbeat | Daylight · 124 | Market Square · 132 |
| Gentle | Evening · 84 | Moonlit Garden · 90 |
| Tense | Pursuit · 148 | Nightfall Chase · 156 |

English | [日本語](README.md)

![sound](./sound.jpg)

## Overview
- This sample uses `AudioSynth` and `GameAudioSynth` so you can inspect sound effects and BGM while adjusting them on the same screen
- After starting the `AudioContext` with `Audio Start`, you can play sound with `Play SE`, `Next SE`, `Audition All`, and `BGM Start`, then adjust volume, delay, reverb, envelope, and melody on the spot
- The sample is arranged so you can go back and forth on a single screen between "what to play" and "how to shape what it sounds like"

## Reading the Screen

The screen is divided into `System`, `Sound Effects`, and `Background Music`. In that order, you first start the `AudioContext`, then adjust sound effects, and finally adjust melody, BPM, BGM envelope, and BGM reverb directly to refine the detailed contour of the BGM.

`System` contains `Audio Start` and `Master Vol`. `Audio Start` is the button that starts `AudioContext` after a user gesture, matching browser restrictions. `Master Vol` is the baseline for the overall volume. Adjusting that first makes it easier to compare the relative balance between sound effects and BGM.

In `Sound Effects`, you choose the effect to play through `Sound Effect`, then play it with `Play SE`. `Next SE` advances through the catalog one item at a time, while `Audition All` plays the full catalog in sequence so you can compare the differences. `SE Profiles` shows the envelope profiles used by that effect, and `Editing Profile` shows the profile currently being edited by the sliders. `SE Vol`, `SE Delay`, `SE Reverb`, `SE Reverb Kind`, `SE Reverb Length`, `SE Reverb Decay`, `SE Envelope`, `SE Attack`, `SE Decay`, `SE Sustain`, and `SE Release` let you change the contour and spatial character of the same sound effect in considerable detail.

In `Background Music`, you work with `BGM Start`, `BGM Stop`, `BGM Vol`, `BPM`, `Melody`, `BGM Delay`, `BGM Reverb`, `BGM Reverb Kind`, `BGM Reverb Length`, `BGM Reverb Decay`, `BGM Attack`, `BGM Decay`, `BGM Sustain`, and `BGM Release`. Because BGM changes its progression itself through melody and BPM, it is different from SE and is better adjusted while listening to the flow of time.

## How to Run
- Open [./sound.html](./sound.html)
- Use a browser with WebGPU support, and check the help panel and HUD together with the sample when needed

## webg Features Used
- `GameAudioSynth`: handles the game-oriented sound-effect catalog and melody presets together
- `AudioSynth`: handles envelope, delay, reverb, and IR settings for SE and BGM

## Compare the synthesized sound effects

The 18 effects combine short filtered noise, low resonances, continuous pitch changes, and notification phrases. Paddle and wall are brief impacts; block adds debris; baan is an explosion; shupa uses a noise sweep; laser descends in pitch. Poyoon, piyoon, and jump use smooth pitch motion; coin, levelup, and powerup use stable pitches and chords; gameover has a descending phrase. Ui_move and ui_ok are short and quiet enough for repeated input. Effect names and the Play SE controls are preserved.

Noise layers also follow the selected SE Envelope profiles. SE Profiles is generated from the layers actually used, and Editing Profile changes their next playback. Attack and Decay are proportionally shortened to fit brief layers; Release uses the current profile value. Tail_probe combines a short noise onset with sustained tones for envelope and reverb comparisons.

Audition All waits until each effect’s tones and current Release finish, then adds 0.15 seconds before the next effect. You can also keep BGM running to compare the clarity of collision and UI sounds. Delay and reverb tails are not included in the audition wait time.

## Checkpoints
The first thing to do is press `Audio Start`. Once sound output is enabled, use `Sound Effect` and `Play SE` to inspect short effects, then use `BGM Start` to play a melody. If you want to inspect the contour of the sound, change `SE Envelope`. If you want to inspect spatial character, change `SE Reverb Kind`, `SE Reverb Length`, and `SE Reverb Decay`. If you want to inspect the flow of BGM, change `Melody` and `BPM`.

This sample also provides comparison buttons such as `SE Dry / SE Reverb Max` and `BGM Dry / BGM Wet`. If the difference is hard to hear at middle slider values, pushing the state to an extreme and then returning makes it easier to grasp the direction of change.

`SE Reverb Kind` and `BGM Reverb Kind` switch between `room`, `hall`, and `plate`. These settings select the character of the reverberation. `Length` describes the length of the IR, and `Decay` describes how quickly it fades. You can compare the full range from a short, tight room to a long, spreading hall.

`SE Envelope` is the place where you switch the envelope profile used by the chosen sound effect. Profile names are grouped like instrument categories such as `percussion`, `brass`, `woodwind`, `organ`, `piano`, and `guitar`, making it easy to compare time behavior such as percussive hits, wind-like sustain, held tones, and plucked or struck strings. When you change `SE Attack`, `SE Decay`, `SE Sustain`, and `SE Release`, the next playback of that profile changes. Because short sound effects can make the difference harder to hear, selecting `tail_probe` makes both the front contour and the trailing tail easier to compare.

`BGM Envelope` defines the attack and tail of each BGM note. When you change `BGM Attack`, `BGM Decay`, `BGM Sustain`, and `BGM Release`, the impression changes even with the same melody. `BPM` changes speed, and `Melody` changes the shape of the phrase, so BGM is easier to tune if you separate "what is played" from "how it progresses". The BGM-side reverb is initialized a little stronger and more hall-like than the SE side, making it easier to first grasp the longer phrase tail when `Audition All` plays the melody.

First, press `Audio Start` and confirm that `Play SE`, `Next SE`, `Audition All`, and `BGM Start` become active. Then switch `Sound Effect` and confirm that `SE Profiles` and `Editing Profile` change to match the selected sound. After that, move `SE Attack`, `SE Decay`, `SE Sustain`, `SE Release`, and `SE Reverb`, replay the same effect, and compare the differences.

When you press `Audition All`, confirm that the entire catalog plays in sequence. If you want to stop it halfway, pressing the same button stops it. `Next SE` advances only one item at a time, which is useful when you want to hear a specific effect once again.

When you switch `SE Reverb Kind` between `room`, `hall`, and `plate`, the reflection texture changes even if the wet amount stays the same. Changing `SE Reverb Length` and `SE Reverb Decay` changes both the length and the falloff of the reverberation. Selecting `tail_probe` makes differences in envelope and reverb tail easier to follow than with shorter sound effects.

On the BGM side, change `Melody` while adjusting `BPM` and `BGM Envelope`, and compare how the same source can feel different. Changing `BGM Reverb Kind`, `BGM Reverb Length`, and `BGM Reverb Decay` shows how the same melody changes in spatial spread. The initial values lean toward a stronger hall sound, so it is easier to hear the difference if you first play it as-is and then return toward the dry side.

## Controls
Use the on-screen UI buttons and sliders to control this sample.

`Audio Start` starts the `AudioContext`, `BGM Start / BGM Stop` start and stop the BGM, and `Play SE` plays the currently selected sound effect once. `SE Dry / SE Reverb Max` and `BGM Dry / BGM Wet` switch to fixed comparison states.

## Common Pitfalls

Press `Audio Start` to activate the `AudioContext` as required by the browser, then use the other buttons to play sound.

`SE Reverb` and `SE Reverb Kind` are different settings. `SE Reverb` is the amount of reverberation, while `Kind` is the character of the reverberation. The same applies on the BGM side: `BGM Reverb` is the amount and `BGM Reverb Kind` is the character.

`SE Attack` and `BGM Attack` are in seconds, while `SE Sustain` and `BGM Sustain` are ratios. Because the units differ, it is easier to understand the behavior if you watch the displayed values while moving the sliders.

## Related Documents

- [14_UI表示の設計.md](../../book/14_UI表示の設計.md)
- [16_サウンドの設計.md](../../book/16_サウンドの設計.md)
- [01_はじめに.md](../../book/01_はじめに.md)
- [samples/sound/main.js](./main.js)
- [samples/sound/sound.html](./sound.html)

`16_サウンドの設計.md` explains the implementation in detail, and `01_はじめに.md` is the overall project entry point. This `README.md` is easiest to read as guidance focused on how to operate the sample screen itself.
