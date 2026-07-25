# skinning

English | [日本語](README.md)

![skinning](./skinning.jpg)

## Overview
- This is an instructional sample for closely observing skinning deformation while switching weight distribution and rotation axes
- You can switch between `static`, `soft`, `hard`, and `weight view` and compare only the skinning appearance on the same shape

## How to Run
- Open [./skinning.html](./skinning.html)
- Use a browser with WebGPU support, and check the help panel and HUD together with the sample when needed

## webg Features Used
- `WebgApp`: initializes display, input, and the operation guide
- `Skeleton / Shape.addVertexWeight`
- `SmoothShader`: shared entry point for `static / skinned / weight_debug`
- `Space.drawBones`: draws the bones
- Live mode switching for direct comparison on the spot

## Checkpoints
- When switching between hard and soft weights, confirm how the continuity at bend boundaries changes, and consider weight design choices for different uses
- Confirm that deformation occurs as expected for each axis switch and rotation operation, making it easier to detect mistakes in local-axis interpretation
- Confirm that display changes immediately when `S / W / V` is pressed, making it easy to compare `static / soft / hard / weight debug` back and forth

## Controls
- `S`: toggle static mode
- `W`: switch the weight mode between hard and soft
- `V`: toggle weight visualization on or off
- `X / Y / Z`: choose the object rotation axis
- `J / L`: rotate the object around the selected axis
- `R`: reset the object rotation
- `Space`: pause or resume bone animation
