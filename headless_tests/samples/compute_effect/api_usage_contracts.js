// ---------------------------------------------------------
// headless_tests/samples/compute_effect/api_usage_contracts.js  2026/07/23
//   v2 integrated API and documentation contracts for compute_effect
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const main = read("../../../samples/compute_effect/main.js");
const html = read("../../../samples/compute_effect/compute_effect.html");
const readmeJa = read("../../../samples/compute_effect/README.md");
const readmeEn = read("../../../samples/compute_effect/README.en.md");
const indexJa = read("../../../samples/compute_effect/index.html");
const indexEn = read("../../../samples/compute_effect/index.en.html");
const sampleIndex = read("../../../samples/index.html");

// 旧lit G-buffer、個別projection、eye World cloneをsampleへ残しません
{
  assert.doesNotMatch(main, /gbufferColorMode|litMaterial|createGBufferProjectionParams/);
  assert.doesNotMatch(main, /cameraWorld\s*[,}]|app\.eye\.worldMatrix\.clone/);
  assert.doesNotMatch(main, /projectionNear\s*:/);
  assert.doesNotMatch(main, /projectionFar\s*:\s*app\.projectionFar/);
}

// WebgAppが渡す同一frameをrenderSceneとencodeへ接続します
{
  assert.match(
    main,
    /onBeforeDraw:\s*\(\{ cameraFrame \}\)[\s\S]+pipeline\.renderScene\(\s*app\.space,\s*cameraFrame,\s*app\.clearColor/
  );
  assert.match(
    main,
    /onAfterDraw3d:\s*\(\{ cameraFrame \}\)[\s\S]+pipeline\.encode\(gpu\.commandEncoder,\s*\{\s*cameraFrame,/
  );
}

// 全Shapeがv2 surface materialを明示し、color alphaを反射率として使用しません
{
  assert.match(main, /color:\s*\[color\[0\], color\[1\], color\[2\], 1\.0\]/);
  assert.match(main, /specular:\s*reflectivity/);
  assert.match(main, /roughness:\s*options\.roughness/);
  assert.match(main, /metallic:\s*options\.metallic/);
  assert.match(main, /emissive:\s*options\.emissive/);
}

// Tone Map後のcopyとHUDはattachment構成の異なる二passとして順番を固定します
{
  assert.match(
    main,
    /screen\.beginPresentPass\([\s\S]+copyPass\.draw\(finalColor\);[\s\S]+screen\.clearDepthBuffer\(\);/
  );
  assert.doesNotMatch(main, /screen\.beginPass\(\{[\s\S]{0,160}depthView:\s*null/);
  assert.match(html, /main\.js\?v=20260723_dof_coverage/);
}

// Fog、Vignette、透明合成、Local Lightを含むPipeline全体をPaletteから調整します
{
  for (const option of [
    "ssao", "shadow", "ssr", "fog", "toon", "dof", "bloom", "edge", "vignette"
  ]) {
    assert.match(main, new RegExp(`${option}(Enabled|:)`), `${option} must be connected`);
  }
  assert.match(main, /alpha:\s*state\.glassAlpha/);
  assert.match(main, /type:\s*"point"/);
  assert.match(main, /type:\s*"cone"/);
  assert.match(main, /lights:\s*buildLocalLights\(\)/);
  assert.match(main, /sixteenthWidth:\s*pipeline\.dofPass\.getSixteenthTarget\(\)\.getWidth\(\)/);
  assert.match(main, /sixteenthHeight:\s*pipeline\.dofPass\.getSixteenthTarget\(\)\.getHeight\(\)/);
  assert.match(main, /pageRows:\s*10/);
  assert.match(main, /pageRowsByPage:\s*\[10, 9, 10, 10, 10, 8, 5, 6\]/);
  assert.match(main, /stepper\("dofBlurRadius", "DoF Blur Radius", 0\.25, 3\.0, 0\.25, 2\)/);
  assert.match(main, /stepper\("dofCocScale", "DoF CoC Scale", 0\.0, 2\.0, 0\.10\)/);
  assert.match(main, /cocScale:\s*state\.dofCocScale/);
  assert.match(main, /commands:\s*commandPages\.flat\(\)/);
  assert.equal((main.match(/next\(\),/g) ?? []).length, 8);
  const pageBodies = main.match(/\[\n\s+(?:toggle|\{ id: "reset")[\s\S]*?\n\s+\]/g) ?? [];
  assert.equal(pageBodies.length, 8, "the Palette must keep eight explicit pages");
  for (const [index, page] of pageBodies.entries()) {
    const firstRow = page.split("\n").slice(1, 5).join("\n");
    assert.match(firstRow, /next\(\),?$/, `page ${index + 1} must put Next in the fourth cell`);
  }
}

// 日英READMEとHTML版は同じv2処理フローと注意点を説明します
{
  for (const document of [readmeJa, indexJa]) {
    assert.match(document, /DeferredLightingPass/);
    assert.match(document, /surface material/);
    assert.match(document, /beginPresentPass/);
    assert.match(document, /clearDepthBuffer/);
    assert.doesNotMatch(document, /litMaterial/);
  }
  for (const document of [readmeEn, indexEn]) {
    assert.match(document, /DeferredLightingPass/);
    assert.match(document, /surface material/);
    assert.match(document, /beginPresentPass/);
    assert.match(document, /clearDepthBuffer/);
    assert.doesNotMatch(document, /litMaterial/);
  }
  assert.match(sampleIndex, /明示材質G-buffer、Deferred Lighting/);
}

console.log("sample_compute_effect_api_usage_contracts: all integrated sample contracts passed");
