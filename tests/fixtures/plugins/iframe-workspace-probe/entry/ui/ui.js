const contributionId = new URLSearchParams(location.search).get('contributionId')
  ?? 'com.serpent.iframe-workspace-probe.workspace-probe';
const instanceId = decodeURIComponent(location.pathname.split('/')[1] || '');
const status = document.querySelector('#status');

function request(message) {
  window.parent.postMessage(message, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== 'null') return;
  if (event.data?.type === 'plugin-ui.theme') {
    for (const [name, value] of Object.entries(event.data.tokens || {})) {
      document.documentElement.style.setProperty(`--serpent-${name.slice(2)}`, value);
    }
    const accent = event.data.tokens?.['--accent'] ?? 'unset';
    status.textContent = `Theme: ${event.data.theme} · accent ${accent}`;
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
    key: 'iframe-click',
    value: { clicked: true },
  });
});
