async function setup(serpent) {
  serpent.commands.register('probe.write', async () => {
    await serpent.storage.set('iframe-command', {
      invoked: true,
      source: 'workspace-iframe',
    });
  });
}

async function dispose() {}

void setup;
void dispose;
