async function activate(serpent) {
  serpent.commands.register('probe.write', async () => {
    await serpent.storage.set('iframe-command', {
      invoked: true,
      source: 'workspace-iframe',
    });
  });
}

async function deactivate() {}

void activate;
void deactivate;
