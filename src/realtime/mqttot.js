/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// The MQTToT wire format Instagram's realtime/push brokers speak. It is MQTT
// 3.1.1 with a Facebook twist: the CONNECT payload is a Thrift compact struct
// (MQTToTConnection) instead of the spec's UTF-8 fields, and publish payloads
// are zlib-compressed. This module is a dependency-free codec (Thrift compact
// protocol + MQTT packets) plus a TLS transport, so the realtime client needs
// nothing beyond Node's net/tls/zlib.

"use strict";

const tls = require("tls");
const zlib = require("zlib");

const ThriftTypes = {
  STOP: 0x00,
  TRUE: 0x01,
  FALSE: 0x02,
  BYTE: 0x03,
  INT_16: 0x04,
  INT_32: 0x05,
  INT_64: 0x06,
  DOUBLE: 0x07,
  BINARY: 0x08,
  LIST: 0x09,
  SET: 0x0a,
  MAP: 0x0b,
  STRUCT: 0x0c,
  BOOLEAN: 0xa1,
  LIST_INT_32: (0x05 << 8) | 0x09,
  LIST_BINARY: (0x08 << 8) | 0x09,
  MAP_BINARY_BINARY: (0x88 << 8) | 0x0b
};

// Thrift compact integers are zigzag + LEB128. Values above 2^53 (appId, a
// 64-bit userId) need BigInt, so the varint writer always works in BigInt.
function zigzag(value, bits) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  return (v << 1n) ^ (v >> BigInt(bits - 1));
}

function unzigzag(value) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  return (v >> 1n) ^ -(v & 1n);
}

class ThriftWriter {
  constructor() {
    this.buffer = [];
    this._fieldStack = [];
    this._field = 0;
  }

  writeStop() {
    this.buffer.push(ThriftTypes.STOP);
    if (this._fieldStack.length) this._field = this._fieldStack.pop();
  }

  writeField(field, fieldType) {
    const delta = field - this._field;
    const thriftType = fieldType & 0x0f;
    if (delta > 0 && delta <= 15) {
      this.buffer.push((delta << 4) | thriftType);
    } else {
      this.buffer.push(thriftType);
      this.writeVarint(zigzag(field, 16));
    }
    this._field = field;
  }

  writeVarint(value) {
    let v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) v &= 0xffffffffffffffffn;
    for (;;) {
      if ((v & ~0x7fn) === 0n) {
        this.buffer.push(Number(v));
        return;
      }
      this.buffer.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
  }

  writeStringDirect(value) {
    const raw = Buffer.from(String(value), "utf8");
    this.writeVarint(raw.length);
    for (const b of raw) this.buffer.push(b);
  }

  writeString(field, value) {
    this.writeField(field, ThriftTypes.BINARY);
    this.writeStringDirect(value);
  }

  writeBool(field, value) {
    this.writeField(field, value ? ThriftTypes.TRUE : ThriftTypes.FALSE);
  }

  writeInt(field, value, bits) {
    const fieldType = { 8: ThriftTypes.BYTE, 16: ThriftTypes.INT_16, 32: ThriftTypes.INT_32, 64: ThriftTypes.INT_64 }[bits];
    this.writeField(field, fieldType);
    if (bits === 8) {
      this.buffer.push(Number(BigInt(value) & 0xffn));
    } else {
      this.writeVarint(zigzag(value, bits));
    }
  }

  pushStruct(field) {
    this.writeField(field, ThriftTypes.STRUCT);
    this._fieldStack.push(this._field);
    this._field = 0;
  }
}

class ThriftReader {
  constructor(data, options = {}) {
    if (!Buffer.isBuffer(data)) throw new TypeError("ThriftReader data must be a Buffer");
    this.data = data;
    this.int64AsBigInt = options.int64AsBigInt === true;
    this.maxCollectionSize = positiveLimit(options.maxCollectionSize, 100000);
    this.maxDepth = positiveLimit(options.maxDepth, 64);
    this.pos = 0;
    this._depth = 0;
    this._fieldStack = [];
    this._field = 0;
  }

