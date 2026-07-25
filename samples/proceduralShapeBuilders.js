// -------------------------------------------------
// proceduralShapeBuilders.js       2026/04/05
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

// 手続き的に mesh を育てる builder 群
// 各 sample では WebgApp を入口にしつつ、
// 形状そのものは Shape の low-level API だけで構築する

// 正二十面体を細分化して球面へ投影し、共有 edge を保ったまま icosphere を構築する
export function buildIcosphere(shape, options = {}) {
  const radius = Number(options.radius ?? 1.0);
  const subdivisions = Math.max(0, Math.floor(options.subdivisions ?? 2));
  const flatShading = options.flatShading === true;

  // smooth / flat のどちらも sample 側で明示的に normal を作るため、
  // Shape の自動法線計算は使わない
  shape.setAutoCalcNormals(false);

  const vertices = [];
  let faces = [];

  // まずは subdivision 用の topology 頂点だけを local 配列へ積み、
  // 最後に smooth / flat の方針に応じて Shape へ書き出す
  const addSphereVertex = (x, y, z) => {
    const len = Math.hypot(x, y, z);
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    vertices.push([nx * radius, ny * radius, nz * radius]);
    return vertices.length - 1;
  };

  const t = (1.0 + Math.sqrt(5.0)) * 0.5;

  // 正二十面体の 12 頂点
  addSphereVertex(-1,  t,  0);
  addSphereVertex( 1,  t,  0);
  addSphereVertex(-1, -t,  0);
  addSphereVertex( 1, -t,  0);
  addSphereVertex( 0, -1,  t);
  addSphereVertex( 0,  1,  t);
  addSphereVertex( 0, -1, -t);
  addSphereVertex( 0,  1, -t);
  addSphereVertex( t,  0, -1);
  addSphereVertex( t,  0,  1);
  addSphereVertex(-t,  0, -1);
  addSphereVertex(-t,  0,  1);

  // 正二十面体の 20 面
  faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];

  // edge ごとの中点を cache し、隣接三角形で同じ頂点を共有できるようにする
  const getMidpoint = (cache, ia, ib) => {
    const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    const a = vertices[ia];
    const b = vertices[ib];
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const mz = (a[2] + b[2]) * 0.5;
    const index = addSphereVertex(mx, my, mz);
    cache.set(key, index);
    return index;
  };

  // subdivision は「前段の全 triangle を 4 分割した face 一覧へ置き換える」
  // という流れを level 回だけ繰り返し、細かい icosphere topology を作る
  for (let level = 0; level < subdivisions; level++) {
    const nextFaces = [];
    const midpointCache = new Map();

    for (let i = 0; i < faces.length; i++) {
      const [a, b, c] = faces[i];
      const ab = getMidpoint(midpointCache, a, b);
      const bc = getMidpoint(midpointCache, b, c);
      const ca = getMidpoint(midpointCache, c, a);

      nextFaces.push([a, ab, ca]);
      nextFaces.push([b, bc, ab]);
      nextFaces.push([c, ca, bc]);
      nextFaces.push([ab, bc, ca]);
    }

    faces = nextFaces;
  }

  if (flatShading) {
    // flat shading では face ごとに頂点を独立させ、
    // 同じ面法線を 3 頂点へ与えて facet をはっきり見せる
    for (let i = 0; i < faces.length; i++) {
      const [ia, ib, ic] = faces[i];
      const a = vertices[ia];
      const b = vertices[ib];
      const c = vertices[ic];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len <= 1.0e-8) {
        throw new Error(`buildIcosphere: degenerate triangle detected at face ${i}`);
      }
      const fnx = nx / len;
      const fny = ny / len;
      const fnz = nz / len;

      const p0 = shape.addVertexUV(a[0], a[1], a[2], 0.0, 0.0) - 1;
      const p1 = shape.addVertexUV(b[0], b[1], b[2], 0.0, 0.0) - 1;
      const p2 = shape.addVertexUV(c[0], c[1], c[2], 0.0, 0.0) - 1;
      shape.setVertNormal(p0, fnx, fny, fnz);
      shape.setVertNormal(p1, fnx, fny, fnz);
      shape.setVertNormal(p2, fnx, fny, fnz);
      shape.addTriangle(p0, p1, p2);
    }
  } else {
    // smooth shading では topology 頂点を共有し、最終 triangle 群から平均法線を作る
    for (let i = 0; i < vertices.length; i++) {
      const pos = vertices[i];
      shape.addVertexUV(pos[0], pos[1], pos[2], 0.0, 0.0);
    }

    const normalSums = Array.from({ length: vertices.length }, () => [0.0, 0.0, 0.0]);
    for (let i = 0; i < faces.length; i++) {
      const [ia, ib, ic] = faces[i];
      const a = vertices[ia];
      const b = vertices[ib];
      const c = vertices[ic];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len <= 1.0e-8) {
        throw new Error(`buildIcosphere: degenerate triangle detected at face ${i}`);
      }
      normalSums[ia][0] += nx;
      normalSums[ia][1] += ny;
      normalSums[ia][2] += nz;
      normalSums[ib][0] += nx;
      normalSums[ib][1] += ny;
      normalSums[ib][2] += nz;
      normalSums[ic][0] += nx;
      normalSums[ic][1] += ny;
      normalSums[ic][2] += nz;
    }

    for (let i = 0; i < normalSums.length; i++) {
      const nx = normalSums[i][0];
      const ny = normalSums[i][1];
      const nz = normalSums[i][2];
      const len = Math.hypot(nx, ny, nz);
      if (len <= 1.0e-8) {
        throw new Error(`buildIcosphere: failed to build normal for vertex ${i}`);
      }
      shape.setVertNormal(i, nx / len, ny / len, nz / len);
    }

    for (let i = 0; i < faces.length; i++) {
      const [a, b, c] = faces[i];
      shape.addTriangle(a, b, c);
    }
  }

  return {
    radius,
    subdivisions,
    shading: flatShading ? "flat" : "smooth",
    topologyVertexCount: vertices.length,
    vertexCount: flatShading ? faces.length * 3 : vertices.length,
    triangleCount: faces.length
  };
}

