import { PcOnlyNotice } from "@/components/PcOnlyNotice";

// Reads the database on every request (profiles, takes, the pronunciation dictionary).
export const dynamic = "force-dynamic";

export default function VoiceLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return (
    <>
      <PcOnlyNotice />
      {children}
    </>
  );
}
