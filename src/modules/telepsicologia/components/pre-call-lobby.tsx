'use client';

import { useCall, useCallStateHooks } from '@stream-io/video-react-sdk';
import { AlertCircle, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { DeviceToggleButton } from './device-toggle-button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PreCallLobbyProps {
  patient: { id: string; fullName: string } | null;
}

// ---------------------------------------------------------------------------
// Component
//
// Lobby shown before the psychologist joins the call. Provides camera preview,
// mic level indicator, device toggles, and a "Entrar na sessao" button.
// ---------------------------------------------------------------------------

export function PreCallLobby({ patient }: PreCallLobbyProps) {
  const call = useCall();
  const { useCameraState, useMicrophoneState, useParticipantCount } = useCallStateHooks();

  const { camera, mediaStream: cameraStream, isMute: isCameraMuted } = useCameraState();
  const { microphone, isMute: isMicMuted, mediaStream: micStream } = useMicrophoneState();
  const participantCount = useParticipantCount();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Attach camera stream to video element
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && cameraStream) {
      videoEl.srcObject = cameraStream;
    }
    return () => {
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, [cameraStream]);

  // Enable camera and mic on mount to show preview
  useEffect(() => {
    async function enableDevices() {
      try {
        await camera.enable();
      } catch {
        setPermissionError(
          'Não foi possível acessar a câmera. Verifique as permissões do navegador.',
        );
      }

      try {
        await microphone.enable();
      } catch {
        setPermissionError(
          'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
        );
      }
    }

    void enableDevices();
    // Camera/microphone manager refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mic level indicator via Web Audio API.
  // When mic is muted or there is no stream, the level decays to 0 via the
  // cleanup path (no audio source = no rAF updates = level stays at 0 from
  // the initial useState default). We avoid calling setMicLevel(0) directly
  // in the effect body to satisfy React Compiler's "no sync setState in effect".
  useEffect(() => {
    if (!micStream || isMicMuted) {
      // Schedule the reset asynchronously to avoid sync setState in effect
      const id = requestAnimationFrame(() => {
        setMicLevel(0);
      });
      return () => {
        cancelAnimationFrame(id);
      };
    }

    let animationFrameId: number;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(micStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateLevel() {
      analyser.getByteFrequencyData(dataArray);
      // Compute average volume level (0-100)
      const sum = dataArray.reduce((acc, val) => acc + val, 0);
      const avg = sum / dataArray.length;
      setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
      animationFrameId = requestAnimationFrame(updateLevel);
    }

    animationFrameId = requestAnimationFrame(updateLevel);

    return () => {
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
      void audioContext.close();
    };
  }, [micStream, isMicMuted]);

  const handleJoin = useCallback(() => {
    if (!call) return;
    setIsJoining(true);
    void call.join().catch((err) => {
      console.error('[telepsicologia] call.join failed', err);
      setIsJoining(false);
      setPermissionError('Não foi possível entrar na sessão. Tente novamente.');
    });
  }, [call]);

  const toggleCamera = useCallback(() => {
    void camera
      .toggle()
      .then(() => {
        setPermissionError(null);
      })
      .catch(() => {
        setPermissionError(
          'Não foi possível acessar a câmera. Verifique as permissões do navegador.',
        );
      });
  }, [camera]);

  const toggleMic = useCallback(() => {
    void microphone
      .toggle()
      .then(() => {
        setPermissionError(null);
      })
      .catch(() => {
        setPermissionError(
          'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
        );
      });
  }, [microphone]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-lg rounded-xl">
        <CardHeader>
          <CardTitle>Preparar para sessão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Camera preview */}
          <div className="bg-surface-sunken relative aspect-video w-full overflow-hidden rounded-xl">
            {isCameraMuted ? (
              <div className="flex h-full items-center justify-center">
                <VideoOff className="text-text-tertiary h-12 w-12" aria-hidden="true" />
                <span className="sr-only">Câmera desligada</span>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
                aria-label="Prévia da câmera"
              />
            )}
          </div>

          {/* Device controls */}
          <div className="flex items-center justify-center gap-4">
            <DeviceToggleButton
              kind="mic"
              isOff={isMicMuted}
              onToggle={toggleMic}
              ariaLabel={isMicMuted ? 'Ligar microfone' : 'Desligar microfone'}
              data-testid="mic-toggle-button"
            />

            {/* Mic level indicator */}
            {!isMicMuted && (
              <div
                className="bg-surface-muted h-2 w-24 overflow-hidden rounded-full"
                role="meter"
                aria-label="Nível do microfone"
                aria-valuenow={micLevel}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="bg-success-500 duration-fast h-full rounded-full transition-all"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            )}

            <DeviceToggleButton
              kind="camera"
              isOff={isCameraMuted}
              onToggle={toggleCamera}
              ariaLabel={isCameraMuted ? 'Ligar câmera' : 'Desligar câmera'}
              data-testid="camera-toggle-button"
            />
          </div>

          {/* Patient waiting indicator */}
          {participantCount > 0 && (
            <div className="flex justify-center">
              <Badge variant="info">{patient?.fullName ?? 'Paciente'} está aguardando</Badge>
            </div>
          )}

          {/* Permission error */}
          {permissionError && (
            <div className="bg-danger-50 flex items-start gap-2 rounded-xl p-4" role="alert">
              <AlertCircle className="text-danger-700 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-danger-700 text-sm">{permissionError}</p>
                <p className="text-text-tertiary text-xs">
                  Verifique as configurações do navegador e permita o acesso à câmera e microfone
                  para este site.
                </p>
              </div>
            </div>
          )}

          {/* Join button */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleJoin}
            disabled={isJoining}
            data-testid="join-call-button"
          >
            {isJoining ? 'Entrando...' : 'Entrar na sessão'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
