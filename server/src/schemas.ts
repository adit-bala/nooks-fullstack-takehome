import { z } from 'zod';

export const HLCSchema = z.object({
  p: z.number(),
  l: z.number(),
  c: z.string()
});

export const PlayheadStateSchema = z.object({
  ts: HLCSchema,
  pos: z.number(),
  playing: z.boolean(),
  url: z.string().optional()
});

// client → server
export const JoinSessionSchema = z.object({
  type: z.literal('JOIN_SESSION'),
  sessionId: z.string()
});

export const CreateSessionSchema = z.object({
  type: z.literal('CREATE_SESSION'),
  sessionId: z.string(),
  url: z.string()
});

export const CrdtUpdateSchema = z.object({
  type: z.literal('CRDT_UPDATE'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

// server → client
export const SessionSnapshotSchema = z.object({
  type: z.literal('SESSION_SNAPSHOT'),
  sessionId: z.string(),
  state: PlayheadStateSchema,
  url: z.string()
});

export const StateBroadcastSchema = z.object({
  type: z.literal('STATE_BROADCAST'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

export const SessionCreatedSchema = z.object({
  type: z.literal('SESSION_CREATED'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

export const MessageSchema = z.discriminatedUnion('type', [
  JoinSessionSchema,
  CreateSessionSchema,
  CrdtUpdateSchema,
  SessionSnapshotSchema,
  StateBroadcastSchema,
  SessionCreatedSchema
]);