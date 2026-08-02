/* global exports */
exports.setup = async function setup(serpent) {
  await serpent.assets.search({ query: null, limit: 1 });
  const previous = await serpent.storage.get('host-probe');
  await serpent.storage.set('host-probe', { activated: true, source: 'trusted-host-probe', previous });
};

exports.dispose = async function dispose() {};
