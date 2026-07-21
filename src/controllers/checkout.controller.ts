import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db.js';
import crypto from 'crypto';

const HASH_SECRET = process.env.COOKIE_SECRET || 'kod-cookie-secret-9182';

export function generateVerificationHash(orderId: string): string {
  const hmac = crypto.createHmac('sha256', HASH_SECRET);
  hmac.update(orderId);
  const signature = hmac.digest('hex');
  return `${orderId}.${signature}`;
}

export function verifyVerificationHash(hash: string): string | null {
  if (!hash || typeof hash !== 'string') return null;
  const parts = hash.split('.');
  if (parts.length !== 2) return null;
  const [orderId, signature] = parts;
  
  const hmac = crypto.createHmac('sha256', HASH_SECRET);
  hmac.update(orderId);
  const expectedSignature = hmac.digest('hex');
  
  try {
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
    return isMatch ? orderId : null;
  } catch (err) {
    return null;
  }
}

interface CheckoutBody {
  amount: number;
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  orderType: string;
  itemId: string;
  itemName: string;
  orderId?: string;
  selectedTickets?: { day: string; quantity: number; price: number }[];
}

/**
 * Initiates checkout: inserts order and payment entry in a single safe database transaction
 */
export async function initiateCheckout(request: FastifyRequest, reply: FastifyReply) {
  const { amount, customerId, customerEmail, customerPhone, orderType, itemId, itemName, orderId: reqOrderId, selectedTickets } =
    request.body as CheckoutBody;

  const orderId = reqOrderId || `ORDER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  console.log(`[Checkout Controller] [${orderId}] Initiating checkout for customer: ${customerId}, amount: ${amount}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[Checkout Controller] [${orderId}] Transaction started.`);

    // 1. Insert order
    console.log(`[Checkout Controller] [${orderId}] Inserting/updating order...`);
    const orderRes = await client.query(
      `INSERT INTO orders (order_id, user_id, order_type, item_id, item_name, quantity, amount, currency, status, customer_email, customer_phone)
       VALUES ($1, $2, $3, $4, $5, 1, $6, 'INR', 'pending', $7, $8)
       ON CONFLICT (order_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         amount = EXCLUDED.amount,
         customer_email = EXCLUDED.customer_email,
         customer_phone = EXCLUDED.customer_phone,
         updated_at = NOW()
       RETURNING *`,
      [orderId, customerId, orderType, itemId, itemName, amount, customerEmail, customerPhone]
    );

    const order = orderRes.rows[0];
    console.log(`[Checkout Controller] [${orderId}] Order created with DB ID: ${order.id}.`);

    // 2. Insert payment entry
    console.log(`[Checkout Controller] [${orderId}] Creating payment entry...`);
    await client.query(
      `INSERT INTO payment_entries (order_id, payment_method, gateway_order_id, amount, currency, status)
       VALUES ($1, 'paytm', $2, $3, 'INR', 'initiated')
       ON CONFLICT (order_id) DO UPDATE SET
         status = 'initiated',
         amount = EXCLUDED.amount
       ON CONFLICT ON CONSTRAINT payment_entries_pkey DO NOTHING`,
      [order.id, orderId, amount]
    );
    console.log(`[Checkout Controller] [${orderId}] Payment entry created.`);

    // 3. Process upsold tickets if provided
    if (selectedTickets && selectedTickets.length > 0) {
      console.log(`[Checkout Controller] [${orderId}] Processing ${selectedTickets.length} upsold/ spectator tickets...`);
      
      // Delete any pre-existing ticket orders with this orderId to prevent duplicate insertions
      await client.query(`DELETE FROM ticket_orders WHERE order_id = $1`, [orderId]);
      
      for (const ticket of selectedTickets) {
        console.log(`[Checkout Controller] [${orderId}] Adding ticket order: Day ${ticket.day}, Qty: ${ticket.quantity}, Price: ${ticket.price}`);
        await client.query(
          `INSERT INTO ticket_orders (program_id, user_id, day, price, quantity, status, order_id)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
          [itemId, customerId, ticket.day, ticket.price, ticket.quantity, orderId]
        );
      }
      console.log(`[Checkout Controller] [${orderId}] Ticket orders inserted successfully.`);
    }

    await client.query('COMMIT');
    console.log(`[Checkout Controller] [${orderId}] Transaction committed successfully.`);

    return reply.send({
      status: 'success',
      txnToken: 'mock_token_dev_12345',
      orderId: orderId,
      verificationHash: generateVerificationHash(orderId),
      mid: 'MOCK_MID_DEV',
      amount: amount,
      isMock: true
    });
  } catch (err: any) {
    console.error(`[Checkout Controller] [${orderId}] Error during checkout initiation:`, err.message || err);
    try {
      await client.query('ROLLBACK');
      console.log(`[Checkout Controller] [${orderId}] Transaction rolled back.`);
    } catch (rollbackErr: any) {
      console.error(`[Checkout Controller] [${orderId}] Transaction rollback failed:`, rollbackErr.message || rollbackErr);
    }
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to initiate checkout' });
  } finally {
    client.release();
    console.log(`[Checkout Controller] [${orderId}] Connection client released back to pool.`);
  }
}

