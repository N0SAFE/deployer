import { oc } from '@orpc/contract';
import { z } from 'zod';
import { WebhookConfigSchema, CreateWebhookConfigInput, UpdateWebhookConfigInput, WebhookDeliverySchema, } from './schemas';
export const webhookManagementContract = oc.router({
    // Webhook Configuration CRUD
    createWebhook: oc
        .route({
        method: 'POST',
        path: '/webhooks',
        summary: 'Create a new webhook configuration',
    })
        .input(CreateWebhookConfigInput)
        .output(WebhookConfigSchema)
        .meta({
        description: 'Create a new webhook configuration',
        tags: ['Webhook Management'],
    }),
    getWebhook: oc
        .route({
        method: 'GET',
        path: '/webhooks/{id}',
        summary: 'Get webhook configuration by ID',
    })
        .input(z.object({ id: z.string() }))
        .output(WebhookConfigSchema)
        .meta({
        description: 'Get webhook configuration by ID',
        tags: ['Webhook Management'],
    }),
    updateWebhook: oc
        .route({
        method: 'PUT',
        path: '/webhooks/{id}',
        summary: 'Update webhook configuration',
    })
        .input(z.object({
        id: z.string(),
        data: UpdateWebhookConfigInput
    }))
        .output(WebhookConfigSchema)
        .meta({
        description: 'Update webhook configuration',
        tags: ['Webhook Management'],
    }),
    deleteWebhook: oc
        .route({
        method: 'DELETE',
        path: '/webhooks/{id}',
        summary: 'Delete webhook configuration',
    })
        .input(z.object({ id: z.string() }))
        .output(z.object({ success: z.boolean() }))
        .meta({
        description: 'Delete webhook configuration',
        tags: ['Webhook Management'],
    }),
    listWebhooks: oc
        .route({
        method: 'GET',
        path: '/webhooks',
        summary: 'List webhook configurations',
    })
        .input(z.object({
        isActive: z.boolean().optional(),
        event: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
    }))
        .output(z.object({
        webhooks: z.array(WebhookConfigSchema),
        total: z.number(),
        page: z.number(),
        limit: z.number(),
    }))
        .meta({
        description: 'List webhook configurations',
        tags: ['Webhook Management'],
    }),
    // Webhook Testing
    testWebhook: oc
        .route({
        method: 'POST',
        path: '/webhooks/{id}/test',
        summary: 'Test webhook with a sample payload',
    })
        .input(z.object({
        id: z.string(),
        event: z.string(),
        payload: z.record(z.string(), z.any()).optional(),
    }))
        .output(z.object({
        success: z.boolean(),
        statusCode: z.number(),
        responseBody: z.string(),
        responseTime: z.number(), // milliseconds
        error: z.string().optional(),
    }))
        .meta({
        description: 'Test webhook with a sample payload',
        tags: ['Webhook Management'],
    }),
    validateWebhookUrl: oc
        .route({
        method: 'POST',
        path: '/webhooks/validate',
        summary: 'Validate webhook URL and connectivity',
    })
        .input(z.object({
        url: z.string(),
        secret: z.string().optional(),
    }))
        .output(z.object({
        valid: z.boolean(),
        reachable: z.boolean(),
        responseTime: z.number().optional(),
        error: z.string().optional(),
    }))
        .meta({
        description: 'Validate webhook URL and connectivity',
        tags: ['Webhook Management'],
    }),
    // Webhook Delivery Management
    listWebhookDeliveries: oc
        .route({
        method: 'GET',
        path: '/webhook-deliveries',
        summary: 'List webhook deliveries with filtering',
    })
        .input(z.object({
        webhookId: z.string().optional(),
        event: z.string().optional(),
        status: z.enum(['pending', 'success', 'failed', 'retrying']).optional(),
        since: z.date().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
    }))
        .output(z.object({
        deliveries: z.array(WebhookDeliverySchema),
        total: z.number(),
        page: z.number(),
        limit: z.number(),
    }))
        .meta({
        description: 'List webhook deliveries with filtering',
        tags: ['Webhook Management'],
    }),
    getWebhookDelivery: oc
        .route({
        method: 'GET',
        path: '/webhook-deliveries/{id}',
        summary: 'Get webhook delivery details by ID',
    })
        .input(z.object({ id: z.string() }))
        .output(WebhookDeliverySchema)
        .meta({
        description: 'Get webhook delivery details by ID',
        tags: ['Webhook Management'],
    }),
    retryWebhookDelivery: oc
        .route({
        method: 'POST',
        path: '/webhook-deliveries/{id}/retry',
        summary: 'Retry a failed webhook delivery',
    })
        .input(z.object({ id: z.string() }))
        .output(z.object({
        success: z.boolean(),
        nextAttemptAt: z.date().optional(),
    }))
        .meta({
        description: 'Retry a failed webhook delivery',
        tags: ['Webhook Management'],
    }),
    // Webhook Events
    listWebhookEvents: oc
        .route({
        method: 'GET',
        path: '/webhook-events',
        summary: 'List available webhook events and their payloads',
    })
        .input(z.object({}))
        .output(z.object({
        events: z.array(z.object({
            name: z.string(),
            description: z.string(),
            payload: z.object({
                schema: z.record(z.string(), z.any()),
                example: z.record(z.string(), z.any()),
            }),
            triggers: z.array(z.string()),
        })),
        categories: z.array(z.object({
            name: z.string(),
            events: z.array(z.string()),
        })),
    }))
        .meta({
        description: 'List available webhook events and their payloads',
        tags: ['Webhook Management'],
    }),
    // Webhook Security
    generateWebhookSecret: oc
        .route({
        method: 'POST',
        path: '/webhooks/generate-secret',
        summary: 'Generate a secure webhook secret',
    })
        .input(z.object({
        length: z.number().min(16).max(128).default(32),
    }))
        .output(z.object({
        secret: z.string(),
        algorithm: z.string(),
    }))
        .meta({
        description: 'Generate a secure webhook secret',
        tags: ['Webhook Management'],
    }),
    verifyWebhookSignature: oc
        .route({
        method: 'POST',
        path: '/webhooks/verify-signature',
        summary: 'Verify webhook payload signature',
    })
        .input(z.object({
        payload: z.string(),
        signature: z.string(),
        secret: z.string(),
        algorithm: z.string().default('sha256'),
    }))
        .output(z.object({
        valid: z.boolean(),
        error: z.string().optional(),
    }))
        .meta({
        description: 'Verify webhook payload signature',
        tags: ['Webhook Management'],
    }),
    // Webhook Statistics
    getWebhookStats: oc
        .route({
        method: 'GET',
        path: '/webhooks/stats',
        summary: 'Get webhook delivery statistics',
    })
        .input(z.object({
        webhookId: z.string().optional(),
        timeRange: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    }))
        .output(z.object({
        totalDeliveries: z.number(),
        successfulDeliveries: z.number(),
        failedDeliveries: z.number(),
        averageResponseTime: z.number(),
        successRate: z.number(),
        deliveriesByEvent: z.record(z.string(), z.number()),
        deliveriesByStatus: z.record(z.string(), z.number()),
        recentFailures: z.array(z.object({
            id: z.string(),
            event: z.string(),
            error: z.string(),
            timestamp: z.date(),
        })),
    }))
        .meta({
        description: 'Get webhook delivery statistics',
        tags: ['Webhook Management'],
    }),
    // Webhook Templates
    listWebhookTemplates: oc
        .route({
        method: 'GET',
        path: '/webhook-templates',
        summary: 'List webhook templates for popular services',
    })
        .input(z.object({
        service: z.string().optional(),
        category: z.string().optional(),
    }))
        .output(z.object({
        templates: z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            service: z.string(),
            category: z.string(),
            url: z.string(),
            headers: z.record(z.string(), z.string()).optional(),
            events: z.array(z.string()),
            payloadTransform: z.string().optional(),
        })),
    }))
        .meta({
        description: 'List webhook templates for popular services',
        tags: ['Webhook Management'],
    }),
    createWebhookFromTemplate: oc
        .route({
        method: 'POST',
        path: '/webhooks/from-template',
        summary: 'Create webhook from template',
    })
        .input(z.object({
        templateId: z.string(),
        name: z.string(),
        customizations: z.object({
            url: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            events: z.array(z.string()).optional(),
        }).optional(),
    }))
        .output(WebhookConfigSchema)
        .meta({
        description: 'Create webhook from template',
        tags: ['Webhook Management'],
    }),
    // Webhook Monitoring
    getWebhookHealth: oc
        .route({
        method: 'GET',
        path: '/webhooks/{id}/health',
        summary: 'Get webhook health status and issues',
    })
        .input(z.object({ id: z.string() }))
        .output(z.object({
        webhookId: z.string(),
        name: z.string(),
        status: z.enum(['healthy', 'warning', 'critical', 'unknown']),
        lastSuccess: z.date().optional(),
        lastFailure: z.date().optional(),
        consecutiveFailures: z.number(),
        uptime: z.number(), // percentage over last 24 hours
        averageResponseTime: z.number(),
        issues: z.array(z.object({
            type: z.enum(['timeout', 'connection', 'status-code', 'rate-limit']),
            message: z.string(),
            count: z.number(),
            lastOccurrence: z.date(),
        })),
    }))
        .meta({
        description: 'Get webhook health status and issues',
        tags: ['Webhook Management'],
    }),
});
