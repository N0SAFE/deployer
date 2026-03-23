"use client";

import React from "react";
import { useRouter } from "next/navigation";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/shadcn/card";
import { Button } from "@repo/ui/components/shadcn/button";
import { Input } from "@repo/ui/components/shadcn/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@repo/ui/components/shadcn/form";
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert";
import { Spinner } from "@repo/ui/components/atomics/atoms/Icon";
import { Setup, AuthSignin } from "@/routes";
import { useConfigureDatabase, useInitializeSetup, useSetupStatus } from "@/domains/setup/hooks";
import { toast } from "sonner";

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

  const form = useForm<DbConfigValues>({
    resolver: zodResolver(dbConfigSchema),
    defaultValues: { databaseUrl: "" },
  });

  const handleConnect = async (values: DbConfigValues) => {
    const result = await configureDatabase.mutateAsync({ databaseUrl: values.databaseUrl, testOnly: false });
    onSaveSuccess(result.isNewDatabase);
  };

  const handleTest = async () => {
    const valid = await form.trigger("databaseUrl");
    if (!valid) return;
    try {
      await configureDatabase.mutateAsync({ databaseUrl: form.getValues("databaseUrl"), testOnly: true });
      toast.success("Connection successful! Credentials look good.");
    } catch {
      // handled via hook onError toast
    }
  };

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
        <Form {...form}>
          <form className="space-y-4" onSubmit={(e) => { void form.handleSubmit(handleConnect)(e); }}>
            <FormField
              control={form.control}
              name="databaseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postgres connection URL</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="postgresql://user:password@host:5432/dbname" autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
        </Form>
      </CardContent>
    </Card>
  );
}

function NewDatabaseAdminStep({ redirectTo }: { redirectTo: string | undefined }) {
  const router = useRouter();
  const initialize = useInitializeSetup();

  const form = useForm<AdminValues>({
    resolver: zodResolver(adminSchema),
    defaultValues: { name: "", email: "", password: "", organizationName: "" },
  });

  const onSubmit = async (values: AdminValues) => {
    const result = await initialize.mutateAsync({ ...values, strategy: "local_instance" });
    if (!result.state.needsSetup) {
      toast.success("Platform initialized! Signing you in…");
      router.replace(AuthSignin({}, { redirectTo }));
    }
  };

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
        <Form {...form}>
          <form className="space-y-4" onSubmit={(e) => { void form.handleSubmit(onSubmit)(e); }}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Jane Doe" autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" placeholder="admin@example.com" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="••••••••" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Acme Inc" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {initialize.error && (
              <Alert variant="destructive">
                <AlertDescription>{initialize.error.message}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={initialize.isPending}>
              {initialize.isPending ? <Spinner /> : "Create administrator"}
            </Button>
          </form>
        </Form>
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