/**
 * Confirms payment mock: Updates order, payment entries, ticket orders, and battle entries in a strict order
 */
export async function confirmCheckoutMock(request: FastifyRequest, reply: FastifyReply) {
  const { orderId } = request.body as { orderId: string };

  console.log(`[Checkout Controller] [${orderId}] Confirming mock checkout success...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[Checkout Controller] [${orderId}] Transaction started.`);

    // 1. Lock and Update orders (Strict order 1: orders)
    console.log(`[Checkout Controller] [${orderId}] Updating order status to completed...`);
    const orderRes = await client.query(
      `UPDATE orders 
       SET status = 'completed', completed_at = NOW(), updated_at = NOW() 
       WHERE order_id = $1 
       RETURNING *`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      console.warn(`[Checkout Controller] [${orderId}] Order not found! Rolling back.`);
      await client.query('ROLLBACK');
      return reply.status(404).send({ error: `Order with ID '${orderId}' not found` });
    }

    const order = orderRes.rows[0];
    console.log(`[Checkout Controller] [${orderId}] Order status updated.`);

    // 2. Update payment entries (Strict order 2: payment_entries)
    console.log(`[Checkout Controller] [${orderId}] Updating payment entry to success...`);
    await client.query(
      `UPDATE payment_entries 
       SET status = 'success', transaction_id = $1, completed_at = NOW() 
       WHERE gateway_order_id = $2`,
      [`TXN_${Date.now()}`, orderId]
    );
    console.log(`[Checkout Controller] [${orderId}] Payment entry updated.`);

    // 3. Update ticket orders (Strict order 3: ticket_orders)
    console.log(`[Checkout Controller] [${orderId}] Updating ticket_orders to paid...`);
    await client.query(
      `UPDATE ticket_orders 
       SET status = 'paid' 
       WHERE order_id = $1`,
      [orderId]
    );
    console.log(`[Checkout Controller] [${orderId}] Ticket orders updated.`);

    // 4. Update battle entries (Strict order 4: battle_entries)
    if (order.order_type === 'registration') {
      console.log(`[Checkout Controller] [${orderId}] Registration order detected. Approving associated battle_entries...`);
      // Find the battles under this program
      const battlesRes = await client.query(
        `SELECT id FROM battles WHERE program_id = $1`,
        [order.item_id]
      );
      const battleIds = battlesRes.rows.map((b) => b.id);
      if (battleIds.length > 0) {
        console.log(`[Checkout Controller] [${orderId}] Updating battle entries for battles: ${battleIds.join(', ')}`);
        await client.query(
          `UPDATE battle_entries 
           SET entry_status = 'approved' 
           WHERE user_id = $1 AND battle_id = ANY($2)`,
          [order.user_id, battleIds]
        );
        console.log(`[Checkout Controller] [${orderId}] Battle entries approved.`);
      } else {
        console.log(`[Checkout Controller] [${orderId}] No battles found for program ID: ${order.item_id}`);
      }
    }

    await client.query('COMMIT');
    console.log(`[Checkout Controller] [${orderId}] Transaction committed successfully.`);

    return reply.send({ success: true, message: 'Payment successfully mocked and order confirmed' });
  } catch (err: any) {
    console.error(`[Checkout Controller] [${orderId}] Error confirming mock payment:`, err.message || err);
    try {
      await client.query('ROLLBACK');
      console.log(`[Checkout Controller] [${orderId}] Transaction rolled back.`);
    } catch (rollbackErr: any) {
      console.error(`[Checkout Controller] [${orderId}] Transaction rollback failed:`, rollbackErr.message || rollbackErr);
    }
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to mock confirm payment' });
  } finally {
    client.release();
    console.log(`[Checkout Controller] [${orderId}] Connection client released back to pool.`);
  }
}

