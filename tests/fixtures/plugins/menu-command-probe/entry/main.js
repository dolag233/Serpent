async function setup(serpent) {
  serpent.commands.register('probe.write-selection', async (context) => {
    const enabledDemo = await serpent.storage.get('settings.enabled-demo');
    await serpent.storage.set('menu-command', {
      assetId: context.assetIds && context.assetIds[0],
      enabledDemo,
    });
  });
  serpent.commands.register('probe.write-folder', async (context) => {
    await serpent.storage.set('menu-command-folder', {
      folderId: context.folderIds && context.folderIds[0],
    });
  });
  serpent.commands.register('probe.write-collection', async (context) => {
    await serpent.storage.set('menu-command-collection', {
      collectionId: context.collectionIds && context.collectionIds[0],
    });
  });
  serpent.commands.register('probe.write-toolbar', async (context) => {
    await serpent.storage.set('toolbar-command', {
      assetId: context.assetIds && context.assetIds[0],
      assetCount: context.assetIds ? context.assetIds.length : 0,
    });
  });
  serpent.commands.register('probe.write-inspector', async (context) => {
    await serpent.storage.set('inspector-command', {
      assetId: context.assetIds && context.assetIds[0],
      assetCount: context.assetIds ? context.assetIds.length : 0,
    });
  });
  serpent.commands.register('probe.write-viewer', async (context) => {
    await serpent.storage.set('viewer-command', {
      assetId: context.assetIds && context.assetIds[0],
    });
  });
  serpent.commands.register('probe.write-workspace', async (context) => {
    await serpent.storage.set('workspace-command', {
      assetId: context.assetIds && context.assetIds[0],
      assetCount: context.assetIds ? context.assetIds.length : 0,
    });
  });
  serpent.commands.register('probe.write-shortcut', async (context) => {
    await serpent.storage.set('shortcut-command', {
      assetId: context.assetIds && context.assetIds[0],
      assetCount: context.assetIds ? context.assetIds.length : 0,
    });
  });
}

async function dispose() {}

void setup;
void dispose;
