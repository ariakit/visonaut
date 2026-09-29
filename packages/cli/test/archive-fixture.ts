import { crc32, deflateRawSync } from "node:zlib";

export function zip(
  entries: {
    name: string;
    bytes: Buffer;
    declaredSize?: number;
    mode?: number;
    corrupt?: boolean;
  }[],
) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const encoded = deflateRawSync(entry.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 6); // Streaming GitHub ZIPs use data descriptors.
    header.writeUInt16LE(8, 8);

    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(entry.corrupt ? 1 : crc32(entry.bytes), 16);
    directory.writeUInt32LE(encoded.length, 20);
    directory.writeUInt32LE(entry.declaredSize ?? entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((entry.mode ?? 0o100600) * 65536, 38);
    directory.writeUInt32LE(offset, 42);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(crc32(entry.bytes), 4);
    descriptor.writeUInt32LE(encoded.length, 8);
    descriptor.writeUInt32LE(entry.declaredSize ?? entry.bytes.length, 12);
    local.push(header, name, encoded, descriptor);
    central.push(directory, name);
    offset += header.length + name.length + encoded.length + descriptor.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(
    central.reduce((sum, bytes) => sum + bytes.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
