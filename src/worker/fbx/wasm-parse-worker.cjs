/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, Buffer */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');

const PROTOCOL = 'serpent-ufbx-parse-v1';

function safeErrorField(error, key) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
  let value;
  try {
    value = error[key];
  } catch {
    return undefined;
  }
  if (typeof value === 'string' && value.length <= 64) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return undefined;
}

function sendFailure(id, message, error) {
  if (!parentPort) return;
  const response = { protocol: PROTOCOL, id, status: 'error', message };
  const code = safeErrorField(error, 'code');
  const errno = safeErrorField(error, 'errno');
  if (code !== undefined) response.code = code;
  if (errno !== undefined) response.errno = errno;
  parentPort.postMessage(response);
}

function finishPort() {
  parentPort?.close();
}

function requestError(message) {
  return new Error(message);
}

async function parse(request) {
  if (!parentPort) throw requestError('UFBX parser worker has no parent port.');
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw requestError('UFBX parser worker received an invalid request.');
  }
  const { protocol, id, fbxBytes, filename, maxTriangles, ufbxDir } = request;
  if (
    protocol !== PROTOCOL || !Number.isSafeInteger(id) || id <= 0 ||
    !(fbxBytes instanceof ArrayBuffer) || typeof filename !== 'string' ||
    typeof ufbxDir !== 'string' || ufbxDir.length === 0 ||
    !Number.isSafeInteger(maxTriangles) || maxTriangles < 0
  ) {
    throw requestError('UFBX parser worker received an invalid request.');
  }

  const wasmPath = path.join(ufbxDir, 'ufbx.wasm');
  const gluePath = path.join(ufbxDir, 'ufbx.js');
  if (!fs.existsSync(wasmPath)) {
    throw requestError('UFBX_WASM_MISSING: resources/ufbx/ufbx.wasm not found.');
  }
  if (!fs.existsSync(gluePath)) {
    throw requestError('UFBX_WASM_MISSING: ufbx.js glue not found next to ufbx.wasm.');
  }

  // The runtime glue is intentionally loaded inside this disposable thread so
  // its synchronous parse and WASM memory die with the task.
  const loaded = require(gluePath);
  const factory = loaded.default ?? loaded;
  if (typeof factory !== 'function') {
    throw requestError(`UFBX_WASM_GLUE_BROKEN: ${gluePath} did not export a module factory.`);
  }
  const module = await factory({
    locateFile(file) {
      return file === 'ufbx.wasm' ? wasmPath : file;
    },
  });
  if (!module || typeof module._serpent_parse !== 'function') {
    throw requestError('UFBX_WASM_BROKEN: glue does not expose serpent_parse.');
  }

  const input = new Uint8Array(fbxBytes);
  const opts = Buffer.from(JSON.stringify({ filename, maxTriangles }), 'utf8');
  const fbxPtr = module._malloc(input.byteLength);
  const optsPtr = module._malloc(opts.byteLength);
  if (fbxPtr === 0 || optsPtr === 0) {
    if (fbxPtr !== 0) module._free(fbxPtr);
    if (optsPtr !== 0) module._free(optsPtr);
    throw requestError('UFBX_WASM_OOM: bridge memory allocation failed');
  }

  try {
    module.HEAPU8.set(input, fbxPtr);
    module.HEAPU8.set(opts, optsPtr);
    const rc = module._serpent_parse(fbxPtr, input.byteLength, optsPtr);
    if (rc !== 0) {
      const errorPointer = module._serpent_error();
      const message = errorPointer !== 0 ? module.UTF8ToString(errorPointer) : '{"ok":false}';
      throw requestError(message);
    }
    const outputPointer = module._serpent_out_ptr();
    const outputSize = module._serpent_out_size();
    if (
      !Number.isSafeInteger(outputPointer) || outputPointer <= 0 ||
      !Number.isSafeInteger(outputSize) || outputSize <= 0 ||
      outputPointer > module.HEAPU8.byteLength ||
      outputSize > module.HEAPU8.byteLength - outputPointer
    ) {
      throw requestError('UFBX_WASM_BROKEN: bridge returned an invalid result range.');
    }

    // Transfer a compact output buffer back. The main thread receives no
    // second copy of the potentially large packed descriptor.
    const output = new Uint8Array(outputSize);
    output.set(module.HEAPU8.subarray(outputPointer, outputPointer + outputSize));
    parentPort.postMessage({ protocol: PROTOCOL, id, status: 'ok', buffer: output.buffer }, [output.buffer]);
  } finally {
    module._serpent_free_out();
    module._free(fbxPtr);
    module._free(optsPtr);
  }
}

if (!parentPort) {
  throw new Error('UFBX parser worker must run in a worker thread.');
}

parentPort.once('message', (request) => {
  const id = request && typeof request === 'object' && Number.isSafeInteger(request.id) ? request.id : 0;
  void parse(request).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      sendFailure(id, message, error);
    } catch {
      // The parent may already have terminated the worker.
    }
  }).finally(finishPort);
});
