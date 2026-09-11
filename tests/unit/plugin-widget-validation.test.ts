import { expect, it } from 'vitest';
import { parsePluginWidgetTree } from '../../src/shared/plugin-widget-ir';

it('validates nested groups without re-reading every subtree for unrelated node kinds', () => {
  let reads = 0;
  let node: unknown = {
    type: 'list', columns: ['Original', 'Renamed'],
    rows: Array.from({ length: 150 }, (_, index) => [`asset-${index}.png`, `asset-${index}_1.png`]),
  };
  for (let depth = 0; depth < 6; depth += 1) {
    const child = node;
    node = { type: 'group', get children() { reads += 1; return [child]; } };
  }
  expect(parsePluginWidgetTree(node).type).toBe('group');
  expect(reads).toBeLessThanOrEqual(12);
});
