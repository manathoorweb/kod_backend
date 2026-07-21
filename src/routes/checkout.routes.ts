import { Hono } from 'hono';
import { initiateCheckout, confirmCheckoutMock, verifyCheckoutQR, signTransition, verifyTransition } from '../controllers/checkout.controller.js';
import { validateInitiateCheckout, validateConfirmCheckout } from '../middleware/checkout.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.post('/initiate', wrap(validateInitiateCheckout), wrap(initiateCheckout));
app.post('/mock-success', wrap(validateConfirmCheckout), wrap(confirmCheckoutMock));
app.get('/verify-qr', wrap(verifyCheckoutQR));
app.post('/sign-transition', wrap(signTransition));
app.post('/verify-transition', wrap(verifyTransition));

export { app as checkoutRoutes };
