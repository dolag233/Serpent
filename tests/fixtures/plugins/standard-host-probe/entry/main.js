async function activate(serpent) {
  await serpent.assets.search({ query: null, limit: 1 });
  await serpent.storage.set('host-probe', { activated: true, source: 'standard-host-probe' });
}

async function deactivate() {}

void activate;
void deactivate;
