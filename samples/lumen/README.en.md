# LUMEN — Light Observatory

LUMEN is an interactive science-fiction gallery combining webg rendering, GPU simulation, and synthesized music. Three golden rings rotate around a luminous core. Side exhibits contrast translucent glass with a highly reflective aluminum sphere; each exhibit sphere has a diameter of 2.3 units. Twelve metal spheres fall into a tray in the foreground.

## Running and controls

Open [lumen.html](lumen.html) in a WebGPU-capable browser through a local HTTP server. The loading screen remains visible while GPU pipelines and environment lighting are prepared.

Drag to orbit and use the wheel to change distance. The exhibition runs automatically: 1,536 bright particles burst every eight seconds, and twelve spheres restart their fall from heights of 5 to 6.7 every twelve seconds. The pulse is red and orange-red, while continuous light particles rise from the left glass sphere. Both the spheres and tray bottom use restitution 0.85. The rings rotate continuously. Music is the only button and enables Jazz after a user gesture. Master volume is 40% and BGM volume is 35%.

The canvas follows the window size. Controls wrap on narrow screens.

## webg features

SceneYAML defines shared materials, initial objects, rendering, physics, and particle emitters. WebgSceneApp builds the scene, and JavaScript adds repeated architectural elements.

PBR combines metallic reflections, transmission glass, environment lighting, and four colored point lights through Deferred Lighting. Directional shadow mapping supports depth perception, SSR supplies screen-space reflections, and Bloom spreads light around emissive details. The aluminum sphere uses metallic 1 and roughness 0.08 for a crisp metallic reflection.

ComputeParticleEmitter updates the red pulse and drifting particles emitted from the left glass exhibit, then adds them to the HDR image. Compute physics simulates contacts, restitution, friction, and settling for twelve spheres and a five-part tray, using a 240Hz fixed step and twelve solver iterations. GameAudioSynth generates Jazz without downloaded audio files.

## Things to observe

Orbit the scene to inspect changing highlights, reflections, and refraction through the glass. Watch the periodic pulses disperse and fade as the central light returns to its resting intensity. Repeated sphere drops show stronger rebounds from greater heights.

SSR and Transmission use screen-space information, so their appearance depends on the camera and screen boundaries. Thin emissive lines and reflection edges can show pixel-level steps. GPU cost depends on window dimensions and active particles. Rendering resolution follows CSS pixels.

## Implementation

scene.yaml holds shared settings. exhibition.js constructs gallery geometry and physical spheres. ObservatoryApp.js connects colored lighting and resizing. main.js handles interaction, updates, audio, and cleanup. Custom exhibits use Primitive, Shape, and Node. The core library is unchanged.

The five tray parts and twelve spheres participate in physics. The rings and glass exhibits are display geometry. SSAO and depth of field are disabled to keep material comparisons clear. Runtime errors appear on screen and stop updates.