  readStruct(descriptors) {
    if (this._depth >= this.maxDepth) {
      throw new RangeError("Thrift struct nesting exceeds configured limit");
    }
    this._depth += 1;
    try {
      const result = {};
      let stopped = false;
      while (this.pos < this.data.length) {
        const fieldType = this.readField();
        if (fieldType === ThriftTypes.STOP) {
          if (this._fieldStack.length) this._field = this._fieldStack.pop();
          stopped = true;
          break;
        }
        const descriptor = findDescriptor(descriptors, this._field, fieldType);
        const value = this.readValue(fieldType, descriptor);
        if (descriptor) result[descriptor.name] = value;
      }
      if (!stopped) throw new RangeError("Thrift struct is missing STOP marker");
      return result;
    } finally {
      this._depth -= 1;
    }
  }

  readField() {
    const byte = this.readByte();
    if (byte === ThriftTypes.STOP) return ThriftTypes.STOP;
    const delta = (byte & 0xf0) >> 4;
    if (delta) this._field += delta;
    else this._field = Number(unzigzag(this.readVarint()));
    return byte & 0x0f;
  }

  readValue(fieldType, descriptor) {
    if (fieldType === ThriftTypes.TRUE) return true;
    if (fieldType === ThriftTypes.FALSE) return false;
    if (fieldType === ThriftTypes.BYTE) return this.readBytes(1).readInt8(0);
    if (fieldType === ThriftTypes.INT_64) {
      const value = unzigzag(this.readVarint());
      // Keep Number as the backwards-compatible default, but let callers opt
      // into exact 64-bit values without silently rounding large integers.
      return this.int64AsBigInt ? value : Number(value);
    }
    if (fieldType === ThriftTypes.INT_16 || fieldType === ThriftTypes.INT_32) {
      return Number(unzigzag(this.readVarint()));
    }
    if (fieldType === ThriftTypes.BINARY) return this.readBytes(Number(this.readVarint())).toString("utf8");
    if (fieldType === ThriftTypes.LIST) return this.readList();
    if (fieldType === ThriftTypes.MAP) return this.readMap();
    if (fieldType === ThriftTypes.STRUCT) {
      this._fieldStack.push(this._field);
      this._field = 0;
      return this.readStruct(descriptor ? descriptor.children : []);
    }
    throw new Error(`Unsupported thrift type: ${fieldType}`);
  }

  readList() {
    const header = this.readByte();
    let size = header >> 4;
    const itemType = header & 0x0f;
    if (size === 0x0f) size = this._collectionSize(this.readVarint(), "list");
    else this._collectionSize(BigInt(size), "list");
    const items = [];
    for (let i = 0; i < size; i++) items.push(this.readValue(itemType, null));
    return items;
  }

  readMap() {
    const size = this._collectionSize(this.readVarint(), "map");
    if (!size) return {};
    const itemTypes = this.readByte();
    const keyType = (itemTypes & 0xf0) >> 4;
    const valueType = itemTypes & 0x0f;
    const result = {};
    for (let i = 0; i < size; i++) {
      const key = this.readValue(keyType, null);
      result[key] = this.readValue(valueType, null);
    }
    return result;
  }

  _collectionSize(value, kind) {
    if (value < 0n || value > BigInt(this.maxCollectionSize)) {
      throw new RangeError(`Thrift ${kind} exceeds configured collection limit (${this.maxCollectionSize})`);
    }
    return Number(value);
  }

  readByte() {
    if (this.pos >= this.data.length) throw new RangeError("Unexpected end of Thrift data");
    const value = this.data[this.pos];
    this.pos += 1;
    return value;
  }

  readBytes(size) {
    const length = Number(size);
    if (!Number.isSafeInteger(length) || length < 0 || length > this.data.length - this.pos) {
      throw new RangeError("Thrift binary field exceeds available data");
    }
    const value = this.data.slice(this.pos, this.pos + length);
    this.pos += length;
    return value;
  }

