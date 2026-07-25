// ---------------------------------------------------------
// headless_tests/core/matrix/headless_probe.js  2026/07/13
//   Numeric contracts for Matrix Reverse-Z projections
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Matrix from "../../../webg/Matrix.js";
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z,
  linearizeDepth,
  projectViewDepth
} from "../../../webg/DepthConvention.js";

// 相対誤差で数値を比較し、失敗時にactual、expected、differenceを残します
function assertAlmostEqual(actual, expected, tolerance, label) {
  const scale = Math.max(1.0, Math.abs(actual), Math.abs(expected));
  const difference = Math.abs(actual - expected);
  assert.ok(
    difference <= tolerance * scale,
    `${label}: actual=${actual} expected=${expected} difference=${difference}`
  );
}

// 列優先Matrixでview-space中心点[0,0,-distance,1]をclip spaceへ移し、Z/Wをdepthとして返します
// Matrix側のprojection係数だけを読むため、DepthConventionの参照投影式と独立に比較できます
function projectCenterDepth(matrix, distance) {
  const m = matrix.mat;
  const viewZ = -distance;
  const clipZ = m[10] * viewZ + m[14];
  const clipW = m[11] * viewZ + m[15];
  assert.notEqual(clipW, 0.0, `clipW must not be zero for distance=${distance}`);
  return clipZ / clipW;
}

// 正射影はclip.w=1なので、中心点のclip Zをそのままdepthとして返します
function projectOrthoCenterDepth(matrix, distance) {
  const m = matrix.mat;
  return m[10] * -distance + m[14];
}

// 公開4引数形式はCamera Reverse-Zへ固定し、DepthConventionを知らない低レベル利用者も
// 通常カメラの正しいdepthを作れることを明示指定版との全要素比較で確認します
{
  const implicitPerspective = new Matrix().makeProjectionMatrix(0.1, 100.0, 60.0, 1.0);
  const explicitPerspective = new Matrix().makeProjectionMatrix(
    0.1, 100.0, 60.0, 1.0, CAMERA_REVERSE_Z
  );
  assert.deepEqual(implicitPerspective.mat, explicitPerspective.mat);

  const implicitWh = new Matrix().makeProjectionMatrixWH(0.1, 100.0, 0.2, 0.2);
  const explicitWh = new Matrix().makeProjectionMatrixWH(
    0.1, 100.0, 0.2, 0.2, CAMERA_REVERSE_Z
  );
  assert.deepEqual(implicitWh.mat, explicitWh.mat);

  const implicitOrtho = new Matrix().makeProjectionMatrixOrtho(0.1, 100.0, 10.0, 10.0);
  const explicitOrtho = new Matrix().makeProjectionMatrixOrtho(
    0.1, 100.0, 10.0, 10.0, CAMERA_REVERSE_Z
  );
  assert.deepEqual(implicitOrtho.mat, explicitOrtho.mat);

  // nullや独自objectを通常カメラ指定と解釈せず、undefinedだけを公開4引数として扱います
  assert.throws(
    () => new Matrix().makeProjectionMatrix(0.1, 100.0, 60.0, 1.0, null),
    /must be CAMERA_REVERSE_Z or SHADOW_STANDARD_Z/
  );
}

// finite farの透視Reverse-Z行列を、DepthConventionの参照式と複数距離で比較します
// near/farだけでなく対数的に離した中間値を使い、係数の符号や分母の誤りを検出します
{
  const near = 0.125;
  const far = 1000000.0;
  const matrix = new Matrix().makeProjectionMatrix(
    near,
    far,
    67.0,
    16.0 / 9.0,
    CAMERA_REVERSE_Z
  );
  const distances = [near, 0.25, 1.0, 100.0, 100000.0, far];
  for (const distance of distances) {
    const actual = projectCenterDepth(matrix, distance);
    const expected = projectViewDepth(distance, near, far, CAMERA_REVERSE_Z);
    assertAlmostEqual(actual, expected, 1.0e-13, `perspective Reverse-Z ${distance}`);
    if (distance !== far) {
      assertAlmostEqual(
        linearizeDepth(actual, near, far, CAMERA_REVERSE_Z),
        distance,
        1.0e-10,
        `perspective Reverse-Z restored ${distance}`
      );
    }
  }
  assert.ok(matrix.mat.every(Number.isFinite));
}

