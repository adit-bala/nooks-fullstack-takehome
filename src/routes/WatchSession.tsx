import { useEffect, useState } from "react";
import VideoPlayer from "../components/VideoPlayer";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, TextField, Tooltip, CircularProgress } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { wsClient, PlayheadState } from "../utils/websocket";

const WatchSession: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [url, setUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playheadState, setPlayheadState] = useState<PlayheadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      navigate('/create');
      return;
    }

    const connectToSession = async () => {
      try {
        setLoading(true);
        console.log(`Joining session: ${sessionId}`);

        // Join the session
        await wsClient.joinSession(sessionId);

        // Listen for session snapshot (initial state)
        const handleSnapshot = (message: any) => {
          if (message.sessionId === sessionId) {
            console.log("Received initial session snapshot:", message);

            // Store the server timestamp when we received this message
            const receivedTime = Date.now();

            // Get the current time to calculate time elapsed since the state was created

            // Create a copy of the state to avoid modifying the original
            const adjustedState = { ...message.state };

            // Only adjust the position if the video is playing
            if (adjustedState.playing) {
              // If video is playing, adjust the position based on the time elapsed since the state was created
              // Formula: adjusted_pos = original_pos + (current_time - state_timestamp) / 1000
              const timeElapsedMs = receivedTime - adjustedState.ts.p;
              const adjustmentSeconds = timeElapsedMs / 1000;

              console.log(`Adjusting position by ${adjustmentSeconds}s due to network delay`);
              adjustedState.pos += adjustmentSeconds;
            }

            console.log(`Initial state: position=${adjustedState.pos}, playing=${adjustedState.playing}`);

            setUrl(message.url);
            setPlayheadState(adjustedState);
            setLoading(false);
          }
        };

        // Listen for state broadcasts (updates)
        const handleBroadcast = (message: any) => {
          if (message.sessionId === sessionId) {
            console.log("Received state broadcast:", message);

            // Store the server timestamp when we received this message
            const receivedTime = Date.now();

            // Create a copy of the state to avoid modifying the original
            const adjustedState = { ...message.state };

            // Check if this is a seek event (position changed significantly)
            const isSeekEvent = playheadState &&
              Math.abs(adjustedState.pos - playheadState.pos) > 1.0;

            if (isSeekEvent) {
              console.log(`Detected seek event: ${playheadState?.pos} -> ${adjustedState.pos}`);
            }

            // Only adjust the position for playing videos that aren't seek events
            if (adjustedState.playing && !isSeekEvent) {
              // If video is playing, adjust the position based on the time elapsed since the state was created
              // Formula: adjusted_pos = original_pos + (current_time - state_timestamp) / 1000
              const timeElapsedMs = receivedTime - adjustedState.ts.p;
              const adjustmentSeconds = timeElapsedMs / 1000;

              console.log(`Adjusting position by ${adjustmentSeconds}s due to network delay`);
              adjustedState.pos += adjustmentSeconds;
            }

            // Update playhead state with adjusted position
            setPlayheadState(adjustedState);

            // Update URL if it changed
            if (message.state.url && message.state.url !== url) {
              console.log(`Updating URL from ${url} to ${message.state.url}`);
              setUrl(message.state.url);
            }
          }
        };

        // Register handlers
        wsClient.on('SESSION_SNAPSHOT', handleSnapshot);
        wsClient.on('STATE_BROADCAST', handleBroadcast);

      } catch (error) {
        console.error("Failed to join session:", error);
        setError("Failed to join session. Please try again.");
        setLoading(false);
      }
    };

    connectToSession();

    // Cleanup function
    return () => {
      // We could disconnect here, but we'll keep the connection open
      // in case the user navigates back to this page
      console.log("WatchSession component unmounting");
    };
  }, [sessionId, navigate, url]);

  // Function to update the playhead state
  // This is only called for explicit play, pause, or seek events
  const updatePlayheadState = (pos: number, playing: boolean) => {
    if (sessionId && url) {
      console.log(`Sending state update to server: pos=${pos}, playing=${playing}`);

      // Debounce updates to avoid sending too many
      if (updatePlayheadState.timeoutId) {
        clearTimeout(updatePlayheadState.timeoutId);
      }

      // Send the update after a short delay to avoid multiple rapid updates
      updatePlayheadState.timeoutId = setTimeout(() => {
        wsClient.updateState(sessionId, pos, playing, url)
          .then(() => {
            console.log("State update sent successfully");
          })
          .catch((error) => {
            console.error("Failed to send state update:", error);
          });
      }, 100);
    } else {
      console.warn("Cannot update state: missing sessionId or url");
    }
  };

  // Add a timeout property to the function for debouncing
  updatePlayheadState.timeoutId = null as any;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%" flexDirection="column" gap={2}>
        <div>{error}</div>
        <Button variant="contained" onClick={() => navigate('/create')}>
          Create New Session
        </Button>
      </Box>
    );
  }

  if (!!url && playheadState) {
    return (
      <>
        <Box
          width="100%"
          maxWidth={1000}
          display="flex"
          gap={1}
          marginTop={1}
          alignItems="center"
        >
          <TextField
            label="Youtube URL"
            variant="outlined"
            value={url}
            inputProps={{
              readOnly: true,
              disabled: true,
            }}
            fullWidth
          />
          <Tooltip title={linkCopied ? "Link copied" : "Copy link to share"}>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              disabled={linkCopied}
              variant="contained"
              sx={{ whiteSpace: "nowrap", minWidth: "max-content" }}
            >
              <LinkIcon />
            </Button>
          </Tooltip>
          <Tooltip title="Create new watch party">
            <Button
              onClick={() => {
                navigate("/create");
              }}
              variant="contained"
              sx={{ whiteSpace: "nowrap", minWidth: "max-content" }}
            >
              <AddCircleOutlineIcon />
            </Button>
          </Tooltip>
        </Box>
        <VideoPlayer
          url={url}
          initialState={playheadState}
          onStateChange={updatePlayheadState}
        />
      </>
    );
  }

  return null;
};

export default WatchSession;
