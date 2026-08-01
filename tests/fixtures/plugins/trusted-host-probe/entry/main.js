/* global exports */
exports.activate = async function activate(serpent) {
  await serpent.assets.search({ query: null, limit: 1 });
  await serpent.storage.set('host-probe', { activated: true, source: 'trusted-host-probe' });
};

exports.deactivate = async function deactivate() {};