// 周方向 u と幅方向 v から parametric surface を作り、ひねった帯を閉じる
export function buildMobiusStrip(shape, options = {}) {
  const radius = Number(options.radius ?? 2.2);
  const halfWidth = Number(options.halfWidth ?? 0.45);
  const uSegments = Math.max(3, Math.floor(options.uSegments ?? 96));
  const vSegments = Math.max(1, Math.floor(options.vSegments ?? 12));

  // 面法線の加算と endShape() の正規化で smooth な帯を作る
  shape.setAutoCalcNormals(true);

  const grid = [];

  for (let iu = 0; iu <= uSegments; iu++) {
    const row = [];
    const u01 = iu / uSegments;
    const theta = u01 * Math.PI * 2.0;
    const halfTheta = theta * 0.5;

    for (let iv = 0; iv <= vSegments; iv++) {
      const v01 = iv / vSegments;
      const offset = (v01 - 0.5) * 2.0 * halfWidth;

      // webg は Y が上なので、輪の平面は XZ に置く
      const x = (radius + offset * Math.cos(halfTheta)) * Math.cos(theta);
      const z = (radius + offset * Math.cos(halfTheta)) * Math.sin(theta);
      const y = offset * Math.sin(halfTheta);

      const index = shape.addVertexUV(x, y, z, u01, v01) - 1;
      row.push(index);
    }

    grid.push(row);
  }

  for (let iu = 0; iu < uSegments; iu++) {
    for (let iv = 0; iv < vSegments; iv++) {
      const p00 = grid[iu][iv];
      const p10 = grid[iu + 1][iv];
      const p11 = grid[iu + 1][iv + 1];
      const p01 = grid[iu][iv + 1];

      shape.addTriangle(p00, p10, p11);
      shape.addTriangle(p00, p11, p01);
    }
  }

  return {
    radius,
    halfWidth,
    uSegments,
    vSegments,
    rows: grid.length,
    cols: grid[0]?.length ?? 0,
    vertexCount: (uSegments + 1) * (vSegments + 1),
    triangleCount: uSegments * vSegments * 2
  };
}

