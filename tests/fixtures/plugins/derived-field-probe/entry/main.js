async function activate(serpent) {
  serpent.providers.register('derived-field', {
    id: 'ext-upper',
    fieldId: 'extUpper',
    fieldType: 'string',
    async compute(batch) {
      return batch.map((asset) => ({
        assetId: asset.assetId,
        value: asset.extension.toUpperCase(),
      }));
    },
  });
  serpent.providers.registerSearch({
    id: 'fixed-token',
    async search(request, signal) {
      if (signal.aborted || !JSON.stringify(request.query).includes('plugin-probe')) return [];
      return [
        { assetId: 'asset-search-probe-1', sortKey: '0001' },
        { assetId: 'asset-search-probe-2', sortKey: '0002' },
      ];
    },
  });
}

async function deactivate() {}

void activate;
void deactivate;
