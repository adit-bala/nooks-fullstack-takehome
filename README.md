## Nooks Watch Party Project

### Required Functionality

- [x] **Creating a session**. Any user should be able to create a session to watch a given Youtube video.
- [x] **Joining a session**. Any user should be able to join a session created by another user using the shareable session link.
- [x] **Playing/pausing** the video. When a participant pauses the video, it should pause for everyone. When a participant plays the video, it should start playing for everyone.
- [x] **“Seek”**. When someone jumps to a certain time in the video it should jump to that time for everyone.
- [x] **Late to the party**... Everything should stay synced even if a user joins the watch party late (e.g. the video is already playing)
- [x] **Player controls.** All the player controls (e.g. play, pause, and seek) should be intuitive and behave as expected. For play, pause & seek operations you can use the built-in YouTube controls or disable the YouTube controls and build your own UI (including a slider for the seek operation)

🚨 **Please fill out the rubric in the README with the functionality you were able to complete**


### Architecture Questions

After building the watch party app, we would like you to answer the following questions about design decisions and tradeoffs you made while building it. Please fill them out in the README along with your submission.

1. **How did you approach the problem? What did you choose to learn or work on first? Did any unexpected difficulties come up - if so, how did you resolve them?**

My first thoughts were to avoid locking and some sort of server coordination. Thought it would be simplest to have the server act as a proxy for a peer-to-peer network. From my research at Berkeley, I learned about CRDTs and how they can avoid expensive coordination wherein by using specific data structures we can merge state udpates with minimal overhead on the server. I chose to use the last writer wins semantic since it makes sense that whoever sent in their update most recently should be reflected on the server. Using CRDT's is nice since it also allows users to make changes locally first without permission from the server. I also wanted to succintly represent the server's state, which I did with hybrid logical clock. We can use physical time to denote the "winner" for concurrent updates, and tie-break with logical clock for client updates sent simutaneously and then fall back on client id as a tie-breaker.

I was thinking about also using tRPC, but only have used gRPC, so decided to go with typescript to keep it simple for the backend. I know there are other solutions to resolving concurrent updates, but I wanted to keep it simple and try out the techniques I learned from reading research papers. I know they're used in the real world too (Amazon uses CRDTs for DynamoDB).

Some problems were avoiding excessive server updates. With CRDT semantics it became easy to coalesce updates on the server, but I also added a debouncing mechanism on the client side to avoid sending updates too frequently.

Honestly, not too many problems on the server. I used AI to program the frontend and iterate, so it did most of the hardwork. I contemplated using Cypress to test the frontend, but decided it was overkill for this project.

2. **How did you implement seeking to different times in the video? Are there any other approaches you considered and what are the tradeoffs between them?**

Client sends a full CRDT state update on seek, the server coalesces updates and sends a broadcast. Peers basically do
```
currentPos = pos + ( now() − ts ) / 1000
```
which is accounting for network transmission time, when we do `now() - ts` and add that to position.

I honestly didn't consider other approaches, since I couldn't think of a better solution than this, and it seemed to be simple and efficient enough for my use cases. I'd probably have to add some logging/tracing to see if there are any issues with this approach.

3. **How do new users know what time to join the watch party? Are there any other approaches you considered and what were the tradeoffs between them?**

New users receive most up to date state from the server. The state is quite succint, so everything fell into place after coming up with the structure of the state. 

```
/** Hybrid Logical Clock */
export interface HLC {
  p: number;    // physical time in ms
  l: number;    // logical counter
  c: string;    // client / session id
}
/** Video playhead state */
export interface PlayheadState {
  ts: HLC;
  pos: number;      // seconds
  playing: boolean;
  url?: string;     // YouTube URL
}
```

I could use existing mechanisms when using this state, so didn't consider anything else!

4. **How do you guarantee that the time that a new user joins is accurate (i.e perfectly in sync with the other users in the session) and are there any edge cases where it isn’t? Think about cases that might occur with real production traffic.**

When a new user joins, they receive the latest state from the server, which includes the current position and playing status. I adjust for network delay by adding the elapsed time since the state was created.

Some problems that could occur in production include 

- Variable network latency can cause inconsistencies, especially with global users
- Client clock differences can throw off the time adjustment calculation
- Video buffering varies across devices and network conditions
- YouTube's player has quirks with seeking and autoplay policies

5. **Are there any other situations - i.e race conditions, edge cases - where one user can be out of sync with another? (Out of sync meaning that user A has the video playing or paused at some time, while user B has the video playing or paused at some other time.)**

Yes, several situations can cause desynchronization:

Network partitions: If a user temporarily loses connection, they'll miss updates and drift out of sync until they reconnect

Rapid state changes: If multiple users make changes in quick succession, the CRDT merge might not resolve as expected due to clock skew

Browser throttling: Background tabs get throttled, causing timing issues if a user switches tabs

CDN variability: Different users might fetch video content from different CDN edges with varying latencies

Ad insertions: YouTube sometimes inserts ads differently for different users

Seek race conditions: If two users seek simultaneously, one update might overwrite the other
I mitigated some of these with coalescing and debouncing, but they can still occur. The CRDT approach helps with concurrent updates, but doesn't solve all timing issues.

For critical synchronization, I'd probably need to implement a more authoritative server model or periodic forced resynchronization, but that would sacrifice some of the responsiveness of the current approach.

6. **How would you productionize this application to a scale where it needs to be used reliably with 1M+ DAUs and 10k people connected to a single session? Think infrastructure changes, code changes & UX changes.**

The current websocket approach might not work, we could use a distributed WebSocket architecture with Redis or Kafka for pub/sub. We could have regional servers, and auto-scaling with k8s based on session load. We should also implement rate limiting and DDoS protection.

For code changes, we should optimize the broadcast mechanism, implement a hierarchical fan-out pattern for large sessions, add selective broadcasting to only send updates to affected users, improve error handling and retry logic, implement proper authentication and authorization, and add comprehensive telemetry for debugging.

For UX changes, we should add a "sync status" indicator showing connection quality, implement different roles (host, moderator, viewer) with different permissions, addd avatars for who's watching, add chat features with moderation tools,  and add fallback mechanisms when synchronization isn't possible.

🚨 **Please fill out this section in the README with answers to these questions, or send the answers in your email instead.**

### Submission

When you’ve finished, please send back your results to me (nikhil@nooks.in) and CC our recruiting lead Kev (kev@nooks.in) via email as a **zip file**. Make sure to include any instructions about how to run the app in the README.md. 

### Running

```
npm i
```

backend
```
npm run dev:server
```

frontend
```
npm start
```

