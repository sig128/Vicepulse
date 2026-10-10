import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/database.ts";

export const COOKIE = "vp_sid";

export class Sessions {
  constructor(private db: Db, private secret: string, private secure: boolean) {}

  private sign(id: string) {
    return crypto.createHmac("sha256", this.secret).update(id).digest("base64url");
  }

  verify(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const [id, sig] = raw.split(".");
    if (!id || !sig || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
    const expected = this.sign(id);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return this.db.get<{ id: string }>("SELECT id FROM sessions WHERE id = ?", id)?.id ?? null;
  }

  fromCookieHeader(header: string | undefined): string | null {
    const m = (header ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    return m ? this.verify(decodeURIComponent(m.slice(COOKIE.length + 1))) : null;
  }

  /** Existing session from the signed cookie, or a new guest session. Body/query IDs are never trusted. */
  ensure(req: FastifyRequest, reply: FastifyReply): string {
    const existing = this.verify((req.cookies as Record<string, string | undefined>)?.[COOKIE]);
    const t = new Date().toISOString();
    if (existing) {
      this.db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", t, existing);
      return existing;
    }
    const id = crypto.randomBytes(18).toString("base64url");
    const name = `Guest-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    this.db.run("INSERT INTO sessions (id, created_at, last_seen, display_name) VALUES (?, ?, ?, ?)", id, t, t, name);
    reply.setCookie(COOKIE, `${id}.${this.sign(id)}`, { httpOnly: true, sameSite: "lax", secure: this.secure, path: "/", maxAge: 60 * 60 * 24 * 180 });
    return id;
  }

  info(id: string) {
    return this.db.get<{ id: string; display_name: string; created_at: string }>("SELECT id, display_name, created_at FROM sessions WHERE id = ?", id)!;
  }

  rename(id: string, name: string) {
    this.db.run("UPDATE sessions SET display_name = ? WHERE id = ?", name, id);
  }
}
