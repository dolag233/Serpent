import { isValidPairingToken, normalizePairingToken } from './pairing-token';

const form = document.querySelector<HTMLFormElement>('#pairing-form');
const input = document.querySelector<HTMLInputElement>('#pairing-token');
const status = document.querySelector<HTMLElement>('#status');

if (!form || !input || !status) throw new Error('Extension options UI is incomplete.');

chrome.storage.local.get('pairingToken', (values) => {
  void chrome.runtime.lastError;
  const stored = values.pairingToken;
  if (typeof stored === 'string') input.value = stored;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = normalizePairingToken(input.value);
  if (!isValidPairingToken(token)) {
    status.textContent = '配对码格式不正确。请从 Serpent 桌面应用重新复制。';
    status.dataset.kind = 'error';
    return;
  }
  chrome.storage.local.set({ pairingToken: token }, () => {
    if (chrome.runtime.lastError) {
      status.textContent = '保存失败，请重试。';
      status.dataset.kind = 'error';
      return;
    }
    input.value = token;
    status.textContent = '配对码已保存。现在可以从网页右键保存到 Serpent。';
    status.dataset.kind = 'success';
  });
});
