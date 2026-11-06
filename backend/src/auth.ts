import { NextFunction, Request, Response, Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { config } from "./config";
import { pool } from "./db";

export interface AuthedRequest extends Request {
  userId?: number;
}

const COOKIE = "token";

const redirectUri = () => `${config.appUrl}/auth/google/callback`;

const oauthClient = () =>
  new OAuth2Client(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri(),
  );

// Middleware to protect authenticated routes
export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.[COOKIE];

  if (!token) {
    return res.status(401).json({
      error: "Not authenticated",
    });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { uid: number };

    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid session",
    });
  }
}

export const authRouter = Router();

// Google OAuth login
authRouter.get("/google", (_req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    return res
      .status(503)
      .send(
        "Google login is not configured. Use development login for local testing.",
      );
  }

  const state = randomBytes(16).toString("hex");

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });

  const url = oauthClient().generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  return res.redirect(url);
});

// Google OAuth callback
authRouter.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query as {
      code?: string;
      state?: string;
    };

    if (!code || !state || state !== req.cookies?.oauth_state) {
      throw new Error("Invalid OAuth state");
    }

    res.clearCookie("oauth_state");

    const client = oauthClient();

    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      throw new Error("Google ID token missing");
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId,
    });

    const p = ticket.getPayload();

    if (!p?.sub || !p.email) {
      throw new Error("Google profile missing");
    }

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (google_id, email, name, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id)
       DO UPDATE SET email = $2, name = $3, avatar = $4
       RETURNING id`,
      [p.sub, p.email, p.name ?? p.email, p.picture ?? null],
    );

    const token = jwt.sign({ uid: rows[0].id }, config.jwtSecret, {
      expiresIn: "7d",
    });

    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 3600 * 1000,
    });

    return res.redirect(`${config.appUrl}/dashboard`);
  } catch (err) {
    console.error("[auth] google callback failed:", (err as Error).message);

    return res.redirect(`${config.appUrl}/?error=login_failed`);
  }
});

// TEMPORARY DEVELOPMENT LOGIN
// Use only for local project testing.
// Disable before public deployment.
authRouter.get("/dev-login", async (_req, res) => {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (google_id, email, name, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id)
       DO UPDATE SET email = $2, name = $3
       RETURNING id`,
      ["local-development-user", "demo@reachinbox.local", "Demo User", null],
    );

    const token = jwt.sign({ uid: rows[0].id }, config.jwtSecret, {
      expiresIn: "7d",
    });

    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 3600 * 1000,
    });

    return res.redirect(`${config.appUrl}/dashboard`);
  } catch (err) {
    console.error("[auth] dev login failed:", err);

    return res
      .status(500)
      .send("Development login failed. Check database connection.");
  }
});

// Logout
authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE);

  return res.json({
    ok: true,
  });
});
