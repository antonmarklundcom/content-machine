import { PcOnlyNotice } from "@/components/PcOnlyNotice";

// Reads the database on every request (stories, scenes, takes, renders).
export const dynamic = "force-dynamic";

export default function StoriesLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return (
    <>
      <PcOnlyNotice />
      {children}
    </>
  );
}