// 正四面体を 4 つの小 tetra へ再帰分割し、中央を抜いた Sierpinski tetrahedron を作る
export function buildSierpinskiTetrahedron(shape, options = {}) {
  const radius = Number(options.radius ?? 2.2);
  const depth = Math.max(0, Math.floor(options.depth ?? 3));

  // fractal の稜線をはっきり見せるため、面ごとに頂点を複製して flat 寄りに扱う
  shape.setAutoCalcNormals(true);

  const scale = radius / Math.sqrt(3.0);
  const v0 = [ scale,  scale,  scale];
  const v1 = [-scale, -scale,  scale];
  const v2 = [-scale,  scale, -scale];
  const v3 = [ scale, -scale, -scale];

  let triangleCount = 0;
  let tetraCount = 0;

  // tetra の 2 頂点から中点を作り、
  // 再帰の 1 段下で使う corner tetra の新しい角を用意する
  const midpoint = (a, b) => ([
    (a[0] + b[0]) * 0.5,
    (a[1] + b[1]) * 0.5,
    (a[2] + b[2]) * 0.5
  ]);

  // 1 面ごとに頂点を独立登録し、edge を丸めず sharp な表情を保つ
  const pushFace = (a, b, c) => {
    const p0 = shape.addVertexUV(a[0], a[1], a[2], 0.0, 0.0) - 1;
    const p1 = shape.addVertexUV(b[0], b[1], b[2], 1.0, 0.0) - 1;
    const p2 = shape.addVertexUV(c[0], c[1], c[2], 0.5, 1.0) - 1;
    shape.addTriangle(p0, p1, p2);
    triangleCount++;
  };

  // 1 個の tetra を構成する 4 face を、
  // すべて外向き winding になる順でまとめて shape へ追加する
  const addTetraFaces = (a, b, c, d) => {
    tetraCount++;

    // 正四面体の各 face は、中心から見て外側へ法線が向くように winding をそろえる
    // ここが逆だと back-face culling と auto normal の両方が内向きになり、
    // fractal 全体が暗く見えたり、外面が消えたりする
    pushFace(a, c, b);
    pushFace(a, b, d);
    pushFace(a, d, c);
    pushFace(b, c, d);
  };

  // 現在 tetra を 4 つの corner tetra へ分け、
  // depth が尽きるまで同じ分割を繰り返して fractal を育てる
  const recurse = (a, b, c, d, level) => {
    if (level <= 0) {
      addTetraFaces(a, b, c, d);
      return;
    }

    const ab = midpoint(a, b);
    const ac = midpoint(a, c);
    const ad = midpoint(a, d);
    const bc = midpoint(b, c);
    const bd = midpoint(b, d);
    const cd = midpoint(c, d);

    recurse(a,  ab, ac, ad, level - 1);
    recurse(ab, b,  bc, bd, level - 1);
    recurse(ac, bc, c,  cd, level - 1);
    recurse(ad, bd, cd, d,  level - 1);
  };

  recurse(v0, v1, v2, v3, depth);

  return {
    radius,
    depth,
    tetraCount,
    triangleCount,
    vertexCount: triangleCount * 3
  };
}

// palette 補間や smoothstep の入力を 0..1 へ制限し、
// 高さ帯 color の計算が帯外へはみ出さないようにする
const clamp01 = (value) => Math.max(0.0, Math.min(1.0, value));

// 2 値の間を t で線形補間し、
// noise や color band の中間値を分かりやすく作る
const lerp = (a, b, t) => a + (b - a) * t;

// 0..1 の範囲だけを持つ滑らかな補間カーブを返し、
// palette の帯境界が急に切り替わりすぎないようにする
const smoothstep01 = (value) => {
  const t = clamp01(value);
  return t * t * (3.0 - 2.0 * t);
};

