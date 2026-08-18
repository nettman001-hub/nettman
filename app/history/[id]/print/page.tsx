import { PrintSermonClient } from "./print-sermon-client";
import { requirePageUser } from "../../../_lib/auth-user";

export const dynamic = "force-dynamic";

export default async function PrintSermonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageUser(`/history/${encodeURIComponent(id)}/print`);
  return <PrintSermonClient id={id} />;
}
