import { readFileSync } from 'node:fs';

const AMD64_MACHINE = 0x8664;
const PE32_PLUS_MAGIC = 0x20b;

// This is deliberately an allowlist, not a probe of the CI runner's System32.
// The latter can contain SDK/VC runtime DLLs that are absent on supported user
// machines and would make a clean build look falsely self-contained.
const WINDOWS_RUNTIME_DLLS = new Set([
  'ADVAPI32.DLL',
  'AVRT.DLL',
  'BCRYPT.DLL',
  'CABINET.DLL',
  'CFGMGR32.DLL',
  'COMDLG32.DLL',
  'CRYPT32.DLL',
  'D3D11.DLL',
  'DBGHELP.DLL',
  'DNSAPI.DLL',
  'DWRITE.DLL',
  'DXGI.DLL',
  'GDI32.DLL',
  'IPHLPAPI.DLL',
  'KERNEL32.DLL',
  'MF.DLL',
  'MFPLAT.DLL',
  'MFREADWRITE.DLL',
  'MFUUID.DLL',
  'NCRYPT.DLL',
  'NORMALIZ.DLL',
  'OLE32.DLL',
  'OLEAUT32.DLL',
  'POWRPROF.DLL',
  'PROPSYS.DLL',
  'PSAPI.DLL',
  'RPCRT4.DLL',
  'SECUR32.DLL',
  'SETUPAPI.DLL',
  'SHELL32.DLL',
  'SHLWAPI.DLL',
  'STRMIIDS.DLL',
  'USER32.DLL',
  'USERENV.DLL',
  'UXTHEME.DLL',
  'VERSION.DLL',
  'VFW32.DLL',
  'WINMM.DLL',
  'WINTRUST.DLL',
  'WLDAP32.DLL',
  'WS2_32.DLL',
]);

function assertRange(data, offset, length, description) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > data.length) {
    throw new Error(`Truncated PE ${description}.`);
  }
}

function cString(data, offset, description) {
  assertRange(data, offset, 1, description);
  const end = data.indexOf(0, offset);
  if (end < 0) throw new Error(`Unterminated PE ${description}.`);
  return data.toString('ascii', offset, end);
}

export function peImportsFromBuffer(data, description = '<buffer>') {
  assertRange(data, 0, 0x40, `${description} DOS header`);
  if (data.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`Not a PE executable: ${description}`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  assertRange(data, peOffset, 24, `${description} signature`);
  if (data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`Invalid PE signature: ${description}`);
  }
  const machine = data.readUInt16LE(peOffset + 4);
  if (machine !== AMD64_MACHINE) {
    throw new Error(
      `PE executable is not Windows x64 (machine 0x${machine.toString(16)}): ${description}`,
    );
  }
  const sectionCount = data.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
  const optionalHeader = peOffset + 24;
  assertRange(data, optionalHeader, optionalHeaderSize, `${description} optional header`);
  if (optionalHeaderSize < 112 + 14 * 8) {
    throw new Error(`PE executable has a truncated x64 optional header: ${description}`);
  }
  if (data.readUInt16LE(optionalHeader) !== PE32_PLUS_MAGIC) {
    throw new Error(`PE executable does not use the PE32+ x64 format: ${description}`);
  }
  const numberOfDirectories = data.readUInt32LE(optionalHeader + 108);
  if (numberOfDirectories < 14) {
    throw new Error(`PE executable lacks import directories: ${description}`);
  }
  const sectionTable = optionalHeader + optionalHeaderSize;
  assertRange(data, sectionTable, sectionCount * 40, `${description} section table`);
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40;
    sections.push({
      virtualAddress: data.readUInt32LE(offset + 12),
      virtualSize: data.readUInt32LE(offset + 8),
      rawSize: data.readUInt32LE(offset + 16),
      rawOffset: data.readUInt32LE(offset + 20),
    });
  }
  const rvaOffset = (rva, label) => {
    const section = sections.find(
      (candidate) =>
        rva >= candidate.virtualAddress &&
        rva < candidate.virtualAddress + candidate.rawSize,
    );
    if (!section) throw new Error(`PE ${label} RVA ${rva} is outside all sections: ${description}`);
    const offset = section.rawOffset + rva - section.virtualAddress;
    assertRange(data, offset, 1, `${description} ${label}`);
    return offset;
  };
  const directory = (index) => ({
    rva: data.readUInt32LE(optionalHeader + 112 + index * 8),
    size: data.readUInt32LE(optionalHeader + 116 + index * 8),
  });
  const imports = new Set();

  const normal = directory(1);
  if (normal.rva !== 0) {
    const start = rvaOffset(normal.rva, 'import directory');
    const end = Math.min(data.length, start + normal.size);
    let terminated = false;
    for (let descriptor = start; descriptor + 20 <= end; descriptor += 20) {
      const fields = Array.from({ length: 5 }, (_, index) => data.readUInt32LE(descriptor + index * 4));
      if (fields.every((value) => value === 0)) {
        terminated = true;
        break;
      }
      imports.add(cString(data, rvaOffset(fields[3], 'import name'), 'import DLL name'));
    }
    if (!terminated) throw new Error(`Unterminated PE import directory: ${description}`);
  }

  const delayed = directory(13);
  if (delayed.rva !== 0) {
    const start = rvaOffset(delayed.rva, 'delay import directory');
    const end = Math.min(data.length, start + delayed.size);
    let terminated = false;
    for (let descriptor = start; descriptor + 32 <= end; descriptor += 32) {
      const fields = Array.from({ length: 8 }, (_, index) => data.readUInt32LE(descriptor + index * 4));
      if (fields.every((value) => value === 0)) {
        terminated = true;
        break;
      }
      if ((fields[0] & 1) === 0) {
        throw new Error(`PE delay import does not use RVA addressing: ${description}`);
      }
      imports.add(cString(data, rvaOffset(fields[1], 'delay import name'), 'delay-import DLL name'));
    }
    if (!terminated) throw new Error(`Unterminated PE delay import directory: ${description}`);
  }
  return [...imports];
}

export function peImports(binary) {
  return peImportsFromBuffer(readFileSync(binary), binary);
}

export function assertWindowsSystemDependencies(binary) {
  const dependencies = peImports(binary);
  const unexpected = dependencies.filter((dependency) => {
    const normalized = dependency.toUpperCase();
    if (/^(API-MS-WIN-|EXT-MS-WIN-)[A-Z0-9_-]+\.DLL$/.test(normalized)) return false;
    return !WINDOWS_RUNTIME_DLLS.has(normalized);
  });
  if (unexpected.length > 0) {
    throw new Error(`${binary} imports non-allowlisted DLLs:\n${unexpected.join('\n')}`);
  }
  return dependencies;
}
