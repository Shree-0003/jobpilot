import QRCode from "qrcode";
import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { generateSecret, otpauthUri } from "@/lib/auth/totp";

// Returns enrolment data only while MFA is not yet enabled.
export const GET = route({ auth: "pre-mfa", limit: 20 }, async ({ user, cipher }) => {
  if (user.mfaEnabled) return { enrolled: true };
  const secret = user.mfaPendingSecretEnc ? cipher.dec(user.mfaPendingSecretEnc) : generateSecret();
  if (!user.mfaPendingSecretEnc) {
    await (await cols.users()).updateOne({ _id: user._id }, { $set: { mfaPendingSecretEnc: cipher.enc(secret) } });
  }
  const uri = otpauthUri(secret, user.email);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  if (!qr.startsWith("data:image/png")) throw new ApiError(500, "QR generation failed");
  return { enrolled: false, secret, qr };
});
