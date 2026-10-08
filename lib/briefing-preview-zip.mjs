const MAX_FILES = 2;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^
        ((crc & 1) ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function createPreviewZip(files) {
  if (!Array.isArray(files) || files.length !== MAX_FILES) {
    throw new Error('ZIP exige exatamente dois PNGs.');
  }

  const parts = [];
  const central = [];
  let offset = 0;
  let total = 0;

  for (const [index, file] of files.entries()) {
    const data = file?.png;

    if (!Buffer.isBuffer(data) || !data.length) {
      throw new Error('PNG invalido para ZIP.');
    }

    total += data.length;

    if (total > MAX_TOTAL_BYTES) {
      throw new Error('ZIP excede limite de seguranca.');
    }

    const filename = Buffer.from(
      `wiregeek-403-editorial-${index + 1}.png`,
      'utf8'
    );

    const checksum = crc32(data);

    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);

    parts.push(local, filename, data);

    const directory = Buffer.alloc(46);

    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);

    central.push(directory, filename);

    offset += local.length + filename.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);

  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([
    ...parts,
    centralBuffer,
    end
  ]);
}