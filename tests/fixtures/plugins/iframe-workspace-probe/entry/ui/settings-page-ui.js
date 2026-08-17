/* global URLSearchParams, location, document, window, crypto */

const params = new URLSearchParams(location.search);
const contributionId = params.get('contributionId') ?? 'com.serpent.iframe-workspace-probe.settings-page-probe';
const instanceId = decodeURIComponent(location.pathname.split('/')[1] || '');
const status = document.querySelector('#status');

function request(message) {
  window.parent.postMessage(message, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== 'null') return;
  if (event.data?.type === 'plugin-ui.theme-changed') {
    for (const [name, value] of Object.entries(event.data.tokens || {})) {
      document.documentElement.style.setProperty(`--serpent-${name.slice(2)}`, value);
    }
    status.textContent = `Theme: ${event.data.theme}`;
  }
  if (event.data?.type === 'plugin-ui.command-result' || event.data?.type === 'plugin-ui.storage.result') {
    status.textContent = event.data.ok ? 'Request completed' : `Request failed: ${event.data.errorCode}`;
  }
});

request({
  type: 'plugin-ui.ready',
  contributionId,
  instanceId,
});

document.querySelector('#command').addEventListener('click', () => {
  request({
    type: 'plugin-ui.invoke-command',
    requestId: crypto.randomUUID(),
    commandId: 'probe.write',
  });
});

document.querySelector('#storage').addEventListener('click', () => {
  request({
    type: 'plugin-ui.storage.set',
    requestId: crypto.randomUUID(),
    key: 'settings-page-click',
    value: { clicked: true },
  });
});
