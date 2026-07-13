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
});
