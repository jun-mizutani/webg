// ---------------------------------------------
// rules.mjs  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// CPUだけで実行する、地形・移動・攻撃・敵の行動規則

export const SIZE = 9;

// マスをMapで識別するキー。xは列、zは行で、ともに0から始まる
export function key(x, z) {
  return `${x},${z}`;
}

// hは段数。描画の高さと移動の判定が同じ地形データを参照する
export const tiles = Array.from({ length: SIZE * SIZE }, (_, index) => {
  const x = index % SIZE;
  const z = Math.floor(index / SIZE);
  const h = z <= 2 ? 2 : z <= 4 ? 1 : 0;
  const obstacles = [[0, 0], [1, 1], [7, 1], [8, 0], [4, 3], [0, 5], [8, 5]];
  const blocked = obstacles.some(position => position[0] === x && position[1] === z);

  return { x, z, h, blocked };
});

// 盤外ならundefinedを返し、移動候補から除外できるようにする
export function tileAt(x, z) {
  return tiles.find(tile => tile.x === x && tile.z === z);
}

// マスの地形情報から描画位置を求め、ユニットはマスへの参照で高さを共有する
export function world(position) {
  const height = position.h ?? tileAt(position.x, position.z).h;
  return [(position.x - 4) * 1.8, 0.22 + height * 0.7, (position.z - 4) * 1.8];
}

// 再開始のたびに独立したデータを作る。movedとactedはターンごとの行動権
export function newUnits() {
  const definitions = [
    {
      id: "knight", name: "リオ", role: "剣士", team: "ally",
      x: 3, z: 7, hp: 38, maxHp: 38, move: 4, range: 1, power: 13
    },
    {
      id: "mage", name: "ルナ", role: "魔術師", team: "ally",
      x: 4, z: 7, hp: 25, maxHp: 25, move: 3, range: 3, power: 12
    },
    {
      id: "ranger", name: "フィン", role: "弓使い", team: "ally",
      x: 5, z: 7, hp: 29, maxHp: 29, move: 5, range: 4, power: 10
    },
    {
      id: "orc", name: "鉄牙", role: "オーク", team: "enemy",
      x: 3, z: 1, hp: 32, maxHp: 32, move: 3, range: 1, power: 10
    },
    {
      id: "hex", name: "影詠み", role: "呪術師", team: "enemy",
      x: 5, z: 1, hp: 24, maxHp: 24, move: 3, range: 3, power: 8
    },
    {
      id: "goblin", name: "赤爪", role: "ゴブリン", team: "enemy",
      x: 6, z: 3, hp: 22, maxHp: 22, move: 4, range: 1, power: 8
    }
  ];

  return definitions.map(unit => ({ ...unit, moved: false, acted: false }));
}

// 占有は生存中の味方・敵を対象とし、戦闘不能の個体のマスは通行可能にする
export function occupant(units, x, z) {
  return units.find(unit => unit.hp > 0 && unit.x === x && unit.z === z);
}

// 攻撃の射程は上下左右のマス距離。移動経路の長さとは区別する
export function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

// Dijkstra法でコスト最小の経路を求める。上りは2、平地・下りは1を消費する
export function paths(unit, units, budget = unit.move) {
  const start = key(unit.x, unit.z);
  const result = new Map([[start, { cost: 0, path: [] }]]);
  const open = [tileAt(unit.x, unit.z)];

  while (open.length) {
    open.sort((a, b) => result.get(key(a.x, a.z)).cost - result.get(key(b.x, b.z)).cost);
    const current = open.shift();
    const route = result.get(key(current.x, current.z));

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = tileAt(current.x + dx, current.z + dz);
      if (!next || next.blocked || Math.abs(next.h - current.h) > 1
        || occupant(units, next.x, next.z)) continue;

      const cost = route.cost + (next.h > current.h ? 2 : 1);
      const id = key(next.x, next.z);
      if (cost > budget || (result.has(id) && result.get(id).cost <= cost)) continue;

      result.set(id, { cost, path: [...route.path, next] });
      open.push(next);
    }
  }

  return result;
}

// 近接は段差1、遠隔は段差2まで届く。この例では遠隔の遮蔽判定を省略する
export function canAttack(attacker, target) {
  if (attacker.hp <= 0 || target.hp <= 0 || attacker.team === target.team
    || distance(attacker, target) > attacker.range) return false;

  const heightDifference = Math.abs(tileAt(attacker.x, attacker.z).h - tileAt(target.x, target.z).h);
  const allowedHeight = attacker.range === 1 ? 1 : 2;

  return heightDifference <= allowedHeight;
}

// 確定ダメージに高所の利点を加える。演出や乱数から戦闘結果を独立させる
export function damage(attacker, target) {
  const higher = tileAt(attacker.x, attacker.z).h > tileAt(target.x, target.z).h;
  return attacker.power + (higher ? 3 : 0);
}

// 生存チームを調べ、終了していなければnullを返す
export function outcome(units) {
  if (!units.some(unit => unit.team === "enemy" && unit.hp > 0)) return "victory";
  if (!units.some(unit => unit.team === "ally" && unit.hp > 0)) return "defeat";
  return null;
}

// 攻撃できるマスまでの経路を探し、今ターンの移動力で歩ける先頭部分を返す
export function enemyPlan(enemy, units) {
  const targets = units.filter(unit => unit.team === "ally" && unit.hp > 0);
  if (!targets.length) return { path: [], target: null };

  const all = paths(enemy, units, 100);
  const reachable = paths(enemy, units);
  const candidates = [];

  for (const target of targets) {
    for (const [id, route] of all) {
      const [x, z] = id.split(",").map(Number);
      const position = { ...enemy, x, z };
      if (canAttack(position, target)) candidates.push({ target, route });
    }
  }
  candidates.sort((a, b) => a.route.cost - b.route.cost || a.target.hp - b.target.hp);

  if (candidates.length) {
    const best = candidates[0];
    let cost = 0;
    let previous = tileAt(enemy.x, enemy.z);
    const path = [];

    for (const tile of best.route.path) {
      cost += tile.h > previous.h ? 2 : 1;
      if (cost > enemy.move) break;
      path.push(tile);
      previous = tile;
    }

    return { path, target: best.target };
  }

  // 対象の周囲にある合法マスから最も近いものを選び、占有状況を保って移動する
  const target = targets.sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
  const routes = [...reachable].map(([id, route]) => ({
    position: tileAt(...id.split(",").map(Number)), route
  }));
  routes.sort((a, b) => distance(a.position, target) - distance(b.position, target)
    || a.route.cost - b.route.cost);

  return { path: routes[0].route.path, target };
}
