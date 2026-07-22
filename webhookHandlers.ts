import Stripe from 'stripe';
import { getStripeSecretKey } from './stripeClient';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      // No webhook secret configured — skip verification in dev/test
      return;
    }

    const stripe = new Stripe(getStripeSecretKey());
    // Throws StripeSignatureVerificationError if signature is invalid
    stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}
