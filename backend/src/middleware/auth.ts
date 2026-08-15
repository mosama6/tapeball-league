import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "UMPIRE";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "14d" });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser;
    } catch {
      /* ignore */
    }
  }
  next();
}

export function requireAuth(roles?: Array<"ADMIN" | "UMPIRE">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Login required" });
    }
    try {
      const user = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser;
      if (roles && !roles.includes(user.role)) {
        return res.status(403).json({ error: "Not allowed" });
      }
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}
