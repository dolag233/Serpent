/* global exports */
exports.setup = async function setup(serpent) {
  await serpent.assets.search({ query: null, limit: 1 });
  await serpent.storage.set('host-probe', { activated: true, source: 'trusted-host-probe' });
};

exports.dispose = async function dispose() {};
