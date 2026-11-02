import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { getPublicKeyContract } from './getPublicKey';
import { getStatsContract } from './getStats';
import { getSubscriptionsContract } from './getSubscriptions';
import { sendTestNotificationContract } from './sendTestNotification';
import { subscribeContract } from './subscribe';
import { unsubscribeContract } from './unsubscribe';

export const pushContract = oc.meta(openapi({ tags: ["Push Notifications"], prefix: "/push" })).router({
  subscribe: subscribeContract,
  unsubscribe: unsubscribeContract,
  getPublicKey: getPublicKeyContract,
  getSubscriptions: getSubscriptionsContract,
  sendTestNotification: sendTestNotificationContract,
  getStats: getStatsContract,
});

export type PushContract = typeof pushContract;

export * from './subscribe';
export * from './unsubscribe';
export * from './getPublicKey';
export * from './getSubscriptions';
export * from './sendTestNotification';
export * from './getStats';