// fractal terrain の高さ配列を生成し、必要なら erosion 風 smoothing をかける
export function generateFractalTerrainHeightField(options = {}) {
  const cols = Math.max(2, Math.floor(options.cols ?? 48));
  const rows = Math.max(2, Math.floor(options.rows ?? 48));
  const sizeX = Number(options.sizeX ?? 10.0);
  const sizeZ = Number(options.sizeZ ?? 10.0);
  const heightScale = Number(options.heightScale ?? 2.4);
  const octaves = Math.max(1, Math.floor(options.octaves ?? 5));
  const persistence = Number(options.persistence ?? 0.52);
  const lacunarity = Number(options.lacunarity ?? 2.0);
  const seed = Number(options.seed ?? 1337);
  const erosionIterations = Math.max(0, Math.floor(options.erosionIterations ?? 2));
  const erosionStrength = Math.max(0.0, Number(options.erosionStrength ?? 0.22));
  const erosionTalus = Math.max(0.0, Number(options.erosionTalus ?? 0.10));

  // 座標から安定した疑似乱数値を作り、同じ seed なら毎回同じ terrain を再現する
  const hashNoise = (ix, iz) => {
    let h = seed | 0;
    h ^= Math.imul(ix + 1, 374761393);
    h ^= Math.imul(iz + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };

  // value noise の格子境界で傾きが急に変わりすぎないよう、
  // 補間係数へ cubic fade をかける
  const fade = (t) => t * t * (3.0 - 2.0 * t);

  // 4 点の value noise を補間し、格子の間でも連続した高さを返す
  const valueNoise2d = (x, z) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = x - x0;
    const tz = z - z0;

    const n00 = hashNoise(x0, z0);
    const n10 = hashNoise(x1, z0);
    const n01 = hashNoise(x0, z1);
    const n11 = hashNoise(x1, z1);

    const sx = fade(tx);
    const sz = fade(tz);
    const nx0 = lerp(n00, n10, sx);
    const nx1 = lerp(n01, n11, sx);
    return lerp(nx0, nx1, sz);
  };

  // 低周波と高周波を重ね、terrain の大きな起伏と細部を同時に作る
  const fbm = (x, z) => {
    let amplitude = 1.0;
    let frequency = 1.0;
    let sum = 0.0;
    let norm = 0.0;

    for (let octave = 0; octave < octaves; octave++) {
      sum += valueNoise2d(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return norm > 0.0 ? sum / norm : 0.0;
  };

  // 島状に見せるため、中心から離れるほど高さを下げる
  const radialFalloff = (u, v) => {
    const dx = u - 0.5;
    const dz = v - 0.5;
    const d = Math.sqrt(dx * dx + dz * dz) * 2.0;
    return Math.max(0.0, 1.0 - d * d * 0.55);
  };

  const heights = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0.0));

  for (let row = 0; row <= rows; row++) {
    const v = row / rows;

    for (let col = 0; col <= cols; col++) {
      const u = col / cols;
      const coarse = fbm(u * 3.0 + 1.7, v * 3.0 + 2.9);
      const detail = fbm(u * 10.0 + 7.1, v * 10.0 + 5.3);
      const falloff = radialFalloff(u, v);
      const h01 = Math.max(0.0, coarse * 0.78 + detail * 0.22);
      const lifted = Math.pow(h01, 1.55);
      heights[row][col] = (lifted * falloff - 0.12) * heightScale;
    }
  }

  // steep な段差の高い側から低い側へ少しずつ土砂を動かす簡易モデルで、
  // 侵食そのものというより「侵食後のならされた地形」に近い smoothing を作る
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],           [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];

  for (let iter = 0; iter < erosionIterations; iter++) {
    const delta = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0.0));
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const center = heights[row][col];
        const lowerNeighbors = [];
        let totalExcess = 0.0;

        for (let i = 0; i < neighborOffsets.length; i++) {
          const nr = row + neighborOffsets[i][1];
          const nc = col + neighborOffsets[i][0];
          if (nr < 0 || nr > rows || nc < 0 || nc > cols) {
            continue;
          }
          const drop = center - heights[nr][nc];
          const excess = drop - erosionTalus;
          if (excess > 0.0) {
            lowerNeighbors.push([nr, nc, excess]);
            totalExcess += excess;
          }
        }

        if (lowerNeighbors.length === 0 || totalExcess <= 0.0) {
          continue;
        }

        const transferBudget = totalExcess * erosionStrength * 0.25;
        delta[row][col] -= transferBudget;
        for (let i = 0; i < lowerNeighbors.length; i++) {
          const [nr, nc, excess] = lowerNeighbors[i];
          delta[nr][nc] += transferBudget * (excess / totalExcess);
        }
      }
    }

    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        heights[row][col] += delta[row][col];
      }
    }
  }

  let heightMin = Number.POSITIVE_INFINITY;
  let heightMax = Number.NEGATIVE_INFINITY;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      heightMin = Math.min(heightMin, heights[row][col]);
      heightMax = Math.max(heightMax, heights[row][col]);
    }
  }

  return {
    cols,
    rows,
    sizeX,
    sizeZ,
    heightScale,
    octaves,
    persistence,
    lacunarity,
    seed,
    erosionIterations,
    erosionStrength,
    erosionTalus,
    heights,
    heightMin,
    heightMax
  };
}

