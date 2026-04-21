// ---------------------------------------------
// Texture.js      2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class Texture {
  // テクスチャ管理を初期化し非同期初期化を開始する
  constructor(gpu) {
    // Textureは画像読み込みとGPUTexture/Sampler作成を担当する
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.ready = false;
    this.filename = null;
    this.image = null;
    this.width = 0;
    this.height = 0;
    this.ncol = 0;
    this.texture = null;
    this.view = null;
    this.sampler = null;
    this.usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
    this.textureFormat = null;
    this.textureUsage = 0;
    this.initPromise = this.init();
  }

  async init() {
    // GPUデバイス確定後に既定サンプラを作る
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear"
    });
    this.ready = true;
  }

  // 既存サイズを確認し必要なら再作成する
  ensureTexture(width, height, format = "rgba8unorm", usage) {
    // 同サイズ/同フォーマット/同usageなら既存テクスチャを再利用する
    const texUsage = usage ?? this.usage;
    if (this.texture
      && this.width === width
      && this.height === height
      && this.textureFormat === format
      && this.textureUsage === texUsage) {
      return;
    }
    if (this.texture?.destroy) {
      this.texture.destroy();
    }
    this.texture = this.device.createTexture({
      size: [width, height, 1],
      format,
      usage: texUsage
    });
    this.view = this.texture.createView();
    this.width = width;
    this.height = height;
    this.textureFormat = format;
    this.textureUsage = texUsage;
  }

  // サンプラ/ビュー初期設定を行う
  setupTexture() {
    this.ensureTexture(1, 1);
    const data = new Uint8Array([192, 192, 192, 255]);
    this.queue.writeTexture(
      { texture: this.texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
  }

  // Clampサンプラ設定に切り替える
  setClamp() {
    // Sampler settings are immutable; create a clamp sampler if needed.
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

  // Repeatサンプラ設定に切り替える
  setRepeat() {
    // Repeat sampling is required for meshes that intentionally use U>1
    // at seam-fix vertices.
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat"
    });
  }

  async readImageFromFile(textureFile) {
    // 画像ファイルを読み、GPUTextureへ転送する
    await this.initPromise;
    this.filename = textureFile;
    try {
      const response = await fetch(textureFile);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      // Preserve original RGB even when PNG has alpha; avoids black fringes
      // when shaders use tex.rgb on mostly-opaque meshes.
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
      this.ensureTexture(bitmap.width, bitmap.height);
      this.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: this.texture },
        [bitmap.width, bitmap.height]
      );
      this.image = bitmap;
      this.width = bitmap.width;
      this.height = bitmap.height;
      this.ncol = 4;
      return true;
    } catch (err) {
      throw new Error(`Texture.readImageFromFile failed for '${textureFile}': ${err?.message ?? err}`);
    }
  }

  async readNormalMapFromFile(textureFile) {
    // 既にDCCツール等で生成済みの法線マップを、そのままGPUテクスチャ化する
    // 処理経路は通常テクスチャと同じで、呼び出し側で「用途」を明示するためのAPI
    return this.readImageFromFile(textureFile);
  }

  // `luma/r/g/b/a` 指定を内部チャンネル番号へ解決する
  _resolveHeightChannel(channel) {
    if (channel === undefined || channel === null) {
      return -1;
    }
    if (typeof channel === "number") {
      if (channel >= 0 && channel <= 3) return channel;
      throw new Error(`Texture height channel index must be 0..3: ${channel}`);
    }
    const key = String(channel).toLowerCase();
    if (key === "luma") return -1;
    if (key === "r" || key === "red") return 0;
    if (key === "g" || key === "green") return 1;
    if (key === "b" || key === "blue") return 2;
    if (key === "a" || key === "alpha") return 3;
    throw new Error(`Texture height channel must be luma/r/g/b/a: ${channel}`);
  }

  // 1画素から高さ値を取り出す
  _heightFromRgba(r, g, b, a, channel) {
    // 1画素から「高さ」1値を取り出す
    // luma指定時は人間の明るさ知覚に近い重みでRGBを合成する
    const idx = this._resolveHeightChannel(channel);
    if (idx === 0) return r / 255;
    if (idx === 1) return g / 255;
    if (idx === 2) return b / 255;
    if (idx === 3) return a / 255;
    // luma
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // 近傍高さサンプルを取得する
  _sampleHeightFromRgba(src, width, height, x, y, wrap, channel) {
    if (!wrap && (x < 0 || x >= width || y < 0 || y >= height)) {
      throw new Error("Texture height sampling coordinates must stay inside the texture when wrap=false");
    }
    const sx = wrap ? ((x % width) + width) % width : x;
    const sy = wrap ? ((y % height) + height) % height : y;
    const p = (sy * width + sx) * 4;
    return this._heightFromRgba(src[p], src[p + 1], src[p + 2], src[p + 3], channel);
  }

  async _toRgbaPixels(image, width, height, ncol = 4) {
    // ハイト→法線変換用に任意ソースをRGBA生配列へ正規化する
    if (image instanceof Uint8Array) {
      if (ncol === 4) {
        return { data: image, width, height, ncol: 4 };
      }
      if (ncol === 3) {
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < image.length; i += 3, j += 4) {
          rgba[j] = image[i];
          rgba[j + 1] = image[i + 1];
          rgba[j + 2] = image[i + 2];
          rgba[j + 3] = 255;
        }
        return { data: rgba, width, height, ncol: 4 };
      }
      throw new Error("Unsupported color channels for Uint8Array source.");
    }

    if (image?.data && image?.width && image?.height) {
      // ImageData相当オブジェクトを受けた場合
      const arr = image.data instanceof Uint8Array
        ? image.data
        : new Uint8Array(image.data);
      return this._toRgbaPixels(arr, image.width, image.height, 4);
    }

    if (!image || !width || !height) {
      throw new Error("Image source is empty.");
    }

    let canvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("2D context is unavailable.");
    }
    ctx.drawImage(image, 0, 0, width, height);
    const id = ctx.getImageData(0, 0, width, height);
    return { data: new Uint8Array(id.data), width, height, ncol: 4 };
  }

  async makeNormalMapPixelsFromHeightMap(options = {}) {
    // ハイトマップから法線マップRGBAを生成する
    // 計算は中央差分:
    //   dx = h(x+1,y) - h(x-1,y)
    //   dy = h(x,y+1) - h(x,y-1)
    // から、接平面法線 N = normalize([-dx, -dy, 1]) を作る
    const source = options.source;
    const width = options.width;
    const height = options.height;
    const ncol = options.ncol;
    const channel = options.channel;
    const strength = Number(options.strength);
    const wrap = !!options.wrap;
    const invertY = !!options.invertY;

    if (!source || width <= 0 || height <= 0) {
      throw new Error("Invalid source for normal map generation.");
    }

    const src = await this._toRgbaPixels(source, width, height, ncol);
    const out = new Uint8Array(width * height * 4);
    // エンジン/ツール間でY方向規約が異なる場合に合わせる
    const sySign = invertY ? -1.0 : 1.0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // 近傍4点をサンプルして勾配を近似する
        const hL = this._sampleHeightFromRgba(src.data, width, height, x - 1, y, wrap, channel);
        const hR = this._sampleHeightFromRgba(src.data, width, height, x + 1, y, wrap, channel);
        const hD = this._sampleHeightFromRgba(src.data, width, height, x, y - 1, wrap, channel);
        const hU = this._sampleHeightFromRgba(src.data, width, height, x, y + 1, wrap, channel);

        // strength を掛けて凹凸強度を調整する
        const dx = (hR - hL) * strength;
        const dy = (hU - hD) * strength * sySign;

        let nx = -dx;
        let ny = -dy;
        let nz = 1.0;
        // 正規化して単位法線へする
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (!Number.isFinite(len) || len <= 1.0e-8) {
          throw new Error(`Texture normal map generation produced an invalid normal length at (${x}, ${y})`);
        }
        nx /= len;
        ny /= len;
        nz /= len;

        const p = (y * width + x) * 4;
        // [-1,1] を [0,255] に再マップして法線マップ画素へ格納
        out[p] = Math.round((nx * 0.5 + 0.5) * 255);
        out[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        out[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        out[p + 3] = 255;
      }
    }
    return { image: out, width, height, ncol: 4 };
  }

  async buildNormalMapFromHeightMap(options = {}) {
    // 生成した法線マップをこのTextureへ設定する
    const normal = await this.makeNormalMapPixelsFromHeightMap(options);
    this.setImage(normal.image, normal.width, normal.height, normal.ncol);
    return true;
  }

  async readNormalMapFromHeightFile(heightMapFile, options = {}) {
    // 画像をハイトマップとして読み込み、その場で法線マップ化する
    await this.readImageFromFile(heightMapFile);
    return this.buildNormalMapFromHeightMap(options);
  }

  // 小数部を返す内部ユーティリティ
  _fract(v) {
    return v - Math.floor(v);
  }

  // 線形補間を返す内部ユーティリティ
  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // 0..1の平滑補間係数を返す内部ユーティリティ
  _smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  // 2D格子座標から擬似乱数を生成する
  _hash2D(ix, iy, seed = 0) {
    // 格子点に対する擬似乱数value noise / dots 配置の共通乱数源
    const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
    return this._fract(s);
  }

  // 2D value noiseを計算する
  _valueNoise2D(x, y, seed = 0) {
    // 2D value noise: 周囲4格子乱数を平滑補間する
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const tx = this._smoothstep01(x - x0);
    const ty = this._smoothstep01(y - y0);

    const v00 = this._hash2D(x0, y0, seed);
    const v10 = this._hash2D(x1, y0, seed);
    const v01 = this._hash2D(x0, y1, seed);
    const v11 = this._hash2D(x1, y1, seed);

    const a = this._lerp(v00, v10, tx);
    const b = this._lerp(v01, v11, tx);
    return this._lerp(a, b, ty);
  }

  // 複数オクターブのノイズ合成値を計算する
  _fbmNoise2D(x, y, options = {}) {
    // fBm: 複数オクターブのvalue noiseを合成して自然な凹凸を作る
    const octaves = Math.floor(options.octaves ?? 4);
    const persistence = Number(options.persistence ?? 0.5);
    const lacunarity = Number(options.lacunarity ?? 2.0);
    const seed = Number(options.seed ?? 0);
    let amp = 1.0;
    let freq = 1.0;
    let sum = 0.0;
    let norm = 0.0;
    for (let i = 0; i < octaves; i++) {
      sum += this._valueNoise2D(x * freq, y * freq, seed + i * 17.0) * amp;
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    if (norm <= 0.0) return 0.0;
    return sum / norm;
  }

  // dotsパターンの高さ値を計算する
  _dotsPatternHeight(x, y, options = {}) {
    // セルごとにランダム中心を置いたドットハイト生物的な「ぶつぶつ」表現向け
    const seed = Number(options.seed ?? 0);
    const jitter = Number(options.jitter ?? 0.35);
    const radius = Number(options.dotRadius ?? 0.28);
    // dotRadiusRange:
    //   1.0 で均一サイズ
    //   2.0 で「おおよそ2倍レンジ」のサイズばらつき
    //   (半径係数を [1/sqrt(range), sqrt(range)] に分布させる)
    const radiusRange = Number(options.dotRadiusRange ?? 1.0);
    const softness = Number(options.softness ?? 0.35);
    const mode = String(options.dotMode ?? "add").toLowerCase();
    // regularGrid=true ならドット中心をセル中央へ固定し、規則配置にする
    const regularGrid = !!options.regularGrid;

    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let h = mode === "max" ? 0.0 : 0.5;

    // 近傍セルを評価して最寄りドット寄与を計算する
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        const gy = cy + oy;
        const localJitter = regularGrid ? 0.0 : jitter;
        const jx = (this._hash2D(gx, gy, seed + 11.0) * 2.0 - 1.0) * localJitter;
        const jy = (this._hash2D(gx, gy, seed + 29.0) * 2.0 - 1.0) * localJitter;
        const r0 = 1.0 / Math.sqrt(radiusRange);
        const r1 = Math.sqrt(radiusRange);
        const radiusScale = this._lerp(r0, r1, this._hash2D(gx, gy, seed + 53.0));
        const localRadius = radius * radiusScale;
        const px = gx + 0.5 + jx;
        const py = gy + 0.5 + jy;
        const dx = x - px;
        const dy = y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        const edge0 = localRadius;
        const edge1 = localRadius * (1.0 + softness);
        const t = 1.0 - this._smoothstep01((d - edge0) / Math.max(1e-6, (edge1 - edge0)));
        if (mode === "max") {
          if (h < t) h = t;
        } else if (mode === "sub") {
          h -= t * 0.5;
        } else {
          h += t * 0.5;
        }
      }
    }
    return Math.max(0.0, Math.min(1.0, h));
  }

  // 手続きハイトマップ（`noise`/`dots`）を生成する
  makeProceduralHeightMapPixels(options = {}) {
    // 手続き生成ハイトマップをRGBA配列として作る
    // pattern:
    //   - "noise": fBmノイズ
    //   - "dots" : 水玉/ぶつぶつ
    const width = Math.floor(options.width);
    const height = Math.floor(options.height);
    const scale = Number(options.scale);
    const pattern = String(options.pattern).toLowerCase();
    const contrast = Number(options.contrast);
    const bias = Number(options.bias);
    const invert = !!options.invert;
    const out = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = (x / width) * scale;
        const v = (y / height) * scale;
        let h;
        if (pattern === "dots" || pattern === "cells" || pattern === "bumps") {
          h = this._dotsPatternHeight(u, v, options);
        } else {
          h = this._fbmNoise2D(u, v, options);
        }

        // コントラスト/バイアス調整
        h = (h - 0.5) * contrast + 0.5 + bias;
        if (invert) h = 1.0 - h;
        h = Math.max(0.0, Math.min(1.0, h));

        const g = Math.round(h * 255);
        const p = (y * width + x) * 4;
        out[p] = g;
        out[p + 1] = g;
        out[p + 2] = g;
        out[p + 3] = 255;
      }
    }
    return { image: out, width, height, ncol: 4 };
  }

  // 手続きハイトマップを現在Textureへ反映する
  buildProceduralHeightMap(options = {}) {
    // 手続き生成したハイトマップをこのTextureへ設定する
    const heightMap = this.makeProceduralHeightMapPixels(options);
    this.setImage(heightMap.image, heightMap.width, heightMap.height, heightMap.ncol);
    return true;
  }

  async buildNormalMapFromProceduralHeight(options = {}) {
    // 手続きハイト -> 法線マップ を一括で生成してこのTextureへ設定する
    const heightMap = this.makeProceduralHeightMapPixels(options);
    return this.buildNormalMapFromHeightMap({
      source: heightMap.image,
      width: heightMap.width,
      height: heightMap.height,
      ncol: 4,
      channel: options.heightChannel,
      strength: options.normalStrength ?? options.strength,
      wrap: options.wrap,
      invertY: !!options.invertY
    });
  }

  // 粒子ビルボード向けRGBAテクスチャを手続き生成する
  makeProceduralBillboardTexturePixels(options = {}) {
    // options一覧
    // width/height:
    //   生成解像度
    //   4..128 にクランプされる
    //   大きいほど形状ディテールは増えるが更新コストも上がる
    //
    // seed:
    //   ノイズの位相を決める種
    //   同じ値なら毎回同じ絵が生成される
    //
    // noiseScale:
    //   ノイズの空間周波数
    //   値を上げると細かい模様、下げると大きなうねりになる
    //
    // noiseAmount:
    //   ベースアルファに対するfBmノイズ寄与量
    //   0で滑らか、1でノイズの影響が最大
    //
    // dotsAmount:
    //   fBmノイズとdotsノイズの混合比
    //   0でfBm寄り、1で粒状パターン寄り
    //
    // edgeSoftness:
    //   半径外側のフェード幅
    //   小さいと輪郭が硬く、大きいと煙のように柔らかくなる
    //
    // radius:
    //   粒子の有効半径
    //   1.0前後でクアッド内に収まり、値を下げると小さな塊になる
    //
    // centerSolidRatio:
    //   半径radiusに対する中心コア比率
    //   coreRadius = radius * centerSolidRatio
    //   coreRadius内はalpha 1.0を維持する
    //
    // edgeAlphaAtRadius:
    //   r = radius の時点で維持するアルファ値
    //   その外側はedgeSoftness幅で0へ落ちる
    //
    // centerBoost:
    //   中心側アルファ増強係数
    //   centerMaskを使って中心ほどalphaが増える
    //
    // alphaPower:
    //   アルファに対するガンマ補正
    //   1未満で中間濃度を持ち上げ、1超で中間濃度を抑える
    //
    // style:
    //   "smoke" または "debris"
    //   color生成ロジックと一部alpha補正を切り替える

    // 半透明粒子向けに「円形マスク + ノイズ」を合成して、
    // 中心は濃く、外周は滑らかに透明化したRGBAを生成する
    const width = Math.floor(options.width ?? 96);
    const height = Math.floor(options.height ?? 96);
    const seed = Number(options.seed ?? 17);
    const noiseScale = Number(options.noiseScale ?? 5.2);
    const noiseAmount = Number(options.noiseAmount ?? 0.62);
    const dotsAmount = Number(options.dotsAmount ?? 0.28);
    const edgeSoftness = Number(options.edgeSoftness ?? 0.24);
    const radius = Number(options.radius ?? 0.92);
    // radial profile:
    // - centerSolidRatio までの中心領域は alpha=1.0 を維持
    // - 半径radiusの外周で edgeAlphaAtRadius に落とす
    // - radiusより外は edgeSoftness 幅で 0.0 へフェードアウト
    const centerSolidRatio = Number(options.centerSolidRatio ?? 0.20);
    const edgeAlphaAtRadius = Number(options.edgeAlphaAtRadius ?? 0.20);
    const centerBoost = Number(options.centerBoost ?? 1.35);
    const alphaPower = Number(options.alphaPower ?? 0.82);
    const style = String(options.style ?? "smoke").toLowerCase();
    const out = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const v = (y + 0.5) / height;
        const px = u * 2.0 - 1.0;
        const py = v * 2.0 - 1.0;
        const r = Math.sqrt(px * px + py * py);

        // 円形アルファ
        // - 中心一定領域は1.0維持
        // - 中間リングで1.0 -> edgeAlphaAtRadiusへ減衰
        // - 半径外は0.0へ減衰
        const coreRadius = radius * centerSolidRatio;
        let radial = 1.0;
        if (r > coreRadius) {
          const ringT = this._smoothstep01((r - coreRadius) / Math.max(1e-6, radius - coreRadius));
          radial = this._lerp(1.0, edgeAlphaAtRadius, ringT);
          if (r > radius) {
            const outT = this._smoothstep01((r - radius) / Math.max(1e-6, edgeSoftness));
            radial = this._lerp(edgeAlphaAtRadius, 0.0, outT);
          }
        }

        // fBm と dots を混ぜて、煙のゆらぎと破片感を同時に作る
        const n = this._fbmNoise2D(u * noiseScale, v * noiseScale, {
          seed,
          octaves: 4,
          persistence: 0.55,
          lacunarity: 2.0
        });
        const d = this._dotsPatternHeight(u * noiseScale * 1.7, v * noiseScale * 1.7, {
          seed: seed + 91.0,
          dotRadius: 0.24,
          dotRadiusRange: 1.8,
          jitter: 0.32,
          softness: 0.45,
          dotMode: "max",
          regularGrid: false
        });
        const mixedNoise = this._lerp(n, d, dotsAmount);

        // 中心は密度高め、周辺はノイズで欠けるアルファにする
        let alpha = radial * this._lerp(1.0 - noiseAmount, 1.0, mixedNoise);
        // 外周側だけノイズで少し崩す
        const edgeMask = this._smoothstep01((r - radius) / Math.max(1e-6, edgeSoftness));
        alpha *= this._lerp(1.0, mixedNoise, edgeMask * 0.35);
        const centerMask = 1.0 - this._smoothstep01(r / Math.max(1e-6, radius));
        alpha = Math.pow(Math.max(0.0, alpha), alphaPower);
        alpha *= this._lerp(1.0, centerBoost, centerMask);
        alpha = Math.max(0.0, Math.min(1.0, alpha));

        let rCol = 0.95;
        let gCol = 0.86;
        let bCol = 0.42;
        if (style === "debris" || style === "fragment") {
          // 破片感を強めるために高周波側を使って彩度を落とす
          const hard = this._smoothstep01((mixedNoise - 0.48) / 0.22);
          rCol = this._lerp(0.42, 0.90, hard);
          gCol = this._lerp(0.38, 0.72, hard);
          bCol = this._lerp(0.34, 0.44, hard);
          alpha *= Math.max(0.0, Math.min(1.0, hard * 1.2));
        } else {
          // 煙寄りは白～薄グレーに寄せる
          const m = this._lerp(0.0, 1.0, mixedNoise);
          rCol = this._lerp(0.82, 1.00, m);
          gCol = this._lerp(0.82, 1.00, m);
          bCol = this._lerp(0.84, 1.00, m);
        }

        const p = (y * width + x) * 4;
        out[p] = Math.round(Math.max(0.0, Math.min(1.0, rCol)) * 255);
        out[p + 1] = Math.round(Math.max(0.0, Math.min(1.0, gCol)) * 255);
        out[p + 2] = Math.round(Math.max(0.0, Math.min(1.0, bCol)) * 255);
        out[p + 3] = Math.round(alpha * 255);
      }
    }

    return { image: out, width, height, ncol: 4 };
  }

  // 粒子ビルボード向け手続きテクスチャをこのTextureへ反映する
  buildProceduralBillboardTexture(options = {}) {
    const tex = this.makeProceduralBillboardTexturePixels(options);
    this.setImage(tex.image, tex.width, tex.height, tex.ncol);
    return true;
  }

  // 画像データをGPUテクスチャへ書き込む
  setImage(image, width, height, ncol) {
    // 生ピクセル配列からGPUTextureを構築する
    this.ensureTexture(width, height);
    let data = image instanceof Uint8Array ? image : new Uint8Array(image);
    let bytesPerPixel = ncol === 4 ? 4 : 3;
    if (ncol === 3) {
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        rgba[j] = data[i];
        rgba[j + 1] = data[i + 1];
        rgba[j + 2] = data[i + 2];
        rgba[j + 3] = 255;
      }
      data = rgba;
      bytesPerPixel = 4;
      ncol = 4;
    }
    this.queue.writeTexture(
      { texture: this.texture },
      data,
      { bytesPerRow: width * bytesPerPixel },
      { width, height, depthOrArrayLayers: 1 }
    );
    this.image = data;
    this.width = width;
    this.height = height;
    this.ncol = ncol;
  }

  // 画像出力（現状は実装依存）
  writeImageToFile() {
    // WebGPU readback is not implemented.
  }

  // 空テクスチャを作成する
  createTexture(width, height, ncol, usage) {
    this.usage = usage ?? this.usage;
    this.ensureTexture(width, height, "rgba8unorm", this.usage);
    this.ncol = 4;
    this.image = new Uint8Array(width * height * this.ncol);
  }

  // 全画素を単色で埋める
  fillTexture(r, g, b, a) {
    if (!this.image) return;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const n = (y * this.width + x) * this.ncol;
        this.image[n] = r;
        this.image[n + 1] = g;
        this.image[n + 2] = b;
        if (this.ncol === 4) {
          this.image[n + 3] = a;
        }
      }
    }
  }

  // 指定画素を書き換える
  point(x, y, color) {
    if (!this.image) return false;
    if ((x >= this.width) || (y >= this.height)) return false;
    if ((x < 0) || (y < 0)) return false;
    const n = (y * this.width + x) * this.ncol;
    this.image[n] = color[1];
    this.image[n + 1] = color[2];
    this.image[n + 2] = color[3];
    if (this.ncol === 4) {
      this.image[n + 3] = color[4];
    }
    return true;
  }

  // CPUバッファ内容をGPUへ転送する
  assignTexture() {
    // this.image の内容をGPUTextureへ再転送する
    if (!this.image) return;
    const bytesPerPixel = 4;
    const data = this.image instanceof Uint8Array ? this.image : new Uint8Array(this.image);
    this.queue.writeTexture(
      { texture: this.texture },
      data,
      { bytesPerRow: this.width * bytesPerPixel },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 }
    );
  }

  // 名前を返す
  name() {
    return this.texture;
  }

  // 現状 no-op
  active() {
    // No-op in WebGPU (binding happens via bind groups).
  }

  // `GPUTextureView` を返す
  getView() {
    return this.view;
  }

  // `GPUSampler` を返す
  getSampler() {
    return this.sampler;
  }
}
