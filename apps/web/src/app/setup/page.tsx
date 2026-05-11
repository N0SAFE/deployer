"use client";

import React from "react";
import { useRouter } from "next/navigation";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/shadcn/card";
import { Button } from "@repo/ui/components/shadcn/button";
import { Input } from "@repo/ui/components/shadcn/input";
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert";
import { Spinner } from "@repo/ui/components/atomics/atoms/Icon";
import { Setup, AuthSignin } from "@/routes";
import { useConfigureDatabase, useInitializeSetup, useSetupStatus } from "@/domains/setup/hooks";
import { toast } from "sonner";
import { zodFieldErrors } from "@/lib/forms/zod-field-errors";

const dbConfigSchema = z.object({
  databaseUrl: z.url("Must be a valid PostgreSQL URL, e.g. postgresql://user:pass@host:5432/db"),
});

const adminSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  organizationName: z.string().min(1, "Organization name is required"),
});

type DbConfigValues = z.infer<typeof dbConfigSchema>;
type AdminValues = z.infer<typeof adminSchema>;

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <React.Fragment key={i}>
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              i + 1 < current
                ? "bg-primary text-primary-foreground"
                : i + 1 === current
                  ? "border-2 border-primary text-primary"
                  : "border-2 border-muted text-muted-foreground"
            }`}
          >
            {i + 1 < current ? "✓" : i + 1}
          </div>
          {i + 1 < total && <div className={`h-px flex-1 ${i + 1 < current ? "bg-primary" : "bg-muted"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function DatabaseConfigStep({ onSaveSuccess }: { onSaveSuccess: (isNewDatabase: boolean) => void }) {
  const configureDatabase = useConfigureDatabase();
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<keyof DbConfigValues, string>>>({});

  const form = useForm({
    defaultValues: { databaseUrl: "" },
    onSubmit: async ({ value }) => {
      setFieldErrors({});

      const parsed = dbConfigSchema.safeParse(value);
      if (!parsed.success) {
        setFieldErrors(zodFieldErrors(parsed.error));
        return;
      }

      const result = await configureDatabase.mutateAsync({ databaseUrl: parsed.data.databaseUrl, testOnly: false });
      onSaveSuccess(result.isNewDatabase);
    },
  });

  const handleTest = async () => {
    const databaseUrl = form.state.values.databaseUrl;
    const parsed = dbConfigSchema.shape.databaseUrl.safeParse(databaseUrl);

    if (!parsed.success) {
      setFieldErrors({ databaseUrl: parsed.error.issues[0]?.message ?? "Must be a valid PostgreSQL URL" });
      return;
    }

    try {
      setFieldErrors({});
      await configureDatabase.mutateAsync({ databaseUrl, testOnly: true });
      toast.success("Connection successful! Credentials look good.");
    } catch {
      // handled via hook onError toast
    }
  };

  const clearFieldError = React.useCallback((key: keyof DbConfigValues) => {
    setFieldErrors((previous) => {
      if (!previous[key]) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <StepIndicator current={1} total={2} />
        <CardTitle>Connect to database</CardTitle>
        <CardDescription>
          Enter the connection URL for the shared Postgres database. It is stored locally on this
          node and reused on every subsequent boot.
        </CardDescription>
      </CardHeader>
      <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="databaseUrl">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor="databaseUrl" className="text-sm font-medium leading-none">Postgres connection URL</label>
                  <Input
                    id="databaseUrl"
                    value={field.state.value}
                    onChange={(event) => {
                      clearFieldError("databaseUrl");
                      field.handleChange(event.target.value);
                    }}
                    placeholder="postgresql://user:password@host:5432/dbname"
                    autoFocus
                  />
                  {fieldErrors.databaseUrl ? (
                    <p className="text-sm font-medium text-destructive">{fieldErrors.databaseUrl}</p>
                  ) : null}
                </div>
              )}
            </form.Field>

            {configureDatabase.error && (
              <Alert variant="destructive">
                <AlertDescription>{configureDatabase.error.message}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={configureDatabase.isPending}
                onClick={() => { void handleTest(); }}
              >
                Test connection
              </Button>
              <Button type="submit" className="flex-1" disabled={configureDatabase.isPending}>
                {configureDatabase.isPending ? <Spinner /> : "Connect"}
              </Button>
            </div>
          </form>
      </CardContent>
    </Card>
  );
}

function NewDatabaseAdminStep({ redirectTo }: { redirectTo: string | undefined }) {
  const router = useRouter();
  const initialize = useInitializeSetup();
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<keyof AdminValues, string>>>({});

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", organizationName: "" },
    onSubmit: async ({ value }) => {
      setFieldErrors({});

      const parsed = adminSchema.safeParse(value);
      if (!parsed.success) {
        setFieldErrors(zodFieldErrors(parsed.error));
        return;
      }

      const result = await initialize.mutateAsync({ ...parsed.data, strategy: "local_instance" });
      if (!result.state.needsSetup) {
        toast.success("Platform initialized! Signing you in…");
        router.replace(AuthSignin({}, { redirectTo }));
      }
    },
  });

  const clearFieldError = React.useCallback((key: keyof AdminValues) => {
    setFieldErrors((previous) => {
      if (!previous[key]) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <StepIndicator current={2} total={2} />
        <CardTitle>Create first administrator</CardTitle>
        <CardDescription>
          Fresh database detected. Create the platform admin account and your first organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor="setup-name" className="text-sm font-medium leading-none">Your name</label>
                  <Input
                    id="setup-name"
                    value={field.state.value}
                    onChange={(event) => {
                      clearFieldError("name");
                      field.handleChange(event.target.value);
                    }}
                    placeholder="Jane Doe"
                    autoFocus
                  />
                  {fieldErrors.name ? <p className="text-sm font-medium text-destructive">{fieldErrors.name}</p> : null}
                </div>
              )}
            </form.Field>

            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor="setup-email" className="text-sm font-medium leading-none">Email address</label>
                  <Input
                    id="setup-email"
                    value={field.state.value}
                    onChange={(event) => {
                      clearFieldError("email");
                      field.handleChange(event.target.value);
                    }}
                    type="email"
                    placeholder="admin@example.com"
                  />
                  {fieldErrors.email ? <p className="text-sm font-medium text-destructive">{fieldErrors.email}</p> : null}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor="setup-password" className="text-sm font-medium leading-none">Password</label>
                  <Input
                    id="setup-password"
                    value={field.state.value}
                    onChange={(event) => {
                      clearFieldError("password");
                      field.handleChange(event.target.value);
                    }}
                    type="password"
                    placeholder="••••••••"
                  />
                  {fieldErrors.password ? <p className="text-sm font-medium text-destructive">{fieldErrors.password}</p> : null}
                </div>
              )}
            </form.Field>

            <form.Field name="organizationName">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor="setup-organization-name" className="text-sm font-medium leading-none">Organization name</label>
                  <Input
                    id="setup-organization-name"
                    value={field.state.value}
                    onChange={(event) => {
                      clearFieldError("organizationName");
                      field.handleChange(event.target.value);
                    }}
                    placeholder="Acme Inc"
                  />
                  {fieldErrors.organizationName ? (
                    <p className="text-sm font-medium text-destructive">{fieldErrors.organizationName}</p>
                  ) : null}
                </div>
              )}
            </form.Field>

            {initialize.error && (
              <Alert variant="destructive">
                <AlertDescription>{initialize.error.message}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={initialize.isPending}>
              {initialize.isPending ? <Spinner /> : "Create administrator"}
            </Button>
          </form>
      </CardContent>
    </Card>
  );
}

export default Setup.Route(({ searchParams }) => {
  const router = useRouter();
  const status = useSetupStatus();
  const redirectTo = searchParams.redirectTo ?? searchParams.callbackUrl;

  React.useEffect(() => {
    if (status.data && !status.data.needsSetup) {
      router.replace(AuthSignin({}, { redirectTo }));
    }
  }, [status.data, router, redirectTo]);

  const handleDbSaveSuccess = (isNewDatabase: boolean) => {
    if (isNewDatabase) {
      toast.success("Database connected. Now create the first admin account.");
    } else {
      toast.success("Connected to existing installation. Signing you in…");
    }
  };

  if (status.isLoading || status.isPending) {
    return <LoadingScreen />;
  }

  if (status.data && !status.data.needsSetup) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      {!status.data || status.data.state === "awaiting_db_config" ? (
        <DatabaseConfigStep onSaveSuccess={handleDbSaveSuccess} />
      ) : (
        <NewDatabaseAdminStep redirectTo={redirectTo} />
      )}
    </div>
  );
});
