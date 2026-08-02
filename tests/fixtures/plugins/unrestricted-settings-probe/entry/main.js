/* global exports */
exports.activate = async function activate(serpent) {
  await serpent.storage.set('host-probe', { activated: true, source: 'unrestricted-settings-probe' });
  serpent.commands.register('probe.write-selection', async (context) => {
    const assetId = Array.isArray(context?.assetIds) ? context.assetIds[0] ?? null : null;
    await serpent.storage.set('menu-command', { assetId });
  });
  serpent.commands.register('probe.nested-selection', async (context) => {
    const assetId = Array.isArray(context?.assetIds) ? context.assetIds[0] ?? null : null;
    await serpent.storage.set('nested-menu-command', { assetId });
  });
};

exports.deactivate = async function deactivate() {};
