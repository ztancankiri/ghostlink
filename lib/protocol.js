const MSG_CONTROL = 0x01;
const MSG_DATA = 0x02;
const MSG_CLOSE = 0x03;

// Helper to create a Control packet
function createControlPacket(type, payload = {}) {
  const json = JSON.stringify({ type, ...payload });
  const buffer = Buffer.alloc(1 + Buffer.byteLength(json));
  buffer.writeUInt8(MSG_CONTROL, 0);
  buffer.write(json, 1);
  return buffer;
}

// Helper to create a Data packet
// ID is a 4-byte integer ID for the stream
function createDataPacket(id, dataBuffer) {
  const totalLength = 1 + 4 + dataBuffer.length;
  const buffer = Buffer.allocUnsafe(totalLength);
  buffer.writeUInt8(MSG_DATA, 0);
  buffer.writeUInt32BE(id, 1);
  dataBuffer.copy(buffer, 5);
  return buffer;
}

// Helper to create a Close packet
function createClosePacket(id) {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(MSG_CLOSE, 0);
  buffer.writeUInt32BE(id, 1);
  return buffer;
}

// Helper to parse a packet
function parsePacket(buffer) {
  if (buffer.length < 1) return null;
  const type = buffer.readUInt8(0);

  if (type === MSG_CONTROL) {
    try {
      const json = buffer.toString('utf8', 1);
      return { type: 'CONTROL', payload: JSON.parse(json) };
    } catch (e) {
      return { type: 'ERROR', error: e };
    }
  } else if (type === MSG_DATA) {
    if (buffer.length < 5) return null;
    const id = buffer.readUInt32BE(1);
    const data = buffer.subarray(5);
    return { type: 'DATA', id, data };
  } else if (type === MSG_CLOSE) {
    if (buffer.length < 5) return null;
    const id = buffer.readUInt32BE(1);
    return { type: 'CLOSE', id };
  }

  return { type: 'UNKNOWN' };
}

module.exports = {
  MSG_CONTROL,
  MSG_DATA,
  MSG_CLOSE,
  createControlPacket,
  createDataPacket,
  createClosePacket,
  parsePacket
};
