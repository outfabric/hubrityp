'use client';

import dynamic from 'next/dynamic';

import type { VideoCallClientProps } from './video-call-client';

// ssr: false is legal here because this file is a Client Component.
// Keeps the Stream SDK bundle out of SSR and out of other pages' initial chunk.
const VideoCallClient = dynamic(() => import('./video-call-client'), {
  ssr: false,
});

export type { VideoCallClientProps };

export function VideoCallLoader(props: VideoCallClientProps) {
  return <VideoCallClient {...props} />;
}
