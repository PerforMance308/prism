import crypto from 'crypto';
import type { AuthenticatedUser } from './auth-manager.js';

interface CallbackSession {
  payload: AuthenticatedUser;
  expiresAt: number;
}

const CALLBACK_SESSION_TTL_MS = 5 * 60 * 1000;

export class CallbackStore {
  private sessions = new Map<string, CallbackSession>();

  create(payload: AuthenticatedUser, ttlMs = CALLBACK_SESSION_TTL_MS): string {
    this.purgeExpired();
    const id = crypto.randomUUID();
    this.sessions.set(id, {
      payload,
      expiresAt: Date.now() + ttlMs,
    });
    return id;
  }

  consume(id: string): AuthenticatedUser | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    this.sessions.delete(id);
    if (Date.now() > session.expiresAt) {
      return null;
    }
    return session.payload;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }
}

export const callbackStore = new CallbackStore();
