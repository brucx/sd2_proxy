import cron from 'node-cron';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { calculateCost } from '../utils/cost.util.js';
import { concurrencyCache } from './concurrency.service.js';
import { logger } from '../utils/logger.util.js';

const CRON_BATCH_SIZE = 10;

let cronTask: cron.ScheduledTask | null = null;

const processPendingTask = async (log: any) => {
  try {
    if (!log.taskId) return;

    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`
      },
      body: JSON.stringify({ id: log.taskId })
    });

    if (upstreamRes.ok) {
      const data: any = await upstreamRes.json();
      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(data.status)) {
        const completionTokens = data.usage?.completion_tokens || 0;
        const cost = data.status === 'succeeded' ? calculateCost(completionTokens, log.hasVideoInput) : '0';
        
        // Optimistic lock: only update if status is still 'pending' to prevent double deduction
        let statusUpdated = false;
        await db.transaction(async (tx) => {
          const updateResult = await tx.update(schema.usageLogs)
            .set({
              status: data.status,
              completionTokens: completionTokens,
              costYuan: cost,
              resultData: JSON.stringify(data),
              updatedAt: new Date()
            })
            .where(and(
              eq(schema.usageLogs.id, log.id),
              eq(schema.usageLogs.status, 'pending')
            ))
            .returning({ id: schema.usageLogs.id });

          statusUpdated = updateResult.length > 0;

          // Only deduct balance if we actually transitioned from pending
          if (statusUpdated && data.status === 'succeeded' && parseFloat(cost) > 0) {
            await tx.update(schema.users)
              .set({ balance: sql`${schema.users.balance} - ${cost}` })
              .where(eq(schema.users.id, log.userId));
          }
        });

        // Only decrement concurrency if we were the one to transition status
        if (statusUpdated) {
          const ucc = concurrencyCache.get(log.userId);
          if (ucc && ucc.active > 0) ucc.active--;
        }
        
        logger.info(`Updated task ${log.taskId} status to ${data.status}, cost: ¥${cost}, applied: ${statusUpdated}`);
      }
    }
  } catch (err) {
    logger.error({ err, taskId: log.taskId }, `Cron: Error processing task ${log.taskId}`);
  }
};

export function startCronJobs() {
  cronTask = cron.schedule('*/5 * * * *', async () => {
    logger.info('Running Cron Job to poll pending tasks...');
    try {
      const pendingLogs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));

      // Process in batches
      for (let i = 0; i < pendingLogs.length; i += CRON_BATCH_SIZE) {
        const batch = pendingLogs.slice(i, i + CRON_BATCH_SIZE);
        await Promise.allSettled(batch.map(log => processPendingTask(log)));
      }

      // Auto-expire stuck tasks
      const now = Date.now();
      const stillPending = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));
      for (const log of stillPending) {
        const age = now - new Date(log.createdAt).getTime();
        if (age > config.PENDING_TIMEOUT_MS) {
          
          await db.transaction(async (tx) => {
             await tx.update(schema.usageLogs)
              .set({ status: 'expired', updatedAt: new Date() })
              .where(eq(schema.usageLogs.id, log.id));
          });

          const ucc = concurrencyCache.get(log.userId);
          if (ucc && ucc.active > 0) ucc.active--;
          logger.info(`Auto-expired stuck task ${log.taskId}`);
        }
      }

      // Cleanup request logs older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const deleteResult = await db.delete(schema.requestLogs).where(lt(schema.requestLogs.createdAt, thirtyDaysAgo));
      // Drizzle delete result depends on driver, but we don't necessarily need to log the count unless we use returning() or postgres allows it.
      
    } catch (error) {
      logger.error({ err: error }, 'Cron Job Error');
    }
  });
}

export function stopCronJobs() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
