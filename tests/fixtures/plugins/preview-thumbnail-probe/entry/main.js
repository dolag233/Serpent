const PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function mediaResult(batch) {
  return batch.map((asset) => ({
    assetId: asset.assetId,
    media: {
      mimeType: 'image/png',
      bytesBase64: PROBE_PNG_BASE64,
    },
  }));
}

function metadataResult(batch) {
  return batch.map((asset) => ({
    assetId: asset.assetId,
    metadata: {
      probeKind: 'metadata-extractor',
      extensionUpper: String(asset.extension || '').toUpperCase(),
      assetName: asset.name,
    },
  }));
}

function importPlanResult(batch) {
  return batch.map((asset) => ({
    assetId: asset.assetId,
    importPlan: {
      accepted: true,
      note: 'probe-import-accepted',
      asset: {
        displayName: asset.name,
        extension: asset.extension,
        metadata: { probeKind: 'import-provider' },
      },
    },
  }));
}

function exportDescriptorResult(batch) {
  return batch.map((asset) => ({
    assetId: asset.assetId,
    exportDescriptor: {
      fileName: `${asset.name}.export`,
      mimeType: 'application/octet-stream',
      bytesBase64: PROBE_PNG_BASE64,
      note: 'probe-export-stub',
    },
  }));
}

function aiAnalysisResult(batch) {
  return batch.map((asset) => ({
    assetId: asset.assetId,
    analysis: {
      description: `Probe analysis for ${asset.name}`,
      tags: ['probe', 'fixture', String(asset.extension || 'unknown').toLowerCase()],
      rating: 4,
    },
  }));
}

async function activate(serpent) {
  serpent.providers.register('preview', {
    id: 'probe-preview',
    async compute(batch) {
      return mediaResult(batch);
    },
  });
  serpent.providers.register('thumbnail', {
    id: 'probe-thumbnail',
    async compute(batch) {
      return mediaResult(batch);
    },
  });
  serpent.providers.register('metadata', {
    id: 'probe-metadata',
    async compute(batch) {
      return metadataResult(batch);
    },
  });
  serpent.providers.register('import', {
    id: 'probe-import',
    async compute(batch) {
      return importPlanResult(batch);
    },
  });
  serpent.providers.register('export', {
    id: 'probe-export',
    async compute(batch) {
      return exportDescriptorResult(batch);
    },
  });
  serpent.providers.register('ai', {
    id: 'probe-ai',
    async compute(batch) {
      return aiAnalysisResult(batch);
    },
  });
}

async function deactivate() {}

void activate;
void deactivate;
