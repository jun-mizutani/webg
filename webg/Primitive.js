// ---------------------------------------------
//  Primitive.js     2026/03/14
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ModelAsset from "./ModelAsset.js";

class GeometryWriter {
  // Primitive 生成用の CPU 側 geometry writer を初期化する
  constructor(options = {}) {
    // Shape の addVertex / addPlane / calcUV に相当する責務だけを持たせ、
    // ここでは GPU や shader には触れない
    this.txMode = options.txMode ?? 0;
    this.txAxis = options.txAxis ?? 0;
    this.txScaleU = options.txScaleU ?? 1.0;
    this.txScaleV = options.txScaleV ?? 1.0;
    this.txOffU = options.txOffU ?? 0.0;
    this.txOffV = options.txOffV ?? 0.0;
    this.positions = [];
    this.uvs = [];
    this.indices = [];
    this.altVertices = [];
  }

  // 現在の mapping 設定から UV を計算する
  calcUV(x, y, z) {
    let u = 0.0;
    let v = 0.0;
    const PI = Math.PI;

    switch (this.txMode) {
      case 0:
        switch (this.txAxis) {
          case 0:
          case 1:
            u = Math.atan2(-z, x);
            v = Math.atan2(Math.sqrt(x * x + z * z), y);
            break;
          case -1:
            u = Math.atan2(z, x);
            v = Math.atan2(Math.sqrt(x * x + z * z), -y);
            break;
          case 2:
            u = Math.atan2(-z, y);
            v = Math.atan2(Math.sqrt(y * y + z * z), x);
            break;
          case -2:
            u = Math.atan2(z, y);
            v = Math.atan2(Math.sqrt(y * y + z * z), -x);
            break;
          case 3:
            u = Math.atan2(y, x);
            v = Math.atan2(Math.sqrt(x * x + y * y), z);
            break;
          case -3:
            u = Math.atan2(-y, x);
            v = Math.atan2(Math.sqrt(x * x + y * y), -z);
            break;
          default:
            break;
        }
        if (u < 0.0) u += PI * 2.0;
        u = u / (PI * 2.0);
        v = 1.0 - v / PI;
        break;

      case 1:
        switch (this.txAxis) {
          case 0:
          case 1:
            u = x / this.txScaleU + this.txOffU;
            v = y / this.txScaleV + this.txOffV;
            break;
          case -1:
            u = -(x / this.txScaleU + this.txOffU);
            v = y / this.txScaleV + this.txOffV;
            break;
          case 2:
            u = z / this.txScaleU + this.txOffU;
            v = y / this.txScaleV + this.txOffV;
            break;
          case -2:
            u = -(z / this.txScaleU + this.txOffU);
            v = y / this.txScaleV + this.txOffV;
            break;
          case 3:
            u = x / this.txScaleU + this.txOffU;
            v = -(z / this.txScaleV + this.txOffV);
            break;
          case -3:
            u = -(x / this.txScaleU + this.txOffU);
            v = -(z / this.txScaleV + this.txOffV);
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }

    return [u, v];
  }

  // 1 頂点を追加し、頂点番号を返す
  addVertex(x, y, z) {
    this.positions.push(x, y, z);
    this.uvs.push(...this.calcUV(x, y, z));
    return this.positions.length / 3 - 1;
  }

  // 明示 UV 付き頂点を追加する
  addVertexUV(x, y, z, u, v) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  // 三角形を追加する
  addTriangle(a, b, c) {
    this.indices.push(a, b, c);
  }

  // UV seam などで複製した頂点ペアを登録する
  // `source` と `duplicate` は同じ位置を持つが、UV や属性だけを分けたい頂点として扱う
  // Shape 側ではこの対応表を使って法線を共有し、見た目の seam を抑える
  addAltVertex(source, duplicate) {
    this.altVertices.push(source, duplicate);
  }

  // 多角形を扇形に三角形化して追加する
  addPlane(indices) {
    for (let i = 0; i < indices.length - 2; i++) {
      this.addTriangle(indices[0], indices[i + 1], indices[i + 2]);
    }
  }

  // ModelAsset geometry に変換する
  toGeometry() {
    return {
      vertexCount: this.positions.length / 3,
      polygonCount: this.indices.length / 3,
      positions: this.positions,
      uvs: this.uvs,
      indices: this.indices,
      altVertices: this.altVertices
    };
  }
}

export default class Primitive {

