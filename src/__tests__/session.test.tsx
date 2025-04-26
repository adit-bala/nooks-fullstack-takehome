import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CreateSession from '../routes/CreateSession';
import WatchSession from '../routes/WatchSession';
import { wsClient } from '../utils/websocket';

// Mock the WebSocket client
jest.mock('../utils/websocket', () => {
  const originalModule = jest.requireActual('../utils/websocket');
  
  return {
    ...originalModule,
    wsClient: {
      connect: jest.fn().mockResolvedValue({}),
      sendMessage: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockImplementation((sessionId, url) => {
        // Simulate server response
        setTimeout(() => {
          const handlers = mockHandlers.get('SESSION_CREATED') || [];
          handlers.forEach(handler => handler({
            type: 'SESSION_CREATED',
            sessionId,
            state: {
              ts: { p: Date.now(), l: 0, c: sessionId },
              pos: 0,
              playing: false,
              url
            }
          }));
        }, 100);
        return Promise.resolve();
      }),
      joinSession: jest.fn().mockImplementation((sessionId) => {
        // Simulate server response
        setTimeout(() => {
          const handlers = mockHandlers.get('SESSION_SNAPSHOT') || [];
          handlers.forEach(handler => handler({
            type: 'SESSION_SNAPSHOT',
            sessionId,
            state: {
              ts: { p: Date.now(), l: 0, c: sessionId },
              pos: 0,
              playing: false,
              url: 'https://www.youtube.com/watch?v=test'
            },
            url: 'https://www.youtube.com/watch?v=test'
          }));
        }, 100);
        return Promise.resolve();
      }),
      updateState: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockImplementation((type, handler) => {
        if (!mockHandlers.has(type)) {
          mockHandlers.set(type, []);
        }
        mockHandlers.get(type)!.push(handler);
      }),
      disconnect: jest.fn()
    }
  };
});

// Mock handlers storage
const mockHandlers = new Map<string, any[]>();

// Mock ReactPlayer to avoid YouTube API issues in tests
jest.mock('react-player', () => {
  return function MockReactPlayer({ url, onReady }: any) {
    React.useEffect(() => {
      if (onReady) onReady();
    }, [onReady]);
    
    return <div data-testid="react-player">{url}</div>;
  };
});

describe('Session Flow', () => {
  beforeEach(() => {
    mockHandlers.clear();
    jest.clearAllMocks();
  });

  test('Create session and navigate to watch page', async () => {
    // Setup a spy on window.location.assign which is used by navigate
    const navigateMock = jest.fn();
    
    render(
      <MemoryRouter initialEntries={['/create']}>
        <Routes>
          <Route path="/create" element={<CreateSession />} />
          <Route path="/watch/:sessionId" element={<WatchSession />} />
        </Routes>
      </MemoryRouter>
    );

    // Fill in the YouTube URL
    const urlInput = screen.getByLabelText(/youtube url/i);
    act(() => {
      urlInput.setAttribute('value', 'https://www.youtube.com/watch?v=test');
      urlInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Click the create button
    const createButton = screen.getByText(/create a session/i);
    act(() => {
      createButton.click();
    });

    // Verify that createSession was called
    await waitFor(() => {
      expect(wsClient.createSession).toHaveBeenCalled();
    });
  });

  test('Join existing session', async () => {
    const sessionId = 'test-session-id';
    
    render(
      <MemoryRouter initialEntries={[`/watch/${sessionId}`]}>
        <Routes>
          <Route path="/watch/:sessionId" element={<WatchSession />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify that joinSession was called with the correct sessionId
    await waitFor(() => {
      expect(wsClient.joinSession).toHaveBeenCalledWith(sessionId);
    });

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });
});
