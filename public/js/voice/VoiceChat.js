/**
 * Room-scoped WebRTC voice mesh (2–4 peers).
 * Independent of Phaser / Regicide rules. Signaling via /ws only.
 *
 * Offer rule: lower player index always creates the offer → no glare.
 */

const DEFAULT_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class VoiceChat {
  /**
   * @param {{
   *   getSession: () => {code:string, token:string}|null,
   *   onStatus?: (s:string) => void,
   *   onSpeaking?: (index:number, speaking:boolean) => void,
   *   onRoster?: (peers:number[]) => void,
   *   onError?: (err:Error|string) => void,
   * }} opts
   */
  constructor(opts) {
    this.getSession = opts.getSession;
    this.onStatus = opts.onStatus || (() => {});
    this.onSpeaking = opts.onSpeaking || (() => {});
    this.onRoster = opts.onRoster || (() => {});
    this.onError = opts.onError || (() => {});

    this.ws = null;
    this.localStream = null;
    this.selfIndex = null;
    this.iceServers = DEFAULT_ICE.iceServers;
    /** @type {Map<number, RTCPeerConnection>} */
    this.pcs = new Map();
    /** @type {Map<number, HTMLAudioElement>} */
    this.audios = new Map();
    this.muted = false;
    this.inVoice = false;
    this._speakingTimer = null;
    this._analyser = null;
    this._audioCtx = null;
    this._raf = 0;
    this._wantReconnect = false;
    this._reconnectTimer = null;
  }

  get joined() {
    return this.inVoice;
  }

  async join() {
    if (this.inVoice) return;
    const session = this.getSession();
    if (!session?.code || !session?.token) throw new Error('Not in a room');

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (e) {
      const err = e?.name === 'NotAllowedError'
        ? new Error('Microphone permission denied')
        : new Error(e?.message || 'Could not access microphone');
      this.onError(err);
      throw err;
    }

    this._applyMuteTrack();
    this._wantReconnect = true;
    await this._connectSocket(session);
    this.inVoice = true;
    this.onStatus('joined');
    this._startVad();
    this.ws?.send(JSON.stringify({ type: 'voice-join' }));
  }

  leave() {
    this._wantReconnect = false;
    clearTimeout(this._reconnectTimer);
    if (this.ws?.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'voice-leave' }));
      } catch {}
    }
    this._teardownMediaAndPeers();
    this._closeSocket();
    this.inVoice = false;
    this.selfIndex = null;
    this.onStatus('left');
    this.onRoster([]);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMuteTrack();
    this.onStatus(this.muted ? 'muted' : 'unmuted');
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  destroy() {
    this.leave();
  }

  _applyMuteTrack() {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !this.muted;
    });
  }

  async _connectSocket(session) {
    this._closeSocket();
    try {
      const ice = await fetch('/ice-config').then((r) => r.json()).catch(() => DEFAULT_ICE);
      if (ice?.iceServers?.length) this.iceServers = ice.iceServers;
    } catch {}

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const fail = (e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error('Voice signaling failed'));
      };
      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', fail);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', fail);
      ws.addEventListener('message', (ev) => this._onMessage(ev));
      ws.addEventListener('close', () => this._onSocketClose());
    });
  }

  _onSocketClose() {
    this.ws = null;
    if (!this._wantReconnect || !this.inVoice) return;
    this.onStatus('reconnecting');
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(async () => {
      const session = this.getSession();
      if (!session || !this._wantReconnect) return;
      try {
        // Drop peer state; re-join voice after hello
        this._closeAllPeers();
        await this._connectSocket(session);
        this.ws?.send(JSON.stringify({ type: 'voice-join' }));
        this.onStatus(this.muted ? 'muted' : 'joined');
      } catch (e) {
        this.onError(e);
        this._reconnectTimer = setTimeout(() => this._onSocketClose(), 2500);
      }
    }, 800);
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'hello':
        this.selfIndex = msg.index;
        if (msg.ice?.iceServers) this.iceServers = msg.ice.iceServers;
        break;
      case 'voice-roster':
        this.selfIndex = msg.self;
        this._syncPeers(msg.peers.map((p) => p.index));
        break;
      case 'voice-peer-joined':
        this._ensurePeer(msg.peer.index);
        break;
      case 'voice-peer-left':
        this._removePeer(msg.index);
        break;
      case 'signal':
        this._handleSignal(msg.from, msg.data);
        break;
      case 'voice-speaking':
        this.onSpeaking(msg.from, !!msg.speaking);
        break;
      default:
        break;
    }
  }

  _syncPeers(indices) {
    const want = new Set(indices);
    for (const id of [...this.pcs.keys()]) {
      if (!want.has(id)) this._removePeer(id);
    }
    for (const id of want) this._ensurePeer(id);
    this.onRoster([...want]);
  }

  _ensurePeer(remoteIndex) {
    if (remoteIndex === this.selfIndex || this.pcs.has(remoteIndex)) return;
    if (this.selfIndex == null || !this.localStream) return;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pcs.set(remoteIndex, pc);

    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this._signal(remoteIndex, { type: 'candidate', candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      let audio = this.audios.get(remoteIndex);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.style.display = 'none';
        document.body.appendChild(audio);
        this.audios.set(remoteIndex, audio);
      }
      audio.srcObject = stream;
      const play = audio.play();
      if (play?.catch) play.catch(() => {
        // Autoplay blocked — resume on next user gesture
        const resume = () => {
          audio.play().catch(() => {});
          document.removeEventListener('pointerdown', resume);
        };
        document.addEventListener('pointerdown', resume, { once: true });
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        pc.restartIce?.();
      }
    };

    // Lower index creates the offer — avoids collisions
    if (this.selfIndex < remoteIndex) {
      this._makeOffer(remoteIndex, pc);
    }

    this.onRoster([...this.pcs.keys()]);
  }

  async _makeOffer(remoteIndex, pc) {
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this._signal(remoteIndex, { type: 'offer', sdp: pc.localDescription });
    } catch (e) {
      console.warn('[voice] offer failed', e);
    }
  }

  async _handleSignal(from, data) {
    if (!data || from === this.selfIndex) return;
    this._ensurePeer(from);
    const pc = this.pcs.get(from);
    if (!pc) return;

    try {
      if (data.type === 'offer') {
        // Only higher index should receive offers (lower creates them)
        if (this.selfIndex < from) return;
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._signal(from, { type: 'answer', sdp: pc.localDescription });
      } else if (data.type === 'answer') {
        if (this.selfIndex > from) return;
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(data.sdp);
        }
      } else if (data.type === 'candidate' && data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          // Ignore candidates before remote description
        }
      }
    } catch (e) {
      console.warn('[voice] signal error', e);
    }
  }

  _signal(to, data) {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'signal', to, data }));
  }

  _removePeer(index) {
    const pc = this.pcs.get(index);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.pcs.delete(index);
    }
    const audio = this.audios.get(index);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.audios.delete(index);
    }
    this.onSpeaking(index, false);
    this.onRoster([...this.pcs.keys()]);
  }

  _closeAllPeers() {
    for (const id of [...this.pcs.keys()]) this._removePeer(id);
  }

  _teardownMediaAndPeers() {
    this._stopVad();
    this._closeAllPeers();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }

  _closeSocket() {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  _startVad() {
    this._stopVad();
    if (!this.localStream) return;
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this._audioCtx.createMediaStreamSource(this.localStream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      src.connect(this._analyser);
      const data = new Uint8Array(this._analyser.frequencyBinCount);
      let last = false;
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        if (!this._analyser || this.muted) {
          if (last) {
            last = false;
            this._sendSpeaking(false);
          }
          return;
        }
        this._analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const speaking = avg > 18;
        if (speaking !== last) {
          last = speaking;
          this._sendSpeaking(speaking);
          if (this.selfIndex != null) this.onSpeaking(this.selfIndex, speaking);
        }
      };
      tick();
    } catch {
      /* VAD optional */
    }
  }

  _sendSpeaking(speaking) {
    if (this.ws?.readyState === 1 && this.inVoice) {
      this.ws.send(JSON.stringify({ type: 'voice-speaking', speaking }));
    }
  }

  _stopVad() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._audioCtx) {
      try {
        this._audioCtx.close();
      } catch {}
      this._audioCtx = null;
    }
    this._analyser = null;
  }
}
