import RFB from './rfb.js';
import {decodeUserInfo,userInfoRequest} from './user-info.js?v=user-info-20261026';

export default class VeyonRFB extends RFB {
  requestUserInfo() {
    this._sock.sQpushBytes(userInfoRequest);this._sock.flush();
  }

  waitForUserInfo(timeout=500) {
    if(this.userInfo!==undefined)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);this.removeEventListener('userinfo',done);this.removeEventListener('disconnect',done);resolve();};
      const timer=setTimeout(done,timeout);
      this.addEventListener('userinfo',done,{once:true});this.addEventListener('disconnect',done,{once:true});
    });
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
      const payload=this._sock.rQpeekBytes(5+length).slice(5);
      this._sock.rQskipBytes(5 + length);
      try {
        const info=decodeUserInfo(payload);
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
