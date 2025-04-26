import { Box, Button } from "@mui/material";
import React, { useRef, useState, useEffect } from "react";
import ReactPlayer from "react-player";
import { PlayheadState } from "../utils/websocket";

interface VideoPlayerProps {
  url: string;
  hideControls?: boolean;
  initialState?: PlayheadState;
  onStateChange?: (pos: number, playing: boolean) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  url,
  hideControls,
  initialState,
  onStateChange
}) => {
  const [hasJoined, setHasJoined] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const player = useRef<ReactPlayer>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  // Track if the change is local or remote
  const isLocalChange = useRef(false);
  // Track the last progress update time to detect seeks
  const lastProgressTime = useRef(0);
  // Threshold for detecting seeks (in seconds)
  const seekThreshold = 1.5;

  // Apply initial state when component mounts or when initialState changes
  useEffect(() => {
    if (initialState && player.current && isReady && hasJoined) {
      // Don't trigger local change handlers when applying remote state
      isLocalChange.current = false;

      // Set position
      if (Math.abs(player.current.getCurrentTime() - initialState.pos) > seekThreshold) {
        player.current.seekTo(initialState.pos, 'seconds');
        setPosition(initialState.pos);
      }

      // Set playing state
      setPlaying(initialState.playing);
    }
  }, [initialState, isReady, hasJoined]);

  // Update playing state when it changes
  useEffect(() => {
    if (isReady && hasJoined) {
      // Only update if we're not in the middle of a local change
      if (!isLocalChange.current && player.current) {
        player.current.seekTo(position, 'seconds');
      }
    }
  }, [position, isReady, hasJoined]);

  const handleReady = () => {
    setIsReady(true);

    // If we have an initial state, apply it
    if (initialState) {
      setPosition(initialState.pos);
      setPlaying(initialState.playing);
    }
  };

  const handleEnd = () => {
    console.log("Video ended");
    setPlaying(false);

    if (onStateChange) {
      onStateChange(player.current?.getCurrentTime() || 0, false);
    }
  };

  // This doesn't work with YouTube, but we'll keep it for other players
  const handleSeek = (seconds: number) => {
    console.log("Seek event (rarely works):", seconds);

    if (isLocalChange.current && onStateChange) {
      setPosition(seconds);
      onStateChange(seconds, playing);
    }
  };

  const handlePlay = () => {
    const currentTime = player.current?.getCurrentTime() || 0;
    console.log("User played video at time:", currentTime);

    // Mark this as a local change
    isLocalChange.current = true;
    setPlaying(true);
    setPosition(currentTime);

    // Notify parent component
    if (onStateChange) {
      onStateChange(currentTime, true);
    }

    // Reset the local change flag after a short delay
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const handlePause = () => {
    const currentTime = player.current?.getCurrentTime() || 0;
    console.log("User paused video at time:", currentTime);

    // Mark this as a local change
    isLocalChange.current = true;
    setPlaying(false);
    setPosition(currentTime);

    // Notify parent component
    if (onStateChange) {
      onStateChange(currentTime, false);
    }

    // Reset the local change flag after a short delay
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const handleBuffer = () => {
    console.log("Video buffered");
  };

  const handleProgress = (state: {
    played: number;
    playedSeconds: number;
    loaded: number;
    loadedSeconds: number;
  }) => {
    // Detect seeks by checking if the time difference is greater than our threshold
    const currentTime = state.playedSeconds;
    const timeDiff = Math.abs(currentTime - lastProgressTime.current);

    if (timeDiff > seekThreshold && !isLocalChange.current && player.current) {
      console.log("Detected seek via progress:", currentTime, "diff:", timeDiff);

      // Mark this as a local change
      isLocalChange.current = true;
      setPosition(currentTime);

      // Notify parent component
      if (onStateChange) {
        onStateChange(currentTime, playing);
      }

      // Reset the local change flag after a short delay
      setTimeout(() => {
        isLocalChange.current = false;
      }, 100);
    }

    // Update the last progress time
    lastProgressTime.current = currentTime;
  };

  const handleJoinSession = () => {
    setHasJoined(true);

    // If we have an initial state, apply it immediately after joining
    if (initialState) {
      setPosition(initialState.pos);
      setPlaying(initialState.playing);
    }
  };

  return (
    <Box
      width="100%"
      height="100%"
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <Box
        width="100%"
        height="100%"
        display={hasJoined ? "flex" : "none"}
        flexDirection="column"
      >
        <ReactPlayer
          ref={player}
          url={url}
          playing={playing}
          controls={!hideControls}
          onReady={handleReady}
          onEnded={handleEnd}
          onSeek={handleSeek}
          onPlay={handlePlay}
          onPause={handlePause}
          onBuffer={handleBuffer}
          onProgress={handleProgress}
          width="100%"
          height="100%"
          style={{ pointerEvents: hideControls ? "none" : "auto" }}
        />
      </Box>
      {!hasJoined && isReady && (
        // Youtube doesn't allow autoplay unless you've interacted with the page already
        // So we make the user click "Join Session" button and then start playing the video immediately after
        // This is necessary so that when people join a session, they can seek to the same timestamp and start watching the video with everyone else
        <Button
          variant="contained"
          size="large"
          onClick={handleJoinSession}
        >
          Watch Session
        </Button>
      )}
    </Box>
  );
};

export default VideoPlayer;
