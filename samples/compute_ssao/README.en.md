# compute_ssao

English | [日本語](README.md)

![compute_ssao](./compute_ssao.jpg)

## Overview
SSAO is a postprocess that darkens places where nearby surfaces occlude ambient light, making contact areas and corners read more clearly. This sample is a depth-only version: it calculates Ambient Occlusion from scene color and sampleable depth without using a normal G-buffer.

The frame first renders the normal scene into a `RenderTarget` with color and sampleable depth. The compute shader reconstructs view-space position from depth, approximates a normal from neighboring depth differences, and samples depth in up to 16 surrounding directions. Floor contact, wall corners, and gaps between objects become darker in the composite.

This approach is useful because it shows the basic SSAO flow using only existing `RenderTarget` depth, without adding MRT or normal textures. The tradeoff is that normal reconstruction becomes unstable around depth discontinuities and thin objects. Compare it with `samples/compute_ssao_gbuffer` to see the G-buffer normal version.

## How to Run
- Open [./compute_ssao.html](./compute_ssao.html)
- Use a browser with WebGPU support, and check the help panel and CommandPalette together with the sample when needed

## Checkpoints
Press `C` to toggle SSAO and `V` to switch between `composite / scene / ao`. The `ao` view shows only the occlusion coefficient in grayscale, which helps verify the calculation before it is multiplied into the scene color.

`radius` is the screen-space search radius, `strength` is the darkness, and `bias` suppresses false self-occlusion on the same surface. Increasing `samples` adds more directions and smooths the result, but it also increases the number of `textureLoad` calls per pixel.

Because normals are approximated from depth, noise can appear around thin shapes and sudden depth changes. This sample does not change the `webg` core; it is meant to expose both the usefulness and limitations of depth-only SSAO.
