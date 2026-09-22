import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/**
 * Composición principal: toma una imagen de campaña + un audio (jingle o
 * pista de fondo) y arma un video corto con:
 *  - Efecto Ken Burns (zoom lento) sobre la imagen
 *  - Audio sincronizado con fade-out al final
 *  - Caption opcional (texto de marca) con fade-in
 *  - Logo opcional en la esquina superior
 *
 * Todas las propiedades llegan desde el request HTTP que arma n8n.
 */
export const CampaignVideo = ({
  imageUrl,
  audioUrl,
  logoUrl,
  captionText,
  fadeOutSeconds = 1,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();

  // Zoom lento de 1.0x a 1.12x a lo largo de todo el clip (Ken Burns)
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade-in del caption durante los primeros 15 frames (~0.5s a 30fps)
  const textOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const fadeOutFrames = Math.max(1, Math.round(fadeOutSeconds * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <AbsoluteFill
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
      >
        <Img src={imageUrl} style={{ width, height, objectFit: 'cover' }} />
      </AbsoluteFill>

      {logoUrl ? (
        <Img
          src={logoUrl}
          style={{
            position: 'absolute',
            top: height * 0.04,
            right: width * 0.04,
            width: width * 0.18,
            height: 'auto',
          }}
        />
      ) : null}

      {captionText ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: height * 0.08,
          }}
        >
          <div
            style={{
              opacity: textOpacity,
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontWeight: 700,
              fontSize: width * 0.06,
              color: 'white',
              textAlign: 'center',
              textShadow: '0 4px 12px rgba(0,0,0,0.6)',
              padding: '0 6%',
            }}
          >
            {captionText}
          </div>
        </AbsoluteFill>
      ) : null}

      {audioUrl ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <Audio
            src={audioUrl}
            volume={(f) =>
              interpolate(
                f,
                [durationInFrames - fadeOutFrames, durationInFrames],
                [1, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              )
            }
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
