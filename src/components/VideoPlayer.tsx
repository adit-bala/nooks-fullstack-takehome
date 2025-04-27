import { Box, Button, Typography } from "@mui/material";
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

  // Apply state updates when initialState changes (from server updates)
  useEffect(() => {
    if (!initialState || !player.current || !isReady || !hasJoined) {
      return;
    }

    console.log("Applying remote state update:", initialState);

    // Don't trigger local change handlers when applying remote state
    isLocalChange.current = true;

    try {
      // Calculate time adjustment based on network delay if video is playing
      const networkDelayAdjustment = initialState.playing ? 0.2 : 0; // 200ms adjustment if playing

      // Get current time and calculate the adjusted target position
      const currentTime = player.current.getCurrentTime();
      const targetPosition = initialState.playing
        ? initialState.pos + networkDelayAdjustment
        : initialState.pos;

      // Check if we need to seek
      const needsSeek = Math.abs(currentTime - targetPosition) > seekThreshold;

      if (needsSeek) {
        console.log(`Seeking from ${currentTime} to ${targetPosition} (original: ${initialState.pos})`);

        // First seek to the position
        player.current.seekTo(targetPosition, 'seconds');
        setPosition(targetPosition);

        // Then set the playing state after a small delay to ensure the seek completes
        setTimeout(() => {
          if (player.current && playing !== initialState.playing) {
            console.log(`Setting playing state from ${playing} to ${initialState.playing}`);
            setPlaying(initialState.playing);

            // Force the player to play/pause directly
            if (initialState.playing) {
              player.current.getInternalPlayer()?.playVideo?.();
              console.log("Forced play via internal player");
            } else {
              player.current.getInternalPlayer()?.pauseVideo?.();
              console.log("Forced pause via internal player");
            }

            // Double-check position after setting playing state
            if (initialState.playing) {
              setTimeout(() => {
                if (player.current) {
                  const newCurrentTime = player.current.getCurrentTime();
                  // If we've drifted too far from where we should be, correct it
                  if (Math.abs(newCurrentTime - targetPosition) > 1.0) {
                    console.warn(`Position drift detected after play: ${newCurrentTime} vs ${targetPosition}, correcting...`);
                    player.current.seekTo(targetPosition, 'seconds');
                  }
                }
              }, 100);
            }
          }
        }, 100);
      } else {
        // If no seek is needed, just update the playing state directly
        if (playing !== initialState.playing) {
          console.log(`Setting playing state from ${playing} to ${initialState.playing}`);
          setPlaying(initialState.playing);

          // Force the player to play/pause directly
          if (initialState.playing) {
            player.current.getInternalPlayer()?.playVideo?.();
            console.log("Forced play via internal player (no seek)");
          } else {
            player.current.getInternalPlayer()?.pauseVideo?.();
            console.log("Forced pause via internal player (no seek)");
          }
        }
      }
    } catch (error) {
      console.error("Error applying state update:", error);
    } finally {
      // Reset the local change flag after a delay
      setTimeout(() => {
        isLocalChange.current = false;
      }, 300);
    }
  // Only depend on initialState to avoid unnecessary re-renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialState]);

  // We don't need the position effect anymore as we're only sending updates
  // on explicit play, pause, or seek events

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

    // We don't need to send an update to the server when the video ends
    // as this is a local event and doesn't need to be synchronized
  };

  // This doesn't work with YouTube, but we'll keep it for other players
  const handleSeek = (seconds: number) => {
    console.log("Seek event (rarely works):", seconds);

    // Only send updates for user-initiated seeks
    if (!isLocalChange.current && onStateChange) {
      console.log("User initiated seek to:", seconds);

      // Mark this as a local change
      isLocalChange.current = true;

      // Update local state
      setPosition(seconds);

      // Send update to server
      onStateChange(seconds, playing);

      // Reset the local change flag after a short delay
      setTimeout(() => {
        isLocalChange.current = false;
      }, 100);
    }
  };

  // Add a custom seek handler for manual seeking
  const handleManualSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!player.current || isLocalChange.current) return;

    // This is a simplified example - in a real app, you'd calculate the seek position
    // based on the click position relative to the progress bar
    const playerElement = e.currentTarget;
    const rect = playerElement.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const duration = player.current.getDuration();
    const seekTime = duration * relativeX;

    console.log("Manual seek to:", seekTime);

    // Mark this as a local change
    isLocalChange.current = true;

    // Update local state
    setPosition(seekTime);
    player.current.seekTo(seekTime, 'seconds');

    // Send update to server
    if (onStateChange) {
      onStateChange(seekTime, playing);
    }

    // Reset the local change flag after a short delay
    setTimeout(() => {
      isLocalChange.current = false;
    }, 100);
  };

  const handlePlay = () => {
    const currentTime = player.current?.getCurrentTime() || 0;
    console.log("User played video at time:", currentTime);

    // Only process if this is a real user action (not triggered by our state updates)
    if (!isLocalChange.current) {
      // Mark this as a local change to prevent feedback loops
      isLocalChange.current = true;

      // Update local state
      setPlaying(true);
      setPosition(currentTime);

      console.log("Sending play update to server at position:", currentTime);

      // Notify parent component to send update to server
      if (onStateChange) {
        onStateChange(currentTime, true);
      }

      // Reset the local change flag after a short delay
      setTimeout(() => {
        isLocalChange.current = false;
      }, 100);
    }
  };

  const handlePause = () => {
    const currentTime = player.current?.getCurrentTime() || 0;
    console.log("User paused video at time:", currentTime);

    // Only process if this is a real user action (not triggered by our state updates)
    if (!isLocalChange.current) {
      // Mark this as a local change to prevent feedback loops
      isLocalChange.current = true;

      // Update local state
      setPlaying(false);
      setPosition(currentTime);

      console.log("Sending pause update to server at position:", currentTime);

      // Notify parent component to send update to server
      if (onStateChange) {
        onStateChange(currentTime, false);
      }

      // Reset the local change flag after a short delay
      setTimeout(() => {
        isLocalChange.current = false;
      }, 100);
    }
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
    // We'll only use progress to track the current time, not to send updates
    // This prevents sending too many updates to the server

    // Update the last progress time for reference
    lastProgressTime.current = state.playedSeconds;

    // We're intentionally not sending any updates here to reduce server load
    // Updates will only be sent on explicit play, pause, or seek events
  };

  const handleJoinSession = () => {
    console.log("Joining session with initial state:", initialState);

    if (!initialState) {
      console.warn("No initial state available when joining session");
      setHasJoined(true);
      return;
    }

    // Store the current playing state for reference
    const shouldPlay = initialState.playing;
    console.log(`Should the video play? ${shouldPlay}`);

    // Mark this as a local change to prevent sending updates
    isLocalChange.current = true;

    // Set joined state
    setHasJoined(true);

    // Apply the initial state with a slight delay to ensure the player is ready
    setTimeout(() => {
      if (!player.current) {
        console.warn("Player not ready when trying to apply initial state");
        return;
      }

      try {
        // Calculate time adjustment based on network delay
        // For simplicity, we'll use a small fixed adjustment
        const networkDelayAdjustment = shouldPlay ? 0.2 : 0; // 200ms adjustment if playing

        // Apply position with adjustment if video is playing
        const adjustedPosition = shouldPlay
          ? initialState.pos + networkDelayAdjustment
          : initialState.pos;

        console.log(`Applying initial position: ${adjustedPosition} (original: ${initialState.pos})`);
        console.log(`Initial playing state: ${shouldPlay}`);

        // First, make sure we're paused during the seek
        setPlaying(false);

        // Set position
        setPosition(adjustedPosition);

        // Seek to the position
        player.current.seekTo(adjustedPosition, 'seconds');
        console.log(`Seeked to ${adjustedPosition} seconds`);

        // Set playing state AFTER seeking with a slight delay
        // This is important because setting playing=true before seeking completes can cause issues
        setTimeout(() => {
          if (player.current) {
            // IMPORTANT: Set the playing state based on the initial state
            console.log(`Setting playing state to ${shouldPlay}`);
            setPlaying(shouldPlay);

            // Force the player to play/pause directly
            if (shouldPlay) {
              player.current.getInternalPlayer()?.playVideo?.();
              console.log("Forced play via internal player");
            }

            // Double-check that the position is correct
            const currentTime = player.current.getCurrentTime();
            if (Math.abs(currentTime - adjustedPosition) > 1.0) {
              console.warn(`Position drift detected: ${currentTime} vs ${adjustedPosition}, correcting...`);
              player.current.seekTo(adjustedPosition, 'seconds');
            }
          }
        }, 100);
      } catch (error) {
        console.error("Error applying initial state:", error);
      }
    }, 50);

    // Reset the local change flag after a delay
    setTimeout(() => {
      isLocalChange.current = false;
    }, 500);
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
        position="relative"
      >
        {/* Add a transparent overlay to capture seek events */}
        <Box
          position="absolute"
          bottom="0"
          left="0"
          width="100%"
          height="20px"
          onClick={handleManualSeek}
          sx={{
            cursor: 'pointer',
            zIndex: 10,
            opacity: 0.5,
            backgroundColor: 'rgba(0,0,0,0.2)',
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.4)',
            }
          }}
        />
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
          className="react-player"
          style={{ pointerEvents: hideControls ? "none" : "auto" }}
        />
      </Box>
      {!hasJoined && isReady && (
        // Youtube doesn't allow autoplay unless you've interacted with the page already
        // So we make the user click "Join Session" button and then start playing the video immediately after
        // This is necessary so that when people join a session, they can seek to the same timestamp and start watching the video with everyone else
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap={2}
        >
          <Typography variant="h5" component="div">
            {initialState?.playing
              ? "Session is currently playing"
              : "Session is currently paused"}
          </Typography>
          <Button
            variant="contained"
            size="large"
            color="primary"
            onClick={handleJoinSession}
            sx={{
              padding: '12px 24px',
              fontSize: '1.2rem',
              fontWeight: 'bold',
              boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
              '&:hover': {
                boxShadow: '0 6px 12px rgba(0,0,0,0.3)',
              }
            }}
          >
            Join Watch Party
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default VideoPlayer;
