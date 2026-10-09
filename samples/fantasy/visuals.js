// ---------------------------------------------
// visuals.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 手続き形状から部隊を作り、Nodeの階層で姿勢を動かす

import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import { tiles, world } from "./rules.mjs";

// 表示用のNode・Shape・ラベルを所有し、HPやターンはゲームの論理状態へ委ねる
export class Visuals {
  // ゲームの地形とユニットを表示するNode・Shape・ラベルを準備する
  constructor(app, units) {
    this.app = app;
    this.shapes = [];
    this.rigs = new Map();
    this.markers = new Map();

    // パレット内はRGB。part()でRGBAとspecularを補い、直接ShapeのPBR契約を満たす
    this.palette = {
      steel: { color: [0.48, 0.59, 0.62], metallic: 0.88, roughness: 0.28 },
      gold: { color: [0.8, 0.56, 0.2], metallic: 0.85, roughness: 0.25 },
      blue: { color: [0.09, 0.3, 0.4], metallic: 0.15, roughness: 0.65 },
      violet: { color: [0.29, 0.16, 0.42], metallic: 0.1, roughness: 0.72 },
      green: { color: [0.19, 0.36, 0.23], metallic: 0.05, roughness: 0.8 },
      red: { color: [0.4, 0.13, 0.12], metallic: 0.2, roughness: 0.6 },
      skin: { color: [0.73, 0.52, 0.34], metallic: 0, roughness: 0.8 },
      orcskin: { color: [0.34, 0.46, 0.23], metallic: 0, roughness: 0.85 },
      dark: { color: [0.075, 0.095, 0.09], metallic: 0.15, roughness: 0.6 },
      glow: {
        color: [0.25, 0.75, 0.85], metallic: 0.3, roughness: 0.25,
        emissive_factor: [0.1, 1.5, 2]
      },
      selected: {
        color: [0.9, 0.68, 0.22], metallic: 0.5, roughness: 0.3,
        emissive_factor: [0.5, 0.27, 0.03]
      },
      reachable: {
        color: [0.09, 0.42, 0.34], metallic: 0.25, roughness: 0.5,
        emissive_factor: [0.015, 0.15, 0.09]
      },
      enemy: {
        color: [0.65, 0.16, 0.1], metallic: 0.2, roughness: 0.55,
        emissive_factor: [0.15, 0.015, 0.005]
      }
    };

    this.createMarkers();
    for (const unit of units) this.character(unit);
    this.createTrees();
  }

  // マーカーは初めに用意し、行動の区切りでhideを切り替えて使い回す
  createMarkers() {
    for (const tile of tiles) {
      const position = world(tile);
      position[1] += 0.085;
      const node = this.part(null, `reach-${tile.x}-${tile.z}`, "box",
        [1.52, 0.025, 1.52], position, "reachable");
      node.hide(true);
      this.markers.set(`${tile.x},${tile.z}`, node);
    }
    this.selection = this.part(null, "selection", "ring",
      [0.73, 0.035], [0, 0, 0], "selected");
  }

  // 木は通行禁止マスの装飾として配置し、表示の障害物をrulesの地形へ揃える
  createTrees() {
    for (const tile of tiles.filter(candidate => candidate.blocked && (candidate.x === 0 || candidate.x === 8))) {
      const root = this.app.space.addNode(null, `pine-${tile.x}-${tile.z}`);
      root.setPosition(...world(tile));
      this.part(root, `trunk-${tile.x}-${tile.z}`, "box",
        [0.18, 0.9, 0.18], [0, 0.45, 0], "dark");

      for (let i = 0; i < 3; i++) {
        this.part(root, `pine-crown-${tile.x}-${tile.z}-${i}`, "cone",
          [1.1, 0.65 - i * 0.13], [0, 0.95 + i * 0.5, 0], "green");
      }
    }
  }

  // Shapeの確定→PBR材質→Nodeへの取付けを一か所にまとめ、所有するShapeも記録する
  part(parent, id, type, size, position, material) {
    const shape = new Shape(this.app.getGPU());
    let asset;
    if (type === "sphere") asset = Primitive.sphere(size[0], 12, 16);
    else if (type === "cone") asset = Primitive.cone(size[0], size[1], 12);
    else if (type === "ring") asset = Primitive.donut(size[0], size[1], 8, 32);
    else asset = Primitive.cuboid(...size);

    shape.applyPrimitiveAsset(asset);
    shape.endShape();
    const surface = this.palette[material];
    shape.setMaterial(id, { specular: 1, ...surface, color: [...surface.color, 1] });

    const node = this.app.space.addNode(parent, id);
    node.setPosition(...position);
    node.addShape(shape);
    this.shapes.push(shape);
    return node;
  }

