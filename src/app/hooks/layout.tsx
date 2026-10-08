// Reads the database on every request (the hooks library).
export const dynamic = "force-dynamic";

export default function HooksLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}
