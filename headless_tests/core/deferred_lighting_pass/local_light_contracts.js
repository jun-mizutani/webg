// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/13
//   Local Light input, packing, and cone attenuation contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl,
  DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS,
  DEFERRED_LOCAL_LIGHT_TYPE_IDS,
  DEFERRED_LOCAL_LIGHT_TYPES
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };

// Local Light用storage bufferとuniform writeを記録し、実GPUなしでbyte layoutを検査します
function createGpuProbe() {
  const writes = [];
  const buffers = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture: (descriptor) => ({
      descriptor,
      createView: () => ({ descriptor }),
      destroy() {}
    }),
    createBuffer(descriptor) {
      const buffer = { descriptor, destroy() {} };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor })
  };
  const queue = {
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  const commandEncoder = {
    beginComputePass() {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, writes, buffers };
}

function makeFrame(position = [0.0, 0.0, 0.0], rotation = [0.0, 0.0, 0.0]) {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.setByEuler(rotation[0], rotation[1], rotation[2]);
  cameraWorldMatrix.position(position);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 5000.0,
    vfov: 60.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 16, height = 8) {
  const visibility = {
    getView: () => ({}),
    getWidth: () => width,
    getHeight: () => height
  };
  return {
    albedo: { ...visibility },
    normal: { getView: () => ({}) },
    material: { ...visibility },
    depth: { depthConvention: CAMERA_REVERSE_Z, getDepthSampleView: () => ({}) },
    shadowVisibility: { ...visibility },
    spotShadowVisibility: { ...visibility },
    ambientOcclusion: { ...visibility }
  };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0.0, Math.min(1.0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

// WGSLと同じ符号で、光源からsurfaceへ向く方向と放射方向のdot積を使います
function angularAttenuation(type, direction, lightToSurface, innerAngle, outerAngle) {
  if (type === "point") return 1.0;
  const innerCos = Math.cos(innerAngle * Math.PI / 180.0);
  const outerCos = Math.cos(outerAngle * Math.PI / 180.0);
  const coneCos = direction.reduce(
    (sum, value, index) => sum + value * lightToSurface[index],
    0.0
  );
  return smoothstep(outerCos, innerCos, coneCos);
}

function directionAtAngleFromDown(angleDegrees) {
  const angle = angleDegrees * Math.PI / 180.0;
  return [Math.sin(angle), -Math.cos(angle), 0.0];
}

// Local Lightは4個のvec4fであり、cone係数は距離減衰とは別に一度だけ乗算されます
{
  assert.deepEqual(DEFERRED_LOCAL_LIGHT_TYPES, ["point", "cone"]);
  assert.deepEqual(DEFERRED_LOCAL_LIGHT_TYPE_IDS, { point: 0, cone: 1 });
  assert.equal(DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS, 16);
  const wgsl = buildDeferredLightingWgsl(64);
  assert.match(wgsl, /struct LocalLight\s*\{[\s\S]+positionRadius\s*:\s*vec4f,[\s\S]+colorIntensity\s*:\s*vec4f,[\s\S]+directionInnerCos\s*:\s*vec4f,[\s\S]+outerCosAndType\s*:\s*vec4f/);
  assert.match(wgsl, /let lightToSurface = -surfaceToLight/);
  assert.match(wgsl, /smoothstep\(\s*light\.outerCosAndType\.x,\s*light\.directionInnerCos\.w,\s*coneCos\s*\)/);
  assert.match(wgsl, /\* distanceAttenuation\s*\n\s*\* angularAttenuation/);
  assert.match(wgsl, /if \(angularAttenuation > 0\.0\)/);
}

// 真下、inner/outer間、範囲外、上方向を数値化し、coneが単調に減衰することを確認します
{
  const direction = [0.0, -1.0, 0.0];
  const innerAngle = 30.0;
  const outerAngle = 60.0;
  assert.equal(angularAttenuation("cone", direction, directionAtAngleFromDown(0.0), innerAngle, outerAngle), 1.0);
  const insideFade = [35.0, 45.0, 55.0].map((angle) =>
    angularAttenuation("cone", direction, directionAtAngleFromDown(angle), innerAngle, outerAngle)
  );
  assert.ok(insideFade[0] > insideFade[1]);
  assert.ok(insideFade[1] > insideFade[2]);
  assert.equal(angularAttenuation("cone", direction, directionAtAngleFromDown(61.0), innerAngle, outerAngle), 0.0);
  assert.equal(angularAttenuation("cone", direction, [0.0, 1.0, 0.0], innerAngle, outerAngle), 0.0);
  assert.equal(angularAttenuation("point", direction, [0.0, 1.0, 0.0], innerAngle, outerAngle), 1.0);
}

// 1e10規模のWorld位置を小さいview-space差分へ変換し、64 byte strideの全fieldを検査します
// directionはcamera平行移動を受けず、view回転3x3だけを受けることも同じbufferで確認します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "v2-deferred-local-lights",
    width: 16,
    height: 8,
    maxLights: 2
  });
  await pass.ready;
  assert.equal(pass.lightBuffer.descriptor.size, 2 * 64);
  const base = [1.0e10, -2.0e10, 3.0e10];
  const frame = makeFrame(base, [18.0, -7.0, 3.0]);
  const conePosition = [base[0] + 4.25, base[1] - 2.5, base[2] - 15.75];
  const coneDirection = [0.25, -1.0, -0.35];
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: [
      {
        type: "point",
        position: [base[0] + 1.0, base[1], base[2]],
        color: [0.2, 0.3, 0.4],
        radius: 5.0,
        intensity: 1.5
      },
      {
        type: "cone",
        position: conePosition,
        direction: coneDirection,
        color: [1.0, 0.6, 0.2],
        radius: 7.2,
        intensity: 1.8,
        innerAngle: 70.0,
        outerAngle: 88.0
      }
    ]
  });

  const packed = probe.writes.at(-2).data;
  assert.equal(packed.length, 2 * DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS);
  assert.deepEqual(packed.slice(8, 16), [0.0, 0.0, -1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
  const relativePosition = frame.worldPointToCameraRelative(conePosition);
  assert.deepEqual(relativePosition, [4.25, -2.5, -15.75]);
  const expectedPosition = frame.worldPointToView(conePosition);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(packed[16 + index] - expectedPosition[index]) < 1.0e-5);
  }
  assert.equal(packed[19], Math.fround(7.2));
  assert.deepEqual(packed.slice(20, 24), [1.0, 0.6, 0.2, 1.8]
    .map((value) => Math.fround(value)));
  const directionLength = Math.hypot(...coneDirection);
  const expectedDirection = frame.viewRotationMatrix.mul3x3Vector(
    coneDirection.map((value) => value / directionLength)
  );
  const expectedDirectionLength = Math.hypot(...expectedDirection);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(
      packed[24 + index] - expectedDirection[index] / expectedDirectionLength
    ) < 1.0e-6);
  }
  assert.ok(Math.abs(packed[27] - Math.cos(70.0 * Math.PI / 180.0)) < 1.0e-6);
  assert.ok(Math.abs(packed[28] - Math.cos(88.0 * Math.PI / 180.0)) < 1.0e-6);
  assert.equal(packed[29], DEFERRED_LOCAL_LIGHT_TYPE_IDS.cone);
  assert.deepEqual(packed.slice(30, 32), [0.0, 0.0]);
  pass.destroy();
}

