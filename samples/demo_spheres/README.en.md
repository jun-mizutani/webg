# demo_spheres

English | [日本語](README.md)

![demo_spheres](./demo_spheres.jpg)

## Overview
- This sample places multiple spheres and lets you inspect color, texture, rotation, and camera control together
- It also includes the basic mesh-reuse pattern using `Shape.referShape`

## How to Run
- Open [./demo_spheres.html](./demo_spheres.html)
- Use a browser with WebGPU support, and check the help panel and HUD together with the sample when needed

## webg Features Used
- `Shape.sphere / Shape.referShape`
- `Texture` and `shaderParameter` setup
- `Space / Node`: hierarchical rotation and camera control
- `Screen.screenShot`, HUD display

## Checkpoints
- Confirm that spheres duplicated with `referShape` can share the same mesh while still updating their poses independently
- Confirm that camera rotation and zoom remain stable and let you inspect multiple spheres without breaking
- Confirm that shape switching and screenshot saving can be executed safely during the render loop

## Controls
- `Q`: quit
- `P`: save a screenshot
- `W / S`: rotate the camera around the X axis
- `A / D`: rotate the camera around the Y axis
- `Z / X`: zoom in / out
- `1 - 9`: switch the displayed shape
- `H`: toggle help display on or off
