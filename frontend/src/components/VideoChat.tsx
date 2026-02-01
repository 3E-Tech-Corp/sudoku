import { useEffect, useRef, useState, useCallback } from 'react';
import type { HubConnection } from '@microsoft/signalr';
import type { VideoPosition } from './RoomSettings';

interface Peer {
  connectionId: string;
  displayName: string;
  stream?: MediaStream;
  pc?: RTCPeerConnection;
}

interface VideoChatProps {
  connection: HubConnection | null;
  roomCode: string;
  myName: string;
  myColor: string;
  videoPosition?: VideoPosition;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const POSITION_CLASSES: Record<string, string> = {
  'top-left': 'fixed top-16 left-4 z-50',
  'top-right': 'fixed top-16 right-4 z-50',
  'bottom-left': 'fixed bottom-4 left-4 z-50',
  'bottom-right': 'fixed bottom-4 right-4 z-50',
};

export default function VideoChat({ connection, roomCode, myName, myColor, videoPosition = 'inline' }: VideoChatProps) {
  const [expanded, setExpanded] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());

  // Keep ref in sync
  useEffect(() => { peersRef.current = peers; }, [peers]);

  // Create peer connection for a remote peer
  const createPeerConnection = useCallback((remoteId: string, remoteName: string, stream: MediaStream | null): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const peer = next.get(remoteId);
        if (peer) {
          next.set(remoteId, { ...peer, stream: event.streams[0] });
        } else {
          next.set(remoteId, { connectionId: remoteId, displayName: remoteName, stream: event.streams[0], pc });
        }
        return next;
      });
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && connection) {
        connection.invoke('SendIceCandidate', roomCode, remoteId, JSON.stringify(event.candidate)).catch(() => {});
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
        // Clean up failed peer
        setPeers((prev) => {
          const next = new Map(prev);
          const peer = next.get(remoteId);
          if (peer?.pc === pc) {
            peer.pc?.close();
            next.delete(remoteId);
          }
          return next;
        });
      }
    };

    return pc;
  }, [connection, roomCode]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (cameraOn && localStream) {
      // Turn off
      localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
      setCameraOn(false);
    } else {
      try {
        let stream = localStream;
        if (!stream || stream.getVideoTracks().length === 0) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
            audio: micOn || true, // get audio too if not already
          });
          setLocalStream(stream);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;

          // Add tracks to all existing peer connections
          peersRef.current.forEach((peer) => {
            if (peer.pc) {
              stream!.getTracks().forEach((track) => {
                const senders = peer.pc!.getSenders();
                const existing = senders.find((s) => s.track?.kind === track.kind);
                if (existing) {
                  existing.replaceTrack(track);
                } else {
                  peer.pc!.addTrack(track, stream!);
                }
              });
            }
          });
        } else {
          stream.getVideoTracks().forEach((t) => { t.enabled = true; });
        }
        setCameraOn(true);
        setMicOn(stream.getAudioTracks().some((t) => t.enabled));
      } catch (err) {
        console.error('Camera access failed:', err);
      }
    }
  }, [cameraOn, micOn, localStream]);

  // Toggle mic
  const toggleMic = useCallback(() => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach((t) => { t.enabled = !t.enabled; });
      setMicOn(audioTracks.some((t) => t.enabled));
    }
  }, [localStream]);

  // Set up SignalR WebRTC signaling
  useEffect(() => {
    if (!connection) return;

    const onPeerJoined = async (connectionId: string, displayName: string) => {
      if (!localStream) return; // Can't call if we don't have media
      // We are the "offerer" to the new peer
      const pc = createPeerConnection(connectionId, displayName, localStream);

      setPeers((prev) => {
        const next = new Map(prev);
        next.set(connectionId, { connectionId, displayName, pc });
        return next;
      });

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await connection.invoke('SendOffer', roomCode, connectionId, JSON.stringify(offer));
      } catch (err) {
        console.error('Failed to create offer:', err);
      }
    };

    const onReceiveOffer = async (senderId: string, senderName: string, sdpJson: string) => {
      const pc = createPeerConnection(senderId, senderName, localStream);

      setPeers((prev) => {
        const next = new Map(prev);
        next.set(senderId, { connectionId: senderId, displayName: senderName, pc });
        return next;
      });

      try {
        const offer = JSON.parse(sdpJson);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await connection.invoke('SendAnswer', roomCode, senderId, JSON.stringify(answer));
      } catch (err) {
        console.error('Failed to handle offer:', err);
      }
    };

    const onReceiveAnswer = async (senderId: string, _senderName: string, sdpJson: string) => {
      const peer = peersRef.current.get(senderId);
      if (!peer?.pc) return;
      try {
        const answer = JSON.parse(sdpJson);
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Failed to handle answer:', err);
      }
    };

    const onReceiveIceCandidate = async (senderId: string, candidateJson: string) => {
      const peer = peersRef.current.get(senderId);
      if (!peer?.pc) return;
      try {
        const candidate = JSON.parse(candidateJson);
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Failed to add ICE candidate:', err);
      }
    };

    const onPeerLeft = (connectionId: string, _displayName: string) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const peer = next.get(connectionId);
        if (peer) {
          peer.pc?.close();
          next.delete(connectionId);
        }
        return next;
      });
    };

    const onPeerList = (peersJson: string) => {
      // When we first join, request offers from all existing peers
      if (!localStream) return;
      const existingPeers: { connectionId: string; displayName: string }[] = JSON.parse(peersJson);
      existingPeers.forEach(async (p) => {
        const pc = createPeerConnection(p.connectionId, p.displayName, localStream);
        setPeers((prev) => {
          const next = new Map(prev);
          next.set(p.connectionId, { connectionId: p.connectionId, displayName: p.displayName, pc });
          return next;
        });
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await connection!.invoke('SendOffer', roomCode, p.connectionId, JSON.stringify(offer));
        } catch (err) {
          console.error('Failed to create offer to existing peer:', err);
        }
      });
    };

    connection.on('PeerJoined', onPeerJoined);
    connection.on('ReceiveOffer', onReceiveOffer);
    connection.on('ReceiveAnswer', onReceiveAnswer);
    connection.on('ReceiveIceCandidate', onReceiveIceCandidate);
    connection.on('PeerLeft', onPeerLeft);
    connection.on('PeerList', onPeerList);

    return () => {
      connection.off('PeerJoined', onPeerJoined);
      connection.off('ReceiveOffer', onReceiveOffer);
      connection.off('ReceiveAnswer', onReceiveAnswer);
      connection.off('ReceiveIceCandidate', onReceiveIceCandidate);
      connection.off('PeerLeft', onPeerLeft);
      connection.off('PeerList', onPeerList);
    };
  }, [connection, roomCode, localStream, createPeerConnection]);

  // When local stream becomes available, request peer list and initiate connections
  useEffect(() => {
    if (localStream && connection) {
      connection.invoke('RequestPeerList', roomCode).catch(() => {});
    }
  }, [localStream, connection, roomCode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((peer) => peer.pc?.close());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peerArray = Array.from(peers.values());
  const hasAnyVideo = cameraOn || peerArray.some((p) => p.stream);
  const isFloating = videoPosition !== 'inline' && POSITION_CLASSES[videoPosition];

  const videoPanel = (
    <div className={`bg-gray-800 rounded-2xl border border-gray-700 p-3 w-72 ${isFloating ? 'shadow-2xl' : 'mt-2'}`}>
      {/* Drag handle / title for floating */}
      {isFloating && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-[10px] font-semibold uppercase tracking-wider">📹 Video Chat</span>
          <button
            onClick={() => setExpanded(false)}
            className="text-gray-500 hover:text-gray-300 transition-colors text-sm leading-none"
            title="Minimize"
          >
            ✕
          </button>
        </div>
      )}

      {/* Control buttons */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={toggleCamera}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            cameraOn
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {cameraOn ? '📷' : '📷'} {cameraOn ? 'Cam On' : 'Cam Off'}
        </button>
        <button
          onClick={toggleMic}
          disabled={!localStream}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            micOn
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          } disabled:opacity-30`}
        >
          {micOn ? '🎙️ Mic On' : '🔇 Mic Off'}
        </button>
      </div>

      {/* Video grid */}
      <div className={`grid gap-2 ${
        peerArray.length === 0 ? 'grid-cols-1' :
        peerArray.length <= 1 ? 'grid-cols-2' :
        'grid-cols-2'
      }`}>
        {/* Local video */}
        <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-[4/3]">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${!cameraOn ? 'hidden' : ''}`}
          />
          {!cameraOn && (
            <div className="w-full h-full flex items-center justify-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: myColor }}
              >
                {myName.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
            You {!micOn && '🔇'}
          </div>
        </div>

        {/* Remote peers */}
        {peerArray.map((peer) => (
          <PeerVideo key={peer.connectionId} peer={peer} />
        ))}
      </div>

      {!hasAnyVideo && peerArray.length === 0 && (
        <p className="text-gray-500 text-xs text-center mt-2">
          Turn on your camera to start video chat
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Toggle button — always in the header */}
      <div className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all
            ${expanded
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }
          `}
        >
          📹 Video {expanded ? '▾' : '▸'}
          {peerArray.length > 0 && (
            <span className="w-5 h-5 bg-green-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
              {peerArray.length}
            </span>
          )}
        </button>

        {/* Inline panel (default) */}
        {expanded && !isFloating && videoPanel}
      </div>

      {/* Floating panel (corner positions) */}
      {expanded && isFloating && (
        <div className={POSITION_CLASSES[videoPosition]}>
          {videoPanel}
        </div>
      )}
    </>
  );
}

function PeerVideo({ peer }: { peer: Peer }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-[4/3]">
      {peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-bold text-sm">
            {peer.displayName.charAt(0).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
        {peer.displayName}
      </div>
    </div>
  );
}
