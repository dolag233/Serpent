async function activate(serpent) {
  serpent.hooks.onWill('asset.trash', async () => ({
    action: 'block',
    code: 'DEMO_BLOCK',
    message: 'Hook blocking probe refused trash.',
  }));
  await serpent.storage.set('hook-blocking-probe', { armed: true });
}

async function deactivate() {}

void activate;
void deactivate;
