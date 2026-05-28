import { SignJWT } from "jose";
import { UserPayload } from "../../src/types.js";

/**
 * JWT Token Casting Helper.
 * Design Invariant: 8.2, D7 - For testing purposes only.
 * Generates an HS256 signed JWT token containing the UserPayload.
 */
export async function generateTestToken(
  user: UserPayload,
  jwtSecret: string,
  expiresIn: string = "1h",
): Promise<string> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}