  // Primitive API へ渡す mapping 設定を正規化する
  static getOptions(options = {}) {
    return {
      txMode: options.txMode ?? 0,
      txAxis: options.txAxis ?? 0,
      txScaleU: options.txScaleU ?? 1.0,
      txScaleV: options.txScaleV ?? 1.0,
      txOffU: options.txOffU ?? 0.0,
      txOffV: options.txOffV ?? 0.0,
      flipV: options.flipV ?? false
    };
  }

  // 単一 mesh / 単一 node の ModelAsset を返す
  static makeAsset(name, geometry) {
    return ModelAsset.fromData({
      version: "1.0",
      type: "webg-model-asset",
      meta: {
        name,
        generator: "Primitive.js",
        source: name,
        unitScale: 1.0,
        upAxis: "Y"
      },
      materials: [],
      meshes: [
        {
          id: `${name}_mesh`,
          name,
          geometry
        }
      ],
      skeletons: [],
      animations: [],
      nodes: [
        {
          id: `${name}_node`,
          name: `${name}_node`,
          parent: null,
          mesh: `${name}_mesh`,
          transform: {
            translation: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1]
          }
        }
      ]
    });
  }

  // 回転体の共通ロジックを使って geometry を作る
  static makeRevolutionGeometry(latitude, longitude, verts, spherical, options = {}) {
    // Shape.revolution() は球面UVの継ぎ目で addTriangle() 側が頂点複製を行っていた
    // Primitive では Shape の内部処理に頼れないため、
    // はじめから各経線ごとに独立した頂点と UV を持つ構造にして seam を避ける
    const writer = new GeometryWriter(this.getOptions(options));
    const n = latitude + 1;
    const t = Math.PI * 2.0 / longitude;
    const headX = verts[0];
    const headY = verts[1];
    const tailX = verts[latitude * 2];
    const tailY = verts[latitude * 2 + 1];
    const closesProfile = Math.abs(headX - tailX) < 1.0e-7 && Math.abs(headY - tailY) < 1.0e-7;
    const flipV = options.flipV ?? false;

    // 0列目から longitude 列目まで作ることで、最後の列を seam 専用の複製として持つ
    // これにより u=0 と u=1 を同じ三角形で共有せずに済む
    // ただし見た目としては同じ連続面なので、法線だけは 0列目と共有したい
    // そのため geometry.altVertices に seam 対応表を保存し、
    // Shape 側の法線加算後に duplicate へ source の法線を写せるようにする
    for (let j = 0; j <= longitude; j++) {
      const angle = t * j;
      const u = j / longitude;
      for (let i = 0; i < n; i++) {
        const x = verts[i * 2] * Math.cos(angle);
        const y = verts[i * 2 + 1];
        const z = -verts[i * 2] * Math.sin(angle);
        // revolution 系の標準は上側が v=1 だが、背面からの見え方を整えたい場合は反転できる
        const v = flipV ? i / latitude : 1.0 - i / latitude;
        const index = writer.addVertexUV(x, y, z, u, v);
        if (j === longitude) {
          writer.addAltVertex(i, index);
        }
      }
    }

    for (let j = 0; j < longitude; j++) {
      for (let i = 0; i < latitude; i++) {
        writer.addPlane([
          j * n + i,
          j * n + i + 1,
          (j + 1) * n + i + 1,
          (j + 1) * n + i
        ]);
      }
    }

    // ドーナツのように断面そのものが閉じている場合は、
    // 断面の先頭点と末尾点も同一点として法線を共有したい
    // 経度 seam と組み合わさると角の頂点が 4 個に分かれるため、
    // 後段の normal 平均化では連結成分全体をまとめて扱う
    if (closesProfile) {
      for (let j = 0; j <= longitude; j++) {
        writer.addAltVertex(j * n, j * n + latitude);
      }
    }

    return writer.toGeometry();
  }

  // 回転体メッシュを生成する
  static revolution(latitude, longitude, verts, spherical, options = {}) {
    return this.makeAsset(
      "revolution",
      this.makeRevolutionGeometry(latitude, longitude, verts, spherical, options)
    );
  }