// terrain の height field から、高さ帯を見やすい色へ変換した RGBA texture を作る
export function buildTerrainBandTexturePixels(terrain, options = {}) {
  const rows = terrain.rows;
  const cols = terrain.cols;
  const width = cols + 1;
  const height = rows + 1;
  const out = new Uint8Array(width * height * 4);
  const blendWidth = Number(options.blendWidth ?? 0.08);
  const palette = options.palette ?? [
    { level: 0.00, color: [0.10, 0.24, 0.38] },
    { level: 0.18, color: [0.18, 0.44, 0.46] },
    { level: 0.28, color: [0.76, 0.70, 0.48] },
    { level: 0.42, color: [0.34, 0.58, 0.26] },
    { level: 0.66, color: [0.44, 0.48, 0.30] },
    { level: 0.84, color: [0.62, 0.62, 0.64] },
    { level: 1.00, color: [0.96, 0.96, 0.98] }
  ];

  const denom = Math.max(terrain.heightMax - terrain.heightMin, 1.0e-6);
  // 1 点分の height を palette 帯へ当てはめ、
  // 近い 2 色を補間して terrain 用の RGB を返す
  const pickColor = (h) => {
    const t = clamp01((h - terrain.heightMin) / denom);
    for (let i = 0; i < palette.length - 1; i++) {
      const bandA = palette[i];
      const bandB = palette[i + 1];
      if (t <= bandB.level || i === palette.length - 2) {
        const span = Math.max(bandB.level - bandA.level, 1.0e-6);
        const local = smoothstep01(((t - bandA.level) / span - 0.5) / Math.max(blendWidth, 1.0e-6) + 0.5);
        return [
          lerp(bandA.color[0], bandB.color[0], local),
          lerp(bandA.color[1], bandB.color[1], local),
          lerp(bandA.color[2], bandB.color[2], local)
        ];
      }
    }
    return [...palette[palette.length - 1].color];
  };

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const color = pickColor(terrain.heights[row][col]);
      const p = (row * width + col) * 4;
      out[p] = Math.round(clamp01(color[0]) * 255);
      out[p + 1] = Math.round(clamp01(color[1]) * 255);
      out[p + 2] = Math.round(clamp01(color[2]) * 255);
      out[p + 3] = 255;
    }
  }

  return { image: out, width, height, ncol: 4 };
}

// 2D noise を高さへ変換し、共有頂点の grid から連続した terrain mesh を作る
export function buildFractalTerrain(shape, options = {}) {
  const terrain = generateFractalTerrainHeightField(options);
  const cols = terrain.cols;
  const rows = terrain.rows;
  const vertexGrid = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));

  shape.setAutoCalcNormals(true);

  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const z = (v - 0.5) * terrain.sizeZ;
    for (let col = 0; col <= cols; col++) {
      const u = col / cols;
      const x = (u - 0.5) * terrain.sizeX;
      const y = terrain.heights[row][col];
      const index = shape.addVertexUV(x, y, z, u, v) - 1;
      vertexGrid[row][col] = index;
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p00 = vertexGrid[row][col];
      const p10 = vertexGrid[row][col + 1];
      const p11 = vertexGrid[row + 1][col + 1];
      const p01 = vertexGrid[row + 1][col];

      // webg は右手系で +Y が上なので、
      // terrain 上面は外側から見て CCW になる [NW, SW, SE, NE] 相当の順で渡す
      // ここを [p00, p10, p11, p01] にすると外積が -Y を向き、面が裏返る
      shape.addPlane([p00, p01, p11, p10]);
    }
  }

  return {
    ...terrain,
    vertexCount: (rows + 1) * (cols + 1),
    quadCount: rows * cols,
    triangleCount: rows * cols * 2
  };
}
