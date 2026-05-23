'use client';

import { AlertCircle, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeviceTestProps {
  /** Compact mode hides the camera preview (used in waiting room summary). */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
//
// Reusable camera preview + mic level indicator. Designed to be used by:
//   - Patient too-early view (inline device test)
//   - Patient waiting room (device summary indicators)
//   - Psychologist pre-call lobby (future refactor — Section 5 does NOT
//     refactor the existing lobby, just creates this standalone component)
//
// Requests permissions, shows camera feed, mic level meter, and toggle
// controls. Provides troubleshooting instructions if permissions are denied.
// ---------------------------------------------------------------------------

export function DeviceTest({ compact = false }: DeviceTestProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Request media devices on mount
  useEffect(() => {
    let cancelled = false;

    async function requestDevices() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setCameraOk(true);
        setMicOk(true);

        // Attach video preview
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        if (cancelled) return;

        // Try audio only
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) {
            audioStream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = audioStream;
          setCameraOk(false);
          setMicOk(true);
        } catch {
          if (cancelled) return;
          setCameraOk(false);
          setMicOk(false);
        }

        setPermissionError(
          'Nao foi possivel acessar camera ou microfone. Verifique as permissoes do navegador.',
        );
      }
    }

    void requestDevices();

    return () => {
      cancelled = true;
      // Stop all tracks on unmount
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Mic level indicator via Web Audio API
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !micOn) {
      const id = requestAnimationFrame(() => {
        setMicLevel(0);
      });
      return () => cancelAnimationFrame(id);
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    let animationFrameId: number;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateLevel() {
      analyser.getByteFrequencyData(dataArray);
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
  }, [micOn]);

  const toggleCamera = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setCameraOn((prev) => !prev);
  }, []);

  const toggleMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMicOn((prev) => !prev);
  }, []);

  // Compact mode: just show status indicators
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5" aria-label="Status da camera">
          {cameraOk ? (
            <Video className="text-success-500 h-4 w-4" aria-hidden="true" />
          ) : cameraOk === false ? (
            <VideoOff className="text-danger-500 h-4 w-4" aria-hidden="true" />
          ) : (
            <Video className="text-text-tertiary h-4 w-4" aria-hidden="true" />
          )}
          <span className="text-text-secondary text-xs">
            {cameraOk === null ? 'Verificando...' : cameraOk ? 'Camera OK' : 'Camera indisponivel'}
          </span>
        </div>

        <div className="flex items-center gap-1.5" aria-label="Status do microfone">
          {micOk ? (
            <Mic className="text-success-500 h-4 w-4" aria-hidden="true" />
          ) : micOk === false ? (
            <MicOff className="text-danger-500 h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="text-text-tertiary h-4 w-4" aria-hidden="true" />
          )}
          <span className="text-text-secondary text-xs">
            {micOk === null ? 'Verificando...' : micOk ? 'Microfone OK' : 'Microfone indisponivel'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Camera preview */}
      <div className="bg-surface-sunken relative aspect-video w-full overflow-hidden rounded-xl">
        {!cameraOn || cameraOk === false ? (
          <div className="flex h-full items-center justify-center">
            <VideoOff className="text-text-tertiary h-12 w-12" aria-hidden="true" />
            <span className="sr-only">Camera desligada</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            aria-label="Previa da camera"
          />
        )}
      </div>

      {/* Device controls */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant={micOn ? 'ghost' : 'outline'}
          size="icon"
          onClick={toggleMic}
          disabled={micOk === false}
          aria-label={micOn ? 'Desligar microfone' : 'Ligar microfone'}
        >
          {micOn ? (
            <Mic className="h-5 w-5" aria-hidden="true" />
          ) : (
            <MicOff className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>

        {/* Mic level indicator */}
        {micOn && micOk && (
          <div
            className="bg-surface-muted h-2 w-24 overflow-hidden rounded-full"
            role="meter"
            aria-label="Nivel do microfone"
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

        <Button
          variant={cameraOn ? 'ghost' : 'outline'}
          size="icon"
          onClick={toggleCamera}
          disabled={cameraOk === false}
          aria-label={cameraOn ? 'Desligar camera' : 'Ligar camera'}
        >
          {cameraOn ? (
            <Video className="h-5 w-5" aria-hidden="true" />
          ) : (
            <VideoOff className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Permission error */}
      {permissionError && (
        <div className="bg-danger-50 flex items-start gap-2 rounded-xl p-4" role="alert">
          <AlertCircle className="text-danger-700 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-danger-700 text-sm">{permissionError}</p>
            <p className="text-text-tertiary text-xs">
              Verifique as configuracoes do navegador e permita o acesso a camera e microfone para
              este site.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
