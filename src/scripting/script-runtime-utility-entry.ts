import { createScriptRuntimeUtilityHandler } from './script-runtime-utility';

const parentPort = process.parentPort;
if (parentPort === undefined) {
  throw new Error('The Script Runtime Utility must be started by Electron Main.');
}
// A packaged utility process can otherwise exit after the ready handshake if
// Electron observes no ref-counted work. Its parent controls all real lifetime.
const processLifetime = setInterval(() => {}, 60 * 60_000);
const handler = createScriptRuntimeUtilityHandler({
  postMessage: (message) => parentPort.postMessage(message),
});
parentPort.on('message', (event) => handler.handle(event.data));
// Fork returns before Main can install its listener. Defer ready past this
// bootstrap turn so the message cannot be emitted synchronously during fork.
setImmediate(() => parentPort.postMessage({ type: 'script-runtime.ready' }));
process.once('exit', () => {
  clearInterval(processLifetime);
  handler.dispose();
});
