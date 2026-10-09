// ---------------------------------------------
// rules.test.mjs  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// CPU上で経路と戦闘の規則を確認する

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  tiles, key, tileAt, world, newUnits, paths,
  canAttack, damage, outcome, enemyPlan, occupant
} from "./rules.mjs";

// 初期配置を変えても、論理上のマスと表示位置の対応を保つ
test("初期配置は通行可能で重複せず、表示高度はマップと一致", () => {
  const units = newUnits();
  assert.equal(new Set(units.map(unit => key(unit.x, unit.z))).size, 6);

  for (const unit of units) {
    assert.equal(tileAt(unit.x, unit.z).blocked, false);
    assert.equal(world(unit)[1], world(tileAt(unit.x, unit.z))[1]);
    assert.ok(world(unit).every(Number.isFinite));
  }
});

test("段差上りは2を消費し、味方・敵・障害物を通り抜けない", () => {
  const units = newUnits();
  const unit = units[0];
  const routes = paths(unit, units);

  assert.equal(routes.get("3,4").cost, 4);
  assert.equal(routes.has("3,3"), false);
  assert.equal(routes.has("4,7"), false);
  assert.equal(routes.has("5,7"), false);
  assert.equal(routes.has("0,5"), false);

  for (const { path, cost } of routes.values()) {
    let previous = tileAt(unit.x, unit.z);
    let spent = 0;

    for (const next of path) {
      assert.equal(Math.abs(previous.x - next.x) + Math.abs(previous.z - next.z), 1);
      assert.ok(Math.abs(next.h - previous.h) <= 1);
      assert.equal(next.blocked, false);
      assert.equal(occupant(units, next.x, next.z), undefined);
      spent += next.h > previous.h ? 2 : 1;
      previous = next;
    }

    assert.equal(spent, cost);
    assert.ok(cost <= unit.move);
  }
});

test("近接射程、高低差、味方誤射禁止と高所ダメージ", () => {
  const [knight, mage] = newUnits();
  const enemy = { ...newUnits()[3], x: 3, z: 4 };

  assert.equal(canAttack(knight, enemy), false);
  knight.z = 5;
  assert.equal(canAttack(knight, enemy), true);
  assert.equal(canAttack(knight, mage), false);
  assert.equal(damage(enemy, knight), 13);
  assert.equal(damage(knight, enemy), 13);

  enemy.hp = 0;
  assert.equal(canAttack(knight, enemy), false);
});

test("敵の計画は移動力内の合法な経路を返す", () => {
  const units = newUnits();
  units[0].z = 4;

  for (const enemy of units.filter(unit => unit.team === "enemy")) {
    const plan = enemyPlan(enemy, units);
    const legal = paths(enemy, units);

    if (plan.path.length) {
      const last = plan.path.at(-1);
      assert.ok(legal.has(key(last.x, last.z)));
      const visited = new Set();

      for (const tile of plan.path) {
        assert.equal(visited.has(key(tile.x, tile.z)), false);
        visited.add(key(tile.x, tile.z));
      }
    }

    assert.equal(plan.target.team, "ally");
  }
});

test("勝利・敗北と戦闘不能ユニットの通行", () => {
  const units = newUnits();
  assert.equal(outcome(units), null);

  units.filter(unit => unit.team === "enemy").forEach(unit => { unit.hp = 0; });
  assert.equal(outcome(units), "victory");

  const lost = newUnits();
  lost.filter(unit => unit.team === "ally").forEach(unit => { unit.hp = 0; });
  assert.equal(outcome(lost), "defeat");

  units[1].hp = 0;
  assert.ok(paths(units[0], units).has("4,7"));
});

// 全通行マスから探索し、さまざまな開始位置から経路が成立することを調べる
test("全通行マスから探索しても段差・占有・移動力の契約を保つ", () => {
  for (const start of tiles.filter(tile => !tile.blocked)) {
    const unit = { ...newUnits()[0], x: start.x, z: start.z };
    const others = newUnits().filter(candidate => candidate.id !== unit.id
      && !(candidate.x === unit.x && candidate.z === unit.z));
    const occupied = [unit, ...others];

    for (const route of paths(unit, occupied).values()) {
      assert.ok(route.cost <= unit.move);
      for (const tile of route.path) {
        assert.equal(tile.blocked, false);
        assert.equal(occupant(occupied, tile.x, tile.z), undefined);
      }
    }
  }
});
