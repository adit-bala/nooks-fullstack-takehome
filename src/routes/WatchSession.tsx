import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button, TextField, Tooltip, CircularProgress } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import VideoPlayer from '../components/VideoPlayer';
import { wsClient, PlayheadState, Message } from '../utils/websocket';

const adjust = (s: PlayheadState) => ({
  ...s,
  pos: s.playing ? s.pos + (Date.now() - s.ts.p) / 1e3 : s.pos,
});

const WatchSession: React.FC = () => {
  const { sessionId = '' } = useParams();
  const nav                = useNavigate();

  const [url, setUrl]               = useState<string>();
  const [state, setState]           = useState<PlayheadState>();
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(false);
  const debounceRef                 = useRef<number>();

  /* ─── join session ────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!sessionId) { nav('/create'); return; }

    const onSnap = (m: Extract<Message,{type:'SESSION_SNAPSHOT'}>) =>
      m.sessionId === sessionId && (setUrl(m.url), setState(adjust(m.state)), setLoading(false));

    const onCast = (m: Extract<Message,{type:'STATE_BROADCAST'}>) =>
      m.sessionId === sessionId && setState(adjust(m.state));

    wsClient.joinSession(sessionId).catch(() => setError('connection failed'));
    wsClient.on('SESSION_SNAPSHOT', onSnap);
    wsClient.on('STATE_BROADCAST',  onCast);

    return () => {
      wsClient.off?.('SESSION_SNAPSHOT', onSnap);
      wsClient.off?.('STATE_BROADCAST',  onCast);
    };
  }, [sessionId, nav]);

  /* ─── push local updates (debounced) ───────────────────────────────────── */
  const push = useCallback((pos: number, playing: boolean) => {
    if (!url) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(
      () => wsClient.updateState(sessionId, pos, playing, url).catch(() => {}),
      100
    );
  }, [sessionId, url]);

  /* ─── ui ───────────────────────────────────────────────────────────────── */
  if (loading) return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
      <CircularProgress />
    </Box>
  );

  if (error) return (
    <Box display="flex" flexDirection="column" gap={2} alignItems="center" height="100%">
      {error}
      <Button variant="contained" onClick={() => nav('/create')}>Create New Session</Button>
    </Box>
  );

  if (!url || !state) return null;

  return (
    <>
      <Box width="100%" maxWidth={1000} mt={1} display="flex" gap={1} alignItems="center">
        <TextField label="YouTube URL" fullWidth value={url} InputProps={{ readOnly:true }} />
        <Tooltip title={copied ? 'Link copied' : 'Copy link'}>
          <Button
            onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(()=>setCopied(false),2e3); }}
            disabled={copied}
            variant="contained"
          ><LinkIcon/></Button>
        </Tooltip>
        <Tooltip title="New watch party">
          <Button variant="contained" onClick={()=>nav('/create')}><AddCircleOutlineIcon/></Button>
        </Tooltip>
      </Box>

      <VideoPlayer url={url} initialState={state} onStateChange={push} />
    </>
  );
};

export default WatchSession;
