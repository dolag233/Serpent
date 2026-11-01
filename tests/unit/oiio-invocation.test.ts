import { expect, it } from 'vitest';

import { literalOiioArgs, oiioFailureCode } from '../../src/worker/oiio-invocation';

it('uses literal filenames before both input and output arguments', () => {
  expect(literalOiioArgs(['#images/source.exr', '-o', '#previews/output.png']))
    .toEqual(['--wildcardoff', '#images/source.exr', '-o', '#previews/output.png']);
});

it('distinguishes input and output failures from color transform failures', () => {
  expect(oiioFailureCode('No filenames found matching pattern: "#OCIO/input.exr"'))
    .toBe('OIIO_GENERATION_FAILED');
  expect(oiioFailureCode('Could not open file: OCIO-input.exr'))
    .toBe('OIIO_GENERATION_FAILED');
  expect(oiioFailureCode('Could not write output'))
    .toBe('OIIO_GENERATION_FAILED');
  expect(oiioFailureCode('OCIO display/view transform rejected the selected config'))
    .toBe('OIIO_COLOR_TRANSFORM_FAILED');
});
