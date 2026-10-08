// Reads the database on every request (brands, links, spend in the header).
export const dynamic = "force-dynamic";

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout now (PLAN.md §1.22).
  return children;
}
