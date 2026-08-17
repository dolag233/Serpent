import { z } from 'zod';

import {
  pluginInputCaptureEndReasonSchema,
  pluginInputCaptureEventSchema,
  pluginInputCaptureOptionsSchema,
} from './plugin-input-capture';

export const pluginInputCaptureErrorCodeSchema = z.enum([
  'PERMISSION_DENIED',
  'INVALID_OPTIONS',
  'APPLICATION_CAPTURE_BUSY',
  'CAPTURE_UNAVAILABLE',
]);
export type PluginInputCaptureErrorCode = z.infer<typeof pluginInputCaptureErrorCodeSchema>;

const instanceIdSchema = z.string().uuid();
const requestIdSchema = z.string().uuid();
const sessionIdSchema = z.string().uuid();

export const pluginRuntimeInputCaptureChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('input-capture.start'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    options: pluginInputCaptureOptionsSchema,
  }),
  z.strictObject({
    type: z.literal('input-capture.release'),
    instanceId: instanceIdSchema,
    sessionId: sessionIdSchema,
  }),
]);
export type PluginRuntimeInputCaptureChildMessage = z.infer<
  typeof pluginRuntimeInputCaptureChildMessageSchema
>;

export const pluginRuntimeInputCaptureParentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('input-capture.started'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    sessionId: sessionIdSchema,
  }),
  z.strictObject({
    type: z.literal('input-capture.event'),
    instanceId: instanceIdSchema,
    sessionId: sessionIdSchema,
    event: pluginInputCaptureEventSchema,
  }),
  z.strictObject({
    type: z.literal('input-capture.end'),
    instanceId: instanceIdSchema,
    sessionId: sessionIdSchema,
    reason: pluginInputCaptureEndReasonSchema,
  }),
  z.strictObject({
    type: z.literal('input-capture.error'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    code: pluginInputCaptureErrorCodeSchema,
    message: z.string().min(1).max(1_024),
  }),
]);
export type PluginRuntimeInputCaptureParentMessage = z.infer<
  typeof pluginRuntimeInputCaptureParentMessageSchema
>;