// infinite farの透視Reverse-Z行列ではm10=0、m14=nearとなり、depth=near/distanceを満たします
{
  const near = 0.5;
  const matrix = new Matrix().makeProjectionMatrix(
    near,
    Infinity,
    75.0,
    2.0,
    CAMERA_REVERSE_Z
  );
  assert.equal(matrix.mat[10], 0.0);
  assert.equal(matrix.mat[14], near);
  for (const distance of [near, 1.0, 1000.0, 1.0e12]) {
    assertAlmostEqual(
      projectCenterDepth(matrix, distance),
      near / distance,
      1.0e-14,
      `infinite Reverse-Z ${distance}`
    );
  }
}

// near planeの幅高指定版も同じZ係数を使い、X/Y scaleだけが指定寸法から決まることを確認します
{
  const near = 0.25;
  const far = 5000.0;
  const width = 0.8;
  const height = 0.45;
  const matrix = new Matrix().makeProjectionMatrixWH(
    near,
    far,
    width,
    height,
    CAMERA_REVERSE_Z
  );
  assertAlmostEqual(matrix.mat[0], 2.0 * near / width, 1.0e-14, "WH X scale");
  assertAlmostEqual(matrix.mat[5], 2.0 * near / height, 1.0e-14, "WH Y scale");
  for (const distance of [near, 1.0, 100.0, far]) {
    assertAlmostEqual(
      projectCenterDepth(matrix, distance),
      projectViewDepth(distance, near, far, CAMERA_REVERSE_Z),
      1.0e-13,
      `WH Reverse-Z ${distance}`
    );
  }
}

// 正射影Reverse-Zは距離に対して線形に1から0へ減少します
// 透視用の1/distance分布と取り違えないよう、四分点を明示値で確認します
{
  const near = 2.0;
  const far = 102.0;
  const matrix = new Matrix().makeProjectionMatrixOrtho(
    near,
    far,
    20.0,
    10.0,
    CAMERA_REVERSE_Z
  );
  assertAlmostEqual(projectOrthoCenterDepth(matrix, near), 1.0, 1.0e-14, "ortho near");
  assertAlmostEqual(projectOrthoCenterDepth(matrix, 27.0), 0.75, 1.0e-14, "ortho 25%");
  assertAlmostEqual(projectOrthoCenterDepth(matrix, 52.0), 0.5, 1.0e-14, "ortho 50%");
  assertAlmostEqual(projectOrthoCenterDepth(matrix, 77.0), 0.25, 1.0e-14, "ortho 75%");
  assertAlmostEqual(projectOrthoCenterDepth(matrix, far), 0.0, 1.0e-14, "ortho far");
}

// Shadow Map用通常Zはconventionを明示した場合だけ生成でき、従来のnear=0、far=1を維持します
{
  const near = 1.0;
  const far = 101.0;
  const perspective = new Matrix().makeProjectionMatrix(
    near,
    far,
    45.0,
    1.0,
    SHADOW_STANDARD_Z
  );
  for (const distance of [near, 2.0, 50.0, far]) {
    assertAlmostEqual(
      projectCenterDepth(perspective, distance),
      projectViewDepth(distance, near, far, SHADOW_STANDARD_Z),
      1.0e-13,
      `shadow perspective ${distance}`
    );
  }

  const ortho = new Matrix().makeProjectionMatrixOrtho(
    near,
    far,
    10.0,
    10.0,
    SHADOW_STANDARD_Z
  );
  assertAlmostEqual(projectOrthoCenterDepth(ortho, near), 0.0, 1.0e-14, "shadow ortho near");
  assertAlmostEqual(projectOrthoCenterDepth(ortho, 51.0), 0.5, 1.0e-14, "shadow ortho middle");
  assertAlmostEqual(projectOrthoCenterDepth(ortho, far), 1.0, 1.0e-14, "shadow ortho far");
}

// 入力値の誤りを行列へ書いてから表示で発見するのではなく、生成時点で例外にします
{
  assert.throws(
    () => new Matrix().makeProjectionMatrix(0.0, 100.0, 60.0, 1.0, CAMERA_REVERSE_Z),
    /near must be > 0/
  );
  assert.throws(
    () => new Matrix().makeProjectionMatrix(1.0, 0.5, 60.0, 1.0, CAMERA_REVERSE_Z),
    /far must be > 1/
  );
  assert.throws(
    () => new Matrix().makeProjectionMatrix(0.1, 100.0, 180.0, 1.0, CAMERA_REVERSE_Z),
    /vfov must be < 180/
  );
  assert.throws(
    () => new Matrix().makeProjectionMatrix(0.1, 100.0, 60.0, 0.0, CAMERA_REVERSE_Z),
    /ratio must be > 0/
  );
  assert.throws(
    () => new Matrix().makeProjectionMatrixOrtho(0.1, Infinity, 10.0, 10.0, CAMERA_REVERSE_Z),
    /far must be finite/
  );
}

console.log("matrix_projection_contracts: all projection contracts passed");