  // rootを移動し、四肢の関節Nodeを回転する。各部品の座標は親からのローカル位置
  character(unit) {
    const root = this.app.space.addNode(null, `unit-${unit.id}`);
    const parts = [];
    // 表示対象を管理用の配列へ加え、位置・姿勢の更新と解放の対象にする
    const add = (parent, id, type, size, position, material) => {
      const node = this.part(parent, `${unit.id}-${id}`, type, size, position, material);
      parts.push(node);
      return node;
    };
    const enemy = unit.team === "enemy";
    const mage = unit.id === "mage" || unit.id === "hex";
    const archer = unit.id === "ranger";
    const cloth = enemy ? "red" : mage ? "violet" : archer ? "green" : "blue";

    const base = add(root, "base", "ring", [0.51, 0.045], [0, 0.09, 0], enemy ? "enemy" : "blue");
    add(root, "body", "box", [0.6, 0.65, 0.4], [0, 0.87, 0], mage ? cloth : enemy ? "dark" : "steel");
    add(root, "tabard", "box", [0.36, 0.7, 0.045], [0, 0.78, 0.24], cloth);
    add(root, "belt", "box", [0.63, 0.09, 0.44], [0, 0.7, 0], "gold");
    add(root, "head", "sphere", [0.23], [0, 1.4, 0], enemy ? "orcskin" : "skin");

    if (mage) {
      add(root, "robe", "cone", [0.7, 0.46], [0, 0.47, 0], cloth);
      add(root, "hat", "cone", [0.52, 0.33], [0, 1.74, 0], cloth);
      add(root, "brim", "ring", [0.3, 0.055], [0, 1.5, 0], "gold");
    } else {
      add(root, "helmet", "box", [0.49, 0.2, 0.46], [0, 1.55, 0], enemy ? "dark" : "steel");
      add(root, "crest", "box", [0.09, 0.28, 0.37], [0, 1.72, 0], cloth);
      if (enemy) {
        for (const x of [-0.28, 0.28]) {
          add(root, `horn-${x}`, "cone", [0.34, 0.09], [x, 1.62, 0], "gold");
        }
      }
    }

    // limbsは左脚・左腕・右脚・右腕の順。歩行時に対角の手足を同時に振る
    const limbs = [];
    for (const side of [-1, 1]) {
      const leg = this.app.space.addNode(root, `${unit.id}-leg-${side}`);
      leg.setPosition(side * 0.19, 0.55, 0);
      parts.push(leg);
      add(leg, `boot-${side}`, "box", [0.23, 0.5, 0.3], [0, -0.24, 0.035], "dark");
      limbs.push(leg);

      const arm = this.app.space.addNode(root, `${unit.id}-arm-${side}`);
      arm.setPosition(side * 0.4, 1.13, 0);
      parts.push(arm);
      add(arm, `sleeve-${side}`, "box", [0.21, 0.43, 0.24], [0, -0.16, 0], cloth);
      add(arm, `hand-${side}`, "sphere", [0.12], [0, -0.4, 0], enemy ? "orcskin" : "skin");
      limbs.push(arm);

      // 装備を腕の子にすることで、腕の回転に剣・弓・杖が追従する
      if (side === 1) {
        if (mage) {
          add(arm, "staff", "box", [0.065, 1.25, 0.065], [0.04, -0.26, 0.1], "gold");
          add(arm, "orb", "sphere", [0.16], [0.04, 0.45, 0.1], "glow");
        } else if (archer) {
          const bow = add(arm, "bow", "ring", [0.38, 0.035], [0.12, -0.2, 0.1], "gold");
          bow.rotateX(90);
          add(arm, "string", "box", [0.02, 0.65, 0.02], [0.12, -0.2, 0.1], "dark");
        } else {
          add(arm, "sword", "box", [0.11, 0.75, 0.045], [0, 0.1, 0.12], "steel");
          add(arm, "guard", "box", [0.34, 0.06, 0.08], [0, -0.27, 0.12], "gold");
        }
      } else if (!mage && !archer) {
        add(arm, "shield", "box", [0.42, 0.58, 0.12], [-0.1, -0.18, 0.15], cloth);
        add(arm, "shield-cross", "box", [0.07, 0.42, 0.04], [-0.1, -0.18, 0.23], "gold");
      }
    }

    // 背面にも役割の色を置き、斜めから見ても部隊を区別できるようにする
    add(root, "cape", "box", [0.58, 0.82, 0.07], [0, 0.84, -0.25], cloth);
    const label = document.createElement("div");
    label.className = `unit-label ${enemy ? "enemy" : ""}`;
    label.innerHTML = `<b>${unit.name}</b><div class="health"><i></i></div>`;
    document.querySelector("#labels").append(label);

    this.rigs.set(unit.id, { root, limbs, angles: [0, 0, 0, 0], parts, base, label, yaw: 0 });
    this.place(unit);
  }

  // 再開始時は既存のrootを初期マスへ戻し、四肢を基準姿勢へ戻す
  place(unit) {
    const rig = this.rigs.get(unit.id);
    rig.root.setPosition(...world(unit));
    this.pose(rig, 0);
  }

  // rotateXは加算なので、望む角度と前回角度の差だけを渡して累積を防ぐ
  pose(rig, phase) {
    rig.limbs.forEach((node, index) => {
      const angle = Math.sin(phase) * ((index === 0 || index === 3) ? 1 : -1) * 28;
      node.rotateX(angle - rig.angles[index]);
      rig.angles[index] = angle;
    });
  }

  // rootの向きを移動先・攻撃先へ合わせる。ここでも回転は差分として加える
  face(rig, from, to) {
    const yaw = Math.atan2(to[0] - from[0], to[2] - from[2]) * 180 / Math.PI;
    rig.root.rotateY(yaw - rig.yaw);
    rig.yaw = yaw;
  }

  // hideは各NodeのShapeに適用するため、戦闘不能時は全ての子部品も隠す
  visible(unit) {
    const rig = this.rigs.get(unit.id);
    rig.parts.forEach(node => node.hide(unit.hp <= 0));
    rig.label.hidden = unit.hp <= 0;
  }

  // 手動で作ったShapeだけを解放する。SceneのShapeや粒子はWebgSceneAppが所有する
  destroy() {
    for (const shape of this.shapes) shape.destroy();
  }
}
