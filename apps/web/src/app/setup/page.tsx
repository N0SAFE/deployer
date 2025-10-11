'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/shadcn/button';
import { Input } from '@repo/ui/components/shadcn/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@repo/ui/components/shadcn/card';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@repo/ui/components/shadcn/form';
import { setupFormSchema, type SetupFormData } from './setup-form-schema';

export default function SetupPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SetupFormData>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      organizationName: 'Default Organization',
    },
  });

  const createUserMutation = useMutation(
    orpc.setup.createInitialUser.mutationOptions({
      onSuccess: async () => {
        toast.success('Account created! Signing you in...');
        
        // Sign in the user with Better Auth
        try {
          const { signIn } = await import('@/lib/auth');
          await signIn.email({
            email: form.getValues('email'),
            password: form.getValues('password'),
            callbackURL: '/dashboard',
          });
          
          // Navigation handled by Better Auth callback
        } catch (error) {
          console.error('Sign in error:', error);
          toast.error('Account created but sign-in failed. Please sign in manually.');
          router.push('/auth/login');
        }
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to create account. Please try again.');
        setIsSubmitting(false);
      },
    })
  );

  const onSubmit = async (data: SetupFormData) => {
    setIsSubmitting(true);
    createUserMutation.mutate({
      name: data.name,
      email: data.email,
      password: data.password,
      organizationName: data.organizationName,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            🚀 Welcome to Deployer
          </CardTitle>
          <CardDescription className="text-center">
            Let&apos;s set up your deployment platform. Create your admin account and organization to get started.
          </CardDescription>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="John Doe" 
                        {...field} 
                        disabled={isSubmitting}
                      />
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
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder="john@example.com" 
                        {...field} 
                        disabled={isSubmitting}
                      />
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
                      <Input 
                        type="password" 
                        placeholder="••••••••" 
                        {...field} 
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="••••••••" 
                        {...field} 
                        disabled={isSubmitting}
                      />
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
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="My Company" 
                        {...field} 
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>

            <CardFooter>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating Account...' : 'Create Account & Continue'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
