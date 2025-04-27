import { Box, Button, Typography } from '@mui/material';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import ReactPlayer from 'react-player';
import { PlayheadState } from '../utils/websocket';

interface Props {
  url: string;
  hideControls?: boolean;
  initialState?: PlayheadState;
  onStateChange?: (pos: number, playing: boolean) => void;
}

const SEEK_EPS   = 1.5;
const DRIFT_FIX  = 0.2;     // rough network-delay fudge
const FLAG_DELAY = 100;     // ms for feedback-loop guard

const VideoPlayer: React.FC<Props> = ({
  url,
  hideControls,
  initialState,
  onStateChange,
}) => {
  const player               = useRef<ReactPlayer>(null);
  const localChange          = useRef(false);
  const [joined, setJoined]  = useState(false);
  const [ready,  setReady]   = useState(false);
  const [playing, setPlay]   = useState(initialState?.playing ?? false);
  const [pos,     setPos]    = useState(initialState?.pos ?? 0);

  /* ─── helpers ─────────────────────────────────────────────────────────── */

  const guard = (fn: () => void) => {
    if (localChange.current) return;
    localChange.current = true;
    fn();
    setTimeout(() => (localChange.current = false), FLAG_DELAY);
  };

  const pushState = useCallback(
    (p: number, pl: boolean) => {
      setPos(p); setPlay(pl);
      onStateChange?.(p, pl);
    },
    [onStateChange]
  );

  /* ─── remote updates ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!initialState || !ready || !joined || !player.current) return;

    const target = initialState.playing
      ? initialState.pos + DRIFT_FIX
      : initialState.pos;

    const cur = player.current.getCurrentTime();
    const needSeek = Math.abs(cur - target) > SEEK_EPS;

    localChange.current = true;

    if (needSeek) player.current.seekTo(target, 'seconds');
    setPos(target);
    setPlay(initialState.playing);

    if (initialState.playing) player.current.getInternalPlayer()?.playVideo?.();

    setTimeout(() => (localChange.current = false), FLAG_DELAY);
  }, [initialState, ready, joined]);

  /* ─── events from player ──────────────────────────────────────────────── */
  const handleReady = () => {
    setReady(true);
    if (initialState) {
      player.current?.seekTo(initialState.pos, 'seconds');
      setPlay(initialState.playing);
    }
  };

  const onPlay  = () => guard(() => pushState(player.current!.getCurrentTime(), true));
  const onPause = () => guard(() => pushState(player.current!.getCurrentTime(), false));

  const onManualSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (localChange.current || !player.current) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const t = player.current.getDuration() * ((e.clientX - left) / width);
    guard(() => {
      player.current!.seekTo(t, 'seconds');
      pushState(t, playing);
    });
  };

  /* ─── join overlay ────────────────────────────────────────────────────── */
  const join = () => {
    setJoined(true);
    if (!ready || !initialState) return;
    localChange.current = true;
    player.current?.seekTo(initialState.pos, 'seconds');
    setPlay(initialState.playing);
    setTimeout(() => (localChange.current = false), FLAG_DELAY);
  };

  /* ─── render ──────────────────────────────────────────────────────────── */
  return (
    <Box width="100%" height="100%" display="flex" flexDirection="column" alignItems="center" justifyContent="center">
      <Box flex={1} width="100%" display={joined ? 'flex' : 'none'} position="relative">
        <Box position="absolute" bottom={0} left={0} width="100%" height={20} onClick={onManualSeek} sx={{ cursor:'pointer', opacity:0 }} />
        <ReactPlayer
          ref={player}
          url={url}
          playing={playing}
          controls={!hideControls}
          onReady={handleReady}
          onPlay={onPlay}
          onPause={onPause}
          width="100%"
          height="100%"
          style={{ pointerEvents: hideControls ? 'none' : 'auto' }}
        />
      </Box>

      {!joined && ready && (
        <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
          <Typography variant="h5">{initialState?.playing ? 'Session is playing' : 'Session is paused'}</Typography>
          <Button variant="contained" size="large" onClick={join}>
            Join Watch Party
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default VideoPlayer;