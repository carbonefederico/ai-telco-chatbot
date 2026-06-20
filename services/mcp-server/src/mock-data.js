export const customers = {
  'cust-1001': {
    customerId: 'cust-1001',
    name: 'Federico Carbone',
    plan: 'Fiber Max 1 Gbps + Mobile Unlimited',
    status: 'active',
    tenureMonths: 38,
    loyaltyTier: 'gold',
    devices: [
      { type: 'router', model: 'TelcoHub X6', status: 'online' },
      { type: 'sim', label: 'Primary mobile SIM', status: 'active' }
    ],
    usage: {
      mobileDataGb: 42.8,
      homeDataGb: 812,
      billingCycleEndsOn: '2026-06-30'
    }
  }
};

export const payments = {
  'cust-1001': {
    customerId: 'cust-1001',
    balanceDue: 76.45,
    currency: 'EUR',
    dueDate: '2026-06-27',
    autopay: true,
    lastPayment: {
      amount: 76.45,
      date: '2026-05-28',
      method: 'Visa ending 4242'
    },
    invoices: [
      { id: 'inv-2026-06', period: 'June 2026', issuedOn: '2026-06-13', dueDate: '2026-06-27', amount: 76.45, status: 'open' },
      { id: 'inv-2026-05', period: 'May 2026', issuedOn: '2026-05-13', dueDate: '2026-05-27', amount: 76.45, status: 'paid' },
      { id: 'inv-2026-04', period: 'April 2026', issuedOn: '2026-04-13', dueDate: '2026-04-27', amount: 74.9, status: 'paid' },
      { id: 'inv-2026-03', period: 'March 2026', issuedOn: '2026-03-13', dueDate: '2026-03-27', amount: 74.9, status: 'paid' }
    ]
  }
};

export function resolveCustomerId(requestedCustomerId, authInfo) {
  return requestedCustomerId || authInfo?.extra?.customerId || 'cust-1001';
}
