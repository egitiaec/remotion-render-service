import React from 'react';
import { Composition } from 'remotion';
import { CampaignVideo } from './CampaignVideo.jsx';

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920; // vertical, pensado para Reels/Stories

export const RemotionRoot = () => {
  return (
    <Composition
      id="CampaignVideo"
      component={CampaignVideo}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      // Placeholder: se recalcula siempre vía calculateMetadata en cada render
      durationInFrames={DEFAULT_FPS * 15}
      defaultProps={{
        imageUrl: '',
        audioUrl: undefined,
        logoUrl: undefined,
        captionText: undefined,
        fadeOutSeconds: 1,
      }}
      calculateMetadata={async ({ props }) => {
        const durationInSeconds = props.durationInSeconds ?? 15;
        const width = props.width ?? DEFAULT_WIDTH;
        const height = props.height ?? DEFAULT_HEIGHT;
        const fps = props.fps ?? DEFAULT_FPS;
        return {
          durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)),
          fps,
          width,
          height,
        };
      }}
    />
  );
};
