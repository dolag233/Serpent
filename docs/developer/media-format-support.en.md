# Media Format Support Guide

This guide is for developers working on Serpent itself. Adding an extension to one list only makes one entry point recognize it; a format is supported only after import, thumbnails, the viewer, filters, and related protocols are checked.

## 1. Start with the shared registry

Inspect and update `src/shared/media-formats.ts`, and `src/shared/audio-media.ts` when applicable:

- Add images to the appropriate `IMAGE_EXTENSIONS` decoder set. Do not route RAW through an ordinary image decoder by accident.
- Add video, model, and document formats to their corresponding registries.
- Treat alias extensions for the same bitstream as one format. JFIF is a JPEG bitstream, so `.jfif` uses `image/jpeg`; it is not a new image codec.
- Extension matching must be case-insensitive, and registry helpers should accept both filenames and extension strings.

After changing the registry, do not create a second hard-coded extension list in the UI or Worker.

## 2. Check every consumer

Use `rg` to search for the old extensions, MIME strings, `endsWith`, `includes`, and format dispatch points. Check each applicable path:

| Path | Main locations | What to verify |
| --- | --- | --- |
| Import recognition | `src/worker/library-service.ts`, import strategies | Discovery, indexing, rescans, deletion, and clear handling of corrupt/unsupported files |
| Format filters | `src/renderer/format-filter-presets.ts` | Generated from the shared registry; add a regression test |
| Thumbnails | Worker thumbnail/media decoders | Decoder, bounds, animation/multi-frame, and corrupt-file behavior |
| Viewer | `src/shared/preview-policy.ts`, viewer components | Source passthrough vs. full-resolution derived image; never present a thumbnail as the original |
| MIME/protocol | `src/main/index.ts`, preload, shared protocol | Correct MIME for artifacts, remote assets, and plugin context with runtime validation |
| Sequences/color | sequence and image color-space modules | Only formats with the relevant capability enter these paths |
| External ecosystems | Eagle/Billfish, plugins, remote import | Candidate extensions, URL MIME, and saved preview behavior agree |

Chromium native rendering is an optimization, not sufficient proof of product support. Formats Chromium cannot render should use bounded thumbnails and a separate full-resolution decoder path.

## 3. Implementation order

1. Decide whether the addition is a codec, container, or alias extension; record MIME, decoder, and fallback semantics.
2. Update the shared registry and its pure-function tests.
3. Correct import, Worker decoding, preview policy, filters, main-process protocol, and plugin/remote entry points one by one.
4. For animation, multi-frame, RAW, HDR, or 3D, define viewer semantics first: playback, first frame, frame controls, color space, missing materials, and so on.
5. Update this developer documentation and the human acceptance checklist. “The backend library can theoretically read it” is not evidence of support.

## 4. Test matrix

Prepare fixtures in temporary directories; never commit personal absolute paths or real user data. Cover:

- valid content, upper/mixed-case extensions, non-ASCII paths, and long filenames;
- corrupt/truncated files and extension/content mismatches;
- format-specific capabilities such as transparency, animation, multiple frames, RAW, or HDR when applicable;
- decoded thumbnails and viewer originals; images must satisfy `complete && naturalWidth > 0`, and videos must expose metadata and non-zero dimensions;
- search and format filters, rescan, delete/restore, remote import, and plugin entry points when applicable;
- packaged apps on macOS and Windows; missing platform evidence must be recorded as “not verified”.

Minimum checks:

```bash
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/<relevant-test>.test.ts
npm run test:unit
```

Any change to library opening, import, Worker, schema, or media storage paths must also run:

```bash
npm run test:library-availability
```

Changes crossing Renderer/preload/Main/Worker or custom media protocols require the relevant Electron E2E. After every test run, remove only temporary databases, media, screenshots, and exports created by that run and known to be safe to remove.

## 5. Definition of done

Record four columns in the development log and acceptance checklist: requirement, implementation location (`file:line`), automated test (`test:line`), and human/platform evidence. If any column is missing, report “partially complete” or “not verified”.

Related research: [Media format support research](research-media-format-support.md).
