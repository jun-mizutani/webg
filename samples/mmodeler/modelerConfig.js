// ---------------------------------------------
// samples/webgmodeler/modelerConfig.js  2026/04/29
//   webgmodeler sample configuration
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
export const TOOL_SELECT_VERTEX = "selectVertex";
export const TOOL_SELECT_FACE = "selectFace";
export const TOOL_ADD_VERTEX = "addVertex";
export const TOOLS = new Set([
  TOOL_SELECT_VERTEX,
  TOOL_SELECT_FACE,
  TOOL_ADD_VERTEX
]);

export const EDITOR_MODE_OBJECT = "object";
export const EDITOR_MODE_EDIT = "edit";
export const EDITOR_MODES = new Set([
  EDITOR_MODE_OBJECT,
  EDITOR_MODE_EDIT
]);

export const DEFAULT_OBJECT_ID = 1;

export const DEFAULT_CAMERA = {
  target: [0.0, 0.8, 0.0],
  distance: 12.0,
  yaw: 28.0,
  pitch: -18.0
};

export const INITIAL_ORBIT_BINDINGS = {
  orbitKeyMap: {
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown"
  },
  panModifierKey: "shift"
};

export const MATERIAL = {
  mesh: {
    color: [0.70, 0.84, 0.96, 1.0],
    ambient: 0.62,
    specular: 0.26,
    power: 24.0,
    emissive: 0.08,
    flat_shading: 1,
    use_texture: 0,
    has_bone: 0
  },
  selectedFace: {
    color: [1.0, 0.82, 0.32, 1.0],
    addColor: [0.20, 0.12, 0.02, 0.0],
    ambient: 0.70,
    specular: 0.18,
    power: 18.0,
    emissive: 0.10,
    flat_shading: 1,
    use_texture: 0,
    has_bone: 0
  },
  selectedObject: {
    color: [0.70, 0.84, 0.96, 1.0],
    addColor: [0.16, 0.12, 0.02, 0.0],
    ambient: 0.66,
    specular: 0.28,
    power: 24.0,
    emissive: 0.10,
    flat_shading: 1,
    use_texture: 0,
    has_bone: 0
  },
  marker: {
    color: [0.30, 0.50, 0.64, 1.0],
    addColor: [0.0, 0.0, 0.0, 0.0],
    ambient: 0.68,
    specular: 0.20,
    power: 18.0,
    emissive: 0.08,
    use_texture: 0,
    has_bone: 0
  },
  selectedMarker: {
    color: [0.30, 0.50, 0.64, 1.0],
    addColor: [0.68, 0.0, 0.0, 0.0],
    ambient: 0.70,
    specular: 0.42,
    power: 30.0,
    emissive: 0.10,
    use_texture: 0,
    has_bone: 0
  },
  grid: {
    color: [0.42, 0.48, 0.52, 1.0],
    ambient: 0.72,
    specular: 0.12,
    power: 8.0,
    emissive: 0.04,
    use_texture: 0,
    has_bone: 0
  }
};
