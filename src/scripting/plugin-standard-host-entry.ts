import { createPluginStandardHostHandler } from './plugin-standard-host';

const parentPort = process.parentPort;
if (parentPort === undefined) {
  throw new Error('The Plugin Standard Host Utility must be started by Electron Main.');
}
// Packaged utility processes can otherwise exit after the ready handshake when
// Electron observes no ref-counted work. Parent controls lifetime.
const processLifetime = setInterval(() => {}, 60 * 60_000);
const handler = createPluginStandardHostHandler({
  postMessage: (message) => parentPort.postMessage(message),
});
parentPort.on('message', (event) => handler.handle(event.data));
setImmediate(() => parentPort.postMessage({ type: 'plugin-runtime.ready' }));
process.once('exit', () => {
  clearInterval(processLifetime);
  handler.dispose();
});
