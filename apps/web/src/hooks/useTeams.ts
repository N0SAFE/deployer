import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth';

// Types based on Better Auth organization plugin
export type OrganizationRole = "owner" | "admin" | "member"

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  organizationId: string;
  role: OrganizationRole[];
  createdAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
}

export interface OrganizationInvitation {
  id: string;
  email: string;
  inviterId: string;
  organizationId: string;
  role: string[];
  status: 'pending' | 'accepted' | 'rejected';
  expiresAt: Date;
  teamId?: string;
}

export interface Team {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
}

// Organization Hooks
export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await authClient.organization.list();
      if (error) {
        throw new Error(error.message);
      }
      return data || [];
    },
  });
}

export function useActiveOrganization(): ReturnType<typeof authClient.useActiveOrganization> {
  return authClient.useActiveOrganization();
}

export function useSetActiveOrganization() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ organizationId }: { organizationId: string | null }) => {
      const { data, error } = await authClient.organization.setActive({
        organizationId,
      });
      console.log(data, error);
      if (error) {
        throw new Error(error.message);
      }
      // IMPORTANT: Refetch the session to update activeOrganizationId
      // This is a known limitation in Better Auth where setActive doesn't automatically
      // update the session state in useSession() hook
      await authClient.getSession({ 
        fetchOptions: {
          cache: 'no-store'
        }
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Active organization updated');
    },
    onError: (error) => {
      toast.error(`Failed to update active organization: ${error.message}`);
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ name, slug, logo }: { name: string; slug: string; logo?: string }) => {
      const { data, error } = await authClient.organization.create({
        name,
        slug,
        logo,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Organization created successfully');
    },
    onError: (error) => {
      toast.error(`Failed to create organization: ${error.message}`);
    },
  });
}

// Organization Members Hooks
export function useOrganizationMembers(organizationId?: string) {
  return useQuery({
    queryKey: ['organization-members', organizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listMembers({
        query: {
            organizationId,limit: 100,
        },
        
      });
      if (error) {
        throw new Error(error.message);
      }
      return data?.members || [];
    },
    enabled: !!organizationId || true, // Works with active organization if no ID provided
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      email,
      role,
      organizationId,
      teamId,
    }: {
      email: string;
      role: OrganizationRole | OrganizationRole[];
      organizationId?: string;
      teamId?: string;
    }) => {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        role,
        organizationId,
        teamId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] });
      queryClient.invalidateQueries({ queryKey: ['organization-invitations'] });
      toast.success('Member invited successfully');
    },
    onError: (error) => {
      toast.error(`Failed to invite member: ${error.message}`);
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      memberId,
      role,
      organizationId,
    }: {
      memberId: string;
      role: OrganizationRole | OrganizationRole[];
      organizationId?: string;
    }) => {
      const { data, error } = await authClient.organization.updateMemberRole({
        memberId,
        role,
        organizationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] });
      toast.success('Member role updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update member role: ${error.message}`);
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      memberIdOrEmail,
      organizationId,
    }: {
      memberIdOrEmail: string;
      organizationId?: string;
    }) => {
      const { data, error } = await authClient.organization.removeMember({
        memberIdOrEmail,
        organizationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members'] });
      toast.success('Member removed successfully');
    },
    onError: (error) => {
      toast.error(`Failed to remove member: ${error.message}`);
    },
  });
}

// Organization Invitations Hooks
export function useOrganizationInvitations(organizationId?: string) {
  return useQuery({
    queryKey: ['organization-invitations', organizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listInvitations({
        query: { organizationId },
      });
      if (error) {
        throw new Error(error.message);
      }
      return data || [];
    },
  });
}

export function useCancelInvitation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ invitationId }: { invitationId: string }) => {
      const { data, error } = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invitations'] });
      toast.success('Invitation cancelled successfully');
    },
    onError: (error) => {
      toast.error(`Failed to cancel invitation: ${error.message}`);
    },
  });
}

// Teams Hooks
export function useTeams(organizationId?: string) {
  return useQuery({
    queryKey: ['teams', organizationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listTeams({
        query: { organizationId },
      });
      if (error) {
        throw new Error(error.message);
      }
      return data || [];
    },
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      name,
      organizationId,
    }: {
      name: string;
      organizationId?: string;
    }) => {
      const { data, error } = await authClient.organization.createTeam({
        name,
        organizationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Team created successfully');
    },
    onError: (error) => {
      toast.error(`Failed to create team: ${error.message}`);
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      teamId,
      data,
    }: {
      teamId: string;
      data: { name?: string; organizationId?: string };
    }) => {
      const { data: result, error } = await authClient.organization.updateTeam({
        teamId,
        data,
      });
      if (error) {
        throw new Error(error.message);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Team updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update team: ${error.message}`);
    },
  });
}

export function useRemoveTeam() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      teamId,
      organizationId,
    }: {
      teamId: string;
      organizationId?: string;
    }) => {
      const { data, error } = await authClient.organization.removeTeam({
        teamId,
        organizationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Team removed successfully');
    },
    onError: (error) => {
      toast.error(`Failed to remove team: ${error.message}`);
    },
  });
}

// Team Members Hooks
export function useTeamMembers(teamId?: string) {
  return useQuery({
    queryKey: ['team-members', teamId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listTeamMembers({
        query: { teamId },
      });
      if (error) {
        throw new Error(error.message);
      }
      return data || [];
    },
    enabled: !!teamId,
  });
}

export function useAddTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
    }: {
      teamId: string;
      userId: string;
    }) => {
      const { data, error } = await authClient.organization.addTeamMember({
        teamId,
        userId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Team member added successfully');
    },
    onError: (error) => {
      toast.error(`Failed to add team member: ${error.message}`);
    },
  });
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
    }: {
      teamId: string;
      userId: string;
    }) => {
      const { data, error } = await authClient.organization.removeTeamMember({
        teamId,
        userId,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Team member removed successfully');
    },
    onError: (error) => {
      toast.error(`Failed to remove team member: ${error.message}`);
    },
  });
}

// Utility Hooks
export function useCurrentMember() {
  return useQuery({
    queryKey: ['current-member'],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getActiveMember();
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
  });
}

// Legacy compatibility exports (for backward compatibility during migration)
export const useUpdateRole = useUpdateMemberRole;