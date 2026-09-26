import { closeSync, openSync, readSync } from 'node:fs';

const PDF_HEADER = Buffer.from('%PDF-');
const PDF_HEADER_SCAN_BYTES = 1024;

/**
 * Illustrator can save a PDF-compatible representation inside an AI file.
 * Only probe its bounded header area; the PDF parser remains responsible for
 * validating the full document before creating a preview.
 */
export function hasPdfCompatibleIllustratorHeader(filePath: string): boolean {
  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(PDF_HEADER_SCAN_BYTES);
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead).indexOf(PDF_HEADER) >= 0;
  } finally {
    closeSync(descriptor);
  }
}