  readVarint() {
    let shift = 0n;
    let result = 0n;
    for (let count = 0; count < 10; count++) {
      if (this.pos >= this.data.length) throw new RangeError("Truncated Thrift varint");
      const byte = this.readByte();
      if (count === 9 && (byte & 0xfe) !== 0) {
        throw new RangeError("Thrift varint exceeds 64 bits");
      }
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new RangeError("Thrift varint exceeds 10 bytes");
  }
}

function positiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function findDescriptor(descriptors, field, fieldType) {
  for (const descriptor of descriptors) {
    if (descriptor.field !== field) continue;
    const descriptorType = descriptor.type & 0x0f;
    if (descriptorType === fieldType) return descriptor;
    if (descriptor.type === ThriftTypes.BOOLEAN && (fieldType === ThriftTypes.TRUE || fieldType === ThriftTypes.FALSE)) return descriptor;
  }
  return null;
}

function writeThriftStruct(writer, data, descriptors) {
  const byName = {};
  for (const d of descriptors) byName[d.name] = d;
  for (const [name, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    const descriptor = byName[name];
    if (!descriptor) continue;
    const thriftType = descriptor.type & 0xff;
    if (thriftType === ThriftTypes.BOOLEAN) writer.writeBool(descriptor.field, !!value);
    else if (thriftType === ThriftTypes.BYTE) writer.writeInt(descriptor.field, value, 8);
    else if (thriftType === ThriftTypes.INT_16) writer.writeInt(descriptor.field, value, 16);
    else if (thriftType === ThriftTypes.INT_32) writer.writeInt(descriptor.field, value, 32);
    else if (thriftType === ThriftTypes.INT_64) writer.writeInt(descriptor.field, value, 64);
    else if (thriftType === ThriftTypes.BINARY) writer.writeString(descriptor.field, value);
    else if (thriftType === ThriftTypes.STRUCT) {
      writer.pushStruct(descriptor.field);
      writeThriftStruct(writer, value, descriptor.children);
      writer.writeStop();
    } else if (thriftType === ThriftTypes.LIST) {
      writer.writeField(descriptor.field, ThriftTypes.LIST);
      writeThriftList(writer, descriptor.type >> 8, value);
    } else if (thriftType === ThriftTypes.MAP) {
      writeThriftMap(writer, descriptor.field, value);
    } else {
      throw new Error(`Unsupported thrift type: ${descriptor.type}`);
    }
  }
}

function writeThriftList(writer, itemType, values) {
  const size = values.length;
  if (size < 0x0f) writer.buffer.push((size << 4) | itemType);
  else {
    writer.buffer.push(0xf0 | itemType);
    writer.writeVarint(size);
  }
  for (const value of values) {
    if (itemType === ThriftTypes.INT_32) writer.writeVarint(zigzag(value, 32));
    else if (itemType === ThriftTypes.BINARY) writer.writeStringDirect(value);
    else throw new Error(`Unsupported thrift list type: ${itemType}`);
  }
}

function writeThriftMap(writer, field, values) {
  writer.writeField(field, ThriftTypes.MAP);
  const keys = Object.keys(values);
  writer.writeVarint(keys.length);
  if (!keys.length) return;
  writer.buffer.push((ThriftTypes.BINARY << 4) | ThriftTypes.BINARY);
  for (const key of keys) {
    writer.writeStringDirect(key);
    writer.writeStringDirect(values[key]);
  }
}

function writeThriftObject(data, descriptors) {
  const writer = new ThriftWriter();
  writeThriftStruct(writer, data, descriptors);
  writer.writeStop();
  return Buffer.from(writer.buffer);
}

// The CONNECT payload: a Thrift compact MQTToTConnection struct.
const CONNECTION_DESCRIPTORS = [
  { name: "clientIdentifier", field: 1, type: ThriftTypes.BINARY, children: [] },
  { name: "willTopic", field: 2, type: ThriftTypes.BINARY, children: [] },
  { name: "willMessage", field: 3, type: ThriftTypes.BINARY, children: [] },
  {
    name: "clientInfo",
    field: 4,
    type: ThriftTypes.STRUCT,
    children: [
      { name: "userId", field: 1, type: ThriftTypes.INT_64, children: [] },
      { name: "userAgent", field: 2, type: ThriftTypes.BINARY, children: [] },
      { name: "clientCapabilities", field: 3, type: ThriftTypes.INT_64, children: [] },
      { name: "endpointCapabilities", field: 4, type: ThriftTypes.INT_64, children: [] },
      { name: "publishFormat", field: 5, type: ThriftTypes.INT_32, children: [] },
      { name: "noAutomaticForeground", field: 6, type: ThriftTypes.BOOLEAN, children: [] },
      { name: "makeUserAvailableInForeground", field: 7, type: ThriftTypes.BOOLEAN, children: [] },
      { name: "deviceId", field: 8, type: ThriftTypes.BINARY, children: [] },
      { name: "isInitiallyForeground", field: 9, type: ThriftTypes.BOOLEAN, children: [] },
      { name: "networkType", field: 10, type: ThriftTypes.INT_32, children: [] },
      { name: "networkSubtype", field: 11, type: ThriftTypes.INT_32, children: [] },
      { name: "clientMqttSessionId", field: 12, type: ThriftTypes.INT_64, children: [] },
      { name: "clientIpAddress", field: 13, type: ThriftTypes.BINARY, children: [] },
      { name: "subscribeTopics", field: 14, type: ThriftTypes.LIST_INT_32, children: [] },
      { name: "clientType", field: 15, type: ThriftTypes.BINARY, children: [] },
      { name: "appId", field: 16, type: ThriftTypes.INT_64, children: [] },
      { name: "overrideNectarLogging", field: 17, type: ThriftTypes.BOOLEAN, children: [] },
      { name: "connectTokenHash", field: 18, type: ThriftTypes.BINARY, children: [] },
      { name: "regionPreference", field: 19, type: ThriftTypes.BINARY, children: [] },
      { name: "deviceSecret", field: 20, type: ThriftTypes.BINARY, children: [] },
      { name: "clientStack", field: 21, type: ThriftTypes.BYTE, children: [] },
      { name: "fbnsConnectionKey", field: 22, type: ThriftTypes.INT_64, children: [] },
      { name: "fbnsConnectionSecret", field: 23, type: ThriftTypes.BINARY, children: [] },
      { name: "fbnsDeviceId", field: 24, type: ThriftTypes.BINARY, children: [] },
      { name: "fbnsDeviceSecret", field: 25, type: ThriftTypes.BINARY, children: [] },
      { name: "anotherUnknown", field: 26, type: ThriftTypes.INT_64, children: [] }
    ]
  },
  { name: "password", field: 5, type: ThriftTypes.BINARY, children: [] },
  { name: "getDiffsRequests", field: 6, type: ThriftTypes.LIST_BINARY, children: [] },
  { name: "zeroRatingTokenHash", field: 9, type: ThriftTypes.BINARY, children: [] },
  { name: "appSpecificInfo", field: 10, type: ThriftTypes.MAP_BINARY_BINARY, children: [] }
];

class MQTToTConnection {
  constructor({ clientIdentifier, clientInfo, password, appSpecificInfo }) {
    this.clientIdentifier = clientIdentifier;
    this.clientInfo = clientInfo;
    this.password = password;
    this.appSpecificInfo = appSpecificInfo || null;
  }

  toThrift() {
    const payload = {
      clientIdentifier: this.clientIdentifier,
      clientInfo: this.clientInfo,
      password: this.password
    };
    if (this.appSpecificInfo) payload.appSpecificInfo = this.appSpecificInfo;
    return writeThriftObject(payload, CONNECTION_DESCRIPTORS);
  }
}

function compressPayload(data) {
  return zlib.deflateSync(data, { level: 9 });
}

// Publish payloads are zlib streams (0x78 ...). Anything else is left as-is.
// Bound decompressed broker payloads independently of the MQTT frame limit.
// A small compressed publish must not be able to expand into unbounded memory.
const MAX_DECOMPRESSED_PAYLOAD_BYTES = 32 * 1024 * 1024;

function tryDecompressPayload(data) {
  if (!data || !data.length || data[0] !== 0x78) return data;
  try {
    return zlib.inflateSync(data, { maxOutputLength: MAX_DECOMPRESSED_PAYLOAD_BYTES });
  } catch (_) {
    // Preserve the existing best-effort contract: malformed or oversized
    // compressed payloads are returned unchanged for the caller to ignore.
    return data;
  }
}

// The CONNECT keep-alive in seconds. The client's PINGREQ timer must fire well
// inside this window (see client.js PING_INTERVAL_MS); the broker drops a client
// that stays silent for ~1.5x the keep-alive.
const KEEP_ALIVE_SECONDS = 60;

function writeConnectPacket(connection, keepAlive = KEEP_ALIVE_SECONDS) {
  const payload = compressPayload(connection.toThrift());
  const header = Buffer.concat([
    writeUtf8("MQTToT"),
    Buffer.from([3, 0xc2]),
    uint16BE(keepAlive)
  ]);
  const remaining = Buffer.concat([header, payload]);
  return Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(remaining.length), remaining]);
}

