// ==UserScript==
// @name         Secure WebRTC with H.264 Video Codec
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replaces existing WebRTC functions with secure H.264 video codec support on a specific domain.
// @match        https://tinychat.com/room/*
// @author       BadNintendo
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tinychat.com
// @grant        none
// ==/UserScript==

(function() {
    "use strict";
    const TinychatApp = window.TinychatApp;
    class a {
        constructor(a, b, c, d, e, codec) {
            this.videolist = a;
            this.chatroom = a.chatroom;
            this.app = a.chatroom.app;
            this.EventBus = a.chatroom.app.EventBus;
            this.handle = b;
            this.outgoing = c;
            this.sdp = e;
            this.mediaStream = null;
            this.iceStateLast = "";
            this.iceConnectedCount = 0;
            let f = this;
            this.rtc = new RTCPeerConnection({
                rtcpMuxPolicy: "require",
                bundlePolicy: "max-bundle",
                iceServers: [{
                    urls: d
                }],
                // Add H.264 codec configuration
                codecs: [{ mimeType: codec }]
            }, {});

            this.rtc.onicecandidate = function(a) {
                f.onICE_Candidate(a);
            };
            this.rtc.oniceconnectionstatechange = function(a) {
                f.onICE_ConnectionStateChange(a);
            };
            this.rtc.onaddstream = function(a) {
                f.onAddStream(a);
            };
            this.rtc.onremovestream = a => {
                f.onRemoveStream(a);
            };
        }

        get ingoing() {
            return !this.outgoing;
        }

        async Connect() {
            if (this.outgoing) {
                await this._sendOfferPublisher();
            } else {
                await this._sendOfferRemote();
            }
        }

        Close() {
            if (null != this.rtc) {
                let a = this.rtc;
                this.rtc = null;
                if (null != this.mediaStream) {
                    if (this.mediaStream.active && "closed" !== a.signalingState && "function" === typeof a.removeStream) {
                        a.removeStream(this.mediaStream);
                    }
                    this.mediaStream.stop();
                    this.mediaStream = null;
                }
                if ("closed" !== a.signalingState) {
                    a.close();
                }
                console.log("MediaConnection.SignalingState: " + a.signalingState + " ->>> Close");
            }
        }

        AddStream(a) {
            this.rtc.addStream(a);
            this.mediaStream = a;
        }

        async onICE_Candidate(a) {
            console.log(a.candidate);
            if (null != a.candidate && "object" === typeof a.candidate && "string" === typeof a.candidate.candidate) {
                var b = this.chatroom.tcPkt_Trickle(this.handle, a.candidate.candidate);
                this.chatroom.packetWorker.send(b);
            }
        }

        onICE_ConnectionStateChange(a) {
            console.log(a);
            let b = TinychatApp.BLL.BroadcastProgressEvent,
                c = a.target;
            if (null != c) {
                switch (c.iceConnectionState) {
                    case "starting":
                        break;
                    case "checking":
                        break;
                    case "completed":
                        break;
                    case "connected":
                        if (this.outgoing && 0 === this.iceConnectedCount) {
                            console.log("Broadcast: Started Successfully");
                            this.videolist.AddVideoSelf(this.handle, this.mediaStream);
                            let a = new b(b.MEDIA_STARTED_SUCCESS);
                            this.EventBus.broadcast(b.ID, a);
                        }
                        this.iceConnectedCount += 1;
                        break;
                    case "disconnected":
                        break;
                    case "failed":
                        console.error(a);
                        break;
                    case "closed":
                        if (this.outgoing) {
                            this.videolist.RemoveVideoSelf(this.handle);
                            let a = new b(b.MEDIA_STOPED);
                            this.EventBus.broadcast(b.ID, a);
                        } else {
                            this.videolist.RemoveVideoRemote(this.handle);
                        }
                }
                this.iceStateLast = c.iceConnectionState;
            }
        }

        onAddStream(a) {
            if (this.outgoing) {
                console.log("Broadcast: LocalMedia.Added (" + this.handle + ")!!!");
            } else {
                console.log("Broadcast: RemoteMedia.Added (" + this.handle + ")!!!");
                this.videolist.AddVideoRemote(this.handle, a.stream);
            }
        }

        onRemoveStream() {
            if (this.outgoing) {
                console.log("Broadcast: LocalMedia.Removed (" + this.handle + ")!!!");
            } else {
                console.log("Broadcast: RemoteMedia.Removed (" + this.handle + ")!!!");
                this.videolist.RemoveVideoRemote(this.handle, event.stream);
            }
        }

        async _sendOfferPublisher() {
            let a = this;
            let b = new Map;
            b.set("offerToReceiveAudio", !1);
            b.set("offerToReceiveVideo", !1);

            try {
                const offer = await this.rtc.createOffer(b);
                const updatedOffer = await this._addVideoCodecToSDP(offer, 'video/H264');
                this.rtc.setLocalDescription(updatedOffer);
                console.log({ sdp: updatedOffer.sdp });

                let c = this.chatroom.tcPkt_SDP(updatedOffer.type, updatedOffer.sdp, 0, function(b) {
                    a._onOfferPublisher(b);
                });
                this.chatroom.packetWorker.send(c);
            } catch (error) {
                console.error(error);
                let b = TinychatApp.BLL.BroadcastProgressEvent,
                    c = new b(b.MEDIA_RTC_FAILED);
                c.error = error;
                this.EventBus.broadcast(b.ID, c);
            }
        }

        _onOfferPublisher(a) {
            if (this.chatroom.tcPkt_TcCallbackCheck(a, "sdp")) {
                if (!0 === a.success) {
                    console.log({ sdp: a.sdp });
                    this.rtc.setRemoteDescription(new RTCSessionDescription({
                        type: a.type,
                        sdp: a.sdp
                    }));
                } else {
                    if (void 0 !== a.reason && null !== a.reason) {
                        if (16 === a.reason.code) {
                            let b = a.timeout.timeToReadable();
                            if (60 < a.timeout) {
                                this.app.showToastWarn(`${a.reason.text}, you can try to broadcast again in ${b}`, 4000);
                            } else {
                                this.app.showToast(`${a.reason.text}, you can try to broadcast again in ${b}`, 4000);
                            }
                        } else if (18 === a.reason.code) {
                            this.app.showToast(a.reason.text, 3000);
                        }
                    }
                    this.rtc.close();
                }
            }
        }

        async _sendOfferRemote() {
            let a = this;

            try {
                await this.rtc.setRemoteDescription(new RTCSessionDescription({
                    type: "offer",
                    sdp: this.sdp
                }));

                const remoteDescription = await this.rtc.remoteDescription;
                const updatedAnswer = await this._addVideoCodecToSDP(remoteDescription, 'video/H264');
                await this.rtc.setLocalDescription(updatedAnswer);

                let b = this.rtc.localDescription.type,
                    c = this.rtc.localDescription.sdp,
                    d = this.handle;

                var e = this.chatroom.tcPkt_SDP(b, c, d, function() {});
                this.chatroom.packetWorker.send(e);
            } catch (error) {
                console.error(error);
            }
        }

        _onOfferRemote(a) {
            this.chatroom.tcPkt_TcCallbackCheck(a, "sdp") && (!0 !== a.success && this.Close(), console.log("Broadcast: RemoteMedia.SDP ..."));
        }

        async _addVideoCodecToSDP(description, codec) {
            const updatedSDP = description.sdp.replace(/m=video (\d+) RTP\/SAVPF/g, `m=video $1 RTP/SAVPF ${codec}`);
            return new RTCSessionDescription({
                type: description.type,
                sdp: updatedSDP
            });
        }
    }

    window.TinychatApp.BLL.MediaConnection = a;
})();
