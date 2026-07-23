import Stripe from 'stripe';

function getCredentials() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (secretKey && publishableKey) {
    return { secretKey, publishableKey };
  }

  throw new Error(
    'Stripe credentials not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY environment variables.'
  );
}

export function getUncachableStripeClient() {
  const { secretKey } = getCredentials();
  return new Stripe(secretKey);
}

export function getStripePublishableKey() {
  const { publishableKey } = getCredentials();
  return publishableKey;
}

export function getStripeSecretKey() {
  const { secretKey } = getCredentials();
  return secretKey;
}
