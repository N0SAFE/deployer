import { SetupWizard } from "@/components/setup/setup-wizard"

export default function Page() {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:py-16">
        <SetupWizard />
      </div>
    </main>
  )
}
