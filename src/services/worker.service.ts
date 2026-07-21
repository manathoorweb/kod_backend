import crypto from 'crypto';
import { pool } from '../config/db';
import admin from '../config/firebase';

let WORKER_ID = 'worker-init';
let workerTimeout: NodeJS.Timeout | null = null;
let isShuttingDown = false;

/**
 * Polls the job queue and processes the next pending job
 */
async function pollAndProcessJob() {
  if (isShuttingDown) return;

  let client;
  try {
    client = await pool.connect();
  } catch (err: any) {
    if (!isShuttingDown) {
      console.error(`[Worker ${WORKER_ID}] Database connection timeout/failure:`, err.message || err);
    }
    return;
  }

  try {
    await client.query('BEGIN');

    // 1. Fetch next pending job using SKIP LOCKED to prevent multiple workers from picking the same job
    const fetchRes = await client.query(
      `SELECT * FROM job_queue 
       WHERE status = 'pending'::job_status AND run_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (fetchRes.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const job = fetchRes.rows[0];
    const newAttempts = job.attempts + 1;

    // 2. Mark job as processing
    await client.query(
      `UPDATE job_queue 
       SET status = 'processing'::job_status, attempts = $1, locked_at = NOW(), locked_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [newAttempts, WORKER_ID, job.id]
    );

    await client.query('COMMIT');

    // 3. Process job task outside the lock transactions
    console.log(`[Worker ${WORKER_ID}] Processing job ${job.id} (Type: ${job.job_type}, Attempt: ${newAttempts})`);
    
    try {
      await executeJob(job.job_type, job.payload);
      
      // 4. Mark job as completed
      await pool.query(
        `UPDATE job_queue 
         SET status = 'completed'::job_status, locked_at = null, locked_by = null, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [job.id]
      );
      console.log(`[Worker ${WORKER_ID}] Job ${job.id} completed successfully`);
    } catch (jobErr: any) {
      const errMessage = jobErr.message || String(jobErr);
      console.error(`[Worker ${WORKER_ID}] Job ${job.id} failed:`, errMessage);

      const isRetryable = newAttempts < job.max_attempts;
      const nextStatus = isRetryable ? 'pending' : 'failed';
      // Exponential backoff retry time: e.g. retry after 15s, 30s, 45s...
      const nextRunAt = isRetryable ? new Date(Date.now() + newAttempts * 15 * 1000) : job.run_at;

      await pool.query(
        `UPDATE job_queue 
         SET status = $1::job_status, error_message = $2, locked_at = null, locked_by = null, run_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [nextStatus, errMessage, nextRunAt, job.id]
      );
    }
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error(`[Worker ${WORKER_ID}] Transaction rollback failed:`, rollbackErr);
    }
    if (err.code === '42P01') {
      console.warn(`[Worker ${WORKER_ID}] Database tables not initialized yet. Please run migrations: npm run migrate`);
    } else {
      console.error(`[Worker ${WORKER_ID}] Concurrency error in worker transaction:`, err);
    }
  } finally {
    try {
      client.release();
    } catch (releaseErr) {
      console.error(`[Worker ${WORKER_ID}] Failed to release database client:`, releaseErr);
    }
  }
}

/**
 * Router that executes job logic depending on job type
 */
async function executeJob(jobType: string, payload: any) {
  switch (jobType) {
    case 'send_bulk_notification':
      await processBulkNotification(payload);
      break;
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

/**
 * Logic to process bulk push notifications using Firebase Cloud Messaging
 */
async function processBulkNotification(payload: any) {
  const { title, body, tokens } = payload;

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Notification payload is missing target tokens list');
  }

  // Verify Firebase Admin is initialized
  if (!admin.apps || admin.apps.length === 0) {
    console.warn('[FCM Worker] Firebase SDK is in dummy/unconfigured mode. Simulating push notifications.');
    return;
  }

  // Firebase allows multicast up to 500 tokens per batch
  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const tokenBatch = tokens.slice(i, i + batchSize);
    
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title,
        body
      }
    });

    console.log(`[FCM Worker] Broadcasted batch notification. Success: ${response.successCount}, Failures: ${response.failureCount}`);

    // Clean up stale or unregistered tokens from database
    const tokensToRemove: string[] = [];
    response.responses.forEach((res, index) => {
      if (!res.success && res.error) {
        const code = res.error.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          tokensToRemove.push(tokenBatch[index]);
        }
      }
    });

    if (tokensToRemove.length > 0) {
      console.log(`[FCM Worker] Removing ${tokensToRemove.length} inactive registration tokens...`);
      await pool.query('DELETE FROM user_fcm_tokens WHERE token = ANY($1)', [tokensToRemove]);
    }
  }
}

/**
 * Start the background worker loop
 */
export function startWorker() {
  try {
    WORKER_ID = `worker-${crypto.randomBytes(4).toString('hex')}`;
  } catch (err) {
    WORKER_ID = 'worker-cf';
  }
  console.log(`[Worker ${WORKER_ID}] Database background job worker loop initialized.`);
  isShuttingDown = false;

  async function loop() {
    await pollAndProcessJob();
    if (!isShuttingDown) {
      workerTimeout = setTimeout(loop, 5000); // Poll every 5 seconds
    }
  }

  loop();
}

/**
 * Gracefully stop the worker loop
 */
export function stopWorker() {
  console.log(`[Worker ${WORKER_ID}] Shutting down job worker loop...`);
  isShuttingDown = true;
  if (workerTimeout) {
    clearTimeout(workerTimeout);
    workerTimeout = null;
  }
}