// type、cone固有field、有限値、方向長、角度順序を厳密に拒否し、pointへのfallbackを防ぎます
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  const frame = makeFrame();
  const base = {
    type: "cone",
    position: [0.0, 2.0, -4.0],
    direction: [0.0, -1.0, 0.0],
    color: [1.0, 0.8, 0.5],
    radius: 7.2,
    intensity: 1.8,
    innerAngle: 70.0,
    outerAngle: 88.0
  };
  const encodeLight = (light) => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: [light]
  });
  const { type: omittedType, ...withoutType } = base;
  assert.equal(omittedType, "cone");
  assert.throws(() => encodeLight(withoutType), /lights\[0\]\.type is required/);
  assert.throws(() => encodeLight({ ...base, type: "spot" }), /type must be one of: point, cone/);
  assert.throws(() => encodeLight({ ...base, direction: undefined }), /direction must be a vec3 array/);
  assert.throws(() => encodeLight({ ...base, direction: [0.0, 0.0, 0.0] }), /direction has zero length/);
  assert.throws(() => encodeLight({ ...base, direction: [0.0, -Infinity, 0.0] }), /direction\[1\] must be finite/);
  assert.throws(() => encodeLight({ ...base, position: [NaN, 0.0, 0.0] }), /position\[0\] must be finite/);
  assert.throws(() => encodeLight({ ...base, innerAngle: 88.0, outerAngle: 70.0 }), /innerAngle must be less than outerAngle/);
  assert.throws(() => encodeLight({ ...base, innerAngle: 0.0 }), /innerAngle must be > 0/);
  assert.throws(() => encodeLight({ ...base, outerAngle: 91.0 }), /outerAngle must be <= 90/);
  pass.destroy();
}

console.log("deferred_lighting_pass_local_light_contracts: all Local Light contracts passed");
