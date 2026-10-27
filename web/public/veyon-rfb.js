import RFB from './rfb.js';
import {decodeUserInfo,isUserInfo,userInfoRequest} from './user-info.js?v=user-info-performance-20261027';

export default class VeyonRFB extends RFB {
  requestUserInfo() {
    this._sock.sQpushBytes(userInfoRequest);this._sock.flush();
  }

  _handleDataRect() {
    const complete = super._handleDataRect();
    // Cursor/size/desktop-name notifications are not screenshots. CopyRect
    // only moves existing pixels and cannot supply an initial desktop image.
    if (complete && this._FBU.width > 0 && this._FBU.height > 0 && this._FBU.encoding !== 1) this._frameHasPixels = true;
    return complete;
  }

  _framebufferUpdate() {
    const complete = super._framebufferUpdate();
    if (complete && this._FBU.rects === 0 && this._frameHasPixels) {
      this._frameHasPixels = false;
      this._display.flush().then(() => {
        this.hasFrame = true;
        this.dispatchEvent(new CustomEvent('framebufferupdate'));
      });
    }
    return complete;
  }

  _normalMsg() {
    // Only inspect message boundaries. Framebuffer payloads may also contain 41.
    if (this._FBU.rects === 0 && !this._sock.rQwait('message', 1) && this._sock.rQpeek8() === 41) {
      // FeatureMessage: one type byte, a big-endian uint32 size, then a
      // serialized QVariant payload. Read user metadata and ignore other events.
      if (this._sock.rQwait('Veyon feature header', 5)) return false;
      const header = this._sock.rQpeekBytes(5);
      const length = new DataView(header.buffer, header.byteOffset + 1, 4).getUint32(0);
      if (length > 1048576) return this._fail('Veyon feature message exceeds its size limit.');
      if (this._sock.rQwait('Veyon feature payload', 5 + length)) return false;
      // Inspect only the UUID before copying a payload: other feature messages
      // can be large and are irrelevant to the dashboard.
      const relevant=length>=21&&isUserInfo(this._sock.rQpeekBytes(26).subarray(5));
      const payload=relevant?this._sock.rQpeekBytes(5+length).subarray(5):null;
      this._sock.rQskipBytes(5 + length);
      try {
        const info=payload?decodeUserInfo(payload):null;
        if(info){this.userInfo=info;this.dispatchEvent(new CustomEvent('userinfo',{detail:info}));}
      }catch{/* Malformed optional metadata must not interrupt desktop pictures. */}
      return true;
    }
    return super._normalMsg();
  }

  disconnect() {
    if (this._rfbConnectionState === 'disconnected' || this._rfbConnectionState === 'disconnecting') return;
    super.disconnect();
  }
}