function writePublishPacket(topic, payload, qos = 1, packetId = 1) {
  if (qos !== 0 && qos !== 1) throw new Error("Only QoS 0 and QoS 1 are supported");
  if (qos === 1 && (!Number.isInteger(packetId) || packetId < 1 || packetId > 65535)) {
    throw new RangeError("MQTT packet identifier must be an integer from 1 to 65535");
  }
  let body = writeUtf8(String(topic));
  if (qos) body = Buffer.concat([body, uint16BE(packetId)]);
  body = Buffer.concat([body, payload]);
  return Buffer.concat([Buffer.from([0x30 | (qos << 1)]), encodeRemainingLength(body.length), body]);
}

function writeSubscribePacket(topic, packetId = 1, qos = 1) {
  if (!Number.isInteger(packetId) || packetId < 1 || packetId > 65535) {
    throw new RangeError("MQTT packet identifier must be an integer from 1 to 65535");
  }
  if (qos !== 0 && qos !== 1) throw new Error("Only QoS 0 and QoS 1 are supported");
  const body = Buffer.concat([uint16BE(packetId), writeUtf8(String(topic)), Buffer.from([qos])]);
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(body.length), body]);
}

function writePingreqPacket() {
  return Buffer.from([0xc0, 0x00]);
}

function writeDisconnectPacket() {
  return Buffer.from([0xe0, 0x00]);
}

function decodePacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 2) {
    throw new Error("Malformed MQTT packet: missing fixed header");
  }
  const packetTypeId = packet[0] >> 4;
  const flags = packet[0] & 0x0f;
  if (packetTypeId === 0 || packetTypeId === 15) {
    throw new Error("Malformed MQTT packet: reserved control packet type");
  }
  const { value: remainingLength, offset } = decodeRemainingLength(packet, 1);
  if (offset + remainingLength !== packet.length) {
    throw new Error("Malformed MQTT packet: remaining length does not match frame size");
  }
  const body = packet.slice(offset, offset + remainingLength);
  if (packetTypeId === 2 && remainingLength !== 2) {
    throw new Error("Malformed MQTT CONNACK: expected a two-byte body");
  }
  if ([12, 13, 14].includes(packetTypeId) && remainingLength !== 0) {
    throw new Error("Malformed MQTT control packet: expected an empty body");
  }
  if (packetTypeId === 1) {
    const { value: protocolName, offset: pos } = readUtf8(body, 0);
    return {
      packetType: "connect",
      protocolName,
      protocolLevel: body[pos],
      connectFlags: body[pos + 1],
      keepAlive: body.readUInt16BE(pos + 2),
      payload: body.slice(pos + 4)
    };
  }
  if (packetTypeId === 2) {
    return { packetType: "connack", returnCode: body[1], payload: body.slice(2) };
  }
  if (packetTypeId === 3) {
    const { value: topic, offset: pos } = readUtf8(body, 0);
    const qos = (flags >> 1) & 0x03;
    if (qos > 1) throw new Error("Malformed MQTT PUBLISH: unsupported QoS value");
    let packetId = null;
    let at = pos;
    if (qos) {
      packetId = body.readUInt16BE(at);
      if (packetId === 0) throw new Error("Malformed MQTT PUBLISH: packet identifier cannot be zero");
      at += 2;
    }
    return { packetType: "publish", topic, qos, packetId, payload: body.slice(at) };
  }
  if (packetTypeId === 12) return { packetType: "pingreq", payload: body };
  if (packetTypeId === 13) return { packetType: "pingresp", payload: body };
  if (packetTypeId === 14) return { packetType: "disconnect", payload: body };
  return { packetType: String(packetTypeId), payload: body };
}

