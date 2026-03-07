import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video, MicOff, Volume2, Lock, Wifi, Camera, CameraOff, Mic } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { useNodeAgentPresencePeers } from '@/hooks/useNodeAgent';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { nodeAgentApi, type Call, type MediaEvent } from '@/api/nodeAgent';
import { useCallback, useRef as useRef2 } from 'react';

type CallState = 'idle' | 'incoming' | 'outgoing' | 'connected';

interface Props {
  initialPeerId?: string | null;
  autoStart?: boolean;
  autoVideo?: boolean;
}

const CallsPanel = ({ initialPeerId, autoStart, autoVideo }: Props) => {
  const { data: peersData } = useNodeAgentPresencePeers();
  const { events, activeCall, setActiveCall } = useSession();
  const [callState, setCallState] = useState<CallState>('idle');
  const [targetPeerId, setTargetPeerId] = useState<string>(initialPeerId || "");
  const [currentCall, setCurrentCall] = useState<Call | null>(null);
  const [callTimer, setCallTimer] = useState('00:00');
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  const [metrics, setMetrics] = useState<{
    rtt?: number;
    audio?: { jitter?: number; inboundLoss?: number; bitrateKbps?: number };
    video?: { jitter?: number; inboundLoss?: number; bitrateKbps?: number };
    quality?: 'good' | 'medium' | 'poor';
  } | null>(null);

  // Find display name for current call
  const callDisplayName = currentCall ? (
      peersData?.peers.find(p => p.payload.peer_id === currentCall.peer_id)?.payload.display_name || 
      currentCall.peer_id.substring(0, 8) + '...'
  ) : '';
  
  // Track processed events to avoid duplicates
  const processedEvents = useRef<Set<string>>(new Set());
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  // WebRTC Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const callStartAt = useRef<number | null>(null);
  const [history, setHistory] = useState<Array<{ peer: string; type: 'audio'|'video'; dir: 'исходящий'|'входящий'; ts: number; dur: number }>>(() => {
    // Check if mediaDevices is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("Media devices API not supported or context is not secure (http)");
        toast.error("Media API not available");
        return null;
    }

    try { return JSON.parse(localStorage.getItem('svyaz-call-history') || '[]'); } catch { return []; }
  });
  const [historyLimit, setHistoryLimit] = useState(5);

  // Auto start call flag
  const autoStartedRef = useRef2(false);
  const startCallRef = useRef2<(v: boolean) => void>(() => {});

  const saveHistory = useCallback((items: typeof history) => {
    setHistory(items);
    try { localStorage.setItem('svyaz-call-history', JSON.stringify(items.slice(-50))); } catch (e) { console.error(e); }
  }, []);

  const endCall = useCallback((arg?: boolean | any) => {
    const clearGlobal = typeof arg === 'boolean' ? arg : true;
    console.log('Ending call:', currentCall?.id);
    if (currentCall) {
        nodeAgentApi.hangupCall(currentCall.id).catch((e) => {
            console.error('Failed to hangup call:', e);
        });
    }
    // Clear global active call
    if (clearGlobal) {
        setActiveCall(null);
    }

    if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
    }
    pendingCandidates.current = [];
    if (localStream.current) {
        localStream.current.getTracks().forEach(t => t.stop());
        localStream.current = null;
    }
    if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
    }
    const endAt = Date.now();
    if (callStartAt.current) {
      const dur = Math.max(0, Math.floor((endAt - callStartAt.current) / 1000));
      if (history.length) {
        const last = history[history.length - 1];
        const updated = [...history.slice(0, -1), { ...last, dur }];
        saveHistory(updated);
      }
    }
    setCurrentCall(null);
    setCallState('idle');
    setCallTimer('00:00');
    setVideoEnabled(false);
    setMicEnabled(true);
    setMetrics(null);
  }, [currentCall, history, saveHistory]);

  const startTimer = useCallback(() => {
      let s = 0;
      if (timerInterval.current) clearInterval(timerInterval.current);
      timerInterval.current = setInterval(() => {
          s++;
          const m = String(Math.floor(s / 60)).padStart(2, '0');
          const sec = String(s % 60).padStart(2, '0');
          setCallTimer(`${m}:${sec}`);
      }, 1000);
  }, []);

  // Helper to attach streams to video elements safely
  const attachRemoteStream = useCallback(() => {
    if (remoteVideoRef.current && remoteStream.current) {
      console.log('Attaching remote stream to video element', remoteStream.current.getTracks().map(t => t.kind));
      
      // Only reset srcObject if it has changed to avoid flickering
      if (remoteVideoRef.current.srcObject !== remoteStream.current) {
          remoteVideoRef.current.srcObject = remoteStream.current;
      }
      
      remoteVideoRef.current.muted = false; // Important: hear the caller
      
      const playPromise = remoteVideoRef.current.play();
      if (playPromise !== undefined) {
          playPromise.catch(e => {
            if (e.name !== 'AbortError') console.error('Error playing remote video:', e);
          });
      }
      
      // Update state when video actually starts playing
      remoteVideoRef.current.onplaying = () => {
          console.log('Remote video started playing');
          setRemoteStreamActive(true);
      };
    }
  }, []);

  const attachLocalStream = useCallback(() => {
    if (localVideoRef.current && localStream.current) {
      console.log('Attaching local stream to video element');
      
      if (localVideoRef.current.srcObject !== localStream.current) {
          localVideoRef.current.srcObject = localStream.current;
      }
      
      localVideoRef.current.muted = true; // Important: mute yourself
      localVideoRef.current.play().catch(e => {
         if (e.name !== 'AbortError') console.error('Error playing local video:', e);
      });
    }
  }, []);

  // Re-attach streams when video elements mount or state changes
  useEffect(() => {
    if (callState === 'connected' || callState === 'outgoing') {
        attachLocalStream();
        attachRemoteStream();
    }
  }, [callState, videoEnabled, attachLocalStream, attachRemoteStream]);

  // Initialize WebRTC
  const initPeerConnection = useCallback(() => {
    console.log('Initializing peer connection');
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && currentCall) {
        console.log('Sending ICE candidate for call:', currentCall.id, event.candidate.candidate);
        nodeAgentApi.sendCandidate(currentCall.id, event.candidate).catch(e => {
          console.error('Failed to send ICE candidate:', e);
        });
      } else {
        console.log('ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind, event.streams.length);
      
      // Handle both grouped streams and individual tracks
      let stream = event.streams[0];
      if (!stream) {
         console.warn("No stream in ontrack event, creating new MediaStream");
         if (!remoteStream.current) {
             remoteStream.current = new MediaStream();
         }
         remoteStream.current.addTrack(event.track);
      } else {
         remoteStream.current = stream;
      }
      
      attachRemoteStream();
    };

    pc.onconnectionstatechange = () => {
       console.log('Connection state changed:', pc.connectionState);
       if (pc.connectionState === 'failed') {
           console.log('Connection failed, ending call');
           toast.error("Connection failed");
           endCall();
       }
       if (pc.connectionState === 'connected') {
           console.log('Connection established');
           setCallState('connected');
           startTimer();
       }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    peerConnection.current = pc;
    return pc;
  }, [currentCall, endCall, startTimer]);

  // Debug function to check video state
  const debugVideoState = useCallback(() => {
    console.log('=== Video Debug Info ===');
    console.log('videoEnabled:', videoEnabled);
    console.log('callState:', callState);
    console.log('localStream:', localStream.current);
    console.log('localVideoRef:', localVideoRef.current);
    
    if (localStream.current) {
      const videoTracks = localStream.current.getVideoTracks();
      console.log('Video tracks:', videoTracks.length);
      videoTracks.forEach((track, i) => {
        console.log(`Track ${i}:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted
        });
      });
    }
    
    if (localVideoRef.current) {
      console.log('Video element:', {
        srcObject: localVideoRef.current.srcObject,
        videoWidth: localVideoRef.current.videoWidth,
        videoHeight: localVideoRef.current.videoHeight,
        paused: localVideoRef.current.paused
      });
    }
  }, [videoEnabled, callState]);

  // Add debug button in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as any).debugVideo = debugVideoState;
      console.log('Debug function available: window.debugVideo()');
    }
  }, [videoEnabled, callState, debugVideoState]);

  const getLocalStream = useCallback(async (video: boolean) => {
    // Check Secure Context first
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocal) {
        toast.error("Video calls require HTTPS or localhost");
        return null;
    }

    // Check if mediaDevices is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("Media devices API not supported or context is not secure (http)");
        toast.error("Media API not available");
        return null;
    }

    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          latency: 0
        },
        video: video ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 }
        } : false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStream.current = stream;
      
      // Always show local preview if video is requested, regardless of call state
      if (video) {
          attachLocalStream();
      }
      
      return stream;
    } catch (err) {
      console.error('Failed to get local stream', err);
      // In http/localhost context or if device missing, fallback to mock stream or audio-only if video failed
      if (video && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          console.warn("Video access failed, trying audio only fallback");
          try {
             const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
             localStream.current = audioStream;
             return audioStream;
          } catch {}
      }
      
      toast.error('Media access denied. Check permissions or HTTPS context.');
      return null;
    }
  }, []);

  

  const startCall = useCallback(async (video: boolean) => {
    // If no targetPeerId is set, try to use initialPeerId or just return
    const peerToCall = targetPeerId || initialPeerId;
    console.log('Starting call to:', peerToCall, 'video:', video);
    if (!peerToCall) return;
    
    // Ensure targetPeerId is set for UI
    if (targetPeerId !== peerToCall) setTargetPeerId(peerToCall);
    
    setVideoEnabled(video);
    const stream = await getLocalStream(video);
    if (!stream) return;

    const pc = initPeerConnection();
    
    // Add tracks BEFORE creating offer
    stream.getTracks().forEach(track => {
        console.log('Adding local track to PC:', track.kind, track.label);
        pc.addTrack(track, stream);
    });

    try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
        await pc.setLocalDescription(offer);
        console.log('Created offer:', offer);

        const res = await nodeAgentApi.initiateCall(peerToCall, offer.sdp!, video ? "video" : "audio");
        console.log('Call initiated:', res);
        if (res.ok) {
            setCurrentCall(res.call);
            setCallState('outgoing');
            callStartAt.current = Date.now();
            saveHistory([...history, { peer: peerToCall, type: video ? 'video' : 'audio', dir: 'исходящий', ts: Date.now(), dur: 0 }]);
        }
    } catch (e) {
        console.error('Failed to start call:', e);
        toast.error("Failed to start call");
        endCall();
    }
  }, [targetPeerId, initialPeerId, getLocalStream, initPeerConnection, endCall, history, saveHistory]);

  const acceptCall = useCallback(async (video: boolean) => {
    // If we are already connected or connecting, don't re-accept unless it's a retry
    if (callState === 'connected') return;

    // Use activeCall if currentCall is not set yet
    const callToAnswer = currentCall || activeCall;
    console.log('Accepting call:', callToAnswer?.id, 'video:', video);
    
    if (!callToAnswer) return;
    const sdp = (callToAnswer as any).sdp; // Retrieved from event
    
    setVideoEnabled(video);
    const stream = await getLocalStream(video);
    // If we can't get a stream, we still proceed? No, we need stream for bi-directional. 
    // But maybe we can answer audio-only if video fails. getLocalStream handles fallback.
    if (!stream) {
        console.error("No local stream available, cannot accept call");
        return;
    }

    const pc = initPeerConnection();
    
    // Add tracks BEFORE setting remote description
    stream.getTracks().forEach(track => {
        console.log('Adding local track to PC (answer):', track.kind, track.label);
        pc.addTrack(track, stream);
    });

    try {
        await pc.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: sdp
        }));
        
        // Process pending candidates that might have arrived before we set remote desc
        if (pendingCandidates.current.length > 0) {
            console.log('Processing pending candidates in acceptCall:', pendingCandidates.current.length);
            pendingCandidates.current.forEach(candidate => {
                pc.addIceCandidate(candidate).catch(e => console.error('Error adding pending ICE candidate:', e));
            });
            pendingCandidates.current = [];
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Created answer:', answer);

        await nodeAgentApi.answerCall(callToAnswer.id, answer.sdp!);
        console.log('Call answered');
        setCallState('connected');
        startTimer();
        callStartAt.current = Date.now();
        saveHistory([...history, { peer: callToAnswer.peer_id, type: video ? 'video' : 'audio', dir: 'входящий', ts: Date.now(), dur: 0 }]);
    } catch (e) {
        console.error('Failed to accept call:', e);
        toast.error("Failed to accept call");
        endCall();
    }
  }, [currentCall, activeCall, getLocalStream, initPeerConnection, startTimer, endCall, history, saveHistory, callState]);

  // Watch for active call from global session (e.g. accepted via Modal)
  useEffect(() => {
    // Case 1: Switching calls (activeCall is different from currentCall)
    if (activeCall && currentCall && activeCall.id !== currentCall.id) {
        console.log('Switching calls: ending', currentCall.id, 'starting', activeCall.id);
        endCall(false); // End current call but keep activeCall in global state
        return;
    }

    // Case 2: New call when idle
    if (activeCall && !currentCall && callState === 'idle') {
      console.log('Picking up active call from global session:', activeCall);
      setCurrentCall(activeCall);
      
      // Check intent from storage
      const intentStr = localStorage.getItem('svyaz-call-intent');
      let isVideo = activeCall.type === 'video';
      if (intentStr) {
          try {
              const intent = JSON.parse(intentStr);
              if (intent.video !== undefined) isVideo = intent.video;
          } catch {
              if (intentStr === 'video') isVideo = true;
          }
      }
      localStorage.removeItem('svyaz-call-intent');
      
      // Trigger WebRTC acceptance
      acceptCall(isVideo);
    }
  }, [activeCall, currentCall, callState, acceptCall, endCall]);

  useEffect(() => {
    startCallRef.current = startCall;
  }, [startCall, startCallRef]);

  // Auto start call if props provided (run once)
  useEffect(() => {
    if (!autoStartedRef.current && autoStart && initialPeerId && callState === 'idle') {
      autoStartedRef.current = true;
      const timer = setTimeout(() => {
        startCallRef.current(!!autoVideo);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoStartedRef, autoStart, initialPeerId, autoVideo, callState, startCallRef]);

  const handleEvent = useCallback((event: MediaEvent) => {
    console.log('Handling event:', event.type, event);
    const pc = peerConnection.current;
    switch (event.type) {
      // incoming_call is handled by Global Session + Modal now.
      // We only care about active calls here.
      
      case 'call_accepted':
        if (currentCall && currentCall.id === event.call.id && pc) {
          console.log('Call accepted, setting remote description');
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: (event as any).sdp }))
            .then(() => {
              console.log('Remote description set, processing pending candidates:', pendingCandidates.current.length);
              setCallState('connected');
              startTimer();
              
              // Process pending candidates
              pendingCandidates.current.forEach(candidate => {
                  pc.addIceCandidate(candidate).catch(e => console.error('Error adding pending ICE candidate:', e));
              });
              pendingCandidates.current = [];
            })
            .catch((e) => {
              console.error('Failed to set remote description:', e);
              toast.error("Failed to establish connection");
            });
        }
        break;
      case 'ice_candidate':
        // Handle ICE candidates for current call
        const callId = currentCall?.id || activeCall?.id;
        if (callId && callId === event.call_id) {
          console.log('Received ICE candidate from peer:', (event as any).candidate);
          const candidate = new RTCIceCandidate((event as any).candidate);
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(candidate).catch(e => console.error('Error adding ICE candidate:', e));
          } else {
            console.log('Queueing ICE candidate (no remote description)');
            pendingCandidates.current.push(candidate);
          }
        }
        break;
      case 'hangup':
        if ((currentCall && currentCall.id === event.call_id) || (activeCall && activeCall.id === event.call_id)) {
          endCall();
          toast.info("Call ended by peer");
        }
        break;
    }
  }, [callState, currentCall, activeCall, endCall, startTimer]);

  // Process events from session
  useEffect(() => {
    if (!events || events.length === 0) return;
    
    // Process only new events
    events.forEach(event => {
        const eventKey = `${event.timestamp}-${event.type}-${event.call_id || 'global'}`;
        if (!processedEvents.current.has(eventKey)) {
            processedEvents.current.add(eventKey);
            handleEvent(event as unknown as MediaEvent);
        }
    });
  }, [events, handleEvent]);

  
  
  // Collect WebRTC stats while connected
  useEffect(() => {
    let interval: any = null;
    if (callState === 'connected' && peerConnection.current) {
      interval = setInterval(async () => {
        try {
          const stats = await peerConnection.current!.getStats();
          let rtt: number | undefined;
          const audio = { jitter: 0, inboundLoss: 0, bitrateKbps: 0 };
          const video = { jitter: 0, inboundLoss: 0, bitrateKbps: 0 };
          let audioPackets = 0, audioLost = 0;
          let videoPackets = 0, videoLost = 0;
          const last = (window as any).__webrtc_prev__ || {};
          const nowCounters: Record<string, any> = {};
          stats.forEach((report: any) => {
            if (report.type === 'transport' && report.rtt) {
              rtt = report.rtt * 1000;
            }
            if (report.type === 'inbound-rtp') {
              if (report.kind === 'audio') {
                audioPackets += report.packetsReceived || 0;
                audioLost += report.packetsLost || 0;
                if (typeof report.jitter === 'number') audio.jitter = Math.max(audio.jitter, report.jitter * 1000);
              }
              if (report.kind === 'video') {
                videoPackets += report.packetsReceived || 0;
                videoLost += report.packetsLost || 0;
                if (typeof report.jitter === 'number') video.jitter = Math.max(video.jitter, report.jitter * 1000);
              }
            }
            if (report.type === 'outbound-rtp') {
              const key = report.id;
              nowCounters[key] = { bytesSent: report.bytesSent, timestamp: report.timestamp, kind: report.kind };
              const prev = last[key];
              if (prev && report.timestamp > prev.timestamp) {
                const dt = (report.timestamp - prev.timestamp) / 1000;
                const dBytes = (report.bytesSent || 0) - (prev.bytesSent || 0);
                const kbps = dt > 0 ? (dBytes * 8) / 1000 / dt : 0;
                if (report.kind === 'audio') audio.bitrateKbps = Math.max(audio.bitrateKbps, kbps);
                if (report.kind === 'video') video.bitrateKbps = Math.max(video.bitrateKbps, kbps);
              }
            }
          });
          (window as any).__webrtc_prev__ = nowCounters;
          audio.inboundLoss = audioPackets > 0 ? (audioLost / audioPackets) * 100 : 0;
          video.inboundLoss = videoPackets > 0 ? (videoLost / videoPackets) * 100 : 0;
          const quality = ((): 'good' | 'medium' | 'poor' => {
            const jit = Math.max(audio.jitter || 0, video.jitter || 0);
            const loss = Math.max(audio.inboundLoss || 0, video.inboundLoss || 0);
            if (loss < 1 && jit < 20) return 'good';
            if (loss < 5 && jit < 50) return 'medium';
            return 'poor';
          })();
          setMetrics({ rtt, audio, video, quality });
        } catch (e) {
          // ignore
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callState]);
  
  const toggleMic = () => {
      if (localStream.current) {
          localStream.current.getAudioTracks().forEach(t => t.enabled = !micEnabled);
          setMicEnabled(!micEnabled);
      }
  };

  const toggleVideo = async () => {
      if (!localStream.current || !peerConnection.current) return;
      
      const videoTrack = localStream.current.getVideoTracks()[0];
      
      if (videoTrack) {
          // Toggle existing video track
          videoTrack.enabled = !videoEnabled;
          setVideoEnabled(!videoEnabled);
          
          // Update local preview
          if (localVideoRef.current) {
              if (!videoEnabled) {
                  localVideoRef.current.srcObject = localStream.current;
                  localVideoRef.current.play().catch(console.error);
              }
          }
      } else if (!videoEnabled) {
          // Add video track to existing audio stream
          try {
              const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
              const newVideoTrack = videoStream.getVideoTracks()[0];
              
              // Add to local stream
              localStream.current.addTrack(newVideoTrack);
              
              // Add to peer connection
              peerConnection.current.addTrack(newVideoTrack, localStream.current);
              
              // Update local preview
              if (localVideoRef.current) {
                  localVideoRef.current.srcObject = localStream.current;
                  localVideoRef.current.play().catch(console.error);
              }
              
              setVideoEnabled(true);
          } catch (err) {
              console.error('Failed to add video track', err);
              toast.error('Failed to enable video');
          }
      }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden">
      <video 
        ref={remoteVideoRef} 
        autoPlay 
        playsInline 
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 bg-black ${callState === 'connected' && currentCall?.type === 'video' ? 'opacity-100' : 'opacity-0'}`}
      />
      
      {/* Local Video Preview (PiP) */}
      {videoEnabled && (callState === 'connected' || callState === 'outgoing') && (
          <div className="absolute top-4 right-4 w-48 h-36 bg-black rounded-lg overflow-hidden border-2 border-primary/20 shadow-2xl z-20">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
          </div>
      )}

      {/* Idle State */}
      {callState === 'idle' && (
        <div className="flex-1 flex flex-col items-center p-8 animate-in fade-in duration-500 relative z-10 overflow-y-auto">
            <div className="w-full max-w-md space-y-8 flex flex-col items-center">
                <div className="w-32 h-32 rounded-full bg-muted flex items-center justify-center mb-4">
                <Video size={48} className="text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold">Начать звонок</h2>
            
            <div className="w-full max-w-xs space-y-4">
                 <Select value={targetPeerId} onValueChange={setTargetPeerId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Выберите собеседника..." />
                    </SelectTrigger>
                    <SelectContent>
                        {peersData?.peers
                            .filter(p => p.payload.display_name && p.payload.display_name.trim() !== "" && !p.payload.display_name.startsWith("Relay-"))
                            .map(p => (
                            <SelectItem key={p.payload.peer_id} value={p.payload.peer_id}>
                                {p.payload.display_name || p.payload.peer_id.substring(0, 8)}
                            </SelectItem>
                        ))}
                        {(!peersData?.peers || peersData.peers.filter(p => p.payload.display_name && p.payload.display_name.trim() !== "" && !p.payload.display_name.startsWith("Relay-")).length === 0) && (
                            <div className="p-2 text-sm text-muted-foreground text-center">Нет контактов онлайн</div>
                        )}
                    </SelectContent>
                 </Select>
                 
                 <div className="grid grid-cols-2 gap-3">
                    <Button className="h-12 text-md gap-2 bg-[#2b5278] hover:bg-[#2b5278]/90 text-white border-0" onClick={() => startCall(false)} disabled={!targetPeerId}>
                        <Phone size={18} /> Аудио
                    </Button>
                    <Button className="h-12 text-md gap-2 bg-[#182533] hover:bg-[#182533]/90 text-white border-0" onClick={() => startCall(true)} disabled={!targetPeerId}>
                        <Video size={18} /> Видео
                    </Button>
                 </div>
                 
                 <div className="mt-6">
                   <h3 className="text-sm font-semibold mb-2">История звонков</h3>
                   <div className="space-y-2">
                     {history.length === 0 && <div className="text-xs text-muted-foreground">Пока пусто</div>}
                     {history
                        .filter(h => !h.peer.startsWith("Relay-"))
                        .slice().reverse().slice(0, historyLimit).map((h, i) => (
                       <div key={i} className="text-xs bg-card/60 border border-border/40 rounded-md px-3 py-2 flex items-center justify-between">
                         <span className="font-mono">{new Date(h.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                         <span className="uppercase tracking-wide">{h.type === 'video' ? 'Видео' : 'Аудио'}</span>
                         <span className="truncate max-w-[120px]">{h.dir} с {h.peer.substring(0,8)}…</span>
                         <span className="font-mono opacity-70">{Math.floor(h.dur/60).toString().padStart(2,'0')}:{(h.dur%60).toString().padStart(2,'0')}</span>
                       </div>
                     ))}
                     {history.filter(h => !h.peer.startsWith("Relay-")).length > historyLimit && (
                       <button 
                         onClick={() => setHistoryLimit(prev => prev + 5)}
                         className="w-full text-xs text-primary hover:text-primary/80 py-2 font-medium transition-colors"
                       >
                         Загрузить еще
                       </button>
                     )}
                   </div>
                 </div>
                 </div>
            </div>
        </div>
      )}

      {/* Incoming Call */}
      {callState === 'incoming' && currentCall && (
          <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
               <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center mb-6 animate-pulse">
                   {currentCall.type === 'video' ? <Video size={48} className="text-primary" /> : <Phone size={48} className="text-primary" />}
               </div>
               <h2 className="text-3xl font-bold mb-2">Входящий {currentCall.type === 'video' ? 'видеозвонок' : 'аудиозвонок'}</h2>
               <p className="text-muted-foreground mb-8">от {callDisplayName}</p>
               
               <div className="flex gap-8">
                   <Button size="lg" className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600" onClick={() => acceptCall(currentCall.type === 'video')}>
                       {currentCall.type === 'video' ? <Video size={28} /> : <Phone size={28} />}
                   </Button>
                   <Button size="lg" className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600" onClick={endCall}>
                       <PhoneOff size={28} />
                   </Button>
               </div>
          </div>
      )}

      {/* Active Call / Outgoing */}
      {(callState === 'connected' || callState === 'outgoing') && (
          <div className={`flex flex-col h-full z-10 ${currentCall?.type === 'video' && callState === 'connected' ? 'bg-black/40 text-white backdrop-blur-sm absolute inset-0' : ''}`}>
              
              <div className="flex-1 flex flex-col items-center justify-center space-y-8">
                  {/* Show Avatar only if Audio Call or Video not yet connected/active */}
                  {(!remoteStreamActive || currentCall?.type !== 'video') && (
                      <div className="relative">
                          <div className="w-40 h-40 rounded-full bg-muted flex items-center justify-center overflow-hidden border-4 border-background shadow-xl">
                              <GeometricAvatar index={1} size={160} />
                          </div>
                          {callState === 'connected' && (
                              <div className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
                          )}
                      </div>
                  )}
              </div>

              {/* Info and Controls at bottom */}
              <div className="flex flex-col items-center pb-8 pt-4 space-y-6">
                  <div className="text-center space-y-2">
                      <h3 className="text-2xl font-bold">
                          {callDisplayName}
                      </h3>
                      <p className={`font-mono text-xl tracking-wider ${currentCall?.type === 'video' && callState === 'connected' ? 'text-white' : 'text-primary'}`}>
                          {callState === 'outgoing' ? 'Calling...' : callTimer}
                      </p>
                      <div className={`flex items-center justify-center gap-2 text-xs ${currentCall?.type === 'video' && callState === 'connected' ? 'text-white/70' : 'text-muted-foreground'}`}>
                          <Lock size={12} /> Сквозное шифрование
                      </div>
                  </div>

                  <div className="flex justify-center gap-6 relative">
                      <Button 
                        variant={currentCall?.type === 'video' && callState === 'connected' ? "secondary" : "outline"}
                        size="icon" 
                        className={`h-14 w-14 rounded-full ${!micEnabled ? 'bg-red-500 text-white border-red-600 hover:bg-red-600' : ''}`}
                        onClick={toggleMic}
                      >
                          {micEnabled ? <Mic size={24} /> : <MicOff size={24} />}
                      </Button>
                      
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        className="h-16 w-16 rounded-full shadow-lg"
                        onClick={endCall}
                      >
                          <PhoneOff size={32} />
                      </Button>
                      
                      {currentCall?.type === 'video' && (
                        <Button 
                            variant={currentCall?.type === 'video' && callState === 'connected' ? "secondary" : "outline"}
                            size="icon" 
                            className={`h-14 w-14 rounded-full ${!videoEnabled ? 'bg-red-500 text-white border-red-600 hover:bg-red-600' : ''}`}
                            onClick={toggleVideo}
                        >
                            {videoEnabled ? <Camera size={24} /> : <CameraOff size={24} />}
                        </Button>
                      )}
                  </div>
              </div>

              {/* Metrics in bottom right */}
              {metrics && callState === 'connected' && (
                <div className="absolute bottom-4 right-4 text-[10px] font-mono opacity-80 bg-black/60 text-white p-2 rounded-lg backdrop-blur-sm space-y-1 text-right min-w-[120px]">
                  <div>RTT: {metrics.rtt ? Math.round(metrics.rtt) : '—'}ms</div>
                  <div>A-Jit: {metrics.audio?.jitter ? Math.round(metrics.audio.jitter) : '—'}ms</div>
                  <div>A-Loss: {metrics.audio?.inboundLoss?.toFixed(1) ?? '0.0'}%</div>
                  <div>V-Jit: {metrics.video?.jitter ? Math.round(metrics.video.jitter) : '—'}ms</div>
                  <div>V-Loss: {metrics.video?.inboundLoss?.toFixed(1) ?? '0.0'}%</div>
                  <div className={`font-bold ${metrics.quality === 'good' ? 'text-green-400' : metrics.quality === 'medium' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {metrics.quality.toUpperCase()}
                  </div>
                </div>
              )}
          </div>
      )}
    </div>
  );
};

export default CallsPanel;