  // 球を生成する
  static sphere(radius, latitude, longitude, options = {}) {
    const vertices = [];
    vertices.push(radius / 10000);
    vertices.push(radius);
    for (let i = 1; i < latitude; i++) {
      vertices.push(radius * Math.sin(i * Math.PI / latitude));
      vertices.push(radius * Math.cos(i * Math.PI / latitude));
    }
    vertices.push(radius / 10000);
    vertices.push(-radius);
    return this.makeAsset(
      "sphere",
      this.makeRevolutionGeometry(latitude, longitude, vertices, true, options)
    );
  }

  // トーラスを生成する
  static donut(radius, radiusTube, latitude, longitude, options = {}) {
    const vertices = [];
    const pi = Math.PI;
    for (let i = 0; i < latitude + 1; i++) {
      vertices.push(radius + radiusTube * Math.cos(2 * pi * (0.5 - i / latitude)));
      vertices.push(radiusTube * Math.sin(2 * pi * (0.5 - i / latitude)));
    }
    return this.makeAsset(
      "donut",
      this.makeRevolutionGeometry(latitude, longitude, vertices, false, options)
    );
  }

  // 円錐を生成する
  static cone(height, radius, n, options = {}) {
    return this.makeAsset(
      "cone",
      this.makeRevolutionGeometry(2, n, [0.0001, height, radius, 0, 0.0001, 0], true, options)
    );
  }

  // 台形円錐を生成する
  static truncated_cone(height, radiusTop, radiusBottom, n, options = {}) {
    return this.makeAsset(
      "truncated_cone",
      this.makeRevolutionGeometry(
        3,
        n,
        [0.0001, height, radiusTop, height, radiusBottom, -height, 0.0001, -height],
        true,
        options
      )
    );
  }

  // 双円錐を生成する
  static double_cone(height, radius, n, options = {}) {
    return this.makeAsset(
      "double_cone",
      this.makeRevolutionGeometry(2, n, [0.0001, height, radius, 0, 0.0001, -height], true, options)
    );
  }

  // 角柱を生成する
  static prism(height, radius, n, options = {}) {
    return this.makeAsset(
      "prism",
      this.makeRevolutionGeometry(3, n, [0.0001, height, radius, height, radius, -height, 0.0001, -height], true, options)
    );
  }

  // 矢印形状を生成する
  static arrow(length, head, width, n, options = {}) {
    return this.makeAsset(
      "arrow",
      this.makeRevolutionGeometry(
        4,
        n,
        [0.0001, length, width * 3, length - head, width, length - head, width, 0, 0.0001, 0],
        true,
        options
      )
    );
  }

  // 直方体を生成する
  static cuboid(size_x, size_y, size_z, options = {}) {
    const writer = new GeometryWriter(this.getOptions(options));
    const sx = size_x / 2.0;
    const sy = size_y / 2.0;
    const sz = size_z / 2.0;

    writer.addVertex(-sx, sy, -sz);
    writer.addVertex(-sx, -sy, -sz);
    writer.addVertex(sx, -sy, -sz);
    writer.addVertex(sx, sy, -sz);

    writer.addVertex(-sx, sy, -sz);
    writer.addVertex(sx, sy, -sz);
    writer.addVertex(sx, sy, sz);
    writer.addVertex(-sx, sy, sz);

    writer.addVertex(sx, sy, -sz);
    writer.addVertex(sx, -sy, -sz);
    writer.addVertex(sx, -sy, sz);
    writer.addVertex(sx, sy, sz);

    writer.addVertex(-sx, sy, -sz);
    writer.addVertex(-sx, sy, sz);
    writer.addVertex(-sx, -sy, sz);
    writer.addVertex(-sx, -sy, -sz);

    writer.addVertex(-sx, -sy, -sz);
    writer.addVertex(-sx, -sy, sz);
    writer.addVertex(sx, -sy, sz);
    writer.addVertex(sx, -sy, -sz);

    writer.addVertex(-sx, sy, sz);
    writer.addVertex(sx, sy, sz);
    writer.addVertex(sx, -sy, sz);
    writer.addVertex(-sx, -sy, sz);

    writer.addPlane([3, 2, 1, 0]);
    writer.addPlane([7, 6, 5, 4]);
    writer.addPlane([11, 10, 9, 8]);
    writer.addPlane([15, 14, 13, 12]);
    writer.addPlane([19, 18, 17, 16]);
    writer.addPlane([23, 22, 21, 20]);

    return this.makeAsset("cuboid", writer.toGeometry());
  }

