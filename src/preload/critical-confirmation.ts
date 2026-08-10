import { contextBridge, ipcRenderer } from 'electron';

import {
  criticalConfirmationDecisionSchema,
  criticalConfirmationPayloadSchema,
  type CriticalConfirmationDecision,
} from '../shared/critical-confirmation';
import {
  CRITICAL_CONFIRMATION_DECIDE_CHANNEL,
  CRITICAL_CONFIRMATION_GET_CHANNEL,
} from '../shared/protocol/channels';

const criticalConfirmation = Object.freeze({
  getRequest: async () => criticalConfirmationPayloadSchema.parse(
    await ipcRenderer.invoke(CRITICAL_CONFIRMATION_GET_CHANNEL),
  ),
  decide: async (decision: CriticalConfirmationDecision): Promise<boolean> => {
    const parsed = criticalConfirmationDecisionSchema.parse(decision);
    return Boolean(await ipcRenderer.invoke(CRITICAL_CONFIRMATION_DECIDE_CHANNEL, parsed));
  },
});

contextBridge.exposeInMainWorld('serpentCriticalConfirmation', criticalConfirmation);