/**
 * Verifies a scanned QR code's cryptographically signed hash and aggregates order lifecycle steps.
 * Returns a detailed chronological audit trail with status results.
 */
export async function verifyCheckoutQR(request: FastifyRequest, reply: FastifyReply) {
  const { hash } = request.query as { hash: string };

  if (!hash) {
    return reply.status(400).send({ error: 'Verification hash is required' });
  }

  console.log(`[Checkout Verification] Verifying hash: ${hash}`);

  // 1. Verify cryptographic signature to prevent tampering
  const orderId = verifyVerificationHash(hash);
  if (!orderId) {
    console.warn(`[Checkout Verification] Invalid verification hash signature: ${hash}`);
    return reply.status(401).send({ error: 'Invalid verification signature' });
  }

  const client = await pool.connect();
  try {
    // 2. Fetch main order (Read-only query, no transaction locks needed to prevent deadlocks)
    const orderRes = await client.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    if (orderRes.rows.length === 0) {
      return reply.status(404).send({ error: `No order records found for Order ID: ${orderId}` });
    }
    const order = orderRes.rows[0];

    // 3. Fetch payment entries
    const paymentRes = await client.query('SELECT * FROM payment_entries WHERE order_id = $1', [order.id]);
    const payment = paymentRes.rows[0] || null;

    // 4. Fetch user details
    const userRes = await client.query('SELECT * FROM user_profiles WHERE id = $1', [order.user_id]);
    const userProfile = userRes.rows[0] || null;

    // 5. Fetch dancer details
    const dancerRes = await client.query('SELECT * FROM dancer_profiles WHERE user_id = $1', [order.user_id]);
    const dancerProfile = dancerRes.rows[0] || null;

    // 6. Fetch battle entries
    const battlesRes = await client.query(
      `SELECT be.*, b.title as battle_title 
       FROM battle_entries be 
       JOIN battles b ON be.battle_id = b.id 
       WHERE be.user_id = $1 AND b.program_id = $2`,
      [order.user_id, order.item_id]
    );
    const battleEntries = battlesRes.rows;

    // 7. Fetch workshop bookings
    const workshopsRes = await client.query(
      `SELECT wb.*, w.name as workshop_name 
       FROM workshop_bookings wb 
       JOIN workshops w ON wb.workshop_id = w.id 
       WHERE wb.user_id = $1 AND w.program_id = $2`,
      [order.user_id, order.item_id]
    );
    const workshopBookings = workshopsRes.rows;

    // 8. Fetch spectator ticket orders
    const ticketsRes = await client.query('SELECT * FROM ticket_orders WHERE order_id = $1', [orderId]);
    const ticketOrders = ticketsRes.rows;

    // 9. Build chronological steps list
    const steps: { name: string; timestamp: Date; status: string; details: string }[] = [];

    // Step A: User Profile Creation
    if (userProfile) {
      steps.push({
        name: 'User Account Created',
        timestamp: userProfile.created_at,
        status: 'SUCCESS',
        details: `Account registered: ${userProfile.first_name} ${userProfile.last_name || ''} (${userProfile.email})`
      });
    }

    // Step B: Dancer Profile Registration
    if (dancerProfile) {
      steps.push({
        name: 'Dancer Profile Created',
        timestamp: dancerProfile.created_at,
        status: 'SUCCESS',
        details: `Stage name '${dancerProfile.stage_name}' synced under styles: ${dancerProfile.primary_style}`
      });
    }

    // Step C: Battle Entries
    if (battleEntries.length > 0) {
      battleEntries.forEach(entry => {
        steps.push({
          name: 'Battle Registration Submitted',
          timestamp: entry.submitted_at,
          status: entry.entry_status.toUpperCase(),
          details: `Registered for category: ${entry.battle_title}`
        });
      });
    }

    // Step D: Workshop Bookings
    if (workshopBookings.length > 0) {
      workshopBookings.forEach(booking => {
        steps.push({
          name: 'Workshop Seat Booked',
          timestamp: booking.created_at,
          status: 'SUCCESS',
          details: `Workshop: ${booking.workshop_name}`
        });
      });
    }

    // Step E: Spectator Ticket Sales
    if (ticketOrders.length > 0) {
      ticketOrders.forEach(ticket => {
        steps.push({
          name: 'Spectator Ticket Allocated',
          timestamp: ticket.created_at,
          status: ticket.status.toUpperCase(),
          details: `Day: ${ticket.day}, Qty: ${ticket.quantity}, Price: INR ${ticket.price}`
        });
      });
    }

    // Step F: Payment Processing Lifecycle
    if (payment) {
      steps.push({
        name: 'Payment Initiated',
        timestamp: payment.initiated_at,
        status: payment.status === 'initiated' ? 'SUCCESS' : payment.status.toUpperCase(),
        details: `Gateway: Paytm, Amount: INR ${payment.amount}`
      });

      if (payment.completed_at) {
        steps.push({
          name: 'Payment Confirmed by Gateway',
          timestamp: payment.completed_at,
          status: payment.status.toUpperCase(),
          details: `Txn ID: ${payment.transaction_id || 'N/A'}`
        });
      } else if (payment.failed_at) {
        steps.push({
          name: 'Payment Failed',
          timestamp: payment.failed_at,
          status: 'FAILED',
          details: 'Transaction terminated unexpectedly'
        });
      }
    }

    // Sort steps chronologically
    steps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Calculate validation status
    const isPaymentSuccess = order.status === 'completed' && payment && payment.status === 'success';
    const paidAmount = payment ? parseFloat(payment.amount) : 0;
    const orderAmount = parseFloat(order.amount);
    const isAmountCorrect = paidAmount >= orderAmount;

    let overallVerificationStatus = 'FAILED';
    let verificationMessage = 'Verification failed. Order payment is incomplete or mismatching.';

    if (isPaymentSuccess && isAmountCorrect) {
      overallVerificationStatus = 'VERIFIED';
      verificationMessage = 'All stages successfully completed and payment amount verified.';
    } else if (payment && payment.status === 'initiated') {
      overallVerificationStatus = 'PENDING';
      verificationMessage = 'Checkout transaction initiated but payment confirmation is pending.';
    }

    console.log(`[Checkout Verification] [${orderId}] Status: ${overallVerificationStatus}`);

    return reply.send({
      success: isPaymentSuccess && isAmountCorrect,
      verificationStatus: overallVerificationStatus,
      message: verificationMessage,
      orderDetails: {
        orderId: order.order_id,
        orderType: order.order_type,
        itemName: order.item_name,
        totalAmount: orderAmount,
        paidAmount: paidAmount,
        currency: order.currency
      },
      customer: {
        name: userProfile ? `${userProfile.first_name} ${userProfile.last_name || ''}`.trim() : 'Unknown',
        email: order.customer_email || (userProfile ? userProfile.email : ''),
        phone: order.customer_phone || (userProfile ? userProfile.phone : '')
      },
      timeline: steps
    });
  } catch (err: any) {
    console.error(`[Checkout Verification] [${orderId || 'Unknown'}] Error during QR check:`, err.message || err);
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error executing QR ticket verification' });
  } finally {
    client.release();
  }
}