  // UV展開付き直方体を生成する
  static mapCuboid(size_x, size_y, size_z) {
    const writer = new GeometryWriter({ txMode: -1 });
    const sx = size_x / 2.0;
    const sy = size_y / 2.0;
    const sz = size_z / 2.0;

    writer.addVertexUV(-sx, sy, -sz, 0.25, 0.75);
    writer.addVertexUV(-sx, -sy, -sz, 0.25, 1.0);
    writer.addVertexUV(sx, -sy, -sz, 0.50, 1.0);
    writer.addVertexUV(sx, sy, -sz, 0.50, 0.75);

    writer.addVertexUV(-sx, sy, -sz, 0.25, 0.75);
    writer.addVertexUV(sx, sy, -sz, 0.50, 0.75);
    writer.addVertexUV(sx, sy, sz, 0.50, 0.50);
    writer.addVertexUV(-sx, sy, sz, 0.25, 0.50);

    writer.addVertexUV(sx, sy, -sz, 0.50, 0.75);
    writer.addVertexUV(sx, -sy, -sz, 0.75, 0.75);
    writer.addVertexUV(sx, -sy, sz, 0.75, 0.50);
    writer.addVertexUV(sx, sy, sz, 0.50, 0.50);

    writer.addVertexUV(-sx, sy, -sz, 0.25, 0.75);
    writer.addVertexUV(-sx, sy, sz, 0.25, 0.50);
    writer.addVertexUV(-sx, -sy, sz, 0.00, 0.50);
    writer.addVertexUV(-sx, -sy, -sz, 0.00, 0.75);

    writer.addVertexUV(-sx, -sy, -sz, 0.25, 0.00);
    writer.addVertexUV(-sx, -sy, sz, 0.25, 0.25);
    writer.addVertexUV(sx, -sy, sz, 0.50, 0.25);
    writer.addVertexUV(sx, -sy, -sz, 0.50, 0.00);

    writer.addVertexUV(-sx, sy, sz, 0.25, 0.50);
    writer.addVertexUV(sx, sy, sz, 0.50, 0.50);
    writer.addVertexUV(sx, -sy, sz, 0.50, 0.25);
    writer.addVertexUV(-sx, -sy, sz, 0.25, 0.25);

    writer.addPlane([3, 2, 1, 0]);
    writer.addPlane([7, 6, 5, 4]);
    writer.addPlane([11, 10, 9, 8]);
    writer.addPlane([15, 14, 13, 12]);
    writer.addPlane([19, 18, 17, 16]);
    writer.addPlane([23, 22, 21, 20]);

    return this.makeAsset("map_cuboid", writer.toGeometry());
  }

  // 立方体を生成する
  static cube(size, options = {}) {
    return this.cuboid(size, size, size, options);
  }

  // UV展開付き立方体を生成する
  static mapCube(size) {
    return this.mapCuboid(size, size, size);
  }

  // デバッグ表示向け骨形状を生成する
  static debugBone(a, options = {}) {
    const writer = new GeometryWriter(this.getOptions(options));

    writer.addVertex(0, 10 * a, 0);
    writer.addVertex(0, a, a);
    writer.addVertex(0, 0, 0);
    writer.addVertex(0, a, -a);
    writer.addVertex(3 * a, a, 0);
    writer.addVertex(0, 2 * a, 0);
    writer.addVertex(-a, a, 0);
    writer.addVertex(0, 0, 0);
    writer.addVertex(0, 10 * a, 0);
    writer.addVertex(0, a, a);
    writer.addVertex(0, 0, 0);
    writer.addVertex(0, a, -a);
    writer.addVertex(3 * a, a, 0);
    writer.addVertex(0, 2 * a, 0);
    writer.addVertex(-a, a, 0);
    writer.addVertex(0, 0, 0);
    writer.addPlane([0, 1, 2, 3]);
    writer.addPlane([4, 5, 6, 7]);
    writer.addPlane([11, 10, 9, 8]);
    writer.addPlane([15, 14, 13, 12]);

    return this.makeAsset("debug_bone", writer.toGeometry());
  }
}
