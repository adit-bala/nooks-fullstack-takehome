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

        // Join the session
        await wsClient.joinSession(sessionId);

        // Listen for session snapshot (initial state)
        wsClient.on('SESSION_SNAPSHOT', (message) => {
          if (message.sessionId === sessionId) {
            setUrl(message.url);
            setPlayheadState(message.state);
            setLoading(false);
          }
        });

        // Listen for state broadcasts (updates)
        wsClient.on('STATE_BROADCAST', (message) => {
          if (message.sessionId === sessionId) {
            setPlayheadState(message.state);
            if (message.state.url && message.state.url !== url) {
              setUrl(message.state.url);
            }
          }
        });

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
    };
  }, [sessionId, navigate, url]);

  // Function to update the playhead state
  const updatePlayheadState = (pos: number, playing: boolean) => {
    if (sessionId && url) {
      wsClient.updateState(sessionId, pos, playing, url);
    }
  };

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