/**
 * Signs a URL transition state by generating a cryptographically secured hash.
 */
export async function signTransition(request: FastifyRequest, reply: FastifyReply) {
  const { orderId, programId, step } = request.body as { orderId: string; programId: string; step: string };

  if (!orderId || !programId || !step) {
    return reply.status(400).send({ error: 'orderId, programId, and step are required to sign a transition' });
  }

  const hash = generateVerificationHash(`${orderId}:${programId}:${step}`);
  return reply.send({ success: true, hash });
}

/**
 * Verifies a state transition signature to prevent URL tampering or cheating.
 */
export async function verifyTransition(request: FastifyRequest, reply: FastifyReply) {
  const { orderId, programId, step, hash } = request.body as { orderId: string; programId: string; step: string; hash: string };

  if (!orderId || !programId || !step || !hash) {
    return reply.status(400).send({ error: 'orderId, programId, step, and hash are required to verify a transition' });
  }

  const expectedInput = `${orderId}:${programId}:${step}`;
  const verifiedPayload = verifyVerificationHash(hash);
  
  if (verifiedPayload === expectedInput) {
    return reply.send({ success: true, verified: true });
  } else {
    console.warn(`[Checkout Transition] Invalid signature hash for step: ${step}, expected: ${expectedInput}`);
    return reply.send({ success: false, verified: false, error: 'Invalid transition signature' });
  }
}
