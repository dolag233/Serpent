# Preview / Thumbnail / Metadata Provider Probe

This fixture registers opt-in `preview`, `thumbnail`, and `metadata` providers
for the synthetic `.probe` extension. Preview and thumbnail return the same
deterministic 1×1 PNG as bounded inline bytes; metadata returns deterministic
JSON fields (`probeKind`, `extensionUpper`, `assetName`). It is used by
PLUGIN-025/026 broker and Host invoke tests; it is not a native media or
metadata pipeline replacement.
