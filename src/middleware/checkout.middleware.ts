import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db.js';

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
 * Validates the checkout initiation request body and checks database referential integrity
 */
export async function validateInitiateCheckout(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CheckoutBody;
  
  if (!body) {
    return reply.status(400).send({ error: 'Request body is empty' });
  }

  const { amount, customerId, customerEmail, customerPhone, orderType, itemId, itemName, selectedTickets } = body;

  // 1. Check basic field existence
  if (amount === undefined || !customerId || !customerEmail || !customerPhone || !orderType || !itemId || !itemName) {
    return reply.status(400).send({ 
      error: 'Missing required checkout fields: amount, customerId, customerEmail, customerPhone, orderType, itemId, and itemName are required.' 
    });
  }

  // 2. Validate amount is a positive number
  if (typeof amount !== 'number' || amount <= 0) {
    return reply.status(400).send({ error: 'Amount must be a positive number' });
  }

  // 3. Validate Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(customerEmail)) {
    return reply.status(400).send({ error: 'Invalid customer email format' });
  }

  // 4. Validate orderType
  const validOrderTypes = ['ticket', 'registration'];
  if (!validOrderTypes.includes(orderType)) {
    return reply.status(400).send({ error: `Invalid orderType. Must be one of: ${validOrderTypes.join(', ')}` });
  }

  // 5. Verify customer exists in user_profiles to prevent orphaned records
  try {
    const userRes = await pool.query('SELECT id FROM user_profiles WHERE id = $1', [customerId]);
    if (userRes.rows.length === 0) {
      return reply.status(400).send({ error: `Customer with ID '${customerId}' does not exist` });
    }
  } catch (err: any) {
    request.log.error(`[Checkout Middleware] Error validating customerId: ${err.message}`);
    return reply.status(500).send({ error: 'Database check failed during customer validation' });
  }

  // 6. Verify UUID format for itemId (which refers to program ID, battle ID, or workshop ID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(itemId)) {
    return reply.status(400).send({ error: 'itemId must be a valid UUID' });
  }

  // 7. Verify referred item (program) exists
  try {
    const programRes = await pool.query('SELECT id FROM programs WHERE id = $1', [itemId]);
    if (programRes.rows.length === 0) {
      return reply.status(400).send({ error: `Referenced program ID '${itemId}' does not exist` });
    }
  } catch (err: any) {
    request.log.error(`[Checkout Middleware] Error validating itemId: ${err.message}`);
    return reply.status(500).send({ error: 'Database check failed during item validation' });
  }

  // 8. Validate Upsold Tickets if present
  if (selectedTickets !== undefined) {
    if (!Array.isArray(selectedTickets)) {
      return reply.status(400).send({ error: 'selectedTickets must be an array of ticket configurations' });
    }

    for (const ticket of selectedTickets) {
      if (!ticket.day || ticket.price === undefined || ticket.quantity === undefined) {
        return reply.status(400).send({ error: 'Every upsold ticket configuration must have day, price, and quantity' });
      }

      if (typeof ticket.price !== 'number' || ticket.price < 0) {
        return reply.status(400).send({ error: 'Ticket price must be a non-negative number' });
      }

      if (typeof ticket.quantity !== 'number' || !Number.isInteger(ticket.quantity) || ticket.quantity <= 0) {
        return reply.status(400).send({ error: 'Ticket quantity must be a positive integer' });
      }
    }
  }
}

/**
 * Validates request parameter for mock payment success confirmation
 */
export async function validateConfirmCheckout(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { orderId: string };
  if (!body || !body.orderId) {
    return reply.status(400).send({ error: 'Order ID is required' });
  }
}
