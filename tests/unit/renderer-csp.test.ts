import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
const policy = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/u)?.[1];

function directive(name: string): string[] {
  const value = policy
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name} `));
  return value?.split(/\s+/u).slice(1) ?? [];
}

describe('Renderer content security policy', () => {
  it('permits only the application media scheme at the image and video sinks', () => {
    expect(policy).toBeDefined();
    expect(directive('img-src')).toContain('serpent:');
    expect(directive('media-src')).toContain('serpent:');
    expect(directive('script-src')).not.toContain("'unsafe-eval'");
    expect(directive('script-src')).not.toContain('*');
  });

  it('permits serpent:// fetches (3D viewer + model pipeline, slice C)', () => {
    // three r185 loaders use fetch: GLB artifacts, companion textures, .hdr
    // environment maps and .gltf/.obj/.mtl text all load over serpent:// in
    // the packaged app (file:// fetch is blocked). Embedded glTF buffers and
    // images use data: URLs, and GLB bufferView textures are decoded through
    // blob: URLs (ImageBitmapLoader) — all need the explicit, non-network
    // allowance.
    expect(directive('connect-src')).toContain('serpent:');
    expect(directive('connect-src')).toContain('data:');
    expect(directive('connect-src')).toContain('blob:');
    expect(directive('connect-src')).not.toContain('*');
  });
});
