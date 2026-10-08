// Reads the database on every request.
export const dynamic = "force-dynamic";

export default function GlossaryLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}
