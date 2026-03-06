import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video, MicOff, Volume2, Lock, Wifi, Camera, CameraOff, Mic } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { useNodeAgentPresencePeers } from '@/hooks/useNodeAgent';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { nodeAgentApi, type Call, type MediaEvent } from '@/api/nodeAgent';

type CallState = 'idle' | 'incoming' | 'outgoing' | 'connected';

const CallsPanel = () => {
  const { data: peersData } = useNodeAgentPresencePeers();
  const { events, getEventsByType } = useSession();
  const [callState, setCallState] = useState<CallState>('idle');
  const [targetPeerId, setTargetPeerId] = useState<string>("");
  const [currentCall, setCurrentCall] = useState<Call | null>(null);
  const [callTimer, setCallTimer] = useState('00:00');
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [metrics, setMetrics] = useState<{
    rtt?: number;
    audio?: { jitter?: number; inboundLoss?: number; bitrateKbps?: number };
    video?: { jitter?: number; inboundLoss?: number; bitrateKbps?: number };
    quality?: 'good' | 'medium' | 'poor';
  } | null>(null);
  
  // Track processed events to avoid duplicates
  const processedEvents = useRef<Set<string>>(new Set());

  // WebRTC Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);

  // Initialize WebRTC
  const initPeerConnection = () => {
    console.log('Initializing peer connection');
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      console.log('ICE candidate generated:', event.candidate);
      if (event.candidate && currentCall) {
        console.log('Sending ICE candidate for call:', currentCall.id);
        nodeAgentApi.sendCandidate(currentCall.id, event.candidate).catch(e => {
          console.error('Failed to send ICE candidate:', e);
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind, event.streams.length);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(e => {
          console.error('Failed to play remote video:', e);
        });
      }
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
  };

  // Debug function to check video state
  const debugVideoState = () => {
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
  };

  // Add debug button in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as any).debugVideo = debugVideoState;
      console.log('Debug function available: window.debugVideo()');
    }
  }, [videoEnabled, callState]);

  const getLocalStream = async (video: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video });
      localStream.current = stream;
      
      // Always show local preview if video is requested, regardless of call state
      if (video && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          // Force play and handle any autoplay restrictions
          try {
            await localVideoRef.current.play();
          } catch (playError) {
            console.warn('Autoplay prevented, user interaction required:', playError);
          }
      }
      
      return stream;
    } catch (err) {
      console.error('Failed to get local stream', err);
      toast.error('Media access denied');
      return null;
    }
  };

  // Handle WebSocket events instead of polling
  useEffect(() => {
    // Get only the latest events to avoid processing duplicates
    const latestEvents = events.slice(-10); // Last 10 events
    
    for (const event of latestEvents) {
      // Create unique event ID
      const eventId = `${event.type}-${event.timestamp}-${JSON.stringify(event).substring(0, 50)}`;
      
      // Skip if already processed
      if (processedEvents.current.has(eventId)) {
        continue;
      }
      
      if (event.type === 'incoming_call' || 
          event.type === 'call_accepted' || 
          event.type === 'ice_candidate' || 
          event.type === 'hangup') {
        console.log('Processing new media event:', event.type, eventId);
        processedEvents.current.add(eventId);
        handleEvent(event as unknown as MediaEvent);
        
        // Clean up old processed events (keep last 50)
        if (processedEvents.current.size > 50) {
          const arr = Array.from(processedEvents.current);
          processedEvents.current = new Set(arr.slice(-50));
        }
      }
    }
  }, [events]); // Only depend on events

  const handleEvent = async (event: MediaEvent) => {
    console.log('Handling event:', event.type, event);
    const pc = peerConnection.current;

    switch (event.type) {
        case 'incoming_call':
            if (callState === 'idle') {
                console.log('Setting incoming call:', event.call);
                setCurrentCall(event.call);
                setCallState('incoming');
                // Store SDP for later use
                (event.call as any).sdp = event.sdp;
            } else {
                console.log('Rejecting call - not idle, current state:', callState);
                // Busy - reject call
                if (event.call?.id) {
                    nodeAgentApi.hangupCall(event.call.id);
                }
            }
            break;
            
        case 'call_accepted':
            console.log('Call accepted:', event);
            if (currentCall && currentCall.id === event.call.id && pc) {
                try {
                    console.log('Setting remote description (answer)');
                    await pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: event.sdp
                    }));
                    console.log('Remote description set successfully');
                    setCallState('connected');
                    startTimer();
                } catch (e) {
                    console.error('Error setting remote description:', e);
                    toast.error("Failed to establish connection");
                }
            } else {
                console.log('Ignoring call_accepted - no matching call or PC');
            }
            break;

        case 'ice_candidate':
            console.log('ICE candidate received:', event);
            if (currentCall && currentCall.id === event.call_id && pc) {
                try {
                    // Only add ICE candidate if remote description is set
                    if (pc.remoteDescription) {
                        await pc.addIceCandidate(event.candidate);
                        console.log('ICE candidate added successfully');
                    } else {
                        console.warn("Remote description not set, skipping ICE candidate");
                    }
                } catch (e) {
                    console.error("Error adding ice candidate:", e);
                }
            } else {
                console.log('Ignoring ICE candidate - no matching call or PC');
            }
            break;

        case 'hangup':
            console.log('Hangup received for call:', event.call_id);
            if (currentCall && currentCall.id === event.call_id) {
                endCall();
                toast.info("Call ended by peer");
            } else {
                console.log('Ignoring hangup - no matching call');
            }
            break;
    }
  };

  const startCall = async (video: boolean) => {
    console.log('Starting call to:', targetPeerId, 'video:', video);
    if (!targetPeerId) return;
    
    setVideoEnabled(video);
    const stream = await getLocalStream(video);
    if (!stream) return;

    const pc = initPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('Created offer:', offer);

        const res = await nodeAgentApi.initiateCall(targetPeerId, offer.sdp!, video ? "video" : "audio");
        console.log('Call initiated:', res);
        if (res.ok) {
            setCurrentCall(res.call);
            setCallState('outgoing');
        }
    } catch (e) {
        console.error('Failed to start call:', e);
        toast.error("Failed to start call");
        endCall();
    }
  };

  const acceptCall = async (video: boolean) => {
    console.log('Accepting call:', currentCall?.id, 'video:', video);
    if (!currentCall) return;
    const sdp = (currentCall as any).sdp; // Retrieved from event
    
    setVideoEnabled(video);
    const stream = await getLocalStream(video);
    if (!stream) return;

    const pc = initPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    try {
        await pc.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: sdp
        }));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Created answer:', answer);

        await nodeAgentApi.answerCall(currentCall.id, answer.sdp!);
        console.log('Call answered');
        setCallState('connected');
        startTimer();
    } catch (e) {
        console.error('Failed to accept call:', e);
        toast.error("Failed to accept call");
        endCall();
    }
  };

  const endCall = () => {
    console.log('Ending call:', currentCall?.id);
    if (currentCall) {
        nodeAgentApi.hangupCall(currentCall.id).catch((e) => {
            console.error('Failed to hangup call:', e);
        });
    }
    
    if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
    }
    
    if (localStream.current) {
        localStream.current.getTracks().forEach(t => t.stop());
        localStream.current = null;
    }

    if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
    }
    
    setCurrentCall(null);
    setCallState('idle');
    setCallTimer('00:00');
    setVideoEnabled(false);
    setMicEnabled(true);
    setMetrics(null);
  };

  const startTimer = () => {
      let s = 0;
      if (timerInterval.current) clearInterval(timerInterval.current);
      timerInterval.current = setInterval(() => {
          s++;
          const m = String(Math.floor(s / 60)).padStart(2, '0');
          const sec = String(s % 60).padStart(2, '0');
          setCallTimer(`${m}:${sec}`);
      }, 1000);
  };
  
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
      {/* Remote Video / Audio Element */}
      {/* We use video element for both audio and video calls. For audio calls, it just plays audio. */}
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
        <div className="flex flex-col items-center justify-center h-full p-8 space-y-6 z-10">
            <div className="w-32 h-32 rounded-full bg-muted flex items-center justify-center mb-4">
                <Video size={48} className="text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold">Start a Call</h2>
            
            <div className="w-full max-w-xs space-y-4">
                 <Select value={targetPeerId} onValueChange={setTargetPeerId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select peer to call..." />
                    </SelectTrigger>
                    <SelectContent>
                        {peersData?.peers.map(p => (
                            <SelectItem key={p.payload.peer_id} value={p.payload.peer_id}>
                                {p.payload.display_name || p.payload.peer_id.substring(0, 8)}
                            </SelectItem>
                        ))}
                        {(!peersData?.peers || peersData.peers.length === 0) && (
                            <div className="p-2 text-sm text-muted-foreground text-center">No peers online</div>
                        )}
                    </SelectContent>
                 </Select>
                 
                 <div className="grid grid-cols-2 gap-3">
                    <Button className="h-12 text-md gap-2" onClick={() => startCall(false)} disabled={!targetPeerId}>
                        <Phone size={18} /> Audio
                    </Button>
                    <Button className="h-12 text-md gap-2" variant="outline" onClick={() => startCall(true)} disabled={!targetPeerId}>
                        <Video size={18} /> Video
                    </Button>
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
               <h2 className="text-3xl font-bold mb-2">Incoming {currentCall.type === 'video' ? 'Video' : 'Audio'} Call</h2>
               <p className="text-muted-foreground mb-8">from {currentCall.peer_id.substring(0, 8)}...</p>
               
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
          <div className={`flex flex-col items-center justify-center h-full space-y-8 z-10 ${currentCall?.type === 'video' && callState === 'connected' ? 'bg-black/40 text-white backdrop-blur-sm absolute inset-0' : ''}`}>
              
              {/* Show Avatar only if Audio Call or Video not yet connected */}
              {(currentCall?.type !== 'video' || callState !== 'connected') && (
                  <div className="relative">
                      <div className="w-40 h-40 rounded-full bg-muted flex items-center justify-center overflow-hidden border-4 border-background shadow-xl">
                          <GeometricAvatar index={1} size={160} />
                      </div>
                      {callState === 'connected' && (
                          <div className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
                      )}
                  </div>
              )}
              
              <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold">
                      {currentCall?.peer_id.substring(0, 8)}...
                  </h3>
                  <p className={`font-mono text-xl tracking-wider ${currentCall?.type === 'video' && callState === 'connected' ? 'text-white' : 'text-primary'}`}>
                      {callState === 'outgoing' ? 'Calling...' : callTimer}
                  </p>
                  <div className={`flex items-center justify-center gap-2 text-xs ${currentCall?.type === 'video' && callState === 'connected' ? 'text-white/70' : 'text-muted-foreground'}`}>
                      <Lock size={12} /> End-to-end encrypted
                  </div>
                  {metrics && callState === 'connected' && (
                    <div className="mt-2 text-xs font-mono opacity-80">
                      <span className="px-2 py-0.5 rounded bg-secondary/40 mr-1">RTT: {metrics.rtt ? Math.round(metrics.rtt) : '—'}ms</span>
                      <span className="px-2 py-0.5 rounded bg-secondary/40 mr-1">A-Jit: {metrics.audio?.jitter ? Math.round(metrics.audio.jitter) : '—'}ms</span>
                      <span className="px-2 py-0.5 rounded bg-secondary/40 mr-1">A-Loss: {metrics.audio?.inboundLoss?.toFixed(1) ?? '0.0'}%</span>
                      <span className="px-2 py-0.5 rounded bg-secondary/40 mr-1">V-Jit: {metrics.video?.jitter ? Math.round(metrics.video.jitter) : '—'}ms</span>
                      <span className="px-2 py-0.5 rounded bg-secondary/40 mr-1">V-Loss: {metrics.video?.inboundLoss?.toFixed(1) ?? '0.0'}%</span>
                      <span className={`px-2 py-0.5 rounded ${metrics.quality === 'good' ? 'bg-green-500/20 text-green-500' : metrics.quality === 'medium' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-500'}`}>Quality: {metrics.quality}</span>
                    </div>
                  )}
              </div>

              <div className="flex items-center gap-6 mt-8">
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
      )}
    </div>
  );
};

export default CallsPanel;
