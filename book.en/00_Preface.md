# Preface

This book introduces `webg`, a library for building 3D applications with JavaScript and WebGPU.
The library uses browser APIs, including WebGPU, Web Audio, and Compression Streams, and runs from a local web server without external libraries or build tools.
To get started, download the repository and use a browser and GPU that support WebGPU. Once set up, you can run the applications entirely on your own machine.

The repository brings together 3D rendering, scene management, model loading, animation, input, user interfaces (UI), diagnostics, audio, post-processing, and physics.
Touch, mouse, and pen input use Pointer Events and a shared gesture system. You can develop gesture-based controls in a desktop browser and use the same approach on a smartphone.

The Logo programming language introduced many people to turtle graphics: drawing pictures by telling an on-screen turtle to move forward, turn, and raise or lower its pen.
Around 1991, I wrote a 16-bit fixed-point 3D package in assembly language to try a three-dimensional version of that idea. That was the beginning of my work in 3D graphics.
When I first tried to draw a cube, I encountered gimbal lock as I tilted the view upward by 90 degrees.
With Euler-angle rotations, certain orientations align two rotation axes, making it difficult to control the next rotation independently.
That experience led me to study matrices and quaternions and understand the calculations behind them.
The code in `webg`'s `Quat.js` and `Matrix.js` grew out of that work and has been refined over more than 30 years.
Along the way, I worked with Pascal, C++, Python, Lua, and JavaScript.

I wanted to organize that knowledge so that today's developers and AI coding assistants could use it to build 3D applications.
That effort led to this library and this book.

The book also explains how to build screen effects with WebGPU compute shaders.
It describes the order of operations and the resources each stage depends on, so readers can understand how the pieces fit together.
These explanations are intended for both human developers and AI coding assistants.

## Who this book is for

This book is for readers who know the basics of JavaScript and want to bring 3D graphics to life in a browser.
It is written for readers ranging from WebGPU beginners to developers who want to understand how a 3D rendering library works internally.
If you are new to 3D graphics, you can also use an AI coding assistant to help build applications while you learn.

3D graphics involves many technical terms: coordinate systems, matrices, quaternions, cameras, shaders, assets, animation, collision detection, and physics, among others.
This book introduces those ideas step by step and points to them when they become relevant.
Start by understanding the role of each feature, then return to the corresponding chapter when you need more detail.

For coordinate systems and field of view, revisit Chapters 03 and 06. For shared depth and camera frames in the rendering process, see Chapter 41.
Chapter 05 explains the startup sequence of `WebgApp`, and Chapter 06 covers camera controls.
Chapter 15 is the reference for ray casting and overlap queries; Chapters 27–28 cover physics behavior.

AI coding assistants also need clear explanations of the project's design principles, terminology, order of operations, and relevant examples.
In `webg`, the book, runnable samples, test applications, and core implementation refer to one another. An assistant can use these project-specific sources to check its assumptions.
The public sample catalog is at `samples/index.html`; the book's runnable examples are listed at `book/examples/index.html`. Paths written in inline code in this book are relative to the repository root, unless stated otherwise. Links to another chapter are relative to `book.en/`.

## Reading with an AI coding assistant

If you ask an AI coding assistant to build an application with `webg`, first ask it to read [Appendix A: For AI Coding Assistants](Appendix_A_ForAI.md).
The appendix explains which chapters and samples to consult, how to check assumptions drawn from other 3D libraries, and which `webg` conventions to follow.

Tell the AI which primary sources to consult.
For example, ask it to follow the `WebgApp` structure in Chapter 05 or refer to the camera controls in Chapter 06.
You can also ask it to read the relevant sample and its explanation before making changes.

`webg` is organized so that an AI can follow the book, samples, `unittest` applications, and core implementation in sequence.
This helps it make project-specific decisions more accurately than a request to “build a 3D app” alone.

Always run and inspect an AI's output.
In a 3D application, code can be syntactically correct yet look wrong because the initialization order, draw order, coordinate system, asset orientation, or input state is slightly off.
This book emphasizes learning by checking behavior in a browser with the samples and `unittest` applications.

## What matters in this book

This book explains not only how to use the APIs, but also why they work as they do.
When something fails to work, understanding the cause helps you solve similar problems later.
The explanations in this book are intended to make that knowledge reusable.
Why is `Shape.endShape()` needed?
Why does the order of `clear`, `draw`, and `present` matter?
Why does `WebgApp` use a hierarchy of `cameraRig`, `cameraRod`, and `eye`?
Why do coordinate-system and rotation terms need to stay consistent throughout the book?
Understanding these reasons makes it easier to narrow down a problem when one occurs.

The book also explains `webg` layer by layer, so you can follow the implementation as far as you need.
Convenient entry points such as `WebgApp` make it easy to begin, while the internal structure remains available for closer study.
That is useful both for learning and for solving problems in real development.
When the display looks wrong, input stops responding, a model faces an unexpected direction, or an animation fails to play, you can check browser setup, asset data, API calls, and runtime state to locate the cause.
Understanding what happens at each layer leads to more reliable development.

`webg` is a place to experiment with browser-based 3D applications, a learning resource, and a practical application foundation.
I hope this book serves as a map between these three roles and helps you build 3D experiences with your own hands.
