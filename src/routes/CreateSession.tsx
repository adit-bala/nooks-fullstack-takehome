import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, TextField, CircularProgress } from "@mui/material";
import { v4 as uuidv4 } from "uuid";
import { wsClient } from "../utils/websocket";

const CreateSession: React.FC = () => {
  const navigate = useNavigate();
  const [newUrl, setNewUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const createSession = async () => {
    if (!newUrl) return;

    try {
      setIsCreating(true);
      const sessionId = uuidv4();

      console.log(`Creating new session ${sessionId} with URL: ${newUrl}`);

      // Create the session on the server
      await wsClient.createSession(sessionId, newUrl);

      // Register a one-time handler for session creation confirmation
      const handleSessionCreated = (message: any) => {
        if (message.sessionId === sessionId) {
          console.log("Session created successfully:", message);
          setNewUrl("");
          navigate(`/watch/${sessionId}`);
        }
      };

      wsClient.on('SESSION_CREATED', handleSessionCreated);

      // Set a timeout in case we don't get a response
      setTimeout(() => {
        console.log("No SESSION_CREATED response received, navigating anyway");
        setNewUrl("");
        navigate(`/watch/${sessionId}`);
      }, 2000);

    } catch (error) {
      console.error("Failed to create session:", error);
      alert("Failed to create session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Box width="100%" maxWidth={600} display="flex" gap={1} marginTop={1}>
      <TextField
        label="Youtube URL"
        variant="outlined"
        value={newUrl}
        onChange={(e) => setNewUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        fullWidth
        disabled={isCreating}
      />
      <Button
        disabled={!newUrl || isCreating}
        onClick={createSession}
        size="small"
        variant="contained"
        startIcon={isCreating ? <CircularProgress size={16} color="inherit" /> : null}
      >
        Create a session
      </Button>
    </Box>
  );
};

export default CreateSession;
