// UTF-8 scene documents with optional gzip storage.
// Fetch may already decode HTTP Content-Encoding; inspect bytes to avoid double decoding.
export async function readSceneText(response, sourceUrl) {
  if (!/\.gz(?:[?#]|$)/i.test(sourceUrl)) return response.text();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    if (!/\bgzip\b/i.test(response.headers?.get('content-encoding') ?? '')) {
      throw new Error(`Expected gzip scene document: ${sourceUrl}`);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (typeof DecompressionStream !== 'function') throw new Error('Scene gzip reading requires DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decoded = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}

// Compress the source text itself, including Japanese comments and original formatting.
export async function compressSceneYAML(text) {
  if (typeof text !== 'string') throw new TypeError('SceneYAML source must be a string');
  if (typeof CompressionStream !== 'function') throw new Error('Scene gzip writing requires CompressionStream');
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
