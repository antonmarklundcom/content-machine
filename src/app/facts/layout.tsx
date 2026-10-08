// Reads the database on every request (the sheet, the posted scripts it checks).
export const dynamic = "force-dynamic";

export default function FactsLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}
