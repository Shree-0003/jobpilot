import { route } from "@/lib/http";
import { verifyAuditChain } from "@/lib/audit";

export const GET = route({ auth: "full", limit: 10 }, async () => verifyAuditChain());
