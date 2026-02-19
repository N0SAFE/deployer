import { Suspense } from 'react';
import { ContainersPageContent } from './ContainersPageContent';

export default function ContainersPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Container Management</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and manage all Docker containers across your deployments
        </p>
      </div>
      
      <Suspense fallback={<div>Loading containers...</div>}>
        <ContainersPageContent />
      </Suspense>
    </div>
  );
}