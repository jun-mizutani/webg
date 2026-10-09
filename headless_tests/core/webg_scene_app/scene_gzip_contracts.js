import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import SceneDefinition from '../../../webg/app/SceneDefinition.js';
import { compressSceneYAML, readSceneText } from '../../../webg/SceneText.js';

const yaml = '# 日本語コメントを保持\nname: compressed\nversion: 1\nrenderer: { profile: studio }\nmaterialsUrl: ./materials.yml.gz\nphysicsUrl: ./physics.yaml.gz\n';
const responses = new Map([
  ['http://localhost/project.yaml.gz?v=1', yaml],
  ['http://localhost/materials.yml.gz', '- id: ball\n  color: [1, 0, 0, 1]\n'],
  ['http://localhost/physics.yaml.gz', 'space: { gravity: [0, -9.8, 0] }\n'],
]);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => {
    assert.ok(responses.has(url), url);
    return new Response(gzipSync(responses.get(url)));
  };
  const project = await SceneDefinition.load('http://localhost/project.yaml.gz?v=1');
  assert.equal(project.orientationFormat, 'euler');
  assert.equal((await project.loadMaterials())[0].id, 'ball');
  assert.deepEqual((await project.loadPhysics()).space.gravity, [0, -9.8, 0]);
  project.destroy();
} finally {
  globalThis.fetch = originalFetch;
}
const blob = await compressSceneYAML(yaml);
assert.equal(await readSceneText(new Response(blob), 'scene.yaml.gz'), yaml);
assert.equal(await readSceneText(new Response(yaml, { headers: { 'Content-Encoding': 'gzip' } }), 'scene.yaml.gz'), yaml);
await assert.rejects(() => readSceneText(new Response('plain'), 'scene.yaml.gz'), /Expected gzip/);
await assert.rejects(() => readSceneText(new Response(new Uint8Array([31, 139, 0])), 'scene.yaml.gz'));
const sample = readFileSync(new URL('../../../samples/project_app/domino_36_03_project.yaml', import.meta.url), 'utf8');
assert.equal(await readSceneText(new Response(await compressSceneYAML(sample)), 'domino.yaml.gz'), sample);
console.log('PASS scene_gzip_contracts');