function parseJsonPayload(payload) {
  return JSON.parse(tryDecompressPayload(payload).toString("utf8"));
}

function uint16BE(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value & 0xffff, 0);
  return buf;
}

function writeUtf8(value) {
  const raw = Buffer.from(value, "utf8");
  return Buffer.concat([uint16BE(raw.length), raw]);
}

function readUtf8(data, offset) {
  if (!Buffer.isBuffer(data) || offset < 0 || offset + 2 > data.length) {
    throw new Error("Malformed MQTT packet: truncated UTF-8 length");
  }
  const size = data.readUInt16BE(offset);
  offset += 2;
  if (size > data.length - offset) {
    throw new Error("Malformed MQTT packet: truncated UTF-8 value");
  }
  return { value: data.slice(offset, offset + size).toString("utf8"), offset: offset + size };
}

function encodeRemainingLength(value) {
  const encoded = [];
  for (;;) {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    encoded.push(byte);
    if (!value) return Buffer.from(encoded);
  }
}

function decodeRemainingLength(data, offset) {
  let multiplier = 1;
  let value = 0;
  for (let count = 0; count < 4; count++) {
    if (offset >= data.length) throw new Error("Malformed MQTT packet: truncated remaining length");
    const byte = data[offset++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 128;
  }
  throw new Error("Malformed MQTT packet: remaining length exceeds four bytes");
}

// A TLS transport that frames MQTT packets. `recvPacket()` resolves with one
// complete packet; the realtime client drives it in a loop. Node's socket is
// asynchronous, so unlike the reference (blocking) transport this buffers and
// hands out packets as they arrive.
class SocketMQTToTTransport {
  constructor(host, port = 443, {
    timeout = 30000,
    maxPacketSize = 16 * 1024 * 1024,
    maxBufferedBytes = 32 * 1024 * 1024
  } = {}) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.maxPacketSize = Math.max(1, Math.floor(Number(maxPacketSize) || 16 * 1024 * 1024));
    this.maxBufferedBytes = Math.max(
      this.maxPacketSize + 5,
      Math.floor(Number(maxBufferedBytes) || 32 * 1024 * 1024)
    );
    this.socket = null;
    this._buffer = Buffer.alloc(0);
    this._waiters = [];
    this._closed = false;
    this._error = null;
  }

  // Clears the failure/closed state so the transport can be re-connected after a
  // broker drop. Without this, a reconnect on the same transport rejects every
  // recvPacket() with the stale "MQTT socket closed" error and can never come
  // back up — which is what made the realtime client flap.
  reset() {
    const resetError = new Error("MQTT transport reset");
    const socket = this.socket;
    this.socket = null;
    for (const waiter of this._waiters) waiter.reject(resetError);
    this._waiters = [];
    this._buffer = Buffer.alloc(0);
    this._closed = false;
    this._error = null;
    // Destroy a stale/connecting socket so a new attempt cannot overwrite it
    // while its TLS secureConnect event is still pending.
    if (socket) {
      try { socket.destroy(); } catch (_) {}
    }
  }

  connect() {
    this.reset();
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: this.host,
        port: this.port,
        servername: this.host,
        minVersion: "TLSv1.2"
      });
      this.socket = socket;
      let settled = false;
      const cleanup = () => {
        socket.removeListener("error", onError);
        socket.removeListener("close", onClose);
        socket.removeListener("secureConnect", onConnect);
      };
      const fail = (err) => {
        cleanup();
        const isCurrent = this.socket === socket;
        if (isCurrent) {
          this.socket = null;
          this._fail(err);
        }
        if (!settled) {
          settled = true;
          reject(isCurrent ? err : (this._error || err));
        }
      };
      const onError = (err) => fail(err);
      const onClose = () => fail(this._error || new Error("MQTT socket closed during TLS handshake"));
      const onConnect = () => {
        cleanup();
        if (this._closed || this.socket !== socket) {
          const error = this._error || new Error("MQTT connection cancelled");
          try { socket.destroy(); } catch (_) {}
          if (!settled) {
            settled = true;
            reject(error);
          }
          return;
        }
        this._attach(socket);
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      socket.setTimeout(this.timeout, () => socket.destroy(new Error("MQTT socket timeout")));
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.once("secureConnect", onConnect);
    });
  }

  _attach(socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      if (this.socket !== socket || this._closed) return;
      if (this._buffer.length + chunk.length > this.maxBufferedBytes) {
        const error = new Error("MQTT receive buffer exceeded its configured limit");
        this._fail(error);
        socket.destroy(error);
        return;
      }
      this._buffer = Buffer.concat([this._buffer, chunk]);
      try {
        this._drain();
      } catch (error) {
        this._fail(error);
        socket.destroy(error);
      }
    });
    socket.on("error", (err) => {
      if (this.socket === socket) this._fail(err);
    });
    socket.on("close", () => {
      if (this.socket === socket) this._fail(new Error("MQTT socket closed"));
    });
  }

  _drain() {
    while (this._waiters.length) {
      const packet = this._tryRead();
      if (!packet) break;
      this._waiters.shift().resolve(packet);
    }
  }

  _tryRead() {
    if (this._buffer.length < 2) return null;
    let multiplier = 1;
    let size = 0;
    let offset = 1;
    let completeLength = false;
    for (let count = 0; count < 4; count++) {
      // TCP may split the MQTT fixed header across data events. An incomplete
      // but otherwise valid varint must wait for the next chunk, not fail.
      if (offset >= this._buffer.length) return null;
      const byte = this._buffer[offset++];
      size += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        completeLength = true;
        break;
      }
      multiplier *= 128;
    }
    if (!completeLength) {
      throw new Error("Malformed MQTT packet: remaining length exceeds four bytes");
    }
    if (size > this.maxPacketSize) {
      throw new Error(`MQTT packet exceeds configured limit (${this.maxPacketSize} bytes)`);
    }
    const total = offset + size;
    if (this._buffer.length < total) return null;
    const packet = this._buffer.slice(0, total);
    this._buffer = this._buffer.slice(total);
    return packet;
  }

  recvPacket() {
    const packet = this._tryRead();
    if (packet) return Promise.resolve(packet);
    if (this._closed) return Promise.reject(this._error || new Error("MQTT socket closed"));
    return new Promise((resolve, reject) => this._waiters.push({ resolve, reject }));
  }

  send(packet) {
    if (!this.socket || this._closed) {
      return Promise.reject(this._error || new Error("MQTT transport is not connected"));
    }
    return new Promise((resolve, reject) => {
      this.socket.write(packet, (err) => (err ? reject(err) : resolve()));
    });
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    this._fail(new Error("MQTT transport closed"));
    if (!socket) return;
    try { socket.end(); } catch (_) {}
    try { socket.destroy(); } catch (_) {}
  }

  _fail(err) {
    if (this._closed && this._error) return;
    this._closed = true;
    this._error = err;
    for (const waiter of this._waiters) waiter.reject(err);
    this._waiters = [];
  }
}

module.exports = {
  ThriftTypes,
  ThriftWriter,
  ThriftReader,
  MQTToTConnection,
  CONNECTION_DESCRIPTORS,
  SocketMQTToTTransport,
  compressPayload,
  tryDecompressPayload,
  writeConnectPacket,
  writePublishPacket,
  writeSubscribePacket,
  writePingreqPacket,
  writeDisconnectPacket,
  decodePacket,
  parseJsonPayload,
  writeThriftObject,
  writeThriftStruct,
  KEEP_ALIVE_SECONDS,
  readThriftObject: (data, descriptors, options) => new ThriftReader(data, options).readStruct(descriptors),
  zigzag,
  unzigzag
};
