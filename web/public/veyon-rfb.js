import RFB from './rfb.js';

export default class VeyonRFB extends RFB {
  _normalMsg() {
    // Only inspect message boundaries. Framebuffer payloads may also contain 41.
    if (this._FBU.rects === 0 && !this._sock.rQwait('message', 1) && this._sock.rQpeek8() === 41) {
      // FeatureMessage: one type byte, a big-endian uint32 size, then a
      // serialized QVariant payload. Desktop viewing does not use these events.
      if (this._sock.rQwait('Veyon feature header', 5)) return false;
      const header = this._sock.rQpeekBytes(5);
      const length = new DataView(header.buffer, header.byteOffset + 1, 4).getUint32(0);
      if (length > 1048576) return this._fail('Veyon feature message exceeds its size limit.');
      if (this._sock.rQwait('Veyon feature payload', 5 + length)) return false;
      this._sock.rQskipBytes(5 + length);
      return true;
    }
    return super._normalMsg();
  }

  disconnect() {
    if (this._rfbConnectionState === 'disconnected' || this._rfbConnectionState === 'disconnecting') return;
    super.disconnect();
  }
}
